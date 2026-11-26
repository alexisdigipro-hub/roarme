// Notifications with the app closed (Alex, 18 Oct 2026; supabase/push.sql). Web Push, written out here with the
// browser's own crypto (no library): the message is encrypted for each phone or browser (RFC 8291, aes128gcm) and
// signed with this server's key (VAPID, RFC 8292).
//   GET  ?key            the public key a browser needs to sign up (made, with its private half, the first time)
//   POST {id} + x-roar-hook   a new message (from the trigger roar_push): notify who should know (supabase/mentions.sql:
//                             who is @mentioned is told even in a muted chat, and the notification says so)
//   POST {reminder} + x-roar-hook   a reminder that is due (supabase/reminders.sql): tell the one who set it
//   POST {capsule[, by]} + x-roar-hook   a Locked Message opened (supabase/capsule-notify.sql): at its time, tell the chat's
//                                        other members; reached at its place by someone (by), tell the sender who
//   POST {mail} + x-live-key   a new mail seen by RoarMail Live's Inbox watch: tell its owner's devices
//   POST {test: true} + the user's sign-in   Settings > Send Test: after 5 seconds (time to close RoarMe) a test
//                                            notification to each of that person's devices, and what each push service said
// The private key never leaves the database table roar_push_conf, which only the server can read.
// Inside the iPhone app (14 Nov) a device is kept as https://api.push.apple.com/3/device/<token>: those go to Apple
// (APNs, HTTP/2 with a token signed by the APNs key) instead. The key is three Edge Function secrets set by Alex in
// Supabase: APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_P8 (the .p8 file's text). Without them iPhone-app devices are
// skipped with status 503 and Web Push goes on as before.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const SUBJECT = 'mailto:noreply@themadlions.com'

const enc = new TextEncoder()
const b64u = (u: Uint8Array) => { let s = ''; u.forEach((c) => { s += String.fromCharCode(c) }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length } return out }
const hmac = async (key: Uint8Array, data: Uint8Array) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data))

type Conf = { public_key: string; private_jwk: JsonWebKey; hook_token: string }
let conf: Conf | null = null
let signKey: CryptoKey | null = null

// the server's keys: read, or made once
async function getConf(): Promise<Conf> {
  if (conf) return conf
  const { data } = await sb.from('roar_push_conf').select('public_key, private_jwk, hook_token').eq('id', 1).maybeSingle()
  if (data) { conf = data as Conf; return conf }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  // two at once: the first one written wins, and both read it back
  await sb.from('roar_push_conf').upsert({ id: 1, public_key: pub, private_jwk: jwk }, { onConflict: 'id', ignoreDuplicates: true })
  const again = await sb.from('roar_push_conf').select('public_key, private_jwk, hook_token').eq('id', 1).single()
  conf = again.data as Conf
  return conf
}

async function vapid(endpoint: string) {
  const c = await getConf()
  if (!signKey) signKey = await crypto.subtle.importKey('jwk', c.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, enc.encode(`${head}.${body}`)))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${c.public_key}`
}

// RFC 8291: one record, aes128gcm
async function encrypt(payload: Uint8Array, p256dh: string, authSecret: string) {
  const ua = unb64u(p256dh)
  const auth = unb64u(authSecret)
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const as = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))
  const prkKey = await hmac(auth, shared)
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), ua, as, new Uint8Array([1])))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmac(salt, ikm)
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16)
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(payload, new Uint8Array([2]))))
  const rs = new Uint8Array([0, 0, 16, 0]) // 4096
  return cat(salt, rs, new Uint8Array([as.length]), as, sealed)
}

// what the notification says
const clean = (s: string) => s.replace(/\|\|[^|\n]+\|\|/g, '•••').replace(/\*\*|__|~~|`/g, '').replace(/\s+/g, ' ').trim()
function preview(m: { kind: string; body: string; file: Record<string, unknown> | null }) {
  const f = (m.file || {}) as Record<string, unknown>
  if (typeof m.body === 'string' && m.body.startsWith('e2e1.')) return 'Encrypted message'
  if (m.kind === 'image') return m.body ? `📷 ${clean(m.body)}` : '📷 Photo'
  if (m.kind === 'voice') return '🎤 Voice message'
  if (m.kind === 'file') return `📎 ${(f.name as string) || 'File'}`
  if (f.groupcall) return (f.groupcall as { link?: string }).link ? '📹 invites you to a call' : '📹 started a video chat'
  if (f.contact) return `👤 ${(f.contact as { name?: string }).name || 'Contact'}`
  if (f.event) return `📅 ${clean(m.body)}`
  if (f.location) return '📍 Location'
  if (f.article) return `📰 ${clean(m.body).split(' ').slice(0, 12).join(' ')}`
  if (f.ordino) return '🎬 Call sheet'
  return clean(m.body || '')
}

// Apple's notifications for the iPhone app
const APNS = 'https://api.push.apple.com/3/device/'
const TOPIC = 'com.themadlions.roarme'
let apnsJwt: { token: string; at: number } | null = null
async function apnsToken() {
  // Apple wants the same token reused for 20 to 60 minutes; a new one every 45
  if (apnsJwt && Date.now() - apnsJwt.at < 45 * 60 * 1000) return apnsJwt.token
  const kid = Deno.env.get('APNS_KEY_ID'), team = Deno.env.get('APNS_TEAM_ID'), p8 = Deno.env.get('APNS_KEY_P8')
  if (!kid || !team || !p8) return null
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const iat = Math.floor(Date.now() / 1000)
  const head = b64u(enc.encode(JSON.stringify({ alg: 'ES256', kid })))
  const body = b64u(enc.encode(JSON.stringify({ iss: team, iat })))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`)))
  apnsJwt = { token: `${head}.${body}.${b64u(sig)}`, at: iat * 1000 }
  return apnsJwt.token
}
// RoarMe's own message sounds, as files inside the iPhone app (mobile/sounds, Alex, 14 Nov): the one each device picked
// (roar_push_subs.sound, supabase/push-sound.sql), none while its sound is off, Glass when nothing is known yet
const SOUNDS = ['glass', 'chime', 'pop', 'ping', 'drop', 'bells', 'roar']
// 'iphone': the iPhone's own sound, which Apple plays for 'default' (Alex, 20 Nov)
const soundFile = (k?: string | null) => (k === 'off' ? undefined : k === 'iphone' ? 'default' : `${SOUNDS.includes(k || '') ? k : 'glass'}.wav`)
async function apns(endpoint: string, note: { to?: string; title: string; body: string; room?: string; tag?: string; passive?: boolean; urgent?: boolean; badge?: number; sender?: { id: string; name: string; avatar: string; group?: string } }, sound?: string | null) {
  const jwt = await apnsToken()
  if (!jwt) return new Response('APNs key not set in Supabase (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8)', { status: 503 })
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`, 'apns-topic': TOPIC, 'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400),
      ...(note.tag ? { 'apns-collapse-id': note.tag.slice(0, 64) } : {}),
    },
    // Do Not Disturb (supabase/status.sql): 'passive' lands quietly in the notification list, no sound, no banner
    body: JSON.stringify({ aps: { alert: { title: note.title, body: note.body }, ...(typeof note.badge === 'number' ? { badge: note.badge } : {}), sound: note.passive ? undefined : soundFile(sound), 'thread-id': note.room || 'roarme', ...(note.sender ? { 'mutable-content': 1 } : {}), ...(note.passive ? { 'interruption-level': 'passive' } : note.urgent ? { 'interruption-level': 'time-sensitive' } : {}) }, room: note.room || '', ...(note.to ? { to: note.to } : {}), ...(note.sender ? { sender: note.sender } : {}) }),
  })
  if (r.status === 403) apnsJwt = null // a token Apple no longer takes: a fresh one next time
  // a token for an app that is gone: treated as gone, like Web Push's 410
  if (r.status === 400) { const t = await r.text(); return new Response(t, { status: /BadDeviceToken|DeviceTokenNotForTopic/.test(t) ? 410 : 400 }) }
  return r
}

async function push(t: { endpoint: string; p256dh: string; auth: string; sound?: string | null; user_id?: string }, note0: { title: string; body: string; room?: string; tag?: string; silent?: boolean; passive?: boolean; urgent?: boolean; badge?: number; sender?: { id: string; name: string; avatar: string; group?: string } }) {
  // the account it is for: one device can hold several RoarMe accounts (26 Nov), and a tap opens the right one
  const note = { ...note0, to: t.user_id || '' }
  if (t.endpoint.startsWith(APNS)) return apns(t.endpoint, note, t.sound)
  const r = await fetch(t.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(t.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
    body: await encrypt(enc.encode(JSON.stringify(note)), t.p256dh, t.auth),
  })
  return r
}

async function test(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: { user } } = await sb.auth.getUser(jwt)
  if (!user) return json({ error: 'Sign in first' }, 401)
  const { data: subs } = await sb.from('roar_push_subs').select('*').eq('user_id', user.id)
  if (!subs?.length) return json({ error: 'No device has notifications on yet' }, 404)
  await new Promise((ok) => setTimeout(ok, 5000))
  const results: { device: string; status: number; said: string }[] = []
  for (const t of subs) {
    const device = t.endpoint.startsWith(APNS) ? 'iPhone app' : /iPhone|iPad/.test(t.ua) ? 'iPhone' : /Android/.test(t.ua) ? 'Android' : /Mac/.test(t.ua) ? 'Mac' : /Windows/.test(t.ua) ? 'Windows' : 'Browser'
    try {
      const r = await push(t, { title: 'RoarMe', body: 'Notifications work on this device ✓', room: '', tag: `test-${Date.now()}` })
      results.push({ device, status: r.status, said: r.ok ? 'ok' : (await r.text()).slice(0, 160) })
      if (r.status === 404 || r.status === 410) await sb.from('roar_push_subs').delete().eq('endpoint', t.endpoint)
    } catch (e) { results.push({ device, status: 0, said: String(e).slice(0, 160) }) }
  }
  return json({ results })
}

async function notify(id: string) {
  const { data: m } = await sb.from('roar_messages').select('id, room_id, user_id, kind, body, file').eq('id', id).maybeSingle()
  if (!m) return { sent: 0 }
  const { data: targets, error } = await sb.rpc('roar_push_targets', { msg: id })
  if (error) return { error: error.message }
  if (!targets?.length) return { sent: 0 }
  const [{ data: room }, { data: who }] = await Promise.all([
    sb.from('roar_rooms').select('kind, title').eq('id', m.room_id).maybeSingle(),
    sb.from('roar_profiles').select('display_name, username, avatar_url, privacy').eq('id', m.user_id).maybeSingle(),
  ])
  // each iPhone's sound (select * keeps working before supabase/push-sound.sql adds the column)
  const phones = (targets as { endpoint: string }[]).filter((t) => t.endpoint.startsWith(APNS)).map((t) => t.endpoint)
  const sounds = new Map<string, string | null>()
  const noBadge = new Set<string>() // iPhones with Unread Count on the App Icon off (supabase/badge.sql)
  if (phones.length) {
    const { data: rows } = await sb.from('roar_push_subs').select('*').in('endpoint', phones)
    for (const x of rows || []) { sounds.set(x.endpoint, x.sound ?? null); if (x.badge === false) noBadge.add(x.endpoint) }
  }
  // each person's own settings for this chat (supabase/mute-more.sql; select * keeps working before it is run):
  // Disable Sound -> no sound, Customize -> this chat's sound over the device's
  const chat = new Map<string, { silent?: boolean; sound?: string | null }>()
  {
    const ids = [...new Set((targets as { user_id: string }[]).map((t) => t.user_id))]
    const { data: rows } = await sb.from('roar_members').select('*').eq('room_id', m.room_id).in('user_id', ids)
    for (const x of rows || []) chat.set(x.user_id, x)
  }
  // who is on Do Not Disturb (Settings > Status, supabase/status.sql; select * keeps working before it is run)
  const dnd = new Set<string>()
  {
    const ids = [...new Set((targets as { user_id: string }[]).map((t) => t.user_id))]
    const { data: rows } = await sb.from('roar_profiles').select('*').in('id', ids)
    for (const x of rows || []) if (x.presence === 'dnd') dnd.add(x.id)
  }
  const name = who?.display_name || (who?.username ? `@${who.username}` : 'Someone')
  // the name and photo each one saved for the sender in their contacts (Alex, 21 Nov: "Darta Man" with the photo he gave
  // him, while Darta himself has none) come before the sender's own
  const saved = new Map<string, { nickname?: string | null; photo_url?: string | null }>()
  {
    const ids = [...new Set((targets as { user_id: string }[]).map((t) => t.user_id))]
    const { data: rows } = await sb.from('roar_contacts').select('owner, nickname, photo_url').eq('person', m.user_id).in('owner', ids)
    for (const x of rows || []) saved.set(x.owner, x)
  }
  const group = room?.kind === 'group'
  // Send Without Sound (file.quiet): quiet for everyone; Important / Urgent (file.level 1 / 2, a slide up on Send): a mark
  // before the words and Apple's time-sensitive level, which comes through a Focus; Urgent also with RoarMe's loudest sound
  const mf = (m.file || {}) as { quiet?: boolean; level?: number }
  const quiet = !!mf.quiet
  const level = quiet ? 0 : Number(mf.level) || 0
  const text = (level === 2 ? '‼️ ' : level === 1 ? '❗ ' : '') + preview(m)
  // the number on each one's app icon (supabase/badge.sql; Alex, 22 Nov): their unread messages in chats not muted or archived
  const badges = new Map<string, number>()
  if (targets?.length) {
    const ids = [...new Set((targets as { user_id: string }[]).map((t) => t.user_id))]
    const { data: rows, error } = await sb.rpc('roar_badge_counts', { ids })
    // before supabase/badge.sql is run the call fails: no number is sent, the icon stays as it was
    if (!error) for (const id of ids) badges.set(id, 0)
    for (const x of (rows || []) as { user_id: string; n: number }[]) badges.set(x.user_id, x.n)
  }
  let sent = 0
  const gone: string[] = []
  await Promise.all((targets as { endpoint: string; p256dh: string; auth: string; preview: boolean; unread: number; mention?: boolean; user_id: string }[]).map(async (t) => {
    const own = chat.get(t.user_id)
    const mine = saved.get(t.user_id)
    const nm = mine?.nickname?.trim() || name
    const pic = mine?.photo_url || (who?.privacy?.photo && who.privacy.photo !== 'everybody' ? '' : who?.avatar_url || '')
    const note = {
      title: group ? room?.title || 'Group' : nm,
      body: t.preview ? (group ? `${nm}${t.mention ? ' mentioned you' : ''}: ${text}` : text).slice(0, 180) : t.mention ? `${nm} mentioned you` : 'New message',
      room: m.room_id,
      tag: `room-${m.room_id}`,
      count: t.unread,
      badge: noBadge.has(t.endpoint) ? 0 : badges.has(t.user_id) ? Math.max(1, badges.get(t.user_id) || 0) : undefined,
      silent: !!own?.silent || dnd.has(t.user_id) || quiet,
      passive: dnd.has(t.user_id) || quiet,
      urgent: level > 0,
      // the sender's picture beside the notification on an iPhone (the app's Notification Service Extension reads it);
      // a photo shown only to some stays out
      sender: { id: m.user_id, name: nm, avatar: pic, ...(group ? { group: room?.title || 'Group' } : {}) },
    }
    try {
      const dev = sounds.get(t.endpoint)
      const r = await push({ ...t, sound: own?.silent || dnd.has(t.user_id) || quiet || dev === 'off' ? 'off' : level === 2 ? 'roar' : own?.sound || dev }, note)
      if (r.ok) sent++
      else if (r.status === 404 || r.status === 410) gone.push(t.endpoint)
      else console.log('push', r.status, (await r.text()).slice(0, 200))
    } catch (e) { console.log('push failed', String(e)) }
  }))
  // phones and browsers that are no longer there
  if (gone.length) await sb.from('roar_push_subs').delete().in('endpoint', gone)
  return { sent, gone: gone.length }
}

// a reminder that is due: to each device of the one who set it, unless RoarMe is in front of them (it shows it there)
async function remind(id: string) {
  const { data: r } = await sb.from('roar_reminders').select('id, user_id, room_id, message_id').eq('id', id).maybeSingle()
  if (!r) return { sent: 0 }
  const [{ data: m }, { data: room }, { data: me }, { data: subs }] = await Promise.all([
    sb.from('roar_messages').select('user_id, kind, body, file, deleted_at').eq('id', r.message_id).maybeSingle(),
    sb.from('roar_rooms').select('kind, title').eq('id', r.room_id).maybeSingle(),
    sb.from('roar_profiles').select('active_until').eq('id', r.user_id).maybeSingle(),
    sb.from('roar_push_subs').select('*').eq('user_id', r.user_id),
  ])
  if (!subs?.length || (me?.active_until && new Date(me.active_until).getTime() > Date.now())) return { sent: 0 }
  let where = room?.title || ''
  if (room?.kind !== 'group') {
    const { data: w } = await sb.from('roar_profiles').select('display_name, username').eq('id', m?.user_id || '').maybeSingle()
    where = w?.display_name || (w?.username ? `@${w.username}` : 'a chat')
  }
  const text = !m || m.deleted_at ? 'Message deleted' : preview(m)
  let sent = 0
  const gone: string[] = []
  await Promise.all(subs.map(async (t) => {
    const note = { title: 'Reminder', body: (t.preview ? `${where}: ${text}` : `A message in ${where}`).slice(0, 180), room: r.room_id, tag: `reminder-${r.id}` }
    try {
      const x = await push(t, note)
      if (x.ok) sent++
      else if (x.status === 404 || x.status === 410) gone.push(t.endpoint)
    } catch (e) { console.log('push failed', String(e)) }
  }))
  if (gone.length) await sb.from('roar_push_subs').delete().in('endpoint', gone)
  return { sent }
}

// a Locked Message that opened: at its time, to the chat's other members (not muted, not blocking the sender, unless
// RoarMe is in front of them); reached at its place, to the sender, saying who opened it
async function capsule(id: string, by: string | null) {
  const { data: c } = await sb.from('roar_capsules').select('message_id, room_id, user_id').eq('message_id', id).maybeSingle()
  if (!c) return { sent: 0 }
  const { data: room } = await sb.from('roar_rooms').select('kind, title').eq('id', c.room_id).maybeSingle()
  const group = room?.kind === 'group'
  const nameOf = async (uid: string) => {
    const { data: w } = await sb.from('roar_profiles').select('display_name, username').eq('id', uid).maybeSingle()
    return w?.display_name || (w?.username ? `@${w.username}` : 'Someone')
  }
  let people: string[] = []
  let note: { title: string; body: string; room: string; tag: string }
  if (by) {
    people = [c.user_id]
    note = { title: await nameOf(by), body: '🔓 Reached the place and opened your locked message', room: c.room_id, tag: `capsule-${id}` }
  } else {
    const [{ data: mem }, { data: blocks }] = await Promise.all([
      sb.from('roar_members').select('*').eq('room_id', c.room_id).neq('user_id', c.user_id),
      sb.from('roar_blocks').select('blocker').eq('blocked', c.user_id),
    ])
    const blocking = new Set((blocks || []).map((b) => b.blocker))
    const now = Date.now()
    people = (mem || []).filter((x) => !blocking.has(x.user_id) && !(x.muted && (!x.muted_until || new Date(x.muted_until).getTime() > now))).map((x) => x.user_id)
    const from = await nameOf(c.user_id)
    note = { title: group ? room?.title || 'Group' : from, body: group ? `🔓 ${from}'s locked message is open now` : '🔓 A locked message is open now', room: c.room_id, tag: `capsule-${id}` }
  }
  if (!people.length) return { sent: 0 }
  const [{ data: subs }, { data: profs }] = await Promise.all([
    sb.from('roar_push_subs').select('*').in('user_id', people),
    sb.from('roar_profiles').select('*').in('id', people),
  ])
  const inApp = new Set<string>(), dnd = new Set<string>()
  for (const x of profs || []) {
    if (x.active_until && new Date(x.active_until).getTime() > Date.now()) inApp.add(x.id)
    if (x.presence === 'dnd') dnd.add(x.id)
  }
  let sent = 0
  const gone: string[] = []
  await Promise.all((subs || []).filter((t) => !inApp.has(t.user_id)).map(async (t) => {
    try {
      const quiet = dnd.has(t.user_id)
      const x = await push({ ...t, sound: quiet ? 'off' : t.sound }, { ...note, silent: quiet, passive: quiet })
      if (x.ok) sent++
      else if (x.status === 404 || x.status === 410) gone.push(t.endpoint)
    } catch (e) { console.log('push failed', String(e)) }
  }))
  if (gone.length) await sb.from('roar_push_subs').delete().in('endpoint', gone)
  return { sent }
}

// a new mail (Alex, 26 Nov: "notifications as Spark's"): to each device of its owner, the sender (as saved in their
// address book when they are there) over the subject and a line of the mail; a tap opens that very mail in ROARMAIL
// ('mail:' + account|path|uid in place of a chat). Do Not Disturb makes it quiet; whoever turned it off is not asked.
async function mail(m: any) {
  const user = String(m.user || '')
  if (!/^[0-9a-f-]{36}$/i.test(user)) return { sent: 0 }
  const { data: w } = await sb.from('roarmail_watch').select('enabled, muted').eq('user_id', user).maybeSingle()
  if (!w?.enabled || (w.muted || []).includes(String(m.account || ''))) return { sent: 0 }
  const [{ data: subs }, { data: me }] = await Promise.all([
    sb.from('roar_push_subs').select('*').eq('user_id', user),
    sb.from('roar_profiles').select('presence').eq('id', user).maybeSingle(),
  ])
  if (!subs?.length) return { sent: 0 }
  const addr = String(m.from?.address || '').toLowerCase()
  let name = String(m.from?.name || '') || addr || 'New mail'
  if (addr) {
    const { data: book } = await sb.from('roar_book').select('first_name, last_name, emails').eq('owner', user).limit(2000)
    const hit = (book || []).find((e: any) => (e.emails || []).some((x: any) => String(x?.value || '').toLowerCase() === addr))
    const n = hit ? `${hit.first_name || ''} ${hit.last_name || ''}`.trim() : ''
    if (n) name = n
  }
  const subject = String(m.subject || '').trim() || '(No subject)'
  const snippet = String(m.snippet || '').trim()
  const quiet = me?.presence === 'dnd'
  const note = { title: name.slice(0, 80), body: (snippet ? `${subject}\n${snippet}` : subject).slice(0, 220), room: `mail:${m.account}|${m.path || 'INBOX'}|${Number(m.uid) || 0}`, tag: `mail-${m.account}-${m.uid}`, silent: quiet, passive: quiet }
  let sent = 0
  const gone: string[] = []
  await Promise.all(subs.map(async (t) => {
    try {
      const x = await push({ ...t, sound: quiet ? 'off' : t.sound }, note)
      if (x.ok) sent++
      else if (x.status === 404 || x.status === 410) gone.push(t.endpoint)
    } catch (e) { console.log('push failed', String(e)) }
  }))
  if (gone.length) await sb.from('roar_push_subs').delete().in('endpoint', gone)
  return { sent }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET') return json({ key: (await getConf()).public_key })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  if (body?.test === true) return test(req)
  // a new mail from RoarMail Live's Inbox watch (26 Nov), with the key it shares with roarmail-creds
  if (body?.mail && typeof body.mail === 'object') {
    const { data: k } = await sb.rpc('roarmail_live_key')
    if (!k || req.headers.get('x-live-key') !== String(k)) return json({ error: 'not allowed' }, 403)
    return json(await mail(body.mail))
  }
  const c = await getConf()
  if (req.headers.get('x-roar-hook') !== String(c.hook_token)) return json({ error: 'not allowed' }, 403)
  if (typeof body?.reminder === 'string') return /^[0-9a-f-]{36}$/i.test(body.reminder) ? json(await remind(body.reminder)) : json({ error: 'no reminder' }, 400)
  if (typeof body?.capsule === 'string') {
    const ok = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
    return ok(body.capsule) ? json(await capsule(body.capsule, ok(body.by) ? body.by : null)) : json({ error: 'no capsule' }, 400)
  }
  const { id } = body
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'no message' }, 400)
  return json(await notify(id))
})
