# RoarRef for iPhone

RoarRef (character sheets for AI, https://themadlions.com/lab/roarref/app/) as an iPhone app: a Capacitor shell that
opens that page itself, so the app is always the website as it is that minute, with no new build for a change to
it. Its source is not here: it is `public/site/lab/roarref/app/index.html` of alexisdigipro-hub/themadlions-projects,
served from themadlions-site. This folder lives in RoarMe's repository only because the App Store Connect key is in
this repository's secrets (as roardino-ios/ and transfer-ios/). Nothing of it touches RoarMe the app.

- `capacitor.config.json`: bundle id `com.themadlions.roarref` (it can never change once the app is on the App
  Store), the name on the Home Screen, `server.url` (the page) and `errorPath` (what shows with no connection). The
  page reaches every edge of the screen and keeps clear of the clock and the home line by itself (`contentInset: never`,
  `env(safe-area-inset-*)` in the page), and the app itself does not scroll or bounce (`scrollEnabled: false`), only the
  page's own lists do (Alex, 20 Nov: black pieces showed, and the app spilled over). The workflow sets light status bar text.
- `www/offline.html`: that page, the only thing inside the app; `www/index.html` is a copy of it.
- `icon-1024.png`: the app's icon (the Lab's three windows), no see-through parts.
- `package.json`: Capacitor's version; `version` here is the version shown on the App Store.
- `.github/workflows/roarref-ios.yml` makes the Xcode project fresh at every run (nothing of it is kept), builds it
  unsigned for the simulator on a pull request, and with Run workflow > testflight signs it and sends it to
  App Store Connect. The first time, the app has to exist there: Apps > + > New App, iOS, name RoarRef, bundle ID
  com.themadlions.roarref, SKU roarref.
