import Foundation
import UniformTypeIdentifiers

// Sending, as roartransfer.com does (roartransfer-r2): each file goes up to R2 in 16 MB pieces, three at a time,
// each piece tried again if the connection drops, then one link for everything (bundle). The files are the
// originals the phone has, never made smaller.
struct Picked: Identifiable, Hashable {
    let id = UUID()
    let url: URL      // a copy in the app's temporary folder
    let name: String
    let size: Int64
    let type: String
    var isMedia: Bool { type.hasPrefix("video/") || type.hasPrefix("image/") }

    static func from(_ url: URL, name: String? = nil) -> Picked {
        let n = name ?? url.lastPathComponent
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
        let t = UTType(filenameExtension: (n as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return Picked(url: url, name: n, size: size, type: t)
    }

    // a file that came in for a moment (the picker's own copy): kept in our temporary folder until it is sent
    static func copy(_ src: URL, name: String? = nil) throws -> Picked {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("send", isDirectory: true).appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent(name ?? src.lastPathComponent)
        try FileManager.default.copyItem(at: src, to: dest)
        return from(dest, name: name)
    }
}

@MainActor
final class Uploader: ObservableObject {
    @Published var sentBytes: Int64 = 0
    @Published var totalBytes: Int64 = 0
    @Published var current = ""
    @Published var busy = false
    @Published var link: String?
    @Published var errors: [String] = []
    private var stopped = false
    private var running: Task<Void, Never>?

    static let part: Int64 = 16 * 1024 * 1024

    func send(_ files: [Picked], days: Int, title: String, message: String, password: String) {
        guard !busy, !files.isEmpty else { return }
        busy = true; stopped = false; link = nil; errors = []
        sentBytes = 0; totalBytes = files.reduce(0) { $0 + $1.size }
        running = Task {
            UIApplicationBackground.begin()
            defer { UIApplicationBackground.end() }
            var tokens: [String] = []
            var before: Int64 = 0
            for f in files {
                if stopped { break }
                current = f.name
                do {
                    let t = try await upOne(f, days: days, before: before)
                    tokens.append(t)
                } catch {
                    if stopped { break }
                    errors.append("\(f.name): \(error.localizedDescription)")
                    if let e = error as? APIError, e.limit || e.daily { break }
                }
                before += f.size
                sentBytes = before
            }
            if !tokens.isEmpty && !stopped {
                var body: [String: Any] = ["action": "bundle", "tokens": tokens, "title": title, "message": message, "recipients": [String](), "password": password, "notify": true]
                if password.isEmpty { body.removeValue(forKey: "password") }
                do {
                    let b = try await API.bridge(body, as: Bundled.self)
                    link = Config.page + b.token
                } catch {
                    if tokens.count == 1 { link = Config.page + tokens[0] } else { errors.append(error.localizedDescription) }
                }
            }
            if stopped && tokens.isEmpty { errors = [] }
            busy = false
            for f in files { try? FileManager.default.removeItem(at: f.url.deletingLastPathComponent()) }
        }
    }

    func stop() { stopped = true; running?.cancel() }

    private func upOne(_ f: Picked, days: Int, before: Int64) async throws -> String {
        let made = try await API.bridge(["action": "create", "name": f.name, "size": f.size, "type": f.type, "days": days], as: Upload.self)
        let n = max(1, Int((f.size + Uploader.part - 1) / Uploader.part))
        var urls: [Int: String] = [:]
        var etags: [Int: String] = [:]
        var loaded: [Int: Int64] = [:]
        var next = 1

        func sign(_ from: Int) async throws {
            let want = Array(from...min(n, from + 19)).filter { urls[$0] == nil && etags[$0] == nil }
            if want.isEmpty { return }
            let got = try await API.bridge(["action": "sign", "key": made.key, "uploadId": made.uploadId, "parts": want], as: Signed.self)
            for (k, v) in got.urls { if let i = Int(k) { urls[i] = v } }
        }
        func report() { sentBytes = before + loaded.values.reduce(0, +) }

        do {
            try await withThrowingTaskGroup(of: (Int, String).self) { group in
                var inFlight = 0
                while next <= n || inFlight > 0 {
                    while inFlight < 3 && next <= n {
                        let i = next; next += 1
                        if urls[i] == nil { try await sign(i) }
                        guard let u = urls[i], let url = URL(string: u) else { throw APIError(message: "Could not sign the upload.") }
                        let from = Int64(i - 1) * Uploader.part
                        let len = min(Uploader.part, f.size - from)
                        let file = f.url
                        group.addTask {
                            var tries = 0
                            while true {
                                try Task.checkCancellation()
                                do {
                                    let data = try Uploader.read(file, from: from, length: len)
                                    var r = URLRequest(url: url); r.httpMethod = "PUT"; r.timeoutInterval = 300
                                    let (_, resp) = try await URLSession.shared.upload(for: r, from: data)
                                    let h = resp as? HTTPURLResponse
                                    if let h, (200..<300).contains(h.statusCode) { return (i, h.value(forHTTPHeaderField: "ETag") ?? "") }
                                    throw APIError(message: "Upload failed (\(h?.statusCode ?? 0))")
                                } catch {
                                    if error is CancellationError { throw error }
                                    tries += 1
                                    if tries > 6 { throw error }
                                    try await Task.sleep(nanoseconds: UInt64(min(30.0, pow(2.0, Double(tries)))) * 1_000_000_000)
                                }
                            }
                        }
                        inFlight += 1
                    }
                    guard let done = try await group.next() else { break }
                    let (i, tag) = done
                    inFlight -= 1
                    etags[i] = tag
                    loaded[i] = min(Uploader.part, f.size - Int64(i - 1) * Uploader.part)
                    report()
                    if stopped { throw CancellationError() }
                }
            }
        } catch {
            _ = try? await API.bridge(["action": "abort", "key": made.key, "uploadId": made.uploadId], as: [String: Bool].self)
            if error is CancellationError { throw APIError(message: "Stopped.") }
            throw error
        }
        let parts = etags.keys.sorted().map { ["n": $0, "etag": etags[$0]!] as [String: Any] }
        let fin = try await API.bridge(["action": "complete", "key": made.key, "uploadId": made.uploadId, "parts": parts, "name": f.name, "size": f.size, "type": f.type, "days": days], as: Completed.self)
        return fin.token
    }

    nonisolated static func read(_ url: URL, from: Int64, length: Int64) throws -> Data {
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        try h.seek(toOffset: UInt64(from))
        return try h.read(upToCount: Int(length)) ?? Data()
    }
}
