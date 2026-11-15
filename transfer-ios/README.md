# RoarTransfer for iPhone

The native iPhone app of roartransfer.com (Alex, 15 Nov 2026). SwiftUI, iOS 16+, no dependencies.

- **Receive**: a RoarTransfer link (roartransfer.com/<token>, a pasted link, or roartransfer://<token>) opens in the app.
  Videos and photos download in the background (URLSession background session, any size, the screen may lock) and go
  straight into Photos (PhotoKit, add-only permission); anything else stays in the app's Documents, which Files shows
  (On My iPhone > RoarTransfer). The download address is roar-transfer-get ?dl=1&o=1 (counted, then R2 as plain bytes).
- **Send**: photos and videos from the library in their original form (PHPicker .current, no transcoding) or any file
  from Files, up through roartransfer-r2 (create, sign, 16 MB pieces three at a time, complete, bundle), one link.
- **My Transfers**: sign in with the RoarTransfer account (Supabase password sign-in, session in the Keychain);
  roar_my_transfers lists what was sent. Accounts are made on the website.

Built only on GitHub: .github/workflows/transfer-ios.yml (XcodeGen makes the project from project.yml). "check" builds
for the simulator; "testflight" registers the bundle id com.themadlions.roartransfer, needs the app to exist in App
Store Connect once (New App), then archives and uploads with the App Store Connect key in this repository's secrets.

Universal links need roartransfer.com/.well-known/apple-app-site-association naming <TeamID>.com.themadlions.roartransfer
(the Team ID is printed by the testflight run).
