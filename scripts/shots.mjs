// The App Store's screenshots of RoarMe (Alex, 19 Nov: "make the screenshots yourself"): the built app (dist/), opened in
// Chromium at an iPhone 6.9" screen (440 x 956 points, 3x = 1320 x 2868), signed in as a made-up person whose chats are
// made up too. Nothing reaches Supabase: every call to it is answered here, so no real account, name or photo shows.
// Run by .github/workflows/appstore.yml (mode screenshots) after npm run build; writes shots/<n>-<name>.png.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'

const DIST = new URL('../dist/', import.meta.url).pathname
const OUT = new URL('../shots/', import.meta.url).pathname
const SB = 'https://bzmjhbnwhdwmncxkqkdl.supabase.co'
const now = Date.now()
const ago = (min) => new Date(now - min * 60e3).toISOString()
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// people
const ME = uid(1)
const P = {
  [ME]: ['nina', 'Nina Rossi'],
  [uid(2)]: ['sofia', 'Sofia Andreou'],
  [uid(3)]: ['leo', 'Leo Martin'],
  [uid(4)]: ['daniel', 'Daniel Kim'],
  [uid(5)]: ['elena', 'Elena Petrou'],
  [uid(6)]: ['marco', 'Marco Bianchi'],
  [uid(7)]: ['chloe', 'Chloe Laurent'],
  [uid(8)]: ['jonas', 'Jonas Berg'],
}
const people = Object.entries(P).map(([id, [username, display_name]], i) => ({
  id, username, display_name, bio: '', avatar_url: '', name_color: '', privacy: {}, created_at: ago(90 * 24 * 60),
  last_seen: ago(i % 3 === 0 ? 0 : i * 11),
}))

// chats
const R = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const room = (n, kind, title, members, last, body, by, unread = 0, extra = {}) => ({
  room_id: R(n), kind, title, avatar_url: '', last_message_at: ago(last), muted: false, archived: false, last_read_at: ago(last + (unread ? 5 : -1)),
  role: 'admin', unread, last_body: body, last_kind: extra.kind || 'text', last_user: by, last_deleted: false, members: [ME, ...members],
})
const rooms = [
  room(1, 'direct', '', [uid(2)], 2, 'Can’t wait! See you at 8 🎬', uid(2), 2),
  room(2, 'group', 'Film Crew 🎥', [uid(3), uid(4), uid(5), uid(6)], 9, '📊 Shooting day: which date works?', uid(3), 5),
  room(3, 'direct', '', [uid(4)], 34, 'Sent you the edit, tell me what you think', uid(4), 1),
  room(4, 'group', 'Weekend in Hydra 🏝️', [uid(5), uid(7), uid(2)], 75, 'Ferry leaves at 9:30, don’t be late!', uid(7)),
  room(5, 'direct', '', [uid(6)], 180, 'Ha, perfect 😂', ME),
  room(6, 'direct', '', [uid(7)], 60 * 20, 'Photo', uid(7), 0, { kind: 'image' }),
  room(7, 'group', 'Family ❤️', [uid(8), uid(5)], 60 * 26, 'Sunday lunch at grandma’s?', uid(8)),
  room(8, 'direct', '', [uid(8)], 60 * 50, 'Thanks for the call!', uid(8)),
]

// messages
let mid = 0
const msgs = []
const M = (r, by, min, body, more = {}) => { const m = { id: `20000000-0000-4000-8000-${String(++mid).padStart(12, '0')}`, room_id: R(r), user_id: by, kind: 'text', body, file: null, reply_to: null, edited_at: null, deleted_at: null, created_at: ago(min), ...more }; msgs.push(m); return m }
const pic = (name, w, h) => ({ name: `${name}.jpg`, path: `${R(1)}/${name}.jpg`, thumb: `${R(1)}/${name}-t.jpg`, size: 1834221, type: 'image/jpeg', w, h })
M(1, uid(2), 64, 'Hey! Are we still on for Friday? 🎬')
M(1, ME, 62, 'Yes!! 8 pm at the open-air cinema 🍿')
const sea = M(1, uid(2), 40, '', { kind: 'image', file: pic('sea', 1600, 1200) })
M(1, uid(2), 39, 'Look where I am right now 😍')
M(1, ME, 30, 'So jealous… that view is unreal ❄️🏔️', { reply_to: sea.id })
M(1, uid(2), 12, 'Thissio Open Air Cinema', { file: { location: { z: 16, lat: 37.97557, lng: 23.71982, name: 'Thissio Open Air Cinema', addr: 'Apostolou Pavlou 7, Athens' } } })
M(1, ME, 6, 'Perfect, I’ll bring the blanket 🧺')
M(1, uid(2), 2, 'Can’t wait! See you at 8 🎬')
const reacts = [{ message_id: sea.id, user_id: ME, emoji: '❤️' }, { message_id: msgs[msgs.length - 2].id, user_id: uid(2), emoji: '👍' }]

M(2, uid(5), 70, 'Morning everyone! Location scout photos are in the folder 📁')
M(2, uid(4), 64, 'They look amazing. The rooftop is perfect for the last scene')
M(2, ME, 50, 'Agreed. We need the light around 7 pm')
const poll = M(2, uid(3), 9, '📊 Shooting day: which date works?', { file: { poll: true } })
M(2, uid(6), 4, 'Saturday works best for the gear rental 👍')
const pollState = {
  poll: { message_id: poll.id, room_id: R(2), created_by: uid(3), question: 'Shooting day: which date works?', description: '',
    options: [{ id: 'a', text: 'Friday 21st' }, { id: 'b', text: 'Saturday 22nd' }, { id: 'c', text: 'Sunday 23rd' }],
    show_voters: true, multiple: false, add_options: false, revote: true, shuffle: false, correct: null, closes_at: null, closed_at: null, created_at: ago(9), updated_at: ago(3) },
  closed: false, counts: { a: 1, b: 3, c: 1 }, voters_total: 5, mine: ['b'], voters: { a: [uid(5)], b: [uid(3), ME, uid(6)], c: [uid(4)] },
}
M(3, uid(4), 34, 'Sent you the edit, tell me what you think')
M(4, uid(7), 75, 'Ferry leaves at 9:30, don’t be late!')
M(5, ME, 180, 'Ha, perfect 😂')
M(6, uid(7), 60 * 20, '', { kind: 'image', file: pic('sea', 1600, 1200) })
M(7, uid(8), 60 * 26, 'Sunday lunch at grandma’s?')
M(8, uid(8), 60 * 50, 'Thanks for the call!')

const calls = [
  { id: uid(901), room_id: R(1), caller: uid(2), callee: ME, video: true, status: 'answered', started_at: ago(180), answered_at: ago(179), ended_at: ago(160) },
  { id: uid(902), room_id: R(3), caller: ME, callee: uid(4), video: false, status: 'answered', started_at: ago(60 * 5), answered_at: ago(60 * 5 - 1), ended_at: ago(60 * 5 - 9) },
  { id: uid(903), room_id: R(8), caller: uid(8), callee: ME, video: false, status: 'missed', started_at: ago(60 * 26), answered_at: null, ended_at: ago(60 * 26) },
  { id: uid(904), room_id: R(5), caller: ME, callee: uid(6), video: true, status: 'answered', started_at: ago(60 * 50), answered_at: ago(60 * 50 - 1), ended_at: ago(60 * 50 - 22) },
]

const TABLES = {
  roar_people: people, roar_profiles: people, roar_messages: msgs, roar_reactions: reacts, roar_calls: calls,
  roar_rooms: rooms.map((r) => ({ id: r.room_id, kind: r.kind, title: r.title, pinned_message_id: null, auto_delete_hours: null })),
  roar_members: rooms.flatMap((r) => r.members.map((u) => ({ room_id: r.room_id, user_id: u, role: 'admin', muted: false, archived: false, last_read_at: ago(0), joined_at: ago(9e4) }))),
  roar_contacts: people.filter((p) => p.id !== ME).map((p) => ({ owner: ME, person: p.id, photo_url: '', nickname: '', note: '', updated_at: ago(9e4) })),
}
const RPC = {
  roar_my_rooms: rooms, roar_am_blocked: false, roar_poll_state: pollState, roar_my_mentions: [], roar_is_admin: false, roar_findable: true,
}

// what PostgREST would give: eq / in / is filters on the columns, ordered by created_at as asked, cut by limit
const pick = (rows, q) => {
  let out = [...rows]
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict'].includes(k)) continue
    const [op, ...rest] = v.split('.'); const val = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val)
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')); out = out.filter((r) => set.includes(String(r[k]))) }
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null)
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val)
  }
  const ord = q.get('order')
  if (ord) { const [col, dir] = ord.split('.'); out.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)) }
  const lim = Number(q.get('limit')); if (lim) out = out.slice(0, lim)
  return out
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(now / 1000) + 86400 * 30
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: exp - 86400 * 31 }], exp, session_id: uid(77) })}.c2ln`
const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'nina@example.com', email_confirmed_at: ago(9e4), created_at: ago(9e4), app_metadata: {}, user_metadata: {}, factors: [] }
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400 * 30, expires_at: exp, user }

const photos = {}
const photo = async (name) => {
  if (photos[name]) return photos[name]
  const src = { sea: 'https://picsum.photos/id/1036/1200/900' }[name] || 'https://picsum.photos/id/1036/1200/900'
  try { const r = await fetch(src); photos[name] = Buffer.from(await r.arrayBuffer()) } catch { photos[name] = null }
  return photos[name]
}

async function answer(route) {
  const req = route.request()
  const url = new URL(req.url())
  const p = url.pathname
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (p.startsWith('/auth/v1/user')) return json(user)
  if (p.startsWith('/auth/v1/')) return json({})
  if (p.startsWith('/realtime/')) return route.abort()
  if (p.startsWith('/functions/')) return json({})
  if (p.startsWith('/storage/v1/object/sign/')) {
    if (req.method() === 'POST') {
      const rest = p.replace('/storage/v1/object/sign/', '')
      const body = req.postDataJSON?.() || {}
      if (body.paths) { const bucket = rest.split('/')[0]; return json(body.paths.map((x) => ({ path: x, signedURL: `/object/sign/${bucket}/${x}?token=t`, error: null }))) }
      return json({ signedURL: `/object/sign/${rest}?token=t` })
    }
    const name = p.split('/').pop().replace(/(-t)?\.jpg$/, '')
    const img = await photo(name)
    return img ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: img }) : route.fulfill({ status: 404 })
  }
  if (p.startsWith('/storage/')) return json([])
  if (p.startsWith('/rest/v1/rpc/')) {
    const fn = p.split('/').pop()
    return json(fn in RPC ? RPC[fn] : null)
  }
  if (p.startsWith('/rest/v1/')) {
    if (req.method() !== 'GET' && req.method() !== 'HEAD') return json([], 201)
    const t = p.split('/').pop()
    const rows = pick(TABLES[t] || [], url.searchParams)
    const one = /vnd\.pgrst\.object/.test(req.headers().accept || '')
    if (one) return rows[0] ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows' }, 406)
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) })
  }
  return json({})
}

// the built site, served as it is online
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mjs': 'text/javascript' }
const server = createServer(async (q, s) => {
  let f = decodeURIComponent(new URL(q.url, 'http://x').pathname)
  if (f.endsWith('/')) f += 'index.html'
  try { const body = await readFile(join(DIST, f)); s.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); s.end(body) }
  catch { s.writeHead(404); s.end() }
}).listen(4173)

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
// iPhone 6.9" (1320 x 2868) and iPad 13" (2064 x 2752)
const PHONE = { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
const PAD = { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, ua: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
async function shot(name, { hash = '', mode = 'light', go, dev = PHONE } = {}) {
  const ctx = await browser.newContext({
    viewport: dev.viewport, deviceScaleFactor: dev.deviceScaleFactor, isMobile: true, hasTouch: true,
    userAgent: dev.ua,
    serviceWorkers: 'block',
  })
  await ctx.addInitScript(([s, m]) => {
    localStorage.setItem('roarme-auth-2', JSON.stringify(s))
    const prev = JSON.parse(localStorage.getItem('roarme-prefs') || '{}')
    localStorage.setItem('roarme-prefs', JSON.stringify({ ...prev, mode: m }))
    // as inside the iPhone app: no "add to Home Screen" or download offers
    window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} }
  }, [session, mode])
  await ctx.route(`${SB}/**`, answer)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  page error (${name}): ${e.message}`))
  await page.goto(`http://localhost:4173/${hash}`)
  await page.waitForTimeout(2500)
  if (go) await go(page)
  await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}${name}.png` })
  console.log(`shot ${name}`)
  await ctx.close()
}

const tapText = (t) => async (page) => { await page.getByText(t, { exact: false }).first().click().catch((e) => console.log(`  no "${t}": ${e.message.split('\n')[0]}`)); await page.waitForTimeout(1200) }
await shot('1-chats')
await shot('2-chat', { hash: `#c=${R(1)}` })
await shot('3-group', { hash: `#c=${R(2)}` })
await shot('4-calls', { go: async (page) => { await page.locator('.foot-calls, [data-tab="calls"]').first().click().catch(() => tapText('Calls')(page)) } })
await shot('5-chats-dark', { mode: 'dark' })
await shot('ipad-1-chat', { hash: `#c=${R(1)}`, dev: PAD })
await shot('ipad-2-group', { hash: `#c=${R(2)}`, dev: PAD })
await shot('ipad-3-calls', { dev: PAD, go: async (page) => { await page.locator('.foot-calls, [data-tab="calls"]').first().click().catch(() => tapText('Calls')(page)) } })
await shot('ipad-4-chat-dark', { hash: `#c=${R(1)}`, mode: 'dark', dev: PAD })
await browser.close()
server.close()
