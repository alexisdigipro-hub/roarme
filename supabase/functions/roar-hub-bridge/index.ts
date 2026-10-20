// RoarMe · roar-hub-bridge (Supabase Edge Function, deployed with verify_jwt off: it checks its own secret)
//
// Phase 2 of the THEMADLIONS hub's chat moving onto RoarMe (Alex, 20 Oct 2026). Only the hub's server calls this,
// with the header x-hub-secret (the same secret as roar-hub-link, in roar_hub_conf). It can do exactly two things,
// both through SQL functions only the service role may run (supabase/hub-bridge.sql):
//
//   project_sync  { project, title, hub_users: [hub user ids] } -> { room, added, removed, members }
//        make the project's group if it is not there yet, set its name, and make its members exactly the people
//        among hub_users who linked their own RoarMe account. Anyone else in it is taken out in the same step.
//   project_close { project } -> { room, removed }
//        everyone out of the project's group (project closed or deleted in the hub).
//
// It cannot read messages, post, touch any other chat, or put in anyone who has not linked their account.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PROJECT = /^[A-Za-z0-9_-]{1,80}$/
const enc = new TextEncoder()

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
  const project = String(body.project || '')
  if (!PROJECT.test(project)) return json({ error: 'bad project id' }, 400)

  if (body.action === 'project_sync') {
    const users = Array.isArray(body.hub_users) ? body.hub_users.map(String) : null
    if (!users || users.length > 500 || users.some((u: string) => !UUID.test(u))) return json({ error: 'bad hub_users' }, 400)
    const { data, error } = await sb.rpc('roar_hub_sync_project', { project, group_title: String(body.title || '').slice(0, 80), hub_users: users })
    if (error) return json({ error: error.message }, 500)
    return json(data)
  }

  if (body.action === 'project_close') {
    const { data, error } = await sb.rpc('roar_hub_close_project', { project })
    if (error) return json({ error: error.message }, 500)
    return json(data)
  }

  return json({ error: 'bad request' }, 400)
})
