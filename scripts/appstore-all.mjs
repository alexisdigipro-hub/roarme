// Reads, without changing anything, every app on the App Store Connect account: each platform's newest versions with
// their state, the latest review submission and the newest builds. Run by appstore.yml mode `all`.
import { createSign } from 'node:crypto'
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env
const b64 = (x) => Buffer.from(x).toString('base64url')
const jwt = () => { const now = Math.floor(Date.now() / 1000); const d = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`; return `${d}.${b64(createSign('SHA256').update(d).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' }))}` }
const api = async (p) => { const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, { headers: { Authorization: `Bearer ${jwt()}` } }); const t = await r.text(); if (!r.ok) return { error: `${r.status} ${t.slice(0, 160)}` }; return JSON.parse(t) }
const apps = (await api('/v1/apps?limit=50')).data || []
for (const a of apps) {
  console.log(`\n== ${a.attributes.name} (${a.attributes.bundleId})`)
  const vs = await api(`/v1/apps/${a.id}/appStoreVersions?limit=8`)
  if (vs.error) console.log('  versions:', vs.error)
  for (const v of vs.data || []) {
    const x = v.attributes
    console.log(`  ${x.platform} ${x.versionString}: ${x.appVersionState || x.appStoreState} (store ${x.appStoreState}), created ${String(x.createdDate).slice(0, 10)}`)
  }
  const subs = await api(`/v1/reviewSubmissions?filter[app]=${a.id}&limit=5`)
  for (const s of subs.data || []) console.log(`  submission ${s.attributes.platform}: ${s.attributes.state}, sent ${String(s.attributes.submittedDate || '').slice(0, 16)}`)
  for (const pf of ['IOS', 'MAC_OS']) {
    const bs = await api(`/v1/builds?filter[app]=${a.id}&filter[preReleaseVersion.platform]=${pf}&sort=-uploadedDate&limit=2`)
    if ((bs.data || []).length) console.log(`  ${pf} builds: ${bs.data.map((b) => `${b.attributes.version} ${b.attributes.processingState} ${String(b.attributes.uploadedDate).slice(0, 10)}`).join(', ')}`)
  }
}
