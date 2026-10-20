// RoarMe · roar-hub-link (Supabase Edge Function, deployed with verify_jwt off: it checks its own secret)
//
// Only the THEMADLIONS hub's server calls this, never a browser. Every call carries the header
// x-hub-secret, compared with roar_hub_conf.secret (a table no app user can read). See supabase/hub-link.sql.
//
// Actions (POST JSON):
//   redeem { code, state, hub_user_id, hub_name } -> { user_id, username, display_name }
//          turns a one-time code (made by roar_hub_link_code when the person pressed Approve in RoarMe,
//          at most 5 minutes old, never used) into the link row. The state must be the one the hub started.
//   status { hub_user_id } -> { linked, user_id?, username?, display_name? }
//          lets the hub notice a link the person removed in RoarMe's Settings.
//   unlink { hub_user_id } -> { ok }
//          the person disconnected from the hub's side.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const enc = new TextEncoder()

// compares two strings in the same time whatever they contain, so the secret cannot be guessed byte by byte
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))))
  const u = new Uint8Array(x), v = new Uint8Array(y)
  let d = 0
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]
  return d === 0 && a.length === b.length
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const { data: conf } = await sb.from('roar_hub_conf').select('secret').eq('id', 1).maybeSingle()
  const given = req.headers.get('x-hub-secret') || ''
  if (!conf?.secret || conf.secret.length < 32 || !(await same(given, conf.secret))) return json({ error: 'not allowed' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const hubUser = String(body.hub_user_id || '')
  if (!UUID.test(hubUser)) return json({ error: 'bad request' }, 400)

  const person = async (id: string) => {
    const { data } = await sb.from('roar_profiles').select('id, username, display_name').eq('id', id).maybeSingle()
    return data
  }

  if (body.action === 'redeem') {
    const code = String(body.code || ''), state = String(body.state || '')
    if (!/^[0-9a-f]{48}$/.test(code) || !/^[A-Za-z0-9_-]{24,64}$/.test(state)) return json({ error: 'bad request' }, 400)
    // take the code in one step, so two calls with the same code cannot both succeed
    const { data: row } = await sb.from('roar_hub_link_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code).is('used_at', null).gt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .select('user_id, state').maybeSingle()
    if (!row || !(await same(row.state, state))) return json({ error: 'This link request expired. Try again from the hub.' }, 400)
    const { data: susp } = await sb.from('roar_suspended').select('user_id').eq('user_id', row.user_id).maybeSingle()
    if (susp) return json({ error: 'This RoarMe account is blocked.' }, 403)
    const p = await person(row.user_id)
    if (!p) return json({ error: 'Finish setting up your RoarMe account first.' }, 400)
    // one hub person, one RoarMe account: a new link replaces an old one on either side
    await sb.from('roar_hub_links').delete().eq('hub', 'themadlions').eq('hub_user_id', hubUser)
    const { error } = await sb.from('roar_hub_links').upsert({
      user_id: row.user_id, hub: 'themadlions', hub_user_id: hubUser,
      hub_name: String(body.hub_name || '').slice(0, 80), linked_at: new Date().toISOString(),
    })
    if (error) return json({ error: 'Could not save the link.' }, 500)
    return json({ user_id: p.id, username: p.username, display_name: p.display_name || '' })
  }

  if (body.action === 'status') {
    const { data: link } = await sb.from('roar_hub_links').select('user_id').eq('hub', 'themadlions').eq('hub_user_id', hubUser).maybeSingle()
    if (!link) return json({ linked: false })
    const p = await person(link.user_id)
    return json({ linked: !!p, user_id: link.user_id, username: p?.username || '', display_name: p?.display_name || '' })
  }

  if (body.action === 'unlink') {
    await sb.from('roar_hub_links').delete().eq('hub', 'themadlions').eq('hub_user_id', hubUser)
    return json({ ok: true })
  }

  return json({ error: 'bad request' }, 400)
})
