// RoarMe · roar-pcloud (Supabase Edge Function, verify_jwt on: the signed-in person's own token)
//
// RoarTransfer into Alex's pCloud (Alex, 22 Oct 2026: "a tick on my own profile only, to upload to the pCloud we have
// connected"). Only for RoarMe's admin (roar_is_admin) whose account is linked to the THEMADLIONS hub: for one of the
// admin's own transfers (a roar_transfer_links token) it makes a 6-hour download address of the file (Cloudflare R2
// for store 'r2', else the roar-transfers bucket) and asks the hub's function roarme-pcloud (shared secret,
// roar_hub_conf) to have pCloud fetch it into the hub's pCloud, folder RoarTransfer/<YYYY-MM>. No bytes pass through
// here and the pCloud token stays in the hub. Secrets used: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
//
// POST { token } -> { ok: true, path } | { error }: pCloud starts fetching the file into RoarTransfer/<YYYY-MM>/<token>/
// POST { action: 'check', token, only } -> { done: false } | { done: true }: once the whole file is in pCloud, and only
//   when Alex chose "only in my pCloud" (only: true), its link switches to pCloud (store 'pcloud', path '<api host>|<code>',
//   roar-transfer-get hands the code to the download page) and the copy in R2 is deleted.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const HUB_PCLOUD = 'https://naibamqexcqnqhbbqafa.supabase.co/functions/v1/roarme-pcloud'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })

async function r2Get(key: string) {
  const u = new URL(`https://${account}.r2.cloudflarestorage.com/roartransfer/${key.split('/').map(encodeURIComponent).join('/')}`)
  u.searchParams.set('X-Amz-Expires', String(6 * 3600))
  return (await r2.sign(new Request(u, { method: 'GET' }), { aws: { signQuery: true } })).url
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'not found' }, 404)
  const url = Deno.env.get('SUPABASE_URL')!
  const asPerson = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } }, auth: { persistSession: false } })
  const { data: who } = await asPerson.auth.getUser()
  if (!who?.user) return json({ error: 'Sign in again.' }, 401)
  const { data: admin } = await asPerson.rpc('roar_is_admin')
  if (admin !== true) return json({ error: 'not allowed' }, 403)
  let body: any = {}
  try { body = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const token = String(body.token || '')
  if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return json({ error: 'bad request' }, 400)
  const sb = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: file } = await sb.from('roar_transfer_links').select('*').eq('token', token).maybeSingle()
  if (!file || file.created_by !== who.user.id) return json({ error: 'Not one of your transfers.' }, 403)
  if (new Date(file.expires_at).getTime() <= Date.now()) return json({ error: 'This transfer has expired.' }, 410)
  const { data: link } = await sb.from('roar_hub_links').select('hub_user_id').eq('user_id', who.user.id).eq('hub', 'themadlions').maybeSingle()
  if (!link) return json({ error: 'Link your account to THEMADLIONS Hub first.' }, 403)
  const { data: conf } = await sb.from('roar_hub_conf').select('secret').eq('id', 1).maybeSingle()
  if (!conf?.secret) return json({ error: 'not set up' }, 500)
  let src = ''
  if (file.store === 'pcloud') return json(body.action === 'check' ? { done: true } : { error: 'Already only in your pCloud.' })
  if (file.store === 'r2') src = await r2Get(file.path)
  else { const { data: s } = await sb.storage.from('roar-transfers').createSignedUrl(file.path, 6 * 3600); src = s?.signedUrl || '' }
  if (!src) return json({ error: 'The file is no longer there.' }, 404)
  const where = { hub_user_id: link.hub_user_id, name: String(file.name || 'file'), key: token, month: String(file.created_at).slice(0, 7), size: Number(file.size) || 0 }
  const hub = async (extra: any) => {
    const res = await fetch(HUB_PCLOUD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-roarme-secret': conf.secret }, body: JSON.stringify({ ...where, ...extra }) })
    const out = await res.json().catch(() => null)
    if (!res.ok || !out || out.error) throw new Error(out?.error || 'The hub did not answer.')
    return out
  }
  try {
    if (body.action === 'check') {
      const st = await hub({ action: 'check' })
      if (!st.done) return json({ done: false, got: st.got || 0 })
      if (body.only && file.store !== 'pcloud') {
        const { error } = await sb.from('roar_transfer_links').update({ store: 'pcloud', path: `${st.host}|${st.code}` }).eq('token', token)
        if (error) return json({ error: error.message }, 500)
        if (file.store === 'r2') await r2.fetch(`https://${account}.r2.cloudflarestorage.com/roartransfer/${file.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }).catch(() => null)
        else await sb.storage.from('roar-transfers').remove([file.path])
      }
      return json({ done: true, path: st.path })
    }
    return json(await hub({ url: src }))
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 502)
  }
})
