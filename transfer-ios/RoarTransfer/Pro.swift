import Foundation
import SwiftUI

// What the website knows about the account beyond signing in: Pro (roartransfer-r2 'pro' and roartransfer-pro 'me'),
// the Receive-files page and what came through it, the brand, and the email choices (roar_transfer_mail_prefs).
struct Received: Codable, Identifiable, Hashable {
    var sender_name: String?
    var sender_email: String?
    var files: Double?
    var bytes: Double?
    var created_at: String?
    var message: String?
    var bundle: String?
    var id: String { (bundle ?? "") + (created_at ?? "") }
}
struct ProInfo: Codable { var pro: Bool?; var slug: String?; var name: String?; var received: [Received]? }
struct Brand: Codable, Equatable { var name: String?; var logo: String?; var bgs: [String]? }
struct ProMe: Codable { var admin: Bool?; var until: String?; var brand: Brand? }
struct LinkEvent: Codable, Hashable { var kind: String?; var at: String?; var country: String?; var device: String? }
struct LinkDetails: Codable {
    var expires: String?
    var max: String?
    var bundle: String?
    var locked: Bool?
    var payLock: Bool?
    var events: [LinkEvent]?
}
struct EditReply: Codable { var until: String?; var locked: Bool?; var payLock: Bool? }
struct MailPrefs: Codable { var downloads: Bool?; var received: Bool? }

@MainActor
final class ProStore: ObservableObject {
    static let shared = ProStore()
    @Published var info: ProInfo?
    @Published var me: ProMe?
    @Published var mails = MailPrefs(downloads: true, received: true)
    var isPro: Bool { Session.shared.signedIn && (info?.pro ?? false) }

    func load() async {
        guard Session.shared.signedIn else { info = nil; me = nil; return }
        info = try? await API.bridge(["action": "pro"], as: ProInfo.self)
        me = try? await API.pro(["action": "me"], as: ProMe.self)
        if let m = try? await API.mailPrefs() { mails = m }
    }

    func setMail(downloads: Bool? = nil, received: Bool? = nil) {
        var m = mails
        if let downloads { m.downloads = downloads }
        if let received { m.received = received }
        let old = mails
        mails = m
        Task { do { try await API.saveMailPrefs(m) } catch { mails = old } }
    }

    var planText: String {
        guard isPro else { return "Free" }
        if me?.admin == true { return t("Pro, lifetime") }
        if let u = me?.until, let d = Dates.parse(u) { return t("Pro until") + " " + DateFormatter.localizedString(from: d, dateStyle: .medium, timeStyle: .none) }
        return t("Pro, lifetime")
    }
}

extension API {
    static func pro<T: Decodable>(_ body: [String: Any], as: T.Type) async throws -> T {
        let token = await Session.shared.freshToken()
        let (d, r) = try await URLSession.shared.data(for: request(Config.base.appendingPathComponent("functions/v1/roartransfer-pro"), method: "POST", body: body, auth: token ?? ""))
        let code = (r as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(code) {
            let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
            throw APIError(message: (j["error"] as? String) ?? "Error \(code)")
        }
        return try JSONDecoder().decode(T.self, from: d)
    }

    static func mailPrefs() async throws -> MailPrefs? {
        guard let token = await Session.shared.freshToken() else { return nil }
        var c = URLComponents(url: Config.base.appendingPathComponent("rest/v1/roar_transfer_mail_prefs"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "select", value: "downloads,received")]
        let (d, _) = try await URLSession.shared.data(for: request(c.url!, auth: token))
        return (try? JSONDecoder().decode([MailPrefs].self, from: d))?.first ?? MailPrefs(downloads: true, received: true)
    }

    static func saveMailPrefs(_ m: MailPrefs) async throws {
        guard let token = await Session.shared.freshToken(), let uid = Session.shared.userId else { return }
        var r = request(Config.base.appendingPathComponent("rest/v1/roar_transfer_mail_prefs"), method: "POST",
                        body: ["user_id": uid, "downloads": m.downloads ?? true, "received": m.received ?? true], auth: token)
        r.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
        let (_, resp) = try await URLSession.shared.data(for: r)
        guard (200..<300).contains((resp as? HTTPURLResponse)?.statusCode ?? 0) else { throw APIError(message: "Could not save.") }
    }

    // RoarTransfer's own sign-up and password emails (roartransfer-auth, the same as the website)
    static func auth(_ body: [String: Any]) async throws -> [String: Any] {
        let (d, _) = try await URLSession.shared.data(for: request(Config.base.appendingPathComponent("functions/v1/roartransfer-auth"), method: "POST", body: body))
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:]
    }

    // a picture for the brand, into roartransfer-brand/<id>/, its public address back
    static func uploadBrandPicture(_ data: Data, type: String) async throws -> String {
        guard let token = await Session.shared.freshToken(), let uid = Session.shared.userId else { throw APIError(message: "Sign in first.") }
        let ext = type == "image/png" ? "png" : type == "image/webp" ? "webp" : type == "image/gif" ? "gif" : "jpg"
        let path = "\(uid)/\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(6).lowercased()).\(ext)"
        var r = URLRequest(url: Config.base.appendingPathComponent("storage/v1/object/roartransfer-brand/" + path))
        r.httpMethod = "POST"
        r.setValue(Config.key, forHTTPHeaderField: "apikey")
        r.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        r.setValue(type, forHTTPHeaderField: "Content-Type")
        let (_, resp) = try await URLSession.shared.upload(for: r, from: data)
        guard (200..<300).contains((resp as? HTTPURLResponse)?.statusCode ?? 0) else { throw APIError(message: "Could not upload the picture.") }
        return Config.base.absoluteString + "/storage/v1/object/public/roartransfer-brand/" + path
    }
}
