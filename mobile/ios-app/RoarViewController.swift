// The app's main screen: Capacitor's own, plus RoarMe's plugins that live in the app itself (RoarCamera.swift).
// .github/workflows/ios.yml puts this class in Main.storyboard in place of CAPBridgeViewController.
import UIKit
import Capacitor

class RoarViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(RoarCameraPlugin())
        bridge?.registerPluginInstance(RoarBadgePlugin())
    }
}
