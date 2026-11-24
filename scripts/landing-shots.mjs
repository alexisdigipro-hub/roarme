// The screens of roarme.app (landing/screens/*.jpg), rendered from the real app with made-up people (Alex, 24 Nov: "fresh
// screenshots of the app, in my colours"): light, the warm stone grey wallpaper ('stone', the strength RoarMe starts with), one's own messages in Roar Blue,
// PROjects on with a made-up project "Mira Vale – Night Drive". Nothing reaches Supabase: every call is answered here.
//
// It needs no npm install: src/ is transpiled with TypeScript's transpileModule (jsx react-jsx), served with an importmap
// to cdn.jsdelivr.net (react, react-dom, @supabase/supabase-js, livekit-client), and driven with Playwright + Chromium.
//   node scripts/landing-shots.mjs              (all screens, written to landing/screens/)
//   node scripts/landing-shots.mjs phone-chat   (only the ones named)
// TS and Playwright are looked up in the global node_modules (NODE_PATH, /opt/node-tools, /opt/node22); set
// LANDING_TS / LANDING_PW to their paths if they live elsewhere. Pictures in chats come from picsum.photos (needs the network).
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from 'node:fs/promises'
import { extname, join, dirname, relative } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
const BUILD = join(process.env.TMPDIR || '/tmp', 'roarme-landing-build')
const OUT = process.env.LANDING_OUT || join(ROOT, 'landing/screens')
const PORT = 4185
const SB = 'https://bzmjhbnwhdwmncxkqkdl.supabase.co'
const only = process.argv.slice(2)

const req = createRequire(import.meta.url)
const find = (name, env) => {
  for (const p of [process.env[env], ...(process.env.NODE_PATH || '').split(':').map((d) => d && join(d, name)), `/opt/node-tools/node_modules/${name}`, `/opt/node22/lib/node_modules/${name}`, name]) {
    if (!p) continue
    try { return req(p) } catch { /* next */ }
  }
  throw new Error(`${name} not found`)
}
const ts = find('typescript', 'LANDING_TS')
const { chromium } = find('playwright', 'LANDING_PW')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const ver = (n) => String(pkg.dependencies[n]).replace(/^[\^~]/, '')

// ---------- 1. the app, transpiled as it is (no bundling) ----------
async function walk(d) { const out = []; for (const e of await readdir(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p) } return out }
async function build() {
  await rm(BUILD, { recursive: true, force: true })
  for (const f of await walk(join(ROOT, 'public'))) { const to = join(BUILD, relative(join(ROOT, 'public'), f)); await mkdir(dirname(to), { recursive: true }); await copyFile(f, to) }
  const css = []
  for (const f of await walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f); const to = join(BUILD, rel)
    await mkdir(dirname(to), { recursive: true })
    if (!/\.(jsx?|mjs)$/.test(f)) { await copyFile(f, to); continue }
    let code = await readFile(f, 'utf8')
    code = code.replace(/^import\s+['"](\.\/[^'"]+\.css)['"];?.*$/gm, (_, p) => { css.push(join(dirname(rel), p)); return '' })
    code = code.replace(/^import\s+(\w+)\s+from\s+['"](\.\/[^'"]+\.(png|webp|jpe?g|svg))['"];?.*$/gm, (_, n, p) => `const ${n} = new URL('${p}', import.meta.url).href`)
    code = code.replace(/import\.meta\.env\.BASE_URL/g, "'/'").replace(/import\.meta\.env\.PROD/g, 'false').replace(/import\.meta\.env\.DEV/g, 'true')
    const js = ts.transpileModule(code, { fileName: f.replace(/\.mjs$/, '.js'), compilerOptions: { jsx: ts.JsxEmit.ReactJSX, allowJs: true, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    await writeFile(to, js)
  }
  const cdn = (p) => `https://cdn.jsdelivr.net/npm/${p}/+esm`
  const map = { imports: {
    react: cdn(`react@${ver('react')}`), 'react/jsx-runtime': cdn(`react@${ver('react')}/jsx-runtime`),
    'react-dom': cdn(`react-dom@${ver('react-dom')}`), 'react-dom/client': cdn(`react-dom@${ver('react-dom')}/client`),
    '@supabase/supabase-js': cdn(`@supabase/supabase-js@${ver('@supabase/supabase-js')}`), 'livekit-client': cdn(`livekit-client@${ver('livekit-client')}`),
  } }
  let html = await readFile(join(ROOT, 'index.html'), 'utf8')
  html = html.replace('</head>', `${css.map((c) => `<link rel="stylesheet" href="/${c}">`).join('\n')}\n<script type="importmap">${JSON.stringify(map)}</script>\n</head>`)
  await writeFile(join(BUILD, 'index.html'), html)
}

// ---------- 2. made-up people, chats and a project ----------
const now = Date.now()
const ago = (min) => new Date(now - min * 60e3).toISOString()
const day = (d) => { const t = new Date(now + d * 864e5); return t.toISOString().slice(0, 10) }
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const R = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ME = uid(1)
const P = {
  [ME]: ['nina', 'Nina Rossi'], [uid(2)]: ['sofia', 'Sofia Andreou'], [uid(3)]: ['leo', 'Leo Martin'], [uid(4)]: ['daniel', 'Daniel Kim'],
  [uid(5)]: ['elena', 'Elena Petrou'], [uid(6)]: ['marco', 'Marco Bianchi'], [uid(7)]: ['chloe', 'Chloe Laurent'], [uid(8)]: ['jonas', 'Jonas Berg'],
  [uid(9)]: ['mira', 'Mira Vale'], [uid(10)]: ['theo', 'Theo Novak'],
}
const people = Object.entries(P).map(([id, [username, display_name]], i) => ({
  id, username, display_name, bio: '', avatar_url: '', name_color: '', privacy: {}, created_at: ago(90 * 24 * 60),
  last_seen: ago(i % 3 === 0 ? 0 : i * 11), presence: i === 4 ? 'away' : 'online', pro_on: true,
}))

const PROJ = R(20)
const room = (id, kind, title, members, last, body, by, unread = 0, extra = {}) => ({
  room_id: id, kind, title, avatar_url: '', last_message_at: ago(last), muted: false, archived: false, last_read_at: ago(last + (unread ? 5 : -1)),
  role: 'admin', unread, last_body: body, last_kind: extra.kind || 'text', last_user: by, last_deleted: false, members: [ME, ...members], ...extra,
})
const rooms = [
  room(PROJ, 'group', 'Mira Vale – Night Drive', [uid(2), uid(3), uid(4), uid(5), uid(9)], 3, 'Call sheet for day 2 is up', uid(2), 3, { project: true, channels: ['pre', 'prod', 'post'] }),
  room(R(1), 'direct', '', [uid(2)], 6, 'Can’t wait! See you at 8 🎬', uid(2), 2),
  room(R(2), 'group', 'Film Crew 🎥', [uid(3), uid(4), uid(5), uid(6)], 12, '📊 Shooting day: which date works?', uid(3), 5),
  room(R(21), 'group', 'Atlas Coffee – Spring Spot', [uid(3), uid(6), uid(10)], 40, 'Casting tapes are in', uid(3), 1, { project: true, channels: ['pre', 'prod', 'post'] }),
  room(R(3), 'direct', '', [uid(4)], 55, 'Sent you the edit, tell me what you think', uid(4), 1),
  room(R(4), 'group', 'Weekend in Hydra 🏝️', [uid(5), uid(7), uid(2)], 95, 'Ferry leaves at 9:30, don’t be late!', uid(7)),
  room(R(22), 'group', 'Blue Hour – Short Film', [uid(5), uid(8)], 60 * 9, 'Grade v3 approved', uid(5), 0, { project: true, channels: ['pre', 'prod', 'post'] }),
  room(R(5), 'direct', '', [uid(6)], 60 * 11, 'Ha, perfect 😂', ME),
  room(R(6), 'direct', '', [uid(7)], 60 * 20, 'Photo', uid(7), 0, { kind: 'image' }),
  room(R(7), 'group', 'Family ❤️', [uid(8), uid(5)], 60 * 26, 'Sunday lunch at grandma’s?', uid(8)),
  room(R(8), 'direct', '', [uid(8)], 60 * 50, 'Thanks for the call!', uid(8)),
  room(R(9), 'direct', '', [uid(10)], 60 * 70, 'The drone is booked for Friday', uid(10)),
]

let mid = 0
const msgs = []
const M = (r, by, min, body, more = {}) => { const m = { id: `20000000-0000-4000-8000-${String(++mid).padStart(12, '0')}`, room_id: r, user_id: by, kind: 'text', body, file: null, reply_to: null, edited_at: null, deleted_at: null, created_at: ago(min), channel: null, ...more }; msgs.push(m); return m }
const pic = (r, name, w, h) => ({ name: `${name}.jpg`, path: `${r}/${name}.jpg`, thumb: `${r}/${name}-t.jpg`, size: 1834221, type: 'image/jpeg', w, h })
// a direct chat
M(R(1), uid(2), 64, 'Hey! Are we still on for Friday? 🎬')
M(R(1), ME, 62, 'Yes!! 8 pm at the open-air cinema 🍿')
const sea = M(R(1), uid(2), 40, '', { kind: 'image', file: pic(R(1), 'sea', 1536, 768) })
M(R(1), uid(2), 39, 'Found our corridor for scene 4 😍')
M(R(1), ME, 30, 'That light is unreal. Book it!', { reply_to: sea.id })
M(R(1), uid(2), 12, 'Done. Friday after the screening we go and look at it together')
M(R(1), ME, 8, 'Perfect, I’ll bring the blanket 🧺')
M(R(1), uid(2), 6, 'Can’t wait! See you at 8 🎬')
// a group with a poll
M(R(2), uid(5), 70, 'Morning everyone! Location scout photos are in the folder 📁')
M(R(2), uid(4), 64, 'They look amazing. The salon is perfect for the last scene')
M(R(2), ME, 50, 'Agreed. We need the chandelier lit by 7 pm')
const roof = M(R(2), uid(5), 46, '', { kind: 'image', file: pic(R(2), 'roof', 1536, 768) })
M(R(2), uid(6), 30, 'That’s the one 🔥', { reply_to: roof.id })
const poll = M(R(2), uid(3), 14, '📊 Shooting day: which date works?', { file: { poll: true } })
M(R(2), uid(6), 12, 'Saturday works best for the gear rental 👍')
const pollState = {
  poll: { message_id: poll.id, room_id: R(2), created_by: uid(3), question: 'Shooting day: which date works?', description: '',
    options: [{ id: 'a', text: 'Friday 27th' }, { id: 'b', text: 'Saturday 28th' }, { id: 'c', text: 'Sunday 29th' }],
    show_voters: true, multiple: false, add_options: false, revote: true, shuffle: false, correct: null, closes_at: null, closed_at: null, created_at: ago(14), updated_at: ago(3) },
  closed: false, counts: { a: 1, b: 3, c: 1 }, voters_total: 5, mine: ['b'], voters: { a: [uid(5)], b: [uid(3), ME, uid(6)], c: [uid(4)] },
}
// the project's three chats
M(PROJ, uid(9), 60 * 30, 'So happy we’re doing this together. The demo is in Files 🎧', { channel: 'pre' })
M(PROJ, uid(5), 60 * 5, 'Wardrobe options for Mira are in the folder 👗', { channel: 'pre' })
M(PROJ, uid(4), 60 * 3, 'Drone permit is still pending, I will call them in the morning.', { channel: 'pre' })
M(PROJ, ME, 60 * 2, 'Perfect. Keep it for the close-ups on the road.', { channel: 'pre' })
M(PROJ, uid(3), 50, 'Lens test went well, the 85 holds the sodium light.', { channel: 'pre' })
M(PROJ, uid(2), 3, 'Call sheet for day 2 is up', { channel: 'pre' })
M(PROJ, ME, 2, 'Call time 19:00 at the harbour café. Rain truck at 21:00.', { channel: 'pre' })
M(PROJ, uid(3), 30, 'Batteries charged, two bodies ready 🔋', { channel: 'prod' })
M(PROJ, uid(4), 20, 'Grip truck leaves at 17:30', { channel: 'prod' })
M(PROJ, uid(5), 25, 'First assembly by Monday', { channel: 'post' })
// a file, a song and photos in the project, kept in the Workspace
M(PROJ, uid(2), 60 * 6, '', { kind: 'file', channel: 'pre', file: { name: 'Night Drive – Treatment.pdf', path: `${PROJ}/treatment.pdf`, size: 4_812_330, type: 'application/pdf' } })
M(PROJ, uid(2), 60 * 6, '', { kind: 'file', channel: 'pre', file: { name: 'Call Sheet Day 2.pdf', path: `${PROJ}/callsheet.pdf`, size: 612_330, type: 'application/pdf' } })
M(PROJ, uid(5), 60 * 7, '', { kind: 'file', channel: 'pre', file: { name: 'Shot list v4.docx', path: `${PROJ}/shotlist.docx`, size: 88_120, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } })
M(PROJ, uid(3), 60 * 8, '', { kind: 'file', channel: 'pre', file: { name: 'Night Drive – master.wav', path: `${PROJ}/master.wav`, size: 32_512_000, type: 'audio/wav' } })
M(PROJ, uid(9), 60 * 9, '', { kind: 'file', channel: 'pre', file: { name: 'Night Drive – demo mix.mp3', path: `${PROJ}/demo.mp3`, size: 7_212_000, type: 'audio/mpeg' } })
for (const [n, nm] of [[1, 'harbour'], [2, 'road'], [3, 'neon'], [4, 'cafe'], [5, 'car'], [6, 'city']]) M(PROJ, [uid(3), uid(5), uid(4)][n % 3], 60 * 10 + n, '', { kind: 'image', channel: 'pre', file: pic(PROJ, nm, 1536, 768) })
for (const r of [R(3), R(4), R(5), R(6), R(7), R(8), R(9), R(21), R(22)]) { const x = rooms.find((y) => y.room_id === r); M(r, x.last_user, (now - Date.parse(x.last_message_at)) / 6e4, x.last_body) }

const calls = [
  { id: uid(901), room_id: R(1), caller: uid(2), callee: ME, video: true, status: 'answered', started_at: ago(180), answered_at: ago(179), ended_at: ago(160) },
  { id: uid(902), room_id: R(3), caller: ME, callee: uid(4), video: false, status: 'answered', started_at: ago(60 * 5), answered_at: ago(60 * 5 - 1), ended_at: ago(60 * 5 - 9) },
  { id: uid(903), room_id: R(8), caller: uid(8), callee: ME, video: false, status: 'missed', started_at: ago(60 * 26), answered_at: null, ended_at: ago(60 * 26) },
  { id: uid(904), room_id: R(5), caller: ME, callee: uid(6), video: true, status: 'answered', started_at: ago(60 * 50), answered_at: ago(60 * 50 - 1), ended_at: ago(60 * 50 - 22) },
  { id: uid(905), room_id: R(9), caller: uid(10), callee: ME, video: false, status: 'answered', started_at: ago(60 * 75), answered_at: ago(60 * 75 - 1), ended_at: ago(60 * 75 - 4) },
  { id: uid(906), room_id: R(6), caller: ME, callee: uid(7), video: true, status: 'answered', started_at: ago(60 * 100), answered_at: ago(60 * 100 - 1), ended_at: ago(60 * 100 - 31) },
]

const img = (name) => ({ path: `${PROJ}/scout-${name}.jpg`, thumb: `${PROJ}/scout-${name}-t.jpg` })
const task = (id, t, st, due, more = {}) => ({ id, t, st, s: st === 'done' ? 'done' : st === 'doing' ? 'doing' : 'todo', due, pri: 'normal', subs: [], ...more, who: more.who ? [more.who] : [] })
const proRow = (room_id, status, fields, more = {}) => ({ room_id, status, due: day(2), brief: '', fields, tasks: [], scouts: [], ordinos: [], stages: null, date_label: 'Shoot Date', cover: null, cover_pick: 0, hub_music: [], hub_ordinos: [], updated_at: ago(3), created_at: ago(9e3), ...more })
const projects = [
  proRow(PROJ, 'shoot', [{ k: 'Artist / Client', v: 'Mira Vale' }, { k: 'Title', v: 'Night Drive' }, { k: 'Category', v: 'Music Video' }], {
    brief: 'One night, one car, the city in sodium light. Mira drives from the harbour to the hills while the song builds.',
    tasks: [
      task('t1', 'Call sheet, day 2', 'doing', day(0), { pri: 'high', who: uid(2), subs: [{ id: 's1', t: 'Weather check', d: true }, { id: 's2', t: 'Send to crew', d: false }] }),
      task('t2', 'Lens test with Leo', 'done', day(-1), { who: uid(3) }),
      task('t3', 'Book the drone permit', 'blocked', day(1), { pri: 'urgent', who: uid(4) }),
      task('t4', 'Wardrobe fitting with Mira', 'todo', day(2), { who: uid(5) }),
      task('t5', 'Rain truck and water supply', 'todo', day(2), { who: ME }),
      task('t6', 'Picture lock', 'todo', day(9), { who: uid(5) }),
    ],
    scouts: [
      { id: 'l1', name: 'Harbour Café', address: 'Akti Themistokleous 12, Piraeus', type: 'Both', st: 'confirmed', contact: 'Yannis', phone: '+30 210 000 0000', permit: 'Granted, 26 to 27 Nov', notes: 'Power from the kitchen, quiet after 22:00.', tags: ['night', 'water'], photos: [img('harbour'), img('cafe')] },
      { id: 'l2', name: 'Coastal Road', address: 'Poseidonos Avenue, Vouliagmeni', type: 'Exterior', st: 'option', contact: 'Traffic police', permit: 'Asked', notes: 'Rolling road block, two passes.', tags: ['road', 'drone'], photos: [img('road'), img('car')] },
      { id: 'l3', name: 'Neon Alley', address: 'Kalamiotou 4, Athens', type: 'Exterior', st: 'confirmed', contact: 'Venue owner', tags: ['neon'], photos: [img('neon')] },
      { id: 'l4', name: 'Hill Lookout', address: 'Lycabettus, Athens', type: 'Exterior', st: 'rejected', notes: 'Too many tourists after sunset.', tags: ['city'], photos: [img('city')] },
    ],
    ordinos: [{ url: 'https://example.com/o/night-drive', token: 'x', label: 'Call Sheet', title: 'Night Drive', artist: 'Mira Vale', date: day(2), call: '19:00', place: 'Harbour Café', accent: '#3AA7E8' }],
  }),
  proRow(R(21), 'prep', [{ k: 'Artist / Client', v: 'Atlas Coffee' }, { k: 'Title', v: 'Spring Spot' }, { k: 'Category', v: 'Commercial' }]),
  proRow(R(22), 'post', [{ k: 'Artist / Client', v: 'Blue Hour' }, { k: 'Title', v: 'Short Film' }, { k: 'Category', v: 'Short Film' }]),
]
const visits = [ME, uid(2), uid(3), uid(4), uid(5), uid(9)].map((u, i) => ({ user_id: u, opens: [24, 19, 12, 9, 6, 3][i], secs: [15420, 9120, 5220, 3100, 1800, 600][i], days: [9, 8, 6, 5, 3, 2][i], week_opens: [12, 9, 6, 4, 3, 1][i], last_at: ago([3, 40, 300, 600, 900, 2000][i]) }))

const TABLES = {
  roar_people: people, roar_profiles: people, roar_messages: msgs, roar_calls: calls, roar_pro_projects: projects,
  roar_reactions: [{ message_id: sea.id, user_id: ME, emoji: '❤️' }, { message_id: roof.id, user_id: ME, emoji: '❤️' }, { message_id: roof.id, user_id: uid(4), emoji: '🔥' }],
  roar_rooms: rooms.map((r) => ({ id: r.room_id, kind: r.kind, title: r.title, pinned_message_id: null, auto_delete_hours: null, avatar_url: '' })),
  roar_members: rooms.flatMap((r) => r.members.map((u) => ({ room_id: r.room_id, user_id: u, role: u === ME || r.kind === 'direct' ? 'admin' : 'member', channels: r.project ? ['pre', 'prod', 'post'] : null, muted: false, archived: false, last_read_at: ago(0), joined_at: ago(9e4) }))),
  roar_contacts: people.filter((p) => p.id !== ME).map((p) => ({ owner: ME, person: p.id, photo_url: '', nickname: '', note: '', updated_at: ago(9e4) })),
}
const RPC = {
  roar_my_rooms: rooms, roar_am_blocked: false, roar_poll_state: pollState, roar_my_mentions: [], roar_is_admin: false, roar_findable: true,
  roar_visit_stats: visits, roar_hub_me: null, roar_hub_state: null,
}

const pick = (rows, q) => {
  let out = [...rows]
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'and'].includes(k)) continue
    const [op, ...rest] = v.split('.'); const val = rest.join('.')
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val)
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/"/g, '')); out = out.filter((r) => set.includes(String(r[k]))) }
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null)
    else if (op === 'neq') out = out.filter((r) => String(r[k]) !== val)
    else if (op === 'ilike') { const re = new RegExp(`^${val.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*')}$`, 'i'); out = out.filter((r) => re.test(String(r[k] || ''))) }
    else if (op === 'not' && v === 'not.is.null') out = out.filter((r) => r[k] != null)
  }
  const ord = q.get('order')
  if (ord) { const [col, dir] = ord.split(',')[0].split('.'); out.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)) }
  const lim = Number(q.get('limit')); if (lim) out = out.slice(0, lim)
  return out
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(now / 1000) + 86400 * 30
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, role: 'authenticated', aal: 'aal1', amr: [{ method: 'password', timestamp: exp - 86400 * 31 }], exp, session_id: uid(77) })}.c2ln`
const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: 'nina@example.com', email_confirmed_at: ago(9e4), created_at: ago(9e4), app_metadata: {}, user_metadata: {}, factors: [] }
const session = { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 86400 * 30, expires_at: exp, user }

// the pictures in chats and in Location Scout: RoarTransfer's own stills (public/transfer/stills), so nothing is fetched
const PICS = { sea: 'corridor', roof: 'salon', harbour: 'salon', road: 'corridor', neon: 'silhouette', cafe: 'shoes', car: 'shoes', city: 'silhouette' }
const photos = {}
const photo = async (name) => {
  if (name in photos) return photos[name]
  try { photos[name] = await readFile(join(ROOT, 'public/transfer/stills', `${PICS[name] || 'corridor'}.webp`)) } catch { photos[name] = null }
  return photos[name]
}

async function answer(route) {
  const rq = route.request()
  const url = new URL(rq.url())
  const p = url.pathname
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  if (p.startsWith('/auth/v1/user')) return json(user)
  if (p.startsWith('/auth/v1/')) return json({})
  if (p.startsWith('/realtime/')) return route.abort()
  if (p.startsWith('/functions/')) return json({})
  if (p.startsWith('/storage/v1/object/sign/')) {
    if (rq.method() === 'POST') {
      const rest = p.replace('/storage/v1/object/sign/', '')
      const body = rq.postDataJSON?.() || {}
      if (body.paths) { const bucket = rest.split('/')[0]; return json(body.paths.map((x) => ({ path: x, signedURL: `/object/sign/${bucket}/${x}?token=t`, error: null }))) }
      return json({ signedURL: `/object/sign/${rest}?token=t` })
    }
    const name = p.split('/').pop().replace(/^scout-/, '').replace(/(-t)?\.jpg$/, '')
    if (!(name in PICS)) return route.fulfill({ status: 404 })
    const im = await photo(name)
    return im ? route.fulfill({ status: 200, contentType: 'image/webp', body: im }) : route.fulfill({ status: 404 })
  }
  if (p.startsWith('/storage/')) return json([])
  if (p.startsWith('/rest/v1/rpc/')) { const fn = p.split('/').pop(); return json(fn in RPC ? RPC[fn] : null) }
  if (p.startsWith('/rest/v1/')) {
    if (rq.method() !== 'GET' && rq.method() !== 'HEAD') return json([], 201)
    const t = p.split('/').pop()
    const rows = pick(TABLES[t] || [], url.searchParams)
    const one = /vnd\.pgrst\.object/.test(rq.headers().accept || '')
    if (one) return rows[0] ? json(rows[0]) : json(null)
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(rows) })
  }
  return json({})
}

// ---------- 3. shots ----------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const PHONE = { viewport: { width: 400, height: 868 }, scale: 1.5, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }
const DESK = { viewport: { width: 1440, height: 900 }, scale: 1600 / 1440, desktop: true, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' }
const LOOK = { theme: 'glass', accent: 'h-roar', accentHex: '', myBubble: '', background: process.env.LANDING_BG || 'stone', wallStrength: Number(process.env.LANDING_WS || 31), font: 'inter', folderOrder: [], folderTabs: 'top' }

let browser
const NEWS_ID = ((await readFile(join(ROOT, 'src/whatsnew.jsx'), 'utf8')).match(/id: '([^']+)'/) || [])[1] || ''
async function shot(name, { hash = '', mode = 'light', go, dev = PHONE, store = {} } = {}) {
  if (only.length && !only.includes(name)) return
  const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.scale, isMobile: !dev.desktop, hasTouch: !dev.desktop, userAgent: dev.ua, serviceWorkers: 'block' })
  await ctx.addInitScript(([s, look, st, phone]) => {
    localStorage.setItem('roarme-auth-2', JSON.stringify(s))
    localStorage.setItem('roarme-prefs', JSON.stringify(look))
    localStorage.setItem('roarme-pro-on', '1')
    localStorage.setItem('roarme-news-seen', st.__news); delete st.__news
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v)
    if (phone) window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} }
  }, [session, { ...LOOK, mode }, { ...store, __news: NEWS_ID }, !dev.desktop])
  await ctx.route(`${SB}/**`, answer)
  ctx.on('weberror', () => {})
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`  page error (${name}): ${e.message}`))
  if (process.env.LANDING_DEBUG) { page.on('console', (m) => console.log(`  console ${m.type()}: ${m.text().slice(0, 300)}`)); page.on('requestfailed', (r) => console.log(`  failed ${r.url().slice(0, 160)} ${r.failure()?.errorText}`)) }
  await page.goto(`http://localhost:${PORT}/${hash}`)
  await page.waitForTimeout(3500)
  if (go) await go(page)
  await page.waitForTimeout(1800)
  await page.addStyleTag({ content: '.toast, .whatsnew, .wn-back { display: none !important; }' })
  const png = join(BUILD, `${name}.png`)
  await page.screenshot({ path: png })
  // landing/screens holds JPEGs: phones 600 x 1303, computers 1600 x 1000
  const size = dev.desktop ? '1600x1000!' : '600x1303!'
  execFileSync('convert', [png, '-resize', size, '-quality', '86', '-strip', join(OUT, `${name}.jpg`)])
  console.log(`shot ${name}`)
  await ctx.close()
}

const click = (sel, text) => async (page) => {
  const loc = text ? page.locator(sel, { hasText: text }).first() : page.locator(sel).first()
  await loc.click({ timeout: 4000 }).catch((e) => console.log(`  no ${sel} ${text || ''}: ${e.message.split('\n')[0]}`))
  await page.waitForTimeout(1200)
}
const seq = (...fs) => async (page) => { for (const f of fs) await f(page) }

await build()
await mkdir(OUT, { recursive: true })
const server = createServer(async (q, s) => {
  let f = decodeURIComponent(new URL(q.url, 'http://x').pathname)
  if (f.endsWith('/')) f += 'index.html'
  try { const body = await readFile(join(BUILD, f)); s.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); s.end(body) } catch { s.writeHead(404); s.end() }
}).listen(PORT)
browser = await chromium.launch()

const calls_ = (page) => page.locator('.foot-calls, [data-tab="calls"]').first().click().catch(() => {})
const proFolder = click('.tabs button, .wheel-box button', 'JECTS')
const chan = (key) => ({ [`roarme-chan-${PROJ}`]: key })

await shot('phone-chats')
await shot('phone-chat', { hash: `#c=${R(1)}` })
await shot('phone-group', { hash: `#c=${R(2)}` })
await shot('phone-calls', { go: async (page) => { await calls_(page); await page.waitForTimeout(1200) } })
await shot('phone-dark', { mode: 'dark', hash: `#c=${R(1)}` })
await shot('phone-pro-list', { go: proFolder })
await shot('phone-pro-chat', { hash: `#c=${PROJ}`, store: chan('pre') })
await shot('phone-pro-page', { hash: `#c=${PROJ}`, store: chan('pre'), go: click('.head-sw button, .prw-sw2 button', 'Project') })
await shot('desk-chat', { hash: `#c=${R(1)}`, dev: DESK })
await shot('desk-dark', { hash: `#c=${R(2)}`, mode: 'dark', dev: DESK })
await shot('desk-pro-overview', { hash: `#c=${PROJ}`, dev: DESK, store: chan('pre') })
await shot('desk-pro-tasks', { hash: `#c=${PROJ}`, dev: DESK, store: chan('pre'), go: click('.prw-bar button, .prw-tabs button', 'Tasks') })
await shot('desk-pro-locations', { hash: `#c=${PROJ}`, dev: DESK, store: chan('pre'), go: click('.prw-bar button, .prw-tabs button', 'Locations') })
await shot('desk-pro-files', { hash: `#c=${PROJ}`, dev: DESK, store: chan('pre'), go: click('.prw-bar button, .prw-tabs button', 'Files') })

await browser.close()
server.close()
