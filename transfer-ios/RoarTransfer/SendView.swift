import SwiftUI
import UIKit

// Send, as roartransfer.com's card: SEND BIG FILES, the box to choose files, the chosen files, then the three steps
// (how to send it, how long it stays, more options) and Get the link. Videos go as they are (no making smaller).
struct SendView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @EnvironmentObject var up: Uploader
    @EnvironmentObject var pro: ProStore
    @State private var notify = true
    @State private var payLock = false
    @State private var notes: [String] = []
    @State private var chooser = false
    @State private var photos = false
    @State private var files = false
    @State private var mode = "link"
    @State private var days = 1
    @State private var more = false
    @State private var to = ""
    @State private var title = ""
    @State private var message = ""
    @State private var password = ""
    @State private var share = false
    @State private var copied = false
    @State private var problem = ""

    private var picked: [Picked] { up.picked }
    private var total: Int64 { picked.reduce(0) { $0 + $1.size } }
    private func limitGB(_ d: Int) -> Int64 {
        if !session.signedIn { return 1 }
        if pro.isPro { return d == 1 ? 50 : d == 3 ? 40 : d == 7 ? 30 : 20 }
        return d == 1 ? 5 : d == 7 ? 1 : 3
    }
    private var dayChoices: [Int] { pro.isPro ? [1, 3, 7, 30] : [1, 3, 7] }
    // only a guest is stopped here; an account's own limit (Free or Pro) is the server's to say
    private var over: Bool { !session.signedIn && total > limitGB(1) * 1_073_741_824 }

    var body: some View {
        ZStack {
        // the card in the very middle of the screen, between the top and the menu (Alex, 15 Nov); a longer one scrolls
        GeometryReader { g in
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 4)
                Card {
                    VStack(spacing: 16) {
                        BigTitle(a: lang.el ? "ΣΤΕΙΛΕ" : "SEND", b: lang.el ? "ΜΕΓΑΛΑ" : "BIG", c: lang.el ? "ΑΡΧΕΙΑ" : "FILES")
                        if up.busy { sending } else if let l = up.link { done(l) } else { pick }
                    }
                }
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 16).padding(.bottom, SiteFooter.room)
            .frame(maxWidth: .infinity, minHeight: g.size.height)
        }
        }
        .scrollDismissesKeyboard(.interactively)
        // pull down: the account, its Pro and its limits read again
        .refreshable { await pro.load(); Glass.tap(.soft) }
        .onAppear { notify = pro.mails.downloads ?? true }
        .confirmationDialog(t("Choose from"), isPresented: $chooser, titleVisibility: .visible) {
            Button(t("Photos & Videos")) { photos = true }
            Button(t("Files")) { files = true }
            Button(t("Cancel"), role: .cancel) {}
        }
        .sheet(isPresented: $photos) { PhotoPicker { p, e in add(p, e) }.ignoresSafeArea() }
        .sheet(isPresented: $files) { FilePicker { p, e in add(p, e) }.ignoresSafeArea() }
        .sheet(isPresented: $share) { if let l = up.link, let u = URL(string: l) { ShareSheet(items: [u]).presentationDetents([.medium, .large]) } }
        if more { GlassWindow(title: t("More options"), close: { more = false }) { moreBody }.zIndex(5) }
        }
    }

    private func add(_ p: [Picked], _ e: [String]) { up.picked += p; notes = e }

    // ---- the box and the steps ----
    @ViewBuilder private var pick: some View {
        Button { chooser = true } label: { dropBox }.buttonStyle(.plain)
        ForEach(notes, id: \.self) { n in Text(n).font(.system(size: 13)).foregroundStyle(Theme.redHi) }

        if !picked.isEmpty {
            VStack(spacing: 8) { ForEach(picked) { f in fileRow(f).transition(.glassDrop) } }.animation(Glass.spring, value: picked)
            VStack(alignment: .leading, spacing: 6) {
                ProgressBar(value: session.signedIn ? 0 : Double(total) / Double(limitGB(1) * 1_073_741_824))
                Text(session.signedIn ? "\(sizeText(total)) · \(picked.count) \(picked.count == 1 ? "file" : t("files"))" : "\(sizeText(total)) / \(limitGB(1)) GB · \(picked.count) \(t("files"))")
                    .font(.system(size: 12, design: .monospaced)).foregroundStyle(over ? Theme.redHi : Theme.dim)
            }

            if session.signedIn {
                StepLabel(text: t("How do you want to send it?"))
                Segments(items: [("mail", t("Email"), "sf:envelope"), ("link", t("Link"), "sf:link")], value: $mode)
                if mode == "mail" { GlassField(placeholder: t("Send to: emails, separated by commas"), text: $to, keyboard: .emailAddress) }
                StepLabel(text: t("How long should it stay?"))
                Segments(items: dayChoices.map { d -> (Int, String, String?) in (d, t(d == 1 ? "1 day" : d == 3 ? "3 days" : d == 7 ? "7 days" : "30 days"), "\(t("up to")) \(limitGB(d)) GB") }, value: $days, height: 56)
            } else {
                Text(t("Without an account: link only, 24 hours, up to 1 GB. Sign in for more."))
                    .font(.system(size: 13)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading)
            }

            Button { more = true } label: {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t("More options")).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text)
                        Text(moreLine).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 16).frame(minHeight: 58)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
            }.buttonStyle(.plain)

            Text(t("By continuing you accept the Terms and the Privacy Policy."))
                .font(.system(size: 12)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
            if !problem.isEmpty { Text(problem).font(.system(size: 14)).foregroundStyle(Theme.redHi) }

            Button { start() } label: {
                Label(mode == "mail" && session.signedIn ? t("Send") : t("Get the link"), systemImage: mode == "mail" && session.signedIn ? "paperplane" : "link")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillStyle(main: true)).disabled(over).opacity(over ? 0.5 : 1)
        } else {
            Text(t("Videos go in their original quality, exactly as they are on your iPhone."))
                .font(.system(size: 12)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
        }
    }

    private var moreLine: String {
        let parts = [title, message.isEmpty ? "" : "“\(message)”", password.isEmpty ? "" : "••••", pro.isPro && payLock ? t("Locked until paid") : ""].filter { !$0.isEmpty }
        return parts.isEmpty ? t("Title, message, password") : parts.joined(separator: " · ")
    }

    private var dropBox: some View {
        let empty = picked.isEmpty
        return Group {
            if empty {
                // as the website (Alex, 16 Nov): the red sign in the middle, its two lines under it
                VStack(spacing: 6) {
                    upIcon(64).padding(.bottom, 10)
                    Text(t("Drop your files here")).font(.system(size: 20, weight: .semibold)).foregroundStyle(Theme.text)
                    Text(t("or tap to choose them")).font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
            } else {
                HStack(spacing: 14) {
                    upIcon(44)
                    Text(t("Add more")).font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.text)
                    Spacer()
                }
                .padding(14)
            }
        }
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.white.opacity(0.03)))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(style: StrokeStyle(lineWidth: 1, dash: [5, 4])).foregroundStyle(Color.white.opacity(0.22)))
        .contentShape(Rectangle())
    }

    private func upIcon(_ s: CGFloat) -> some View {
        Image(systemName: "icloud.and.arrow.up").font(.system(size: s * 0.4, weight: .semibold)).foregroundStyle(.white)
            .frame(width: s, height: s)
            .background(Circle().fill(LinearGradient(colors: [Theme.redHi, Theme.red], startPoint: .top, endPoint: .bottom)))
            .shadow(color: Theme.red.opacity(0.55), radius: 14, y: 6)
    }

    private func fileRow(_ f: Picked) -> some View {
        HStack(spacing: 12) {
            Image(systemName: kindIcon(f.name, type: f.type)).font(.system(size: 16)).foregroundStyle(Theme.redHi)
                .frame(width: 40, height: 40).background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Theme.red.opacity(0.18)))
            VStack(alignment: .leading, spacing: 2) {
                Text(f.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.text).lineLimit(1)
                Text(sizeText(f.size)).font(.system(size: 12, design: .monospaced)).foregroundStyle(Theme.dim)
            }
            Spacer()
            Button { remove(f) } label: { Image(systemName: "xmark") }.buttonStyle(RoundStyle(size: 34, tint: Theme.muted))
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
    }

    private var moreBody: some View {
        VStack(spacing: 12) {
            GlassField(placeholder: t("Title (optional)"), text: $title)
            GlassField(placeholder: t("Your message (optional)"), text: $message)
            GlassField(placeholder: t("Password (optional)"), text: $password, secure: true)
            if session.signedIn {
                RowBox {
                    SwitchRow(title: t("Email me when it is downloaded"), on: $notify)
                    if pro.isPro {
                        Divider().overlay(Theme.edge)
                        SwitchRow(title: t("Locked until paid"), sub: t("The link shows what it holds but opens nothing until you unlock it."), on: $payLock)
                    }
                }
            }
            Button { more = false } label: { Text(t("Done")).frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
        }
    }

    // ---- sending ----
    private var sending: some View {
        let frac = up.totalBytes > 0 ? Double(up.sentBytes) / Double(up.totalBytes) : 0
        return VStack(spacing: 14) {
            Text(t("Uploading…")).font(.system(size: 20, weight: .semibold)).foregroundStyle(Theme.text)
            Text(up.current).font(.system(size: 15)).foregroundStyle(Theme.muted).lineLimit(1)
            ProgressBar(value: frac)
            Text("\(Int(frac * 100))% · \(sizeText(up.sentBytes)) / \(sizeText(up.totalBytes))")
                .font(.system(size: 13, design: .monospaced)).foregroundStyle(Theme.dim)
            Text(t("Keep RoarTransfer open until it finishes.")).font(.system(size: 13)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
            Button { up.stop() } label: { Label(t("Stop"), systemImage: "stop.fill").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(danger: true))
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // ---- done ----
    private func done(_ l: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark").font(.system(size: 26, weight: .bold)).foregroundStyle(.white)
                .frame(width: 64, height: 64).background(Circle().fill(Theme.ok.opacity(0.85)))
            Text(up.errors.isEmpty ? t("Uploaded!") : t("Uploaded, with problems")).font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text)
            Text(up.mailed > 0 ? t("Sent by email.") : t("Anyone with the link can download it.")).font(.system(size: 14)).foregroundStyle(Theme.muted)
            Text(l).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.text).textSelection(.enabled)
                .padding(.horizontal, 16).frame(maxWidth: .infinity, minHeight: 48)
                .background(Capsule().fill(Color.black.opacity(0.25))).overlay(Capsule().stroke(Theme.edge))
            HStack(spacing: 10) {
                Button { UIPasteboard.general.string = l; copied = true } label: { Label(copied ? t("Copied") : t("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
                Button { share = true } label: { Label(t("Share"), systemImage: "square.and.arrow.up").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
            }
            ForEach(up.errors, id: \.self) { e in Text(e).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
            Button { reset() } label: { Label(t("Send more files"), systemImage: "plus").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
        }
    }

    private func start() {
        problem = ""; copied = false
        var rec: [String] = []
        if session.signedIn && mode == "mail" {
            rec = to.split(whereSeparator: { $0 == "," || $0 == " " || $0 == ";" }).map { String($0) }.filter { !$0.isEmpty }
            if rec.isEmpty { problem = t("Add at least one email to send to."); return }
        }
        up.send(picked, days: session.signedIn ? days : 1, title: title, message: message, password: password, recipients: rec, notify: notify, payLock: pro.isPro && payLock)
    }
    private func remove(_ f: Picked) {
        try? FileManager.default.removeItem(at: f.url.deletingLastPathComponent())
        up.picked.removeAll { $0.id == f.id }
    }
    private func reset() {
        up.picked = []; title = ""; message = ""; password = ""; to = ""; up.link = nil; up.errors = []; copied = false
    }
}
