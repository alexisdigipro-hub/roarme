// Notifications with the app closed (Alex, 18 Oct 2026; supabase/push.sql). Web Push, written out here with the
// browser's own crypto (no library): the message is encrypted for each phone or browser (RFC 8291, aes128gcm) and
// signed with this server's key (VAPID, RFC 8292).
//   GET  ?key            the public key a browser needs to sign up (made, with its private half, the first time)
//   POST {id} + x-roar-hook   a new message (from the trigger roar_push): notify who should know
// The private key never leaves the database table roar_push_conf, which only the server can read.
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
  if (f.event) return `📅 ${clean(m.body)}`
  if (f.location) return '📍 Location'
  if (f.article) return `📰 ${clean(m.body).split(' ').slice(0, 12).join(' ')}`
  if (f.ordino) return '🎬 Call sheet'
  return clean(m.body || '')
}

async function notify(id: string) {
  const { data: m } = await sb.from('roar_messages').select('id, room_id, user_id, kind, body, file').eq('id', id).maybeSingle()
  if (!m) return { sent: 0 }
  const { data: targets, error } = await sb.rpc('roar_push_targets', { msg: id })
  if (error) return { error: error.message }
  if (!targets?.length) return { sent: 0 }
  const [{ data: room }, { data: who }] = await Promise.all([
    sb.from('roar_rooms').select('kind, title').eq('id', m.room_id).maybeSingle(),
    sb.from('roar_profiles').select('display_name, username').eq('id', m.user_id).maybeSingle(),
  ])
  const name = who?.display_name || (who?.username ? `@${who.username}` : 'Someone')
  const group = room?.kind === 'group'
  const text = preview(m)
  let sent = 0
  const gone: string[] = []
  await Promise.all((targets as { endpoint: string; p256dh: string; auth: string; preview: boolean; unread: number }[]).map(async (t) => {
    const note = {
      title: group ? room?.title || 'Group' : name,
      body: t.preview ? (group ? `${name}: ${text}` : text).slice(0, 180) : 'New message',
      room: m.room_id,
      tag: `room-${m.room_id}`,
      count: t.unread,
    }
    try {
      const r = await fetch(t.endpoint, {
        method: 'POST',
        headers: { Authorization: await vapid(t.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' },
        body: await encrypt(enc.encode(JSON.stringify(note)), t.p256dh, t.auth),
      })
      if (r.ok) sent++
      else if (r.status === 404 || r.status === 410) gone.push(t.endpoint)
      else console.log('push', r.status, (await r.text()).slice(0, 200))
    } catch (e) { console.log('push failed', String(e)) }
  }))
  // phones and browsers that are no longer there
  if (gone.length) await sb.from('roar_push_subs').delete().in('endpoint', gone)
  return { sent, gone: gone.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method === 'GET') return json({ key: (await getConf()).public_key })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const c = await getConf()
  if (req.headers.get('x-roar-hook') !== String(c.hook_token)) return json({ error: 'not allowed' }, 403)
  const { id } = await req.json().catch(() => ({}))
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'no message' }, 400)
  return json(await notify(id))
})
