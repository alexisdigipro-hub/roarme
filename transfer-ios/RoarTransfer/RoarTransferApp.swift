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
    enum Tab: Hashable { case receive, send, mine }
    @Published var tab: Tab = .receive
    @Published var openToken: String?
    func open(_ text: String) {
        guard let t = API.token(from: text) else { return }
        tab = .receive
        openToken = t
    }
}

struct RootView: View {
    @EnvironmentObject var router: Router
    init() {
        let a = UITabBarAppearance()
        a.configureWithTransparentBackground()
        a.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        a.backgroundColor = UIColor(white: 0.08, alpha: 0.6)
        UITabBar.appearance().standardAppearance = a
        UITabBar.appearance().scrollEdgeAppearance = a
    }
    var body: some View {
        TabView(selection: $router.tab) {
            ReceiveView().tabItem { Label("Receive", systemImage: "arrow.down.circle") }.tag(Router.Tab.receive)
            SendView().tabItem { Label("Send", systemImage: "arrow.up.circle") }.tag(Router.Tab.send)
            MineView().tabItem { Label("My Transfers", systemImage: "tray.full") }.tag(Router.Tab.mine)
        }
    }
}
