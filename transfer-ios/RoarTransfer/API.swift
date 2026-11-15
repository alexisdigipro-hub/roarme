import Foundation

// RoarTransfer's own servers, the same ones roartransfer.com talks to (RoarMe's Supabase project). The key is the
// public, publishable one the website carries too; what each person may do is enforced on the server.
enum Config {
    static let base = URL(string: "https://bzmjhbnwhdwmncxkqkdl.supabase.co")!
    static let key = "sb_publishable_7mQ3e0NH5lCmdoIKx2-FUA_EgCoXx9X"
    static let page = "https://roartransfer.com/"
    static var getFn: URL { base.appendingPathComponent("functions/v1/roar-transfer-get") }
    static var bridgeFn: URL { base.appendingPathComponent("functions/v1/roartransfer-r2") }
}

struct APIError: LocalizedError {
    let message: String
    var limit = false
    var daily = false
    var errorDescription: String? { message }
}

// One file of a link, as roar-transfer-get gives it
struct LinkFile: Codable, Identifiable, Hashable {
    var token: String?
    var name: String?
    var size: Double?
    var type: String?
    var expires: String?
    var url: String?
    var view: String?
    var used: Bool?
    var left: Int?
    var id: String { token ?? (name ?? "") + (url ?? "") }
    var displayName: String { name ?? "file" }
    var bytes: Int64 { Int64(size ?? 0) }
    var isVideo: Bool { (type ?? "").hasPrefix("video/") || ["mov", "mp4", "m4v", "hevc"].contains(ext) }
    var isImage: Bool { ((type ?? "").hasPrefix("image/") && !(type ?? "").contains("svg")) || ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp"].contains(ext) }
    var isMedia: Bool { isVideo || isImage }
    var ext: String { (displayName as NSString).pathExtension.lowercased() }
}

// What a link shows: one file, or an upload of many (bundle)
struct LinkInfo: Codable {
    var bundle: Bool?
    var title: String?
    var message: String?
    var from: String?
    var expires: String?
    var error: String?
    var wrong: Bool?
    var slow: Bool?
    var grace: Bool?
    var files: [LinkFile]?
    // a single file's link carries the file's fields at the top
    var token: String?
    var name: String?
    var size: Double?
    var type: String?
    var url: String?
    var view: String?
    var used: Bool?
    var left: Int?

    var allFiles: [LinkFile] {
        if let f = files { return f }
        if name != nil { return [LinkFile(token: token, name: name, size: size, type: type, expires: expires, url: url, view: view, used: used, left: left)] }
        return []
    }
}

struct Upload: Codable { var key: String; var uploadId: String }
struct Signed: Codable { var urls: [String: String] }
struct Completed: Codable { var token: String; var size: Double?; var expires: String? }
struct Bundled: Codable { var token: String }

// a row of My transfers (roar_my_transfers)
struct MyTransfer: Codable, Identifiable, Hashable {
    var path: String?
    var name: String?
    var size: Double?
    var type: String?
    var created_at: String?
    var expires: String?
    var source: String?
    var token: String?
    var opens: Double?
    var downloads: Double?
    var stopped: Bool?
    var deleted: Bool?
    var id: String { (token ?? "") + (path ?? "") + (created_at ?? "") }
    var live: Bool { !(stopped ?? false) && !(deleted ?? false) && (Dates.parse(expires) ?? .distantPast) > Date() }
}

enum Dates {
    static func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = a.date(from: s) { return d }
        let b = ISO8601DateFormatter(); b.formatOptions = [.withInternetDateTime]
        if let d = b.date(from: s) { return d }
        // Postgres' own form: "2026-11-15 10:00:00.123+00"
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX")
        for p in ["yyyy-MM-dd HH:mm:ss.SSSSSSXXXXX", "yyyy-MM-dd HH:mm:ss.SSSXXXXX", "yyyy-MM-dd HH:mm:ssXXXXX", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXXXX"] {
            f.dateFormat = p; if let d = f.date(from: s) { return d }
        }
        return nil
    }
    static func short(_ s: String?) -> String {
        guard let d = parse(s) else { return "" }
        let f = DateFormatter(); f.dateFormat = "EEE d MMM, HH:mm"
        return f.string(from: d)
    }
}

func sizeText(_ b: Int64) -> String {
    let f = ByteCountFormatter(); f.countStyle = .file
    return f.string(fromByteCount: b)
}

enum API {
    static func token(from text: String) -> String? {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.range(of: "^[A-Za-z0-9]{6,32}$", options: .regularExpression) != nil { return s }
        guard let u = URLComponents(string: s.hasPrefix("http") ? s : "https://" + s) else { return nil }
        if let t = u.queryItems?.first(where: { $0.name == "t" })?.value, t.range(of: "^[A-Za-z0-9]{6,32}$", options: .regularExpression) != nil { return t }
        // roartransfer.com/<token>, go.themadlions.com/?transfer/<token> and the like: the last plain piece
        let parts = (u.path + "/" + (u.query ?? "")).split(whereSeparator: { $0 == "/" || $0 == "?" || $0 == "&" }).map(String.init)
        return parts.reversed().first(where: { $0.range(of: "^[A-Za-z0-9]{6,32}$", options: .regularExpression) != nil && !["studio", "pricing", "about", "privacy", "terms"].contains($0) })
    }

    static func request(_ url: URL, method: String = "GET", body: Any? = nil, auth: String? = nil) -> URLRequest {
        var r = URLRequest(url: url)
        r.httpMethod = method
        r.setValue(Config.key, forHTTPHeaderField: "apikey")
        if let auth { r.setValue("Bearer " + auth, forHTTPHeaderField: "Authorization") }
        if let body { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        r.cachePolicy = .reloadIgnoringLocalCacheData
        return r
    }

    static func link(_ t: String, password: String = "") async throws -> LinkInfo {
        var c = URLComponents(url: Config.getFn, resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "t", value: t)] + (password.isEmpty ? [] : [URLQueryItem(name: "p", value: password)])
        let token = await Session.shared.freshToken()
        let (d, r) = try await URLSession.shared.data(for: request(c.url!, auth: token))
        let info = (try? JSONDecoder().decode(LinkInfo.self, from: d)) ?? LinkInfo(error: "Error \((r as? HTTPURLResponse)?.statusCode ?? 0)")
        return info
    }

    // an open counted for the sender's panel, as the website does
    static func hit(_ t: String) {
        let r = request(Config.base.appendingPathComponent("rest/v1/rpc/roar_transfer_hit"), method: "POST", body: ["t": t, "dl": false])
        URLSession.shared.dataTask(with: r).resume()
    }

    // the bridge to R2 (roartransfer-r2): create, sign, complete, abort, bundle, guest
    static func bridge<T: Decodable>(_ body: [String: Any], as: T.Type) async throws -> T {
        let token = await Session.shared.freshToken()
        let (d, r) = try await URLSession.shared.data(for: request(Config.bridgeFn, method: "POST", body: body, auth: token))
        let code = (r as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) {
            let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
            if j["limit"] as? Bool == true { throw APIError(message: "You have used today's free transfers. Sign in to send more.", limit: true) }
            if j["daily"] as? Bool == true { throw APIError(message: "That is today's limit for this account. The rest can go tomorrow.", daily: true) }
            throw APIError(message: (j["error"] as? String) ?? "Error \(code)")
        }
        return try JSONDecoder().decode(T.self, from: d)
    }

    static func myTransfers() async throws -> [MyTransfer] {
        guard let token = await Session.shared.freshToken() else { return [] }
        let (d, r) = try await URLSession.shared.data(for: request(Config.base.appendingPathComponent("rest/v1/rpc/roar_my_transfers"), method: "POST", body: [String: Any](), auth: token))
        guard (r as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(message: "Could not load your transfers.") }
        return try JSONDecoder().decode([MyTransfer].self, from: d)
    }
}
