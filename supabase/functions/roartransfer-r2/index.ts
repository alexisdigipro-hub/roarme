// RoarTransfer on Cloudflare R2 (Alex, 21 Oct 2026: its own domain roartransfer.com and its own storage, so
// RoarMe keeps its room). The page never holds a key: it asks here, signed in with its RoarMe account, and gets
// short-lived signed addresses for each 16 MB piece of a file, which it sends straight to R2 (bucket roartransfer).
// When every piece is up, this puts the file together and makes its download link (roar_transfer_links, store 'r2').
// Files go to free/<account id>/…; R2's own lifecycle rule deletes free/ after 3 days (pro/ after 30, for later).
// Secrets (Supabase > Edge Functions > Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const BUCKET = 'roartransfer'
const MAX = 3 * 1024 ** 3
const DAYS = 3
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// the account id alone, even when the secret holds the whole S3 address (https://<id>.r2.cloudflarestorage.com)
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const base = `https://${account}.r2.cloudflarestorage.com/${BUCKET}`
const at = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function presign(method: string, key: string, query: Record<string, string> = {}, expires = 3600) {
  const u = new URL(at(key))
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  u.searchParams.set('X-Amz-Expires', String(expires))
  return (await r2.sign(new Request(u, { method }), { aws: { signQuery: true } })).url
}
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] || ''
const newToken = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => abc[n % abc.length]).join('')
}
const safeName = (n: string) => (n || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // anything unexpected still answers with CORS, so the page shows the reason instead of "Load failed"
  try { return await handle(req) } catch (e) {
    console.error(e)
    return json({ error: 'RoarTransfer could not reach its storage. Try again in a minute.' }, 502)
  }
})

async function handle(req: Request): Promise<Response> {
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  // whether the keys are in place, without showing them
  if (b.action === 'health') {
    let reach = 0
    if (account) { try { reach = (await r2.fetch(`${base}?max-keys=1`)).status } catch { reach = -1 } }
    return json({ ok: !!(account && Deno.env.get('R2_ACCESS_KEY_ID') && Deno.env.get('R2_SECRET_ACCESS_KEY')), account: !!account, reach })
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: who } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
  const uid = who?.user?.id
  if (!uid) return json({ error: 'signed-out' }, 401)
  const mine = (key: string) => typeof key === 'string' && key.startsWith(`free/${uid}/`) && !key.includes('..')

  if (b.action === 'create') {
    const size = Number(b.size) || 0
    if (size <= 0 || size > MAX) return json({ error: 'Files can be up to 3 GB.' }, 400)
    const key = `free/${uid}/${crypto.randomUUID()}-${safeName(b.name)}`
    const r = await r2.fetch(`${at(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': b.type || 'application/octet-stream' } })
    const uploadId = tag(await r.text(), 'UploadId')
    if (!r.ok || !uploadId) return json({ error: `Could not start the upload (${r.status})` }, 502)
    return json({ key, uploadId })
  }

  if (b.action === 'sign') {
    if (!mine(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    const parts = (Array.isArray(b.parts) ? b.parts : []).map(Number).filter((n: number) => n >= 1 && n <= 10000).slice(0, 50)
    const urls: Record<number, string> = {}
    for (const n of parts) urls[n] = await presign('PUT', b.key, { partNumber: String(n), uploadId: b.uploadId })
    return json({ urls })
  }

  if (b.action === 'complete') {
    if (!mine(b.key) || !b.uploadId || !Array.isArray(b.parts) || !b.parts.length) return json({ error: 'not allowed' }, 403)
    const xml = '<CompleteMultipartUpload>' + b.parts
      .sort((x: any, y: any) => x.n - y.n)
      .map((p: any) => `<Part><PartNumber>${Number(p.n)}</PartNumber><ETag>${String(p.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('') + '</CompleteMultipartUpload>'
    const r = await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(b.uploadId)}`, { method: 'POST', body: xml, headers: { 'Content-Type': 'application/xml' } })
    const text = await r.text()
    if (!r.ok || text.includes('<Error>')) return json({ error: `Could not finish the upload (${tag(text, 'Code') || r.status})` }, 502)
    // the real size, from R2 itself
    const head = await r2.fetch(at(b.key), { method: 'HEAD' })
    const size = Number(head.headers.get('content-length')) || Number(b.size) || 0
    if (size > MAX) { await r2.fetch(at(b.key), { method: 'DELETE' }); return json({ error: 'Files can be up to 3 GB.' }, 400) }
    const token = newToken()
    const expires = new Date(Date.now() + DAYS * 864e5).toISOString()
    const { error } = await sb.from('roar_transfer_links').insert({ token, path: b.key, name: String(b.name || 'file').slice(0, 300), size, type: String(b.type || ''), expires_at: expires, created_by: uid, store: 'r2' })
    if (error) return json({ error: error.message }, 500)
    return json({ token, expires, size })
  }

  // one link for the whole upload (Alex, 21 Oct): the file links it holds must all be the caller's own
  if (b.action === 'bundle') {
    const tokens = (Array.isArray(b.tokens) ? b.tokens : []).map(String).filter((t: string) => /^[A-Za-z0-9]{10,32}$/.test(t)).slice(0, 200)
    if (!tokens.length) return json({ error: 'nothing to link' }, 400)
    const { data: rows } = await sb.from('roar_transfer_links').select('token, expires_at').in('token', tokens).eq('created_by', uid)
    if (!rows || rows.length !== new Set(tokens).size) return json({ error: 'not allowed' }, 403)
    const token = newToken()
    const expires = rows.reduce((a: string, r: any) => (r.expires_at > a ? r.expires_at : a), rows[0].expires_at)
    const { error } = await sb.from('roar_transfer_bundles').insert({ token, tokens, created_by: uid, expires_at: expires })
    if (error) return json({ error: error.message }, 500)
    return json({ token, expires })
  }

  if (b.action === 'abort') {
    if (!mine(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(b.uploadId)}`, { method: 'DELETE' })
    return json({ ok: true })
  }

  // Stop: the link ends (roar_transfer_stop, as the caller) and the file goes from R2 at once
  if (b.action === 'delete') {
    const key = String(b.key || '')
    const { data: admin } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    if (!(mine(key) || (admin && /^(free|pro)\//.test(key)))) return json({ error: 'not allowed' }, 403)
    await sb.from('roar_transfer_links').update({ stopped_at: new Date().toISOString(), expires_at: new Date().toISOString() }).eq('path', key)
    await r2.fetch(at(key), { method: 'DELETE' })
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}
