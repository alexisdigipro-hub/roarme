# RoarMe for iPhone

The App Store app is the same RoarMe (the build of the repository's root) inside a Capacitor shell. Nothing of the
shell is kept here but its settings: the Xcode project is made fresh on GitHub at every build
(`.github/workflows/ios.yml`), so there is no Mac and no Xcode to look after.

- `capacitor.config.json`: the bundle id `com.themadlions.roarme` (it can never change once the app is on the App
  Store) and the name on the Home Screen.
- `package.json`: Capacitor's version; `version` here is the version shown on the App Store.
- The workflow builds the website, copies it into `www/`, runs `cap add ios`, writes the permission texts (camera,
  microphone, saving a photo) and the icon into the project, and builds it.
