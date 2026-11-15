import Foundation
import Security

// The RoarTransfer account (the same as on roartransfer.com): email and password through Supabase's sign-in,
// the session kept in the Keychain, refreshed before it runs out.
@MainActor
final class Session: ObservableObject {
    static let shared = Session()

    struct Stored: Codable { var access: String; var refresh: String; var expires: Double; var email: String; var name: String }
    @Published private(set) var stored: Stored?
    var signedIn: Bool { stored != nil }
    var email: String { stored?.email ?? "" }
    var name: String { stored?.name ?? "" }
    // the account's id, read from the access token (its "sub")
    var userId: String? {
        guard let a = stored?.access else { return nil }
        let parts = a.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var b = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        guard let d = Data(base64Encoded: b), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return nil }
        return j["sub"] as? String
    }

    // Create account and Forgot password, through RoarTransfer's own emails (roartransfer-auth), as the website
    func signUp(name: String, email: String, password: String) async throws {
        let d = try await API.auth(["action": "signup", "email": email, "password": password, "name": name])
        if d["ok"] as? Bool == true { return }
        let e = d["error"] as? String ?? ""
        throw APIError(message: e == "taken" ? "There is already an account with this email. Sign in instead." : e == "wait" ? "Wait a minute and try again." : e == "email" ? "This does not look like an email." : (e.isEmpty ? "Could not create the account. Try again." : e))
    }
    func reset(email: String) async throws {
        let d = try await API.auth(["action": "reset", "email": email])
        if d["ok"] as? Bool == true { return }
        throw APIError(message: d["error"] as? String == "wait" ? "Wait a minute and try again." : "Could not reach RoarTransfer. Check the connection and try again.")
    }

    // Studio runs the website inside the app: it gets this session, and hands back any newer one it makes
    func adopt(access: String, refresh: String, expiresAt: Double) {
        guard var s = stored, refresh != s.refresh || access != s.access else { return }
        s.access = access; s.refresh = refresh; s.expires = expiresAt
        stored = s
        if let d = try? JSONEncoder().encode(s) { keychainWrite(d) }
    }

    private let account = "roartransfer.session"

    init() {
        if let d = keychainRead(), let s = try? JSONDecoder().decode(Stored.self, from: d) { stored = s }
    }

    private struct TokenReply: Decodable {
        struct User: Decodable { var email: String?; var user_metadata: [String: AnyCodable]? }
        var access_token: String?; var refresh_token: String?; var expires_in: Double?; var user: User?
        var error_description: String?; var msg: String?; var error: String?
    }

    func signIn(email: String, password: String) async throws {
        try await grant("password", body: ["email": email, "password": password])
    }

    func signOut() {
        if let t = stored?.access {
            var r = API.request(Config.base.appendingPathComponent("auth/v1/logout"), method: "POST", body: [String: Any](), auth: t)
            r.timeoutInterval = 8
            URLSession.shared.dataTask(with: r).resume()
        }
        stored = nil
        keychainDelete()
    }

    // Delete account (App Store 5.1.1(v), 15 Nov 2026): the same RoarMe account as the website, deleted on the server by
    // roar_delete_me (its transfers, links, brand and Receive files page go with it), then signed out here
    func deleteAccount() async throws {
        guard let t = await freshToken() else { throw APIError(message: "Sign in again first.") }
        var r = API.request(Config.base.appendingPathComponent("rest/v1/rpc/roar_delete_me"), method: "POST", body: [String: Any](), auth: t)
        r.timeoutInterval = 20
        let (_, resp) = try await URLSession.shared.data(for: r)
        guard let code = (resp as? HTTPURLResponse)?.statusCode, (200..<300).contains(code) else { throw APIError(message: "Could not delete the account. Try again.") }
        stored = nil
        keychainDelete()
    }

    // a token good for at least a minute more, or nil when signed out
    func freshToken() async -> String? {
        guard let s = stored else { return nil }
        if s.expires - Date().timeIntervalSince1970 > 60 { return s.access }
        do { try await grant("refresh_token", body: ["refresh_token": s.refresh]) } catch {
            // only a refused refresh signs out; no connection keeps the session for later
            if (error as? APIError) != nil { signOut() }
            return nil
        }
        return stored?.access
    }

    private func grant(_ kind: String, body: [String: Any]) async throws {
        var c = URLComponents(url: Config.base.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        c.queryItems = [URLQueryItem(name: "grant_type", value: kind)]
        let (d, r) = try await URLSession.shared.data(for: API.request(c.url!, method: "POST", body: body))
        let reply = try? JSONDecoder().decode(TokenReply.self, from: d)
        guard (r as? HTTPURLResponse)?.statusCode == 200, let a = reply?.access_token, let rf = reply?.refresh_token else {
            let m = reply?.error_description ?? reply?.msg ?? reply?.error ?? ""
            throw APIError(message: m.lowercased().contains("invalid") ? "Wrong email or password." : m.lowercased().contains("confirm") ? "Open the email we sent you and confirm your account first." : (m.isEmpty ? "Could not sign in. Try again." : m))
        }
        let meta = reply?.user?.user_metadata ?? [:]
        let nm = (meta["name"]?.value as? String) ?? (meta["display_name"]?.value as? String) ?? stored?.name ?? ""
        let s = Stored(access: a, refresh: rf, expires: Date().timeIntervalSince1970 + (reply?.expires_in ?? 3600), email: reply?.user?.email ?? stored?.email ?? "", name: nm)
        stored = s
        if let d = try? JSONEncoder().encode(s) { keychainWrite(d) }
    }

    // ---- Keychain ----
    private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.themadlions.roartransfer", kSecAttrAccount as String: account] }
    private func keychainRead() -> Data? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
    }
    private func keychainWrite(_ d: Data) {
        keychainDelete()
        var q = query; q[kSecValueData as String] = d; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }
    private func keychainDelete() { SecItemDelete(query as CFDictionary) }
}

// just enough to read user_metadata
struct AnyCodable: Decodable {
    let value: Any?
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let b = try? c.decode(Bool.self) { value = b }
        else if let n = try? c.decode(Double.self) { value = n }
        else { value = nil }
    }
}
