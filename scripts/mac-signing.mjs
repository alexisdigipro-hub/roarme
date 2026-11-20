// Signing for RoarMe in the Mac App Store (Alex, 20 Nov), made fresh on GitHub's Mac with the App Store Connect key, as
// the iPhone builds do: a "Mac App Distribution" certificate (signs the app) and a "Mac Installer Distribution" one
// (signs the .pkg), each with a private key made here and never kept, both put in a keychain of their own, and a
// Mac App Store provisioning profile for com.themadlions.roarme. Apple allows only a few certificates of each kind, so
// when one cannot be made the oldest of that same kind is revoked first; these two kinds are used only for the Mac
// App Store, and revoking one never touches an app already published. iPhone and Apple Distribution certificates are
// never touched.
// Reads ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, APPLE_TEAM_ID; writes desktop/build/embedded.provisionprofile and
// desktop/build/entitlements.mas.plist (the team filled in).
import { createSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BUNDLE = 'com.themadlions.roarme'
const PROFILE_NAME = 'RoarMe Mac App Store (GitHub)'
const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, APPLE_TEAM_ID } = process.env
for (const [k, v] of Object.entries({ ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, APPLE_TEAM_ID })) if (!v) { console.log(`::error::The repository secret ${k} is missing`); process.exit(1) }
const DESK = new URL('../desktop/', import.meta.url).pathname
const TMP = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'mas-'))
const KC = join(process.env.RUNNER_TEMP || tmpdir(), 'roarme-mas.keychain-db')
const KC_PASS = Math.random().toString(36).slice(2) + Date.now().toString(36)

const b64 = (x) => Buffer.from(x).toString('base64url')
const jwt = () => {
  const now = Math.floor(Date.now() / 1000)
  const d = `${b64(JSON.stringify({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }))}`
  return `${d}.${b64(createSign('SHA256').update(d).sign({ key: ASC_KEY_P8, dsaEncoding: 'ieee-p1363' }))}`
}
const api = async (method, path, body) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { method, headers: { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  if (!r.ok) { const e = new Error(`${method} ${path.split('?')[0]}: ${r.status} ${text.slice(0, 500)}`); e.status = r.status; throw e }
  return text ? JSON.parse(text) : {}
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString()

// the bundle id must be one a Mac app may use
const bid = (await api('GET', `/v1/bundleIds?filter[identifier]=${BUNDLE}&limit=5`)).data.find((b) => b.attributes.identifier === BUNDLE)
if (!bid) { console.log(`::error::${BUNDLE} is not registered`); process.exit(1) }
console.log(`Bundle id ${BUNDLE}: platform ${bid.attributes.platform}`)

// a certificate of each kind, with its own fresh key
async function certificate(type) {
  const key = join(TMP, `${type}.key`); const csr = join(TMP, `${type}.csr`)
  run('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', csr, '-subj', `/CN=RoarMe GitHub ${type}/C=GR`])
  const csrContent = readFileSync(csr, 'utf8')
  const make = () => api('POST', '/v1/certificates', { data: { type: 'certificates', attributes: { certificateType: type, csrContent } } })
  let made
  try { made = await make() } catch (e) {
    if (e.status !== 409) throw e
    const old = ((await api('GET', `/v1/certificates?filter[certificateType]=${type}&limit=200`)).data || [])
      .sort((a, b) => String(a.attributes.expirationDate).localeCompare(String(b.attributes.expirationDate)))
    if (!old.length) throw e
    console.log(`${type}: Apple's limit reached; revoking the oldest (${old[0].attributes.name}, ${old[0].attributes.expirationDate})`)
    await api('DELETE', `/v1/certificates/${old[0].id}`)
    made = await make()
  }
  const cer = join(TMP, `${type}.cer`); const pem = join(TMP, `${type}.pem`); const p12 = join(TMP, `${type}.p12`)
  writeFileSync(cer, Buffer.from(made.data.attributes.certificateContent, 'base64'))
  run('openssl', ['x509', '-inform', 'DER', '-in', cer, '-out', pem])
  // -legacy: the keychain still reads only the older PKCS#12 ciphers
  try { run('openssl', ['pkcs12', '-export', '-legacy', '-inkey', key, '-in', pem, '-out', p12, '-passout', `pass:${KC_PASS}`]) }
  catch { run('openssl', ['pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12, '-passout', `pass:${KC_PASS}`]) }
  run('security', ['import', p12, '-k', KC, '-P', KC_PASS, '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild', '-T', '/usr/bin/security'])
  console.log(`${type}: made (${made.data.attributes.name})`)
  return made.data
}

run('security', ['create-keychain', '-p', KC_PASS, KC])
run('security', ['set-keychain-settings', '-lut', '21600', KC])
run('security', ['unlock-keychain', '-p', KC_PASS, KC])
const list = run('security', ['list-keychains', '-d', 'user']).split('\n').map((s) => s.trim().replace(/"/g, '')).filter(Boolean)
run('security', ['list-keychains', '-d', 'user', '-s', KC, ...list])
// Apple's intermediate certificate, so the new ones are trusted
try {
  const wwdr = join(TMP, 'wwdr.cer')
  writeFileSync(wwdr, Buffer.from(await (await fetch('https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer')).arrayBuffer()))
  run('security', ['import', wwdr, '-k', KC])
} catch (e) { console.log(`::warning::Apple's intermediate certificate not added: ${e.message}`) }

const appCert = await certificate('MAC_APP_DISTRIBUTION')
await certificate('MAC_INSTALLER_DISTRIBUTION')
run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', KC_PASS, KC])
console.log(run('security', ['find-identity', '-v', KC]))

// the profile: the old one of this name goes, a new one with the new certificate comes
for (const p of (await api('GET', `/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&limit=50`)).data || []) await api('DELETE', `/v1/profiles/${p.id}`)
const prof = await api('POST', '/v1/profiles', { data: { type: 'profiles', attributes: { name: PROFILE_NAME, profileType: 'MAC_APP_STORE' }, relationships: {
  bundleId: { data: { type: 'bundleIds', id: bid.id } },
  certificates: { data: [{ type: 'certificates', id: appCert.id }] },
} } })
writeFileSync(join(DESK, 'build/embedded.provisionprofile'), Buffer.from(prof.data.attributes.profileContent, 'base64'))
writeFileSync(join(DESK, 'build/entitlements.mas.plist'), readFileSync(join(DESK, 'build/entitlements.mas.plist.in'), 'utf8').replaceAll('__TEAM__', APPLE_TEAM_ID))
console.log(`Profile "${PROFILE_NAME}" made; entitlements written for team ${APPLE_TEAM_ID.slice(0, 2)}…`)
if (process.env.GITHUB_ENV) writeFileSync(process.env.GITHUB_ENV, `CSC_KEYCHAIN=${KC}\n`, { flag: 'a' })
