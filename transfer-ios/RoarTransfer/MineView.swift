import SwiftUI
import UIKit

// My transfers, as roartransfer.com: "My transfers." with the totals in one line, All | Active | Expired, the search,
// one row a transfer; a row opens its window (the link, copy, share, open, delete). Signed out: the sign-in card.
struct MineView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @State private var email = ""
    @State private var password = ""
    @State private var err = ""
    @State private var busy = false
    @State private var list: [MyTransfer]?
    @State private var listErr = ""
    @State private var filter = 0
    @State private var query = ""
    @State private var open: MyTransfer?

    var body: some View {
        ScrollView {
            Card {
                if session.signedIn { mine } else { signIn }
            }
            .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 30)
        }
        .refreshable { await load() }
        .scrollDismissesKeyboard(.interactively)
        .task(id: session.signedIn) { if session.signedIn { await load() } else { list = nil } }
        .sheet(item: $open) { m in TransferSheet(m: m, onDeleted: { Task { await load() } }).presentationDetents([.medium, .large]) }
    }

    // ---- signed out ----
    private var signIn: some View {
        VStack(spacing: 14) {
            LightBoldTitle(light: lang.el ? "" : "Sign ", bold: lang.el ? "Σύνδεση." : "in.")
            Text(t("Sign in to send up to 5 GB, by link or email.")).font(.system(size: 15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            GlassField(placeholder: "Email", text: $email, keyboard: .emailAddress).textContentType(.username)
            GlassField(placeholder: t("Password"), text: $password, secure: true).textContentType(.password).submitLabel(.go).onSubmit { go() }
            if !err.isEmpty { Text(err).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
            Button { go() } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text(t("Sign in")) }.frame(maxWidth: .infinity)
            }.buttonStyle(PillStyle(main: true)).disabled(busy || email.isEmpty || password.isEmpty)
            Button { if let u = URL(string: "https://roartransfer.com/") { UIApplication.shared.open(u) } } label: {
                Label(t("No account yet? Make one on roartransfer.com"), systemImage: "safari").frame(maxWidth: .infinity)
            }.buttonStyle(PillStyle())
        }
    }

    private func go() {
        err = ""; busy = true
        Task {
            do { try await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password); password = "" }
            catch { err = (error as? APIError).map { t($0.message) } ?? t("Could not reach RoarTransfer. Check the connection and try again.") }
            busy = false
        }
    }

    // ---- signed in ----
    private var all: [MyTransfer] { (list ?? []).filter { !($0.stopped ?? false) } }
    private var shown: [MyTransfer] {
        let byFilter = filter == 1 ? all.filter { $0.live } : filter == 2 ? all.filter { !$0.live } : all
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? byFilter : byFilter.filter { ($0.name ?? "").lowercased().contains(q) }
    }
    private var facts: String {
        guard !all.isEmpty else { return "" }
        let size = all.reduce(Int64(0)) { $0 + Int64($1.size ?? 0) }
        let dls = all.reduce(0) { $0 + Int($1.downloads ?? 0) }
        let act = all.filter { $0.live }.count
        return [
            "\(all.count) \(all.count == 1 ? t("transfer") : t("transfers"))", sizeText(size),
            "\(act) \(t("active now"))", "\(dls) \(dls == 1 ? t("download") : t("downloads"))",
        ].joined(separator: " · ")
    }

    private var mine: some View {
        VStack(spacing: 14) {
            LightBoldTitle(light: lang.el ? "Οι " : "My ", bold: lang.el ? "αποστολές μου." : "transfers.")
            if !facts.isEmpty { Text(facts).font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center) }
            Segments(items: [(0, t("All"), nil), (1, t("Active"), nil), (2, t("Expired"), nil)], value: $filter)
            GlassField(placeholder: t("Search by file"), text: $query)
            if !listErr.isEmpty { Text(listErr).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
            if list == nil { ProgressView().tint(Theme.text).padding(30) }
            else if shown.isEmpty {
                Text(all.isEmpty ? t("Nothing sent yet. What you send shows here.") : t("Nothing found.")).font(.system(size: 15)).foregroundStyle(Theme.muted).multilineTextAlignment(.center).padding(24)
            } else {
                VStack(spacing: 8) { ForEach(shown) { m in Button { open = m } label: { row(m) }.buttonStyle(.plain) } }
            }
        }
    }

    private func row(_ m: MyTransfer) -> some View {
        HStack(spacing: 12) {
            Image(systemName: kindIcon(m.name ?? "", type: m.type)).font(.system(size: 16)).foregroundStyle(m.live ? Theme.redHi : Theme.dim)
                .frame(width: 40, height: 40).background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(m.live ? Theme.red.opacity(0.18) : Color.white.opacity(0.06)))
            VStack(alignment: .leading, spacing: 2) {
                Text(m.name ?? "file").font(.system(size: 15, weight: .semibold)).foregroundStyle(m.live ? Theme.text : Theme.muted).lineLimit(1)
                Text([sizeText(Int64(m.size ?? 0)), m.live ? leftText(m.expires) : t("Expired"), "\(Int(m.downloads ?? 0)) \(Int(m.downloads ?? 0) == 1 ? t("download") : t("downloads"))"].joined(separator: " · "))
                    .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
            }
            Spacer(minLength: 6)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
        .contentShape(Rectangle())
    }

    private func load() async {
        do { list = try await API.myTransfers(); listErr = "" }
        catch { listErr = error.localizedDescription; if list == nil { list = [] } }
    }
}

@MainActor
func leftText(_ s: String?) -> String {
    guard let d = Dates.parse(s) else { return "" }
    let secs = d.timeIntervalSinceNow
    if secs <= 0 { return t("Ended") }
    let h = Int(secs / 3600)
    if h < 24 { return "\(max(h, 1)) h \(t("left"))" }
    let days = h / 24
    return Lang.shared.el ? "\(days) \(days == 1 ? "μέρα" : "μέρες") \(t("left"))" : "\(days) day\(days == 1 ? "" : "s") left"
}

// one transfer's window: its link, copy, share, open, delete
struct TransferSheet: View {
    var m: MyTransfer
    var onDeleted: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var share = false
    @State private var asking = false
    @State private var err = ""
    private var link: String? { m.token.map { Config.page + $0 } }

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 14) {
                    Image(systemName: kindIcon(m.name ?? "", type: m.type)).font(.system(size: 22)).foregroundStyle(Theme.redHi)
                        .frame(width: 56, height: 56).background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.red.opacity(0.18)))
                        .padding(.top, 24)
                    Text(m.name ?? "file").font(.system(size: 18, weight: .semibold)).foregroundStyle(Theme.text).multilineTextAlignment(.center)
                    Text([sizeText(Int64(m.size ?? 0)), m.live ? "\(t("until")) \(Dates.short(m.expires))" : t("Expired")].joined(separator: " · "))
                        .font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim)
                    HStack(spacing: 24) {
                        stat("\(Int(m.opens ?? 0))", t("opens"))
                        stat("\(Int(m.downloads ?? 0))", t("downloads"))
                    }
                    if m.live, let link {
                        Text(link).font(.system(size: 14, design: .monospaced)).foregroundStyle(Theme.text).textSelection(.enabled)
                            .padding(.horizontal, 16).frame(maxWidth: .infinity, minHeight: 46)
                            .background(Capsule().fill(Color.white.opacity(0.05))).overlay(Capsule().stroke(Theme.edge))
                        HStack(spacing: 10) {
                            Button { UIPasteboard.general.string = link; copied = true } label: { Label(copied ? t("Copied") : t("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                            Button { share = true } label: { Label(t("Share"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
                        }
                        Button { if let u = URL(string: link) { UIApplication.shared.open(u) } } label: { Label(t("Open link"), systemImage: "safari").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                    }
                    if m.live, let p = m.path, p.range(of: "^(free|week|pro)/", options: .regularExpression) != nil {
                        Button { asking = true } label: { Label(t("Delete"), systemImage: "trash").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(danger: true))
                    }
                    if !err.isEmpty { Text(err).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
                }
                .padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
        .sheet(isPresented: $share) { if let l = link, let u = URL(string: l) { ShareSheet(items: [u]).presentationDetents([.medium, .large]) } }
        .confirmationDialog(t("Delete this link? The file goes for good."), isPresented: $asking, titleVisibility: .visible) {
            Button(t("Delete"), role: .destructive) { delete() }
            Button(t("Cancel"), role: .cancel) {}
        }
    }

    private func stat(_ n: String, _ w: String) -> some View {
        VStack(spacing: 2) {
            Text(n).font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text)
            Text(w).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }
    }

    private func delete() {
        guard let p = m.path else { return }
        Task {
            do {
                _ = try await API.bridge(["action": "delete", "key": p], as: AnyCodable.self)
                onDeleted(); dismiss()
            } catch { err = error.localizedDescription }
        }
    }
}

// the gear: the account, the language, where downloads go
struct SettingsSheet: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(t("Settings")).font(.system(size: 24, weight: .bold)).foregroundStyle(Theme.text).padding(.top, 24)
                    Tile {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(t("Account")).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
                            if session.signedIn {
                                if !session.name.isEmpty { Text(session.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text) }
                                Text(session.email).font(.system(size: 15)).foregroundStyle(Theme.muted)
                                Button { session.signOut(); dismiss() } label: { Label(t("Sign out"), systemImage: "rectangle.portrait.and.arrow.right").frame(maxWidth: .infinity) }
                                    .buttonStyle(PillStyle(danger: true))
                            } else {
                                Text(t("Not signed in")).font(.system(size: 15)).foregroundStyle(Theme.muted)
                            }
                            Button { if let u = URL(string: "https://roartransfer.com/") { UIApplication.shared.open(u) } } label: {
                                Label(t("Manage on roartransfer.com"), systemImage: "safari").frame(maxWidth: .infinity)
                            }.buttonStyle(PillStyle())
                        }
                    }
                    Tile {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(t("Language")).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
                            Segments(items: [("en", "English", nil), ("el", "Ελληνικά", nil)], value: $lang.code)
                        }
                    }
                    Tile {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(t("Downloads")).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
                            Text(t("Videos and photos go straight to Photos; other files to Files > On My iPhone > RoarTransfer.")).font(.system(size: 14)).foregroundStyle(Theme.muted)
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
    }
}
