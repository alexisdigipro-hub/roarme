// RoarTransfer's download link (Alex, 16 Oct): whoever has the link (?t=token) gets the file's name, size and expiry,
// and a download address good for one hour. Nothing else is reachable: the token must be in roar_transfer_links, and
// it stops working when its days are up. Files are in Supabase Storage (roar-transfers, from the chats) or, since
// 21 Oct, in Cloudflare R2 (store 'r2', roartransfer.com, Edge Function roartransfer-r2).
// The download address carries the file's own name encoded exactly once, so Greek names come down as they are.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const account = Deno.env.get('R2_ACCOUNT_ID') || ''
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const r2At = (key: string) => `https://${account}.r2.cloudflarestorage.com/roartransfer/${key.split('/').map(encodeURIComponent).join('/')}`
async function r2Url(key: string, query: Record<string, string>) {
  const u = new URL(r2At(key))
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  u.searchParams.set('X-Amz-Expires', '3600')
  return (await r2.sign(new Request(u), { aws: { signQuery: true } })).url
}
// attachment with the real name: a plain ASCII one for old browsers, the UTF-8 one for the rest
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const t = new URL(req.url).searchParams.get('t') || ''
  if (!/^[A-Za-z0-9]{10,32}$/.test(t)) return json({ error: 'not_found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: link } = await sb.from('roar_transfer_links').select('path, name, size, type, expires_at, store').eq('token', t).maybeSingle()
  if (!link) return json({ error: 'not_found' }, 404)
  const info = { name: link.name, size: link.size, type: link.type, expires: link.expires_at }
  if (new Date(link.expires_at).getTime() <= Date.now()) return json({ ...info, error: 'expired' }, 410)
  const media = /^(video|audio|image)\//.test(link.type)
  if (link.store === 'r2') {
    const url = await r2Url(link.path, { 'response-content-disposition': disposition(link.name || 'file') })
    const view = media ? await r2Url(link.path, { 'response-content-type': link.type }) : ''
    return json({ ...info, url, view })
  }
  const { data: signed } = await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600)
  const { data: play } = media ? await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600) : { data: null }
  if (!signed?.signedUrl) return json({ ...info, error: 'expired' }, 410)
  const url = new URL(signed.signedUrl)
  url.searchParams.delete('download')
  return json({ ...info, url: `${url.toString()}&download=${encodeURIComponent(link.name || 'file')}`, view: play?.signedUrl || '' })
})
