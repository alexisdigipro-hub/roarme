// Fills RoarMe's App Store listing for iPhone through the App Store Connect API (Alex, 19 Nov: "do the rest for me").
// Run by .github/workflows/appstore.yml with the repository secrets ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8, and BUILD
// (the TestFlight build to put on the version). The texts are in mobile/appstore/listing.json.
// Not reachable through the API, so done by hand in App Store Connect: App Privacy, the review contact and demo login.
// Each step says what it did; one that fails does not stop the others.
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const L = JSON.parse(readFileSync(new URL('../mobile/appstore/listing.json', import.meta.url), 'utf8'))
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, BUILD } = process.env
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) { console.log('::error::The ASC_* repository secrets are missing'); process.exit(1) }

const b64 = (x) => Buffer.from(x).toString('base64url')
let token = '', tokenAt = 0
const jwt = () => {
  const now = Math.floor(Date.now() / 1000)
  if (token && now - tokenAt < 600) return token
  const data = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`
  const sig = createSign('SHA256').update(data).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' })
  token = `${data}.${b64(sig)}`; tokenAt = now
  return token
}
const api = async (method, path, body) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  const json = text ? JSON.parse(text) : {}
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: ${r.status} ${(json.errors || []).map((e) => e.detail || e.title).join(' | ') || text.slice(0, 300)}`)
  return json
}
const done = []
const failed = []
const step = async (name, fn) => {
  try { const r = await fn(); const note = typeof r === 'string' ? r : ''; done.push(name); console.log(`OK    ${name}${note ? ` (${note})` : ''}`) }
  catch (e) { failed.push(name); console.log(`::warning title=${name}::${e.message}`); console.log(`FAIL  ${name}: ${e.message}`) }
}
const editable = (s) => !/READY_FOR_DISTRIBUTION|READY_FOR_SALE|REPLACED|REMOVED|PROCESSING_FOR_DISTRIBUTION/.test(s || '')

const app = (await api('GET', `/v1/apps?filter[bundleId]=${L.bundleId}`)).data?.[0]
if (!app) { console.log(`::error::No app with bundle id ${L.bundleId} in App Store Connect`); process.exit(1) }
console.log(`App: ${app.attributes.name} (${app.id})`)

await step('Content rights', () => api('PATCH', `/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } } }))

const infos = (await api('GET', `/v1/apps/${app.id}/appInfos`)).data || []
const info = infos.find((i) => editable(i.attributes.state || i.attributes.appStoreState)) || infos[0]

await step('Categories', () => api('PATCH', `/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: {
  primaryCategory: { data: { type: 'appCategories', id: L.primaryCategory } },
  secondaryCategory: { data: { type: 'appCategories', id: L.secondaryCategory } },
} } }))

await step('Subtitle and Privacy Policy URL', async () => {
  const locs = (await api('GET', `/v1/appInfos/${info.id}/appInfoLocalizations`)).data || []
  for (const l of locs) await api('PATCH', `/v1/appInfoLocalizations/${l.id}`, { data: { type: 'appInfoLocalizations', id: l.id, attributes: { subtitle: L.subtitle, privacyPolicyUrl: L.privacyPolicyUrl } } })
  return locs.map((l) => l.attributes.locale).join(', ')
})

await step('Age rating', async () => {
  const d = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data
  const none = ['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor',
    'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'violenceCartoonOrFantasy',
    'violenceRealistic', 'violenceRealisticProlongedGraphicOrSadistic']
  const base = Object.fromEntries(none.map((k) => [k, 'NONE']))
  Object.assign(base, { gambling: false, unrestrictedWebAccess: false })
  const full = { ...base, gunsOrOtherWeapons: 'NONE', lootBox: false, messagingAndChat: true, userGeneratedContent: true, advertising: false, ageAssurance: false, healthOrWellnessTopics: false, parentalControls: false, socialMedia: false }
  try { await api('PATCH', `/v1/ageRatingDeclarations/${d.id}`, { data: { type: 'ageRatingDeclarations', id: d.id, attributes: full } }); return 'with Messaging and Chat, User-Generated Content' }
  catch (e) { console.log(`  the newer questions were refused (${e.message}); sending the older set`); await api('PATCH', `/v1/ageRatingDeclarations/${d.id}`, { data: { type: 'ageRatingDeclarations', id: d.id, attributes: base } }); return 'older set: check Messaging and Chat and User-Generated Content by hand' }
})

await step('Price: Free', async () => {
  const pts = (await api('GET', `/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`)).data || []
  const free = pts.find((p) => Number(p.attributes.customerPrice) === 0)
  if (!free) throw new Error('no free price point found')
  await api('POST', '/v1/appPriceSchedules', {
    data: { type: 'appPriceSchedules', relationships: {
      app: { data: { type: 'apps', id: app.id } },
      baseTerritory: { data: { type: 'territories', id: 'USA' } },
      manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] },
    } },
    included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: 'appPricePoints', id: free.id } } } }],
  })
})

await step('Availability: every country', async () => {
  const cur = await api('GET', `/v1/apps/${app.id}/appAvailabilityV2`).catch(() => null)
  if (cur?.data) return 'already set'
  const terr = (await api('GET', '/v1/territories?limit=200')).data || []
  const lid = (t) => `\${${t.id}}`
  await api('POST', '/v2/appAvailabilities', {
    data: { type: 'appAvailabilities', attributes: { availableInNewTerritories: true }, relationships: {
      app: { data: { type: 'apps', id: app.id } },
      territoryAvailabilities: { data: terr.map((t) => ({ type: 'territoryAvailabilities', id: lid(t) })) },
    } },
    included: terr.map((t) => ({ type: 'territoryAvailabilities', id: lid(t), attributes: { available: true }, relationships: { territory: { data: { type: 'territories', id: t.id } } } })),
  })
  return `${terr.length} countries`
})

await step('Availability: not in mainland China (it asks for licences there)', async () => {
  const av = (await api('GET', `/v1/apps/${app.id}/appAvailabilityV2`)).data
  let next = `/v2/appAvailabilities/${av.id}/territoryAvailabilities?limit=200`
  while (next) {
    const page = await api('GET', next)
    const cn = (page.data || []).find((t) => t.relationships?.territory?.data?.id === 'CHN' || /CHN/.test(Buffer.from(t.id, 'base64').toString('latin1')))
    if (cn) {
      if (cn.attributes.available === false) return 'already off'
      await api('PATCH', `/v1/territoryAvailabilities/${cn.id}`, { data: { type: 'territoryAvailabilities', id: cn.id, attributes: { available: false } } })
      return 'China off'
    }
    next = page.links?.next ? page.links.next.replace('https://api.appstoreconnect.apple.com', '') : ''
  }
  throw new Error('China not found in the list')
})

const versions = (await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`)).data || []
const ver = versions.find((v) => editable(v.attributes.appVersionState || v.attributes.appStoreState))
if (!ver) { console.log('::error::No iOS version waiting to be filled (Prepare for Submission)'); process.exit(1) }
console.log(`Version: ${ver.attributes.versionString} (${ver.attributes.appVersionState || ver.attributes.appStoreState})`)

await step('Copyright', () => api('PATCH', `/v1/appStoreVersions/${ver.id}`, { data: { type: 'appStoreVersions', id: ver.id, attributes: { copyright: L.copyright } } }))

await step('Description, keywords, promotional text, support URL', async () => {
  const locs = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`)).data || []
  for (const l of locs) await api('PATCH', `/v1/appStoreVersionLocalizations/${l.id}`, { data: { type: 'appStoreVersionLocalizations', id: l.id, attributes: {
    description: L.description, keywords: L.keywords, promotionalText: L.promotionalText, supportUrl: L.supportUrl,
  } } })
  return locs.map((l) => l.attributes.locale).join(', ')
})

if (BUILD) await step(`Build ${BUILD}`, async () => {
  const b = (await api('GET', `/v1/builds?filter[app]=${app.id}&filter[version]=${BUILD}&filter[preReleaseVersion.platform]=IOS&limit=5`)).data?.[0]
  if (!b) throw new Error(`build ${BUILD} not found (still processing?)`)
  if (b.attributes.processingState !== 'VALID') throw new Error(`build ${BUILD} is ${b.attributes.processingState}`)
  await api('PATCH', `/v1/appStoreVersions/${ver.id}/relationships/build`, { data: { type: 'builds', id: b.id } })
})

await step('App Review notes', async () => {
  const cur = (await api('GET', `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`).catch(() => ({ data: null }))).data
  const attributes = { notes: L.reviewNotes, demoAccountRequired: true }
  if (cur) await api('PATCH', `/v1/appStoreReviewDetails/${cur.id}`, { data: { type: 'appStoreReviewDetails', id: cur.id, attributes } })
  else await api('POST', '/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } })
})

console.log(`\nDone: ${done.length}. Failed: ${failed.length}${failed.length ? ` (${failed.join(', ')})` : ''}.`)
console.log('Left for App Store Connect by hand: App Privacy, the review contact and the demo account login, the screenshots.')
