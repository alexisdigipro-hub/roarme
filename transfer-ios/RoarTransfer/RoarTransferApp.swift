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
    enum Tab: Hashable { case send, mine, receive }
    @Published var tab: Tab = .send
    @Published var openToken: String?
    func open(_ text: String) {
        guard let t = API.token(from: text) else { return }
        tab = .receive
        openToken = t
    }
}

// As roartransfer.com: the wordmark, Settings and EN | GR at the top, the switch Send | My transfers (and Receive,
// the app's own) under it, the page in the website's glass card on one of Alex's stills.
struct RootView: View {
    @EnvironmentObject var router: Router
    @EnvironmentObject var lang: Lang
    @State private var settings = false

    var body: some View {
        ZStack {
            Backdrop()
            VStack(spacing: 12) {
                HStack(spacing: 10) {
                    Wordmark()
                    Spacer()
                    Button { settings = true } label: { Image(systemName: "gearshape") }.buttonStyle(RoundStyle(size: 38))
                    Segments(items: [("en", "EN", nil), ("el", "GR", nil)], value: $lang.code, height: 38)
                        .frame(width: 96)
                }
                .padding(.horizontal, 16)
                Segments(items: [(Router.Tab.send, t("Send"), nil), (.mine, t("My transfers"), nil), (.receive, t("Receive"), nil)], value: $router.tab, height: 44)
                    .padding(.horizontal, 16)
                ZStack {
                    switch router.tab {
                    case .send: SendView()
                    case .mine: MineView()
                    case .receive: ReceiveView()
                    }
                }
                .frame(maxHeight: .infinity, alignment: .top)
            }
            .padding(.top, 6)
        }
        .sheet(isPresented: $settings) { SettingsSheet().presentationDetents([.medium, .large]) }
    }
}
