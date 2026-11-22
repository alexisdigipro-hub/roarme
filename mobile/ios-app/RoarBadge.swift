// The number on RoarMe's icon (Alex, 22 Nov): while RoarMe is open the page sets it to its own unread count
// (src/push.js setBadge -> RoarBadge.set), and roar-push sends it with each notification while it is closed.
import UIKit
import UserNotifications
import Capacitor

@objc(RoarBadgePlugin)
public class RoarBadgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RoarBadgePlugin"
    public let jsName = "RoarBadge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    @objc func set(_ call: CAPPluginCall) {
        let n = max(0, call.getInt("count") ?? 0)
        DispatchQueue.main.async {
            if #available(iOS 16.0, *) {
                UNUserNotificationCenter.current().setBadgeCount(n) { _ in }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = n
            }
            call.resolve()
        }
    }
}
