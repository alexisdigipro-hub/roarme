// RoarMe · roar-hub-work (Supabase Edge Function, verify_jwt on: the signed-in person's own token)
//
// The person's THEMADLIONS hub tasks and calendar, to show in Tasks and Calendar (Alex, 20 Oct 2026: phase 6; the hub
// stays the one source, RoarMe only shows them). Only for someone whose account is linked to the hub (roar_hub_links);
// asks the hub's function roarme-work with the shared secret (roar_hub_conf), for that person's hub member only.
//
// POST {} -> { tasks: [...], events: [...], canTasks, canCalendar } | { linked: false }

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const HUB_WORK = 'https://naibamqexcqnqhbbqafa.supabase.co/functions/v1/roarme-work'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  const url = Deno.env.get('SUPABASE_URL')!
  const asPerson = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } })
  const { data: who } = await asPerson.auth.getUser()
  if (!who?.user) return json({ error: 'Sign in again.' }, 401)
  // someone with Two-Step Verification on must have entered their code in this session (roar_aal_ok, as for chats)
  const { data: aalOk } = await asPerson.rpc('roar_aal_ok')
  if (aalOk !== true) return json({ error: 'Enter your 6-digit code first.' }, 403)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: link } = await sb.from('roar_hub_links').select('hub_user_id').eq('user_id', who.user.id).eq('hub', 'themadlions').maybeSingle()
  if (!link) return json({ linked: false })
  const { data: susp } = await sb.from('roar_suspended').select('user_id').eq('user_id', who.user.id).maybeSingle()
  if (susp) return json({ linked: false })
  const { data: conf } = await sb.from('roar_hub_conf').select('secret').eq('id', 1).maybeSingle()
  if (!conf?.secret) return json({ error: 'not set up' }, 500)
  const res = await fetch(HUB_WORK, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roarme-secret': conf.secret }, body: JSON.stringify({ hub_user_id: link.hub_user_id }) })
  const out = await res.json().catch(() => null)
  if (!res.ok || !out || out.error) return json({ error: out?.error || 'The hub did not answer.' }, 502)
  return json({ linked: true, ...out })
})
