// RoarMe · roar-hub-signin (Supabase Edge Function, verify_jwt off: it checks every caller itself)
//
// "Sign in with THEMADLIONS Hub" (Alex, 20 Oct 2026: one account for the team, the hub's email and password).
// Needs supabase/hub-link.sql and hub-signin.sql. The hub is the source of the account: a team member's RoarMe account
// is the one linked to them, else the one with the same email, else a new one (no password of its own). No password
// ever comes here; the hub only tells this server "this member, this email, this name" after its own sign-in.
//
// Actions (POST JSON):
//   signin    { code, state }  from the RoarMe page  -> { token_hash }   the page turns it into a session (verifyOtp)
//             the code came back from hub.themadlions.com for the state this RoarMe tab made; the hub's server confirms it.
//   provision { people: [{ hub_user_id, email, name }] }  x-hub-secret (the hub's server)
//             -> { people: [{ hub_user_id, roar_user_id, username, display_name, created, error }] }

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const HUB = 'https://naibamqexcqnqhbbqafa.supabase.co/functions/v1/roarme-signin'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const enc = new TextEncoder()

async function same(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const u = new Uint8Array(x), v = new Uint8Array(y)
  let d = 0
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]
  return d === 0 && a.length === b.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: conf } = await sb.from('roar_hub_conf').select('secret').eq('id', 1).maybeSingle()
  if (!conf?.secret) return json({ error: 'Hub sign-in is not set up.' }, 500)

  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }

  // the RoarMe account for one hub member: linked, else same email, else new; its profile and the link made sure of
  const ensure = async (p: any) => {
    const hubUser = String(p.hub_user_id || ''), email = String(p.email || '').trim().toLowerCase(), name = String(p.name || '').trim().slice(0, 64)
    if (!UUID.test(hubUser) || !EMAIL.test(email)) throw new Error('bad person')
    let created = false
    const { data: link } = await sb.from('roar_hub_links').select('user_id').eq('hub', 'themadlions').eq('hub_user_id', hubUser).maybeSingle()
    let uid: string | null = link?.user_id || null
    if (!uid) {
      const { data: byMail } = await sb.rpc('roar_hub_user_by_email', { mail: email })
      uid = byMail || null
    }
    if (!uid) {
      const { data: made, error } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { name, via: 'themadlions-hub' } })
      if (error || !made?.user) throw new Error(error?.message || 'could not make the account')
      uid = made.user.id
      created = true
    }
    const { data: susp } = await sb.from('roar_suspended').select('user_id').eq('user_id', uid).maybeSingle()
    if (susp) throw new Error('This RoarMe account is blocked.')
    let { data: prof } = await sb.from('roar_profiles').select('id, username, display_name').eq('id', uid).maybeSingle()
    if (!prof) {
      for (let i = 0; i < 3 && !prof; i++) {
        const { data: un } = await sb.rpc('roar_hub_free_username', { base: name || email.split('@')[0] })
        const { data: ins, error } = await sb.from('roar_profiles').insert({ id: uid, username: un, display_name: name }).select('id, username, display_name').maybeSingle()
        if (!error) prof = ins
      }
      if (!prof) throw new Error('could not make the profile')
    }
    await sb.from('roar_hub_links').delete().eq('hub', 'themadlions').eq('hub_user_id', hubUser).neq('user_id', uid)
    await sb.from('roar_hub_links').upsert({ user_id: uid, hub: 'themadlions', hub_user_id: hubUser, hub_name: name, linked_at: new Date().toISOString() })
    return { hub_user_id: hubUser, roar_user_id: uid, username: prof.username, display_name: prof.display_name || '', created, email }
  }

  if (body.action === 'provision') {
    if (!(await same(req.headers.get('x-hub-secret') || '', conf.secret))) return json({ error: 'not allowed' }, 401)
    const people = Array.isArray(body.people) ? body.people.slice(0, 200) : []
    const out = []
    for (const p of people) {
      try {
        const r = await ensure(p)
        out.push({ hub_user_id: r.hub_user_id, roar_user_id: r.roar_user_id, username: r.username, display_name: r.display_name, created: r.created })
      } catch (e) {
        out.push({ hub_user_id: String(p?.hub_user_id || ''), error: ((e as Error).message || 'failed').slice(0, 200) })
      }
    }
    return json({ people: out })
  }

  if (body.action === 'signin') {
    const code = String(body.code || ''), state = String(body.state || '')
    if (!/^[0-9a-f]{48}$/.test(code) || !/^[A-Za-z0-9_-]{24,64}$/.test(state)) return json({ error: 'bad request' }, 400)
    // the hub's server says who this is (and uses the code up)
    const res = await fetch(HUB, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roarme-secret': conf.secret }, body: JSON.stringify({ action: 'redeem', code, state }) })
    let who: any = null
    try { who = await res.json() } catch { /* keep null */ }
    if (!res.ok || !who || who.error) return json({ error: who?.error || 'The hub could not confirm this sign-in.' }, 400)
    let r
    try { r = await ensure(who) } catch (e) { return json({ error: (e as Error).message || 'Could not open your RoarMe account.' }, 400) }
    // the hub keeps its own row of the link
    await fetch(HUB, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roarme-secret': conf.secret }, body: JSON.stringify({ action: 'confirm', hub_user_id: r.hub_user_id, roar_user_id: r.roar_user_id, username: r.username, display_name: r.display_name }) }).catch(() => {})
    // a one-time sign-in for exactly this account, handed to the page as a hash it turns into a session
    const { data: link, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: r.email })
    const hash = (link as any)?.properties?.hashed_token
    if (error || !hash) return json({ error: 'Could not sign you in. Try again.' }, 500)
    return json({ token_hash: hash })
  }

  return json({ error: 'bad request' }, 400)
})
