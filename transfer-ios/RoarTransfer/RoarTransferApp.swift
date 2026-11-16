import SwiftUI
import UIKit

@main
struct RoarTransferApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var router = Router()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(router)
                .environmentObject(Session.shared)
                .environmentObject(Downloads.shared)
                .environmentObject(Lang.shared)
                .environmentObject(Uploader.shared)
                .environmentObject(ProStore.shared)
                .preferredColorScheme(.dark)
                .tint(Theme.redHi)
                // a RoarTransfer link (roartransfer.com/<token>, or roartransfer://<token>) opens it here
                .onOpenURL { url in router.open(url.absoluteString) }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { a in if let u = a.webpageURL { router.open(u.absoluteString) } }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        Task { @MainActor in Downloads.shared.reattach() }
        return true
    }
    // iOS woke the app because downloads ended while it was closed
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            Downloads.shared.backgroundDone = completionHandler
            _ = Downloads.shared.session
        }
    }
}

// a little more time to finish sending when the app goes to the background
enum UIApplicationBackground {
    @MainActor private static var id: UIBackgroundTaskIdentifier = .invalid
    @MainActor static func begin() {
        guard id == .invalid else { return }
        id = UIApplication.shared.beginBackgroundTask(withName: "send") { Task { @MainActor in end() } }
    }
    @MainActor static func end() {
        guard id != .invalid else { return }
        UIApplication.shared.endBackgroundTask(id); id = .invalid
    }
}

@MainActor
final class Router: ObservableObject {
    enum Tab: Hashable { case send, mine, receive, settings }
    static weak var shared: Router?
    @Published var tab: Tab = .send
    @Published var page: String?          // about, pricing, privacy, terms: the footer's pages, in a window
    init() { Router.shared = self }
    @Published var openToken: String?
    func open(_ text: String) {
        guard let t = API.token(from: text) else { return }
        tab = .receive
        openToken = t
    }
}

// Exactly as roartransfer.com on a phone (Alex, 16 Nov: "make the app exactly as the web app"): the wordmark, then PRO
// with the Settings gear in one glass capsule and EN | GR; under them the site's menu Send · My transfers · Receive
// (Receive stands where the site has Admin, which the app does not carry); the page in the glass card on one of Alex's
// stills; and the site's foot under every page. No menu at the foot of the screen any more.
struct RootView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var lang: Lang
    @EnvironmentObject var pro: ProStore
    @EnvironmentObject var session: Session

    var body: some View {
        ZStack {
            Backdrop()
            VStack(spacing: 12) {
                HStack(spacing: 8) {
                    Wordmark()
                    Spacer(minLength: 4)
                    HStack(spacing: 6) {
                        if pro.isPro { ProBadge().transition(.glassDrop) }
                        Button { Glass.tap(.soft); withAnimation(Glass.spring) { router.tab = router.tab == .settings ? .send : .settings } } label: {
                            Image(systemName: "gearshape").font(.system(size: 15, weight: .medium))
                                .foregroundStyle(router.tab == .settings ? Theme.text : Theme.text.opacity(0.8))
                                .frame(width: 28, height: 28)
                                .background(Circle().fill(Color.white.opacity(router.tab == .settings ? 0.2 : 0.08)))
                        }
                        .buttonStyle(FootPress())
                        .accessibilityLabel(t("Settings"))
                    }
                    .padding(.horizontal, 5).frame(height: 38)
                    .background(ZStack { Capsule().fill(.ultraThinMaterial); Capsule().fill(Color(red: 0.07, green: 0.08, blue: 0.09).opacity(0.65)) })
                    .overlay(Capsule().stroke(Theme.edge, lineWidth: 1))
                    Segments(items: [("en", "EN", nil), ("el", "GR", nil)], value: $lang.code, height: 38, solid: true).frame(width: 84)
                }
                .padding(.horizontal, 16)

                Segments(items: [(Router.Tab.send, t("Send"), nil), (.mine, t("My transfers"), nil), (.receive, t("Receive"), nil)], value: $router.tab, height: 46, solid: true)
                    .frame(maxWidth: 330)
                    .padding(.horizontal, 30)

                ZStack {
                    switch router.tab {
                    case .send: SendView().transition(.glassDrop)
                    case .mine: MineView().transition(.glassDrop)
                    case .receive: ReceiveView().transition(.glassDrop)
                    case .settings: SettingsView().transition(.glassDrop)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .animation(Glass.spring, value: router.tab)
            }
            .padding(.top, 6)

            // the site's foot, fixed low on the screen; it stays put under the keyboard
            // the site's foot as a floating pane of frosted glass (Alex, 16 Nov: the dark fade was not nice, "glassmorphism"):
            // what scrolls behind it shows blurred through the glass; it stays put under the keyboard
            VStack { Spacer(); SiteFooter().padding(.horizontal, 12).padding(.bottom, 2) }
                .ignoresSafeArea(.keyboard)

            if let p = router.page {
                GlassWindow(title: pageTitle(p), close: { router.page = nil }) {
                    if p == "pricing" { PricingView() } else { WebPage(path: p, lang: lang.code).frame(height: 560) }
                }
                .transition(.opacity).zIndex(9)
            }
        }
        .task(id: session.signedIn) { await pro.load() }
    }
}
