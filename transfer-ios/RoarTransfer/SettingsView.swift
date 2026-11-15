import SwiftUI
import WebKit
import PhotosUI

// Settings, a tab of the menu at the foot (as the website's Settings window, laid out as a page): the account and its
// plan with PRO, the emails, for a Pro their Receive-files page, their brand and what Pro gives, the language,
// where downloads go, Sign out, and at the foot About Us · Pricing · Privacy Policy · Terms of Service.
// Signed out: Sign in, Create account and Forgot password, as the website.
struct SettingsView: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @EnvironmentObject var pro: ProStore
    @State private var page: String?          // about, pricing, privacy, terms
    @State private var perks = false
    @State private var brandOpen = false
    @State private var editPage = false
    @State private var slug = ""
    @State private var pageName = ""
    @State private var pageErr = ""
    @State private var copied = false

    var body: some View {
        ZStack {
            ScrollView {
                VStack(spacing: 14) {
                    if session.signedIn { account } else { AuthCard() }
                    language
                    downloads
                    if session.signedIn {
                        Button { session.signOut(); Task { await pro.load() } } label: { Label(t("Sign out"), systemImage: "rectangle.portrait.and.arrow.right").frame(maxWidth: .infinity) }
                            .buttonStyle(PillStyle(danger: true))
                    }
                    footer
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 120)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await pro.load() }

            if let p = page {
                GlassWindow(title: pageTitle(p), close: { page = nil }) {
                    if p == "pricing" { PricingView() } else { WebPage(path: p, lang: lang.code).frame(height: 560) }
                }
                .transition(.opacity).zIndex(5)
            }
            if brandOpen {
                GlassWindow(title: t("Your brand"), close: { brandOpen = false }) { BrandEditor() }.zIndex(5)
            }
        }
        .task(id: session.signedIn) { await pro.load() }
    }

    private func pageTitle(_ p: String) -> String {
        p == "about" ? t("About Us") : p == "pricing" ? t("Pricing") : p == "privacy" ? t("Privacy Policy") : t("Terms of Service")
    }

    // ---- signed in ----
    @ViewBuilder private var account: some View {
        SectionHead(text: t("Account"))
        RowBox {
            row(t("Email"), session.email)
            Divider().overlay(Theme.edge)
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("Plan")).font(.system(size: 15)).foregroundStyle(Theme.text)
                    Text(pro.planText).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                Spacer()
                if pro.isPro { ProBadge() }
            }.padding(.horizontal, 14).padding(.vertical, 12)
        }

        SectionHead(text: t("Emails"))
        RowBox {
            SwitchRow(title: t("When someone downloads what I sent"), on: Binding(get: { pro.mails.downloads ?? true }, set: { pro.setMail(downloads: $0) }))
            if pro.isPro {
                Divider().overlay(Theme.edge)
                SwitchRow(title: t("When someone sends me files on my page"), on: Binding(get: { pro.mails.received ?? true }, set: { pro.setMail(received: $0) }))
            }
        }
        Text(t("Sign-up and password emails always come.")).font(.system(size: 12)).foregroundStyle(Theme.dim).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 6)

        if pro.isPro { proSections }
    }

    @ViewBuilder private var proSections: some View {
        SectionHead(text: t("Receive files"))
        RowBox {
            VStack(alignment: .leading, spacing: 4) {
                Text(pro.info?.slug.map { "roartransfer.com/u/\($0)" } ?? t("Pick a name for your page")).font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.text)
                Text(t("Anyone can send you files on this page, without an account: up to 20 GB a file, kept 30 days.")).font(.system(size: 12)).foregroundStyle(Theme.muted)
            }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
        }
        HStack(spacing: 10) {
            if let s = pro.info?.slug {
                Button { UIPasteboard.general.string = "https://roartransfer.com/u/" + s; copied = true } label: { Label(copied ? t("Copied") : t("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc").frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
            }
            Button { withAnimation(Glass.spring) { editPage.toggle(); slug = pro.info?.slug ?? ""; pageName = pro.info?.name ?? "" } } label: { Label(t("Edit"), systemImage: "pencil").frame(maxWidth: .infinity) }.buttonStyle(PillStyle())
        }
        if editPage {
            VStack(spacing: 10) {
                GlassField(placeholder: t("Your name"), text: $pageName)
                HStack(spacing: 0) {
                    Text("roartransfer.com/u/").font(.system(size: 14, design: .monospaced)).foregroundStyle(Theme.dim).padding(.leading, 18)
                    TextField("", text: $slug).textInputAutocapitalization(.never).autocorrectionDisabled().font(.system(size: 15, design: .monospaced)).foregroundStyle(Theme.text)
                        .onChange(of: slug) { v in let c = v.lowercased().filter { $0.isLetter && $0.isASCII || $0.isNumber || $0 == "-" }; if c != v { slug = c } }
                }
                .frame(height: 50).background(Capsule().fill(Theme.glass)).overlay(Capsule().stroke(Theme.edge))
                if !pageErr.isEmpty { Text(pageErr).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
                Button { savePage() } label: { Text(t("Save")).frame(maxWidth: .infinity) }.buttonStyle(PillStyle(main: true))
            }.transition(.glassDrop)
        }

        SectionHead(text: t("Your brand"))
        Button { brandOpen = true } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("Your name, logo and backgrounds")).font(.system(size: 15)).foregroundStyle(Theme.text)
                    Text(brandLine).font(.system(size: 12)).foregroundStyle(Theme.muted)
                }
                Spacer(); Image(systemName: "chevron.right").foregroundStyle(Theme.dim)
            }.padding(14).background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22))).overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
        }.buttonStyle(PressRow())

        SectionHead(text: t("What Pro gives"))
        Button { withAnimation(Glass.spring) { perks.toggle() } } label: {
            HStack { Text(perks ? t("Hide") : t("Show all 8")).font(.system(size: 15)).foregroundStyle(Theme.text); Spacer(); Image(systemName: perks ? "chevron.up" : "chevron.down").foregroundStyle(Theme.dim) }
                .padding(14).background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22))).overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.edge))
        }.buttonStyle(PressRow())
        if perks { PerkList().transition(.glassDrop) }
    }

    private var brandLine: String {
        let b = pro.me?.brand
        let parts = [b?.name ?? "", (b?.logo ?? "").isEmpty ? "" : "Logo", (b?.bgs?.count ?? 0) > 0 ? "\(b!.bgs!.count) \(t("backgrounds"))" : ""].filter { !$0.isEmpty }
        return parts.isEmpty ? t("Not set") : parts.joined(separator: " · ")
    }

    private func savePage() {
        pageErr = ""
        Task {
            do {
                _ = try await API.bridge(["action": "pro-set", "slug": slug, "name": pageName], as: AnyCodable.self)
                await pro.load(); withAnimation(Glass.spring) { editPage = false }
            } catch { pageErr = t(error.localizedDescription) }
        }
    }

    // ---- for everyone ----
    @ViewBuilder private var language: some View {
        SectionHead(text: t("Language"))
        Segments(items: [("en", "English", nil), ("el", "Ελληνικά", nil)], value: $lang.code)
    }
    @ViewBuilder private var downloads: some View {
        SectionHead(text: t("Downloads"))
        RowBox {
            Text(t("Videos and photos go straight to Photos; other files to Files > On My iPhone > RoarTransfer."))
                .font(.system(size: 13)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity, alignment: .leading).padding(14)
        }
    }

    private var footer: some View {
        VStack(spacing: 10) {
            Text("POWERED BY").font(.system(size: 10, weight: .semibold)).kerning(3).foregroundStyle(Theme.muted)
            Text("www.themadlions.com").font(.system(size: 15, weight: .medium)).foregroundStyle(Theme.text)
            HStack(spacing: 6) {
                ForEach(["about", "pricing", "privacy", "terms"], id: \.self) { p in
                    Button { page = p } label: { Text(pageTitle(p)).font(.system(size: 12, weight: .medium)).lineLimit(1).minimumScaleFactor(0.8) }
                        .buttonStyle(SmallPill())
                }
            }
        }
        .padding(.top, 18)
    }

    private func row(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.system(size: 15)).foregroundStyle(Theme.text)
            Text(v).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).padding(.vertical, 12)
    }
}

// a small glass pill (the footer's pages)
struct SmallPill: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.foregroundStyle(Theme.text.opacity(0.85))
            .padding(.horizontal, 10).frame(height: 32)
            .background(Capsule().fill(Theme.glass)).overlay(Capsule().stroke(Theme.edge))
            .glassPress(configuration.isPressed, shape: Capsule())
    }
}
// a whole row that sinks under the finger (GLASS PRESS)
struct PressRow: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.glassPress(configuration.isPressed, shape: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct PerkList: View {
    static let perks = [
        "Up to 50 GB (1 day), 40 GB (3 days), 30 GB (7 days), 20 GB (30 days)", "Links up to 30 days", "Unlimited downloads",
        "Your name, logo and backgrounds", "Change expiry or password after sending", "Who opened and downloaded, when, from where",
        "Uploads resume after a lost connection", "Receive files: your own page, up to 20 GB a file, kept 30 days",
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(PerkList.perks, id: \.self) { p in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 20, height: 20).background(Circle().fill(Theme.red))
                    Text(t(p)).font(.system(size: 14)).foregroundStyle(Theme.text)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.black.opacity(0.22)))
    }
}

// Pricing inside the app: what Free and Pro give, without prices or a way to buy (Apple's rule for apps)
struct PricingView: View {
    var body: some View {
        VStack(spacing: 12) {
            plan("Free", ["Up to 5 GB (1 day), 3 GB (3 days), 1 GB (7 days)", "By link or by email", "Without an account: link only, 24 hours, up to 1 GB"], pro: false)
            plan("Pro", PerkList.perks, pro: true)
            Text(t("Pro is set up on roartransfer.com.")).font(.system(size: 12)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
        }
    }
    private func plan(_ name: String, _ lines: [String], pro: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(name).font(.system(size: 22, weight: .bold)).foregroundStyle(Theme.text); Spacer(); if pro { ProBadge() } }
            ForEach(lines, id: \.self) { l in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(pro ? .white : Theme.text)
                        .frame(width: 20, height: 20).background(Circle().fill(pro ? Theme.red : Color.white.opacity(0.12)))
                    Text(t(l)).font(.system(size: 14)).foregroundStyle(Theme.text)
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(pro ? Theme.red.opacity(0.12) : Color.black.opacity(0.22)))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(pro ? Theme.red.opacity(0.5) : Theme.edge))
    }
}

// the website's own page (About Us, Privacy Policy, Terms of Service) in the chosen language
struct WebPage: UIViewRepresentable {
    var path: String
    var lang: String
    func makeUIView(context: Context) -> WKWebView {
        let c = WKWebViewConfiguration()
        let js = "try{localStorage.setItem('roartransfer.lang','\(lang == "el" ? "el" : "en")')}catch(e){}"
        c.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let w = WKWebView(frame: .zero, configuration: c)
        w.isOpaque = false; w.backgroundColor = .clear; w.scrollView.backgroundColor = .clear
        w.layer.cornerRadius = 18; w.clipsToBounds = true
        w.load(URLRequest(url: URL(string: "https://roartransfer.com/\(path)/")!))
        return w
    }
    func updateUIView(_ w: WKWebView, context: Context) {}
}

// Sign in · Create account · Forgot password, as the website's card
struct AuthCard: View {
    @EnvironmentObject var session: Session
    @EnvironmentObject var lang: Lang
    @State private var mode = "in"      // in, up, forgot
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var err = ""
    @State private var ok = ""
    @State private var busy = false

    var body: some View {
        Card {
            VStack(spacing: 14) {
                LightBoldTitle(light: mode == "up" ? (lang.el ? "Νέος " : "New ") : mode == "forgot" ? (lang.el ? "Νέος " : "New ") : (lang.el ? "" : "Sign "),
                               bold: mode == "up" ? (lang.el ? "λογαριασμός." : "account.") : mode == "forgot" ? (lang.el ? "κωδικός." : "password.") : (lang.el ? "Σύνδεση." : "in."))
                Text(t(mode == "up" ? "Make a free account to send files up to 5 GB." : mode == "forgot" ? "We will email you a link to set a new password." : "Sign in to send up to 5 GB, by link or email."))
                    .font(.system(size: 14)).foregroundStyle(Theme.muted).multilineTextAlignment(.center)
                if mode == "up" { GlassField(placeholder: t("Your name"), text: $name).textContentType(.name) }
                GlassField(placeholder: "Email", text: $email, keyboard: .emailAddress).textContentType(.username)
                if mode != "forgot" {
                    GlassField(placeholder: t("Password"), text: $password, secure: true).textContentType(mode == "up" ? .newPassword : .password).submitLabel(.go).onSubmit { go() }
                }
                if !err.isEmpty { Text(err).font(.system(size: 14)).foregroundStyle(Theme.redHi).multilineTextAlignment(.center) }
                if !ok.isEmpty { Text(ok).font(.system(size: 14)).foregroundStyle(Theme.ok).multilineTextAlignment(.center) }
                Button { go() } label: {
                    HStack { if busy { ProgressView().tint(.white) }; Text(t(mode == "up" ? "Create account" : mode == "forgot" ? "Send the link" : "Sign in")) }.frame(maxWidth: .infinity)
                }.buttonStyle(PillStyle(main: true)).disabled(busy || email.isEmpty || (mode != "forgot" && password.isEmpty))
                HStack(spacing: 8) {
                    if mode != "in" { Button { swap("in") } label: { Text(t("Sign in")) }.buttonStyle(SmallPill()) }
                    if mode != "up" { Button { swap("up") } label: { Text(t("Create account")) }.buttonStyle(SmallPill()) }
                    if mode != "forgot" { Button { swap("forgot") } label: { Text(t("Forgot password")) }.buttonStyle(SmallPill()) }
                }
                if mode == "up" {
                    Text(t("By continuing you accept the Terms and the Privacy Policy.")).font(.system(size: 12)).foregroundStyle(Theme.dim).multilineTextAlignment(.center)
                }
            }
        }
        .animation(Glass.spring, value: mode)
    }

    private func swap(_ m: String) { err = ""; ok = ""; mode = m }

    private func go() {
        err = ""; ok = ""; busy = true
        let e = email.trimmingCharacters(in: .whitespaces)
        Task {
            do {
                switch mode {
                case "up":
                    if password.count < 6 { throw APIError(message: "The password needs at least 6 characters.") }
                    try await session.signUp(name: name, email: e, password: password)
                    ok = t("Almost there: open the email we just sent you and press Confirm my account. Then sign in here.")
                    mode = "in"
                case "forgot":
                    try await session.reset(email: e)
                    ok = t("Check your email for the link to set a new password.")
                default:
                    try await session.signIn(email: e, password: password); password = ""
                    Glass.tap(.medium)
                }
            } catch {
                err = (error as? APIError).map { t($0.message) } ?? t("Could not reach RoarTransfer. Check the connection and try again.")
            }
            busy = false
        }
    }
}

// Your brand: name, logo and up to 8 backgrounds, as the website's editor (roartransfer-pro 'brand')
struct BrandEditor: View {
    @EnvironmentObject var pro: ProStore
    @State private var name = ""
    @State private var logo = ""
    @State private var bgs: [String] = []
    @State private var loaded = false
    @State private var logoPick: PhotosPickerItem?
    @State private var bgPick: PhotosPickerItem?
    @State private var busy = false
    @State private var msg = ""
    @State private var err = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(t("Your name, logo and backgrounds on the pages people open from your links, and on your Receive-files page."))
                .font(.system(size: 13)).foregroundStyle(Theme.muted)
            GlassField(placeholder: t("Your name or company (e.g. The Mad Lions)"), text: $name)
            Text(t("Logo")).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
            HStack(spacing: 10) {
                if !logo.isEmpty { tile(logo) { logo = "" } }
                else { PhotosPicker(selection: $logoPick, matching: .images) { addTile }.buttonStyle(PressRow()) }
                Spacer()
            }
            Text(t("Backgrounds (up to 8, one shows at random)")).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.dim)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
                ForEach(Array(bgs.enumerated()), id: \.offset) { i, u in tile(u) { bgs.remove(at: i) } }
                if bgs.count < 8 { PhotosPicker(selection: $bgPick, matching: .images) { addTile }.buttonStyle(PressRow()) }
            }
            if !err.isEmpty { Text(err).font(.system(size: 13)).foregroundStyle(Theme.redHi) }
            if !msg.isEmpty { Text(msg).font(.system(size: 13)).foregroundStyle(Theme.ok) }
            Button { save() } label: { HStack { if busy { ProgressView().tint(.white) }; Text(t("Save")) }.frame(maxWidth: .infinity) }
                .buttonStyle(PillStyle(main: true)).disabled(busy)
        }
        .onAppear {
            guard !loaded else { return }
            loaded = true
            name = pro.me?.brand?.name ?? ""; logo = pro.me?.brand?.logo ?? ""; bgs = pro.me?.brand?.bgs ?? []
        }
        .onChange(of: logoPick) { it in if let it { upload(it) { logo = $0 } } }
        .onChange(of: bgPick) { it in if let it { upload(it) { bgs.append($0) } } }
    }

    private var addTile: some View {
        VStack(spacing: 4) { Image(systemName: "plus").font(.system(size: 18, weight: .semibold)); Text(t("Add")).font(.system(size: 12)) }
            .foregroundStyle(Theme.muted).frame(width: 92, height: 64)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])).foregroundStyle(Color.white.opacity(0.25)))
    }
    private func tile(_ u: String, remove: @escaping () -> Void) -> some View {
        AsyncImage(url: URL(string: u)) { img in img.resizable().scaledToFill() } placeholder: { Color.white.opacity(0.06) }
            .frame(width: 92, height: 64).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(alignment: .topTrailing) {
                Button { withAnimation(Glass.spring) { remove() } } label: { Image(systemName: "xmark") }.buttonStyle(RoundStyle(size: 24)).padding(4)
            }
            .transition(.glassDrop)
    }

    private func upload(_ it: PhotosPickerItem, done: @escaping (String) -> Void) {
        err = ""; busy = true
        Task {
            defer { busy = false; logoPick = nil; bgPick = nil }
            do {
                guard let data = try await it.loadTransferable(type: Data.self), let img = UIImage(data: data) else { throw APIError(message: "Could not read this picture.") }
                // made smaller on the phone, as the website does (logo 600 px, background 2400 px)
                let maxSide: CGFloat = it == logoPick ? 600 : 2400
                let s = min(1, maxSide / max(img.size.width, img.size.height))
                let size = CGSize(width: img.size.width * s, height: img.size.height * s)
                let small = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
                guard let jpg = small.jpegData(compressionQuality: 0.86) else { throw APIError(message: "Could not read this picture.") }
                let u = try await API.uploadBrandPicture(jpg, type: "image/jpeg")
                withAnimation(Glass.spring) { done(u) }
            } catch { err = t(error.localizedDescription) }
        }
    }

    private func save() {
        err = ""; msg = ""; busy = true
        Task {
            do {
                _ = try await API.pro(["action": "brand", "name": name, "logo": logo, "bgs": bgs], as: AnyCodable.self)
                msg = t("Saved."); await pro.load(); Glass.tap(.medium)
            } catch { err = t(error.localizedDescription) }
            busy = false
        }
    }
}
