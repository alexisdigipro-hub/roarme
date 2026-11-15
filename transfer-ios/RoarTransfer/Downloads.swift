import Foundation
import Photos
import UIKit

// Downloads that go on with the screen locked or the app closed (a background URLSession, run by iOS itself, so a
// 20 GB video never sits in memory). When a file is down: a video or photo goes straight into Photos, anything else
// stays in RoarTransfer's folder, which the Files app shows (On My iPhone > RoarTransfer).
@MainActor
final class Downloads: NSObject, ObservableObject {
    static let shared = Downloads()

    enum State: Equatable { case waiting, loading(Double), saving, inPhotos, inFiles(URL), failed(String) }
    struct Item: Identifiable, Equatable {
        let id: String          // the file's token (or its address)
        let name: String
        let size: Int64
        let toPhotos: Bool
        var state: State
    }
    @Published private(set) var items: [String: Item] = [:]

    var backgroundDone: (() -> Void)?
    private var tasks: [Int: String] = [:]   // URLSession task id -> item id

    lazy var session: URLSession = {
        let c = URLSessionConfiguration.background(withIdentifier: "com.themadlions.roartransfer.downloads")
        c.isDiscretionary = false
        c.sessionSendsLaunchEvents = true
        c.allowsCellularAccess = true
        return URLSession(configuration: c, delegate: self, delegateQueue: nil)
    }()

    nonisolated static var folder: URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    // the address roar-transfer-get gives (?dl=1 counts the download, then sends on to R2); o=1 asks R2 for plain
    // bytes with the file's own name
    func start(_ f: LinkFile, toPhotos: Bool) {
        guard let s = f.url, var c = URLComponents(string: s) else { return }
        if c.path.hasSuffix("/roar-transfer-get"), c.queryItems?.contains(where: { $0.name == "dl" }) == true {
            c.queryItems = (c.queryItems ?? []).filter { $0.name != "o" } + [URLQueryItem(name: "o", value: "1")]
        }
        guard let url = c.url else { return }
        if let cur = items[f.id], case .loading = cur.state { return }
        if toPhotos { PHPhotoLibrary.requestAuthorization(for: .addOnly) { _ in } }
        let t = session.downloadTask(with: url)
        t.taskDescription = [f.id, f.displayName, String(f.bytes), toPhotos ? "1" : "0"].joined(separator: "\u{1f}")
        tasks[t.taskIdentifier] = f.id
        items[f.id] = Item(id: f.id, name: f.displayName, size: f.bytes, toPhotos: toPhotos, state: .loading(0))
        t.resume()
    }

    func cancel(_ id: String) {
        session.getAllTasks { all in
            for t in all where (t.taskDescription ?? "").hasPrefix(id + "\u{1f}") { t.cancel() }
        }
        items[id] = nil
    }

    // after the app was closed: pick up what iOS is still downloading
    func reattach() {
        session.getAllTasks { all in
            Task { @MainActor in
                for t in all {
                    let p = (t.taskDescription ?? "").components(separatedBy: "\u{1f}")
                    guard p.count == 4 else { continue }
                    self.tasks[t.taskIdentifier] = p[0]
                    if self.items[p[0]] == nil {
                        self.items[p[0]] = Item(id: p[0], name: p[1], size: Int64(p[2]) ?? 0, toPhotos: p[3] == "1", state: .loading(0))
                    }
                }
            }
        }
    }

    fileprivate func set(_ id: String, _ s: State) {
        guard var it = items[id] else { return }
        it.state = s; items[id] = it
    }

    // a file kept with its own name in RoarTransfer's folder ("name (2).mp4" if one is there already)
    nonisolated static func keep(_ tmp: URL, name: String) throws -> URL {
        let clean = name.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
        let base = (clean as NSString).deletingPathExtension, ext = (clean as NSString).pathExtension
        var dest = folder.appendingPathComponent(clean.isEmpty ? "file" : clean)
        var n = 2
        while FileManager.default.fileExists(atPath: dest.path) {
            dest = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)"); n += 1
        }
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    nonisolated static func toPhotos(_ file: URL, video: Bool) async throws {
        let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard status == .authorized || status == .limited else { throw APIError(message: "RoarTransfer may not add to Photos. Allow it in Settings > RoarTransfer > Photos.") }
        try await PHPhotoLibrary.shared().performChanges {
            let r = PHAssetCreationRequest.forAsset()
            let o = PHAssetResourceCreationOptions(); o.shouldMoveFile = false
            r.addResource(with: video ? .video : .photo, fileURL: file, options: o)
        }
    }
}

extension Downloads: URLSessionDownloadDelegate {
    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let p = (downloadTask.taskDescription ?? "").components(separatedBy: "\u{1f}")
        guard p.count == 4 else { return }
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (Int64(p[2]) ?? 0)
        let frac = total > 0 ? Double(totalBytesWritten) / Double(total) : 0
        Task { @MainActor in
            if case .loading(let old) = self.items[p[0]]?.state, frac - old < 0.005 && frac < 1 { return }
            self.set(p[0], .loading(min(frac, 1)))
        }
    }

    nonisolated func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let p = (downloadTask.taskDescription ?? "").components(separatedBy: "\u{1f}")
        guard p.count == 4 else { return }
        let id = p[0], name = p[1], photos = p[3] == "1"
        let code = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 200
        let mime = (downloadTask.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
        // a link that ended or was used up sends the browser back to its page: that is no file
        if code >= 400 || mime.contains("text/html") {
            Task { @MainActor in self.set(id, .failed(code == 410 || mime.contains("text/html") ? "This file is no longer available." : "Download failed (\(code)).")) }
            return
        }
        // the file must be moved before this returns
        let kept: URL
        do { kept = try Downloads.keep(location, name: name) } catch {
            Task { @MainActor in self.set(id, .failed("Could not keep the file: \(error.localizedDescription)")) }
            return
        }
        let ext = (name as NSString).pathExtension.lowercased()
        let video = ["mov", "mp4", "m4v", "hevc"].contains(ext)
        Task {
            guard photos else { await MainActor.run { self.set(id, .inFiles(kept)) }; return }
            await MainActor.run { self.set(id, .saving) }
            do {
                try await Downloads.toPhotos(kept, video: video)
                try? FileManager.default.removeItem(at: kept)
                await MainActor.run { self.set(id, .inPhotos) }
            } catch {
                // Photos refused it (a format it cannot take): it stays in Files
                await MainActor.run { self.set(id, .inFiles(kept)) }
            }
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error else { return }
        let p = (task.taskDescription ?? "").components(separatedBy: "\u{1f}")
        guard p.count == 4 else { return }
        if (error as NSError).code == NSURLErrorCancelled { return }
        Task { @MainActor in self.set(p[0], .failed(error.localizedDescription)) }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in self.backgroundDone?(); self.backgroundDone = nil }
    }
}
