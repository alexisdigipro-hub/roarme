// Calls through LiveKit (Alex, 19 Oct 2026): instead of straight from one computer to the other, both sides of a call
// meet in a LiveKit room, which gets through any network (office Wi-Fi, 4G, firewalls). The ringing and the call log
// stay as they are (src/calls.jsx, roar_calls); this hands each of the two a pass for that call's room.
//   POST {callId} + the user's sign-in  ->  {url, token}   only the caller and the callee of that call, while it is on
//   GET  ?check   is LiveKit set up and do its keys work? (asks LiveKit for its room list; says only ok or the error)
// The LiveKit project is set in Supabase > Edge Functions > Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
// Without them it answers 503 and the app calls the old way.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const enc = new TextEncoder()
const b64u = (u: Uint8Array) => { let s = ''; u.forEach((c) => { s += String.fromCharCode(c) }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }

// a LiveKit access token: a JWT signed with the project's secret (HS256), allowed into one room only
async function sign(secret: string, claims: Record<string, unknown>) {
  const head = b64u(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = b64u(enc.encode(JSON.stringify(claims)))
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`${head}.${body}`)))
  return `${head}.${body}.${b64u(sig)}`
}
function pass(key: string, secret: string, identity: string, name: string, room: string) {
  const now = Math.floor(Date.now() / 1000)
  return sign(secret, {
    iss: key, sub: identity, jti: `${identity}-${now}`, nbf: now - 10, exp: now + 4 * 3600, name,
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('LIVEKIT_URL')
  const key = Deno.env.get('LIVEKIT_API_KEY')
  const secret = Deno.env.get('LIVEKIT_API_SECRET')
  if (!url || !key || !secret) return json({ error: 'LiveKit is not set up' }, 503)
  if (req.method === 'GET' && new URL(req.url).searchParams.has('check')) {
    const now = Math.floor(Date.now() / 1000)
    const t = await sign(secret, { iss: key, sub: 'roarme-check', nbf: now - 10, exp: now + 60, video: { roomList: true } })
    try {
      const r = await fetch(`${url.replace(/^ws/, 'http')}/twirp/livekit.RoomService/ListRooms`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: '{}' })
      return json(r.ok ? { livekit: 'ok' } : { livekit: 'error', status: r.status, said: (await r.text()).slice(0, 160) })
    } catch (e) { return json({ livekit: 'error', said: String(e).slice(0, 160) }) }
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer /, '')
  const { data: { user } } = await sb.auth.getUser(jwt)
  if (!user) return json({ error: 'Sign in first' }, 401)
  const { callId } = await req.json().catch(() => ({}))
  if (typeof callId !== 'string' || !/^[0-9a-f-]{36}$/i.test(callId)) return json({ error: 'No call' }, 400)
  const { data: c } = await sb.from('roar_calls').select('caller, callee, started_at, ended_at').eq('id', callId).maybeSingle()
  // only the two people of the call, and only while it is on (it rings for under a minute, so an hour is plenty)
  if (!c || (c.caller !== user.id && c.callee !== user.id)) return json({ error: 'Not your call' }, 403)
  if (c.ended_at || Date.now() - new Date(c.started_at).getTime() > 3600e3) return json({ error: 'This call has ended' }, 410)
  const { data: p } = await sb.from('roar_profiles').select('display_name, username').eq('id', user.id).maybeSingle()
  const name = p?.display_name || (p?.username ? `@${p.username}` : '')
  return json({ url: url.replace(/^http/, 'ws'), token: await pass(key, secret, user.id, name, `roar-call-${callId}`) })
})
