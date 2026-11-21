// The newest crash reports testers sent from TestFlight (Alex, 21 Nov: the selfie closed the app), read through the App
// Store Connect API (betaFeedbackCrashSubmissions and their crash logs). Run by appstore.yml mode crashes. Prints only
// the build, the device, the system, the tester's own comment and the log; never the tester's name or email.
import { createSign } from 'node:crypto'
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = process.env
const b64 = (x) => Buffer.from(x).toString('base64url')
const jwt = () => {
  const now = Math.floor(Date.now() / 1000)
  const data = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`
  return `${data}.${b64(createSign('SHA256').update(data).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' }))}`
}
const api = async (p) => { const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, { headers: { Authorization: `Bearer ${jwt()}` } }); const t = await r.text(); if (!r.ok) throw new Error(`${p.split('?')[0]}: ${r.status} ${t.slice(0, 300)}`); return JSON.parse(t) }
const app = (await api('/v1/apps?filter[bundleId]=com.themadlions.roarme')).data[0]
const subs = (await api(`/v1/apps/${app.id}/betaFeedbackCrashSubmissions?sort=-createdDate&limit=3&include=build`)).data || []
if (!subs.length) console.log('No crash reports sent from TestFlight yet.')
for (const s of subs) {
  const a = s.attributes || {}
  console.log(`\n===== ${a.createdDate} · ${a.deviceModel} · iOS ${a.osVersion} · build ${s.relationships?.build?.data?.id || '?'}`)
  if (a.comment) console.log(`Comment: ${a.comment}`)
  try {
    const log = (await api(`/v1/betaFeedbackCrashSubmissions/${s.id}/crashLog`)).data?.attributes?.logText || ''
    console.log(log.split('\n').slice(0, 160).join('\n'))
  } catch (e) { console.log(`(no log: ${e.message})`) }
}
