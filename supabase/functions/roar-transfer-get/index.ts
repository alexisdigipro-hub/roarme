// RoarTransfer's download link (Alex, 16 Oct): whoever has the link (?t=token) gets the file's name, size and expiry,
// and a download address good for one hour. Nothing else is reachable: the token must be in roar_transfer_links, and
// it stops working when its days are up. Files are in Supabase Storage (roar-transfers, from the chats) or, since
// 21 Oct, in Cloudflare R2 (store 'r2', roartransfer.com, Edge Function roartransfer-r2), or since 22 Oct only in the
// hub's pCloud (store 'pcloud', Alex's own transfers, Edge Function roar-pcloud).
// The download address carries the file's own name encoded exactly once, so Greek names come down as they are.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// the account id alone, even when the secret holds the whole S3 address (https://<id>.r2.cloudflarestorage.com)
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
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
  const q = new URL(req.url).searchParams
  const t = q.get('t') || ''
  if (!/^[A-Za-z0-9]{6,32}$/.test(t)) return json({ error: 'not_found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: link } = await sb.from('roar_transfer_links').select('token, path, name, size, type, expires_at, store').eq('token', t).maybeSingle()
  if (link) {
    const info = { name: link.name, size: link.size, type: link.type, expires: link.expires_at }
    if (new Date(link.expires_at).getTime() <= Date.now()) return json({ ...info, error: 'expired' }, 410)
    const one = await addresses(sb, link)
    if (!one) return json({ ...info, error: 'expired' }, 410)
    return json({ ...info, ...one })
  }
  // one link for a whole upload (roartransfer.com, Alex 21 Oct): every file still alive, each with its own address
  const { data: bundle } = await sb.from('roar_transfer_bundles').select('tokens, expires_at, title, message, password_hash, created_by').eq('token', t).maybeSingle()
  if (!bundle) return json({ error: 'not_found' }, 404)
  // who sent it, the title and the message (roartransfer.com, Alex 21 Oct); with a password, nothing else until it is right
  const { data: p } = bundle.created_by ? await sb.from('roar_profiles').select('display_name, username').eq('id', bundle.created_by).maybeSingle() : { data: null }
  const head = { bundle: true, title: bundle.title || '', from: p?.display_name || (p?.username ? '@' + p.username : '') }
  if (bundle.password_hash) {
    const given = q.get('p') || ''
    if (!given) return json({ ...head, expires: bundle.expires_at, error: 'password' }, 401)
    if ((await sha(`${t}:${given}`)) !== bundle.password_hash) return json({ ...head, expires: bundle.expires_at, error: 'password', wrong: true }, 401)
  }
  Object.assign(head, { message: bundle.message || '' })
  const { data: rows } = await sb.from('roar_transfer_links').select('token, path, name, size, type, expires_at, store').in('token', bundle.tokens)
  const live = (rows || []).filter((r: any) => new Date(r.expires_at).getTime() > Date.now())
    .sort((a: any, b: any) => bundle.tokens.indexOf(a.token) - bundle.tokens.indexOf(b.token))
  if (!live.length) return json({ ...head, expires: bundle.expires_at, error: 'expired' }, 410)
  // deno-lint-ignore no-explicit-any
  const files: any[] = []
  for (const r of live) {
    const one = await addresses(sb, r)
    if (one) files.push({ token: r.token, name: r.name, size: r.size, type: r.type, expires: r.expires_at, ...one })
  }
  if (!files.length) return json({ ...head, expires: bundle.expires_at, error: 'expired' }, 410)
  return json({ ...head, expires: files.reduce((a, f) => (f.expires > a ? f.expires : a), files[0].expires), files })
})

// a file's download address (with its real name) and, for a video, a picture or audio, one to play it
// deno-lint-ignore no-explicit-any
async function addresses(sb: any, link: any): Promise<{ url: string, view: string } | null> {
  const media = /^(video|audio|image)\//.test(link.type)
  // kept only in the hub's pCloud (Alex, 22 Oct): pCloud's direct address works only for the browser that asks for it,
  // so the page gets the public link's code and asks pCloud itself (getpublinkdownload); url is pCloud's own page
  if (link.store === 'pcloud') {
    const [host, code] = String(link.path).split('|')
    if (!code) return null
    return { url: `https://${host === 'api.pcloud.com' ? 'u' : 'e'}.pcloud.link/publink/show?code=${encodeURIComponent(code)}`, view: '', pcloud: { host, code } } as any
  }
  if (link.store === 'r2') {
    const url = await r2Url(link.path, { 'response-content-disposition': disposition(link.name || 'file') })
    const view = media ? await r2Url(link.path, { 'response-content-type': link.type }) : ''
    return { url, view }
  }
  const { data: signed } = await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600)
  const { data: play } = media ? await sb.storage.from('roar-transfers').createSignedUrl(link.path, 3600) : { data: null }
  if (!signed?.signedUrl) return null
  const url = new URL(signed.signedUrl)
  url.searchParams.delete('download')
  return { url: `${url.toString()}&download=${encodeURIComponent(link.name || 'file')}`, view: play?.signedUrl || '' }
}

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}
