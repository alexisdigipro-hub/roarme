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
    enum Tab: Hashable { case send, mine, receive, studio, settings }
    static weak var shared: Router?
    @Published var tab: Tab = .send
    init() { Router.shared = self }
    @Published var openToken: String?
    func open(_ text: String) {
        guard let t = API.token(from: text) else { return }
        tab = .receive
        openToken = t
    }
}

// As roartransfer.com: the wordmark (with PRO for a Pro) and EN | GR at the top, the page in the website's glass card
// on one of Alex's stills, and at the foot RoarMe's menu: Send · My transfers · Receive · Studio · Settings.
struct RootView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var lang: Lang
    @EnvironmentObject var pro: ProStore
    @EnvironmentObject var session: Session

    var body: some View {
        ZStack(alignment: .bottom) {
            Backdrop()
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Wordmark()
                    if pro.isPro { ProBadge().transition(.glassDrop) }
                    Spacer()
                    Segments(items: [("en", "EN", nil), ("el", "GR", nil)], value: $lang.code, height: 38).frame(width: 96)
                }
                .padding(.horizontal, 16)
                ZStack {
                    switch router.tab {
                    case .send: SendView().transition(.glassDrop)
                    case .mine: MineView().transition(.glassDrop)
                    case .receive: ReceiveView().transition(.glassDrop)
                    case .studio: StudioView().padding(.bottom, 92).transition(.glassDrop)
                    case .settings: SettingsView().transition(.glassDrop)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
                .animation(Glass.spring, value: router.tab)
            }
            .padding(.top, 6)

            FootMenu(items: [
                (Router.Tab.send, t("Send"), "foot-send"),
                (.mine, t("My transfers"), "foot-mine"),
                (.receive, t("Receive"), "foot-receive"),
                (.studio, "Studio", "foot-studio"),
                (.settings, t("Settings"), "foot-settings"),
            ], value: $router.tab)
            .padding(.horizontal, 12)
            .padding(.bottom, 4)
        }
        .task(id: session.signedIn) { await pro.load() }
    }
}
