// RoarTransfer's download link (Alex, 16 Oct): whoever has the link (?t=token) gets the file's name, size and expiry,
// and a download address good for one hour. Nothing else is reachable: the token must be in roar_transfer_links, and
// it stops working when its days are up. Files are in Supabase Storage (roar-transfers, from the chats) or, since
// 21 Oct, in Cloudflare R2 (store 'r2', roartransfer.com, Edge Function roartransfer-r2), or since 22 Oct only in the
// hub's pCloud (store 'pcloud', Alex's own transfers, Edge Function roar-pcloud).
// The download address carries the file's own name encoded exactly once, so Greek names come down as they are.
// Download limits (Alex, 23 Oct; supabase/transfer-limits.sql): a file on R2 is not handed out directly any more. Its
// download address is this function again with &dl=1, which counts the download here (roar_transfer_hit, which also
// sends the "downloaded" email) and only then sends the browser on to R2; once max_downloads is reached the file is
// shown as used and its address goes back to its own page.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// the account id alone, even when the secret holds the whole S3 address (https://<id>.r2.cloudflarestorage.com)
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const r2At = (key: string) => `https://${account}.r2.cloudflarestorage.com/roartransfer/${key.split('/').map(encodeURIComponent).join('/')}`
async function r2Url(key: string, query: Record<string, string>, expires = 3600) {
  const u = new URL(r2At(key))
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  u.searchParams.set('X-Amz-Expires', String(expires))
  return (await r2.sign(new Request(u), { aws: { signQuery: true } })).url
}
const PAGE = 'https://roartransfer.com/'
const SELF = `${Deno.env.get('SUPABASE_URL')}/functions/v1/roar-transfer-get`
// deno-lint-ignore no-explicit-any
const used = (f: any) => f.max_downloads != null && (f.downloads || 0) >= f.max_downloads
// attachment with the real name: a plain ASCII one for old browsers, the UTF-8 one for the rest
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const q = new URL(req.url).searchParams
  const t = q.get('t') || ''
  if (!/^[A-Za-z0-9]{6,32}$/.test(t)) return json({ error: 'not_found' }, 404)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // the link's preview (Alex, 25 Oct): what roartransfer.com's Cloudflare Worker puts in the page's Open Graph tags when
  // the link is pasted in WhatsApp, Messenger, iMessage, Slack… (?meta=1), and its picture (?og=1, og/<token>.jpg in R2,
  // made by the page from the first video or picture; roartransfer-r2 never keeps one for a transfer with a password).
  // Nothing here counts as a download or a view.
  if (q.get('meta') === '1' || q.get('og') === '1') {
    const meta = await preview(sb, t)
    if (q.get('meta') === '1') return new Response(JSON.stringify(meta), { status: meta.gone ? 410 : 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=120' } })
    const r = meta.cover ? await fetch(await r2Url(`og/${t}.jpg`, {})) : null
    if (!r || !r.ok) return new Response('not found', { status: 404, headers: cors })
    return new Response(r.body, { headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' } })
  }
  // a download of one R2 file: count it, then on to R2 (six hours, so a big file can finish and resume)
  if (q.get('dl') === '1') {
    const { data: f } = await sb.from('roar_transfer_links').select('token, path, name, expires_at, store, downloads, max_downloads').eq('token', t).maybeSingle()
    const page = `${PAGE}${t}`
    if (!f || f.store !== 'r2' || new Date(f.expires_at).getTime() <= Date.now() || used(f)) return Response.redirect(page, 302)
    if (req.method === 'GET') await sb.rpc('roar_transfer_hit', { t, dl: true })
    const to = await r2Url(f.path, { 'response-content-disposition': disposition(f.name || 'file') }, 6 * 3600)
    return new Response(null, { status: 302, headers: { ...cors, Location: to, 'Cache-Control': 'no-store' } })
  }
  const { data: link } = await sb.from('roar_transfer_links').select('token, path, name, size, type, expires_at, store, downloads, max_downloads').eq('token', t).maybeSingle()
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
  const { data: rows } = await sb.from('roar_transfer_links').select('token, path, name, size, type, expires_at, store, downloads, max_downloads').in('token', bundle.tokens)
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

// who sent it, what and until when, for a link's preview; a password-protected transfer shows only who sent it
// deno-lint-ignore no-explicit-any
async function preview(sb: any, t: string) {
  const now = Date.now()
  const kind = (types: string[]) => types.length && types.every((x) => /^video\//.test(x)) ? 'video' : types.length && types.every((x) => /^image\//.test(x)) ? 'image' : 'files'
  const { data: link } = await sb.from('roar_transfer_links').select('name, size, type, expires_at').eq('token', t).maybeSingle()
  if (link) {
    const gone = new Date(link.expires_at).getTime() <= now
    return { title: '', from: '', names: [link.name || 'file'], count: 1, size: Number(link.size || 0), kind: kind([link.type || '']), expires: link.expires_at, locked: false, cover: false, gone }
  }
  const { data: bundle } = await sb.from('roar_transfer_bundles').select('tokens, expires_at, title, password_hash, created_by').eq('token', t).maybeSingle()
  if (!bundle) return { gone: true, cover: false }
  const { data: p } = bundle.created_by ? await sb.from('roar_profiles').select('display_name, username').eq('id', bundle.created_by).maybeSingle() : { data: null }
  const from = p?.display_name || (p?.username ? '@' + p.username : '')
  const locked = !!bundle.password_hash
  const { data: rows } = await sb.from('roar_transfer_links').select('token, name, size, type, expires_at').in('token', bundle.tokens)
  const live = (rows || []).filter((r: any) => new Date(r.expires_at).getTime() > now)
    .sort((a: any, b: any) => bundle.tokens.indexOf(a.token) - bundle.tokens.indexOf(b.token))
  const head = await r2.fetch(r2At(`og/${t}.jpg`), { method: 'HEAD' }).catch(() => null)
  return {
    title: locked ? '' : bundle.title || '', from, locked, gone: !live.length,
    names: locked ? [] : live.slice(0, 3).map((r: any) => r.name || 'file'), count: live.length,
    size: live.reduce((a: number, r: any) => a + Number(r.size || 0), 0), kind: kind(live.map((r: any) => r.type || '')),
    expires: bundle.expires_at, cover: !locked && !!head?.ok,
  }
}

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
    const left = link.max_downloads == null ? null : Math.max(0, link.max_downloads - (link.downloads || 0))
    if (left === 0) return { url: '', view: '', used: true, left } as any
    const url = `${SELF}?t=${encodeURIComponent(link.token)}&dl=1`
    const view = media ? await r2Url(link.path, { 'response-content-type': link.type }) : ''
    return { url, view, counted: true, left } as any
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
