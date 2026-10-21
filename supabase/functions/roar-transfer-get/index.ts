// RoarTransfer's download link (Alex, 16 Oct): whoever has the link (?t=token on the RoarMe page) gets the file's
// name, size and expiry, and a download address good for one hour. Nothing else is reachable: the token must be in
// roar_transfer_links, which only members of the chat can create, and it stops working when the 3 days are up.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const t = new URL(req.url).searchParams.get('t') || ''
  if (!/^[A-Za-z0-9]{10,32}$/.test(t)) return json({ error: 'not_found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: link } = await sb.from('roar_transfer_links').select('path, name, size, type, expires_at').eq('token', t).maybeSingle()
  if (!link) return json({ error: 'not_found' }, 404)
  const info = { name: link.name, size: link.size, type: link.type, expires: link.expires_at }
  if (new Date(link.expires_at).getTime() <= Date.now()) return json({ ...info, error: 'expired' }, 410)
  const { data: signed } = await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600, { download: link.name || true })
  const { data: play } = /^(video|audio|image)\//.test(link.type) ? await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600) : { data: null }
  if (!signed?.signedUrl) return json({ ...info, error: 'expired' }, 410)
  return json({ ...info, url: signed.signedUrl, view: play?.signedUrl || '' })
})
