import SwiftUI
import UIKit

// My Transfers: sign in with the RoarTransfer account (made on roartransfer.com) and see what was sent, with each
// link to copy or share. Accounts are made and managed on the website.
struct MineView: View {
    @EnvironmentObject var session: Session
    @State private var email = ""
    @State private var password = ""
    @State private var err = ""
    @State private var busy = false
    @State private var list: [MyTransfer]?
    @State private var listErr = ""
    @State private var filter = 0
    @State private var shareURL: URL?
    @State private var account = false

    var body: some View {
        NavigationStack {
            ZStack {
                Backdrop()
                ScrollView {
                    VStack(spacing: 16) {
                        HStack {
                            Wordmark(); Spacer()
                            if session.signedIn { Button { account = true } label: { Image(systemName: "gearshape") }.buttonStyle(RoundStyle()) }
                        }.padding(.top, 8)
                        if session.signedIn { mine } else { signIn }
                    }
                    .padding(.horizontal, 16).padding(.bottom, 30)
                }
                .refreshable { await load() }
                .scrollDismissesKeyboard(.interactively)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task(id: session.signedIn) { if session.signedIn { await load() } else { list = nil } }
        .sheet(item: $shareURL) { u in ShareSheet(items: [u]).presentationDetents([.medium, .large]) }
        .sheet(isPresented: $account) { AccountSheet(close: { account = false }).presentationDetents([.medium]) }
    }

    // ---- signed out ----
    private var signIn: some View {
        VStack(spacing: 16) {
            PageTitle(text: "My Transfers")
            Tile {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Sign in to send up to 5 GB, keep links longer and see what you sent.")
                        .font(.system(size: 15)).foregroundStyle(Theme.muted)
                    GlassField(placeholder: "Email", text: $email, keyboard: .emailAddress).textContentType(.username)
                    GlassField(placeholder: "Password", text: $password, secure: true).textContentType(.password).submitLabel(.go).onSubmit { go() }
                    if !err.isEmpty { Text(err).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
                    Button { go() } label: {
                        HStack { if busy { ProgressView().tint(.white) }; Text("Sign in") }.frame(maxWidth: .infinity)
                    }.buttonStyle(PillStyle(main: true)).disabled(busy || email.isEmpty || password.isEmpty)
                    Button { if let u = URL(string: "https://roartransfer.com/") { UIApplication.shared.open(u) } } label: {
                        Label("No account yet? Make one on roartransfer.com", systemImage: "safari").frame(maxWidth: .infinity)
                    }.buttonStyle(PillStyle())
                }
            }
        }
    }

    private func go() {
        err = ""; busy = true
        Task {
            do { try await session.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password); password = "" }
            catch { err = (error as? APIError)?.message ?? "Could not reach RoarTransfer. Check the connection and try again." }
            busy = false
        }
    }

    // ---- signed in ----
    private var shown: [MyTransfer] {
        let all = (list ?? []).filter { !($0.stopped ?? false) }
        return filter == 1 ? all.filter { $0.live } : filter == 2 ? all.filter { !$0.live } : all
    }

    private var mine: some View {
        VStack(spacing: 14) {
            PageTitle(text: "My Transfers")
            HStack(spacing: 8) {
                ForEach(Array(["All", "Active", "Ended"].enumerated()), id: \.offset) { i, t in
                    Button { filter = i } label: { Text(t).frame(maxWidth: .infinity) }.buttonStyle(ChoiceStyle(on: filter == i))
                }
            }
            if !listErr.isEmpty { Text(listErr).font(.system(size: 14)).foregroundStyle(Theme.redHi) }
            if list == nil { ProgressView().tint(Theme.text).padding(30) }
            else if shown.isEmpty {
                Text(list!.isEmpty ? "Nothing sent yet." : "Nothing here.").font(.system(size: 15)).foregroundStyle(Theme.muted).padding(30)
            } else {
                VStack(spacing: 8) { ForEach(shown) { m in row(m) } }
            }
        }
    }

    private func row(_ m: MyTransfer) -> some View {
        let link = m.token.map { Config.page + $0 }
        return Tile(pad: 12) {
            HStack(spacing: 12) {
                Image(systemName: kindIcon(m.name ?? "", type: m.type)).font(.system(size: 18)).foregroundStyle(m.live ? Theme.redHi : Theme.dim)
                    .frame(width: 44, height: 44).background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.06)))
                VStack(alignment: .leading, spacing: 3) {
                    Text(m.name ?? "file").font(.system(size: 15, weight: .medium)).foregroundStyle(m.live ? Theme.text : Theme.muted).lineLimit(1)
                    Text([sizeText(Int64(m.size ?? 0)), "\(Int(m.downloads ?? 0)) ↓", m.live ? "until " + Dates.short(m.expires) : "ended"].joined(separator: " · "))
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim).lineLimit(1)
                }
                Spacer(minLength: 6)
                if m.live, let link {
                    Button { UIPasteboard.general.string = link } label: { Image(systemName: "doc.on.doc") }.buttonStyle(RoundStyle(size: 36))
                    Button { shareURL = URL(string: link) } label: { Image(systemName: "square.and.arrow.up") }.buttonStyle(RoundStyle(size: 36))
                }
            }
        }
    }

    private func load() async {
        do { list = try await API.myTransfers(); listErr = "" }
        catch { listErr = error.localizedDescription; if list == nil { list = [] } }
    }
}

struct AccountSheet: View {
    @EnvironmentObject var session: Session
    var close: () -> Void
    var body: some View {
        ZStack {
            Backdrop()
            VStack(spacing: 16) {
                Text("Account").font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text)
                Tile {
                    VStack(alignment: .leading, spacing: 4) {
                        if !session.name.isEmpty { Text(session.name).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text) }
                        Text(session.email).font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                }
                Button { if let u = URL(string: "https://roartransfer.com/") { UIApplication.shared.open(u) } } label: {
                    Label("Manage on roartransfer.com", systemImage: "safari").frame(maxWidth: .infinity)
                }.buttonStyle(PillStyle())
                Button { session.signOut(); close() } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right").frame(maxWidth: .infinity) }
                    .buttonStyle(PillStyle(danger: true))
                Spacer()
            }
            .padding(20)
        }
    }
}
