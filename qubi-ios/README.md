# Qubi for iPhone

Qubi (the Greek music video database, https://qubi.gr) as an iPhone app: a Capacitor shell that opens qubi.gr
itself, so the app is always the website as it is that minute, with no new build for a change to the site. Its
source is the repository alexisdigipro-hub/qubi-site. This folder lives in RoarMe's repository only because the
App Store Connect key is in this repository's secrets (as roardino-ios/). Nothing of it touches RoarMe the app.

- `capacitor.config.json`: bundle id `com.themadlions.qubi` (it can never change once the app is on the App
  Store), the name on the Home Screen, `server.url` (the site) and `errorPath` (what shows with no connection).
- `www/offline.html`: that page, the only thing inside the app; `www/index.html` is a copy of it.
- `icon-1024.png`: the app's icon (the QUBI logo on black), no see-through parts.
- `package.json`: Capacitor's version; `version` here is the version shown on the App Store.
- `.github/workflows/qubi-ios.yml` makes the Xcode project fresh at every run (nothing of it is kept), builds it
  unsigned for the simulator on a pull request, and with Run workflow > testflight signs it and sends it to
  App Store Connect. The first time, the app has to exist there: Apps > + > New App, iOS, bundle ID
  com.themadlions.qubi, SKU qubi.
