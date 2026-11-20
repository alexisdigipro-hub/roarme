// RoarMe for the Mac App Store (Alex, 20 Nov): the same shell as the .dmg, built with electron-builder's "mas" target,
// with the website inside (www/, copied from ../dist by .github/workflows/mac-appstore.yml), the App Store's bundle id
// (the iPhone app's, so both live in one App Store Connect record), the sandbox, and none of the .dmg's ad-hoc signing.
const base = require('./package.json').build
const config = {
  ...base,
  appId: 'com.themadlions.roarme',
  afterPack: null,
  files: [...base.files],
  extraResources: [{ from: 'www', to: 'www' }],
  buildVersion: process.env.BUILD_NUMBER || '1',
  extraMetadata: { version: process.env.MAS_VERSION || '1.0.0' },
  mac: { ...base.mac, target: [{ target: 'mas', arch: ['universal'] }] },
  mas: {
    type: 'distribution',
    category: 'public.app-category.social-networking',
    hardenedRuntime: false,
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
    entitlementsLoginHelper: 'build/entitlements.mas.loginhelper.plist',
    provisioningProfile: 'build/embedded.provisionprofile',
    artifactName: 'RoarMe-${version}-MAS.${ext}',
    extendInfo: {
      ...base.mac.extendInfo,
      ITSAppUsesNonExemptEncryption: false,
      LSMinimumSystemVersion: '12.0',
    },
  },
}
// nothing of the .dmg or Windows builds: their own settings, the ad-hoc identity (null) and the beta file names
for (const k of ['dmg', 'win', 'nsis']) delete config[k]
for (const k of ['identity', 'artifactName']) delete config.mac[k]
module.exports = config
