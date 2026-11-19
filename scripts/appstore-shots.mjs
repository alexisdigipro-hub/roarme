// Sends shots/*.png (from scripts/shots.mjs) to RoarMe's iPhone 6.9" screenshots in App Store Connect, in name order,
// in place of the ones there. Run by .github/workflows/appstore.yml (mode upload-screenshots) with the ASC_* secrets.
import { createSign, createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

const BUNDLE = 'com.themadlions.roarme'
const TYPE = 'APP_IPHONE_67' // App Store Connect's slot for the 6.7" and 6.9" iPhones (1290 x 2796, 1320 x 2868)
const DIR = new URL('../shots/', import.meta.url).pathname
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env

const b64 = (x) => Buffer.from(x).toString('base64url')
const jwt = () => {
  const now = Math.floor(Date.now() / 1000)
  const data = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`
  return `${data}.${b64(createSign('SHA256').update(data).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' }))}`
}
const api = async (method, path, body) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: ${r.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : {}
}

const app = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE}`)).data[0]
const ver = ((await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`)).data || [])
  .find((v) => /PREPARE_FOR_SUBMISSION|DEVELOPER_REJECTED|REJECTED|METADATA_REJECTED/.test(v.attributes.appVersionState || v.attributes.appStoreState))
if (!ver) throw new Error('No iOS version open for changes')
const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data
const files = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort()
console.log(`Version ${ver.attributes.versionString}, ${files.length} pictures, ${locs.length} language(s)`)

for (const loc of locs) {
  const sets = (await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data || []
  let set = sets.find((s) => s.attributes.screenshotDisplayType === TYPE)
  if (!set) set = (await api('POST', '/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: TYPE }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } } } })).data
  for (const old of (await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)).data || []) await api('DELETE', `/v1/appScreenshots/${old.id}`)
  for (const f of files) {
    const buf = readFileSync(DIR + f)
    const shot = (await api('POST', '/v1/appScreenshots', { data: { type: 'appScreenshots', attributes: { fileName: f, fileSize: buf.length }, relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } })).data
    for (const op of shot.attributes.uploadOperations) {
      const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]))
      const r = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) })
      if (!r.ok) throw new Error(`upload ${f}: ${r.status}`)
    }
    await api('PATCH', `/v1/appScreenshots/${shot.id}`, { data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(buf).digest('hex') } } })
    console.log(`${loc.attributes.locale}: ${f} sent`)
  }
}
console.log('Done. Apple checks each picture for a minute or two before it shows.')
