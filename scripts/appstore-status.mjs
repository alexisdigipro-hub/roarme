// Reads, without changing anything, whether RoarMe's iPhone version is ready to send for review: the build, the
// screenshots, and the App Review details (the demo account's name and whether a password is there; never the password).
import { createSign } from 'node:crypto'
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env
const b64 = (x) => Buffer.from(x).toString('base64url')
const jwt = () => { const now = Math.floor(Date.now() / 1000); const d = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`; return `${d}.${b64(createSign('SHA256').update(d).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' }))}` }
const api = async (p) => { const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, { headers: { Authorization: `Bearer ${jwt()}` } }); const t = await r.text(); if (!r.ok) throw new Error(`${p.split('?')[0]}: ${r.status} ${t.slice(0, 200)}`); return JSON.parse(t) }
const app = (await api('/v1/apps?filter[bundleId]=com.themadlions.roarme')).data[0]
const ver = (await api(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=5`)).data[0]
console.log(`Version ${ver.attributes.versionString}: ${ver.attributes.appVersionState || ver.attributes.appStoreState}, release ${ver.attributes.releaseType}`)
const b = (await api(`/v1/appStoreVersions/${ver.id}/build`)).data
console.log(`Build: ${b ? b.attributes.version + ' ' + b.attributes.processingState : 'none'}`)
const loc = (await api(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data[0]
for (const s of (await api(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data) {
  const shots = (await api(`/v1/appScreenshotSets/${s.id}/appScreenshots`)).data
  console.log(`Screenshots ${s.attributes.screenshotDisplayType}: ${shots.length} (${shots.map((x) => x.attributes.assetDeliveryState?.state).join(', ')})`)
}
const r = (await api(`/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`)).data
const a = r?.attributes || {}
console.log(`Sign-in required: ${a.demoAccountRequired}; user name filled: ${!!a.demoAccountName}${a.demoAccountName ? ` (${a.demoAccountName.replace(/(.).*(@.*)/, '$1…$2')})` : ''}; password filled: ${!!a.demoAccountPassword}`)
console.log(`Contact: first name ${!!a.contactFirstName}, last name ${!!a.contactLastName}, phone ${!!a.contactPhone}, email ${!!a.contactEmail}; notes ${a.notes ? a.notes.length + ' characters' : 'empty'}`)
const info = (await api(`/v1/apps/${app.id}/appInfos`)).data.find((i) => !/READY_FOR_DISTRIBUTION/.test(i.attributes.state || i.attributes.appStoreState)) 
const ar = (await api(`/v1/appInfos/${info.id}/ageRatingDeclaration`)).data
console.log(`Age rating answers: ${JSON.stringify(ar.attributes)}`)
