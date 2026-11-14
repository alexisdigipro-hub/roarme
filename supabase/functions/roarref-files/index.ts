// RoarRef's photos on Cloudflare R2 (Alex, 14 Nov 2026: "can they go up to another server, so Supabase is not loaded").
// RoarRef (themadlions.com/lab/roarref/app/) keeps a sheet's photos and its pool at full resolution; they go to the R2
// bucket `roarref`, not to Supabase storage. The page never holds a key: signed in with its Roar Account it asks here and
// gets short-lived signed addresses, and sends or fetches each file straight to and from R2.
// A person reaches only their own folder: <account id>/<sheet id>/<file>.
// Secrets: the same as RoarTransfer's (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). The bucket and its CORS
// rule are made here the first time, if the key may do that; if it may not, `health` says so and RoarRef stays on Supabase.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const BUCKET = 'roarref'
const MAX_FILES = 200            // files in one sheet's folder (photos, pool, small pictures)
const MAX_BYTES = 1.5 * 1024 ** 3 // and their size together
const ORIGINS = ['https://themadlions.com', 'https://www.themadlions.com', 'https://hub.themadlions.com', 'http://localhost:8765']
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const keys = !!(account && Deno.env.get('R2_ACCESS_KEY_ID') && Deno.env.get('R2_SECRET_ACCESS_KEY'))
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const base = `https://${account}.r2.cloudflarestorage.com/${BUCKET}`
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY = new RegExp(`^${UUID}/${UUID}/[A-Za-z0-9._-]{1,80}$`)
const FOLDER = new RegExp(`^${UUID}/${UUID}$`)
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] || ''

// the bucket, ready or not: 200 it is there, 404 it is not, 403 the key may not look. Asked once per start of the function.
let ready: Promise<{ ok: boolean; status: number; made: boolean; cors: number }> | null = null
async function prepare() {
  const out = { ok: false, status: 0, made: false, cors: 0 }
  if (!keys) return out
  let r = await r2.fetch(`${base}?list-type=2&max-keys=1`)
  await r.body?.cancel()
  if (r.status === 404) { // not there yet: make it, where the key is allowed to
    const c = await r2.fetch(base, { method: 'PUT' }); await c.body?.cancel()
    out.made = c.ok
    r = await r2.fetch(`${base}?list-type=2&max-keys=1`); await r.body?.cancel()
  }
  out.status = r.status
  if (!r.ok) return out
  // the pages may send and fetch files from the browser
  const rule = `<CORSConfiguration><CORSRule>${ORIGINS.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')}<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>86400</MaxAgeSeconds></CORSRule></CORSConfiguration>`
  const have = await r2.fetch(`${base}?cors`)
  const xml = await have.text()
  if (have.status === 403) out.cors = 403
  else if (have.ok && ORIGINS.every((o) => xml.includes(o)) && xml.includes('PUT')) out.cors = 200
  else { const s = await r2.fetch(`${base}?cors`, { method: 'PUT', body: rule, headers: { 'Content-Type': 'application/xml' } }); await s.body?.cancel(); out.cors = s.status }
  // a key for files only may not read or set the rule (403): then the rule is the one put on the bucket by hand in Cloudflare,
  // and RoarRef itself falls back to Supabase for any file R2 does not take
  out.ok = (out.cors >= 200 && out.cors < 300) || out.cors === 403
  return out
}
const state = () => { if (!ready) ready = prepare().catch(() => ({ ok: false, status: -1, made: false, cors: 0 })); return ready }

const at = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
async function presign(method: string, key: string, expires: number) {
  const u = new URL(at(key))
  u.searchParams.set('X-Amz-Expires', String(expires))
  return (await r2.sign(new Request(u, { method }), { aws: { signQuery: true } })).url
}
async function listFolder(folder: string) {
  const files: { name: string; size: number }[] = []
  let next = ''
  for (let i = 0; i < 5; i++) {
    const r = await r2.fetch(`${base}?list-type=2&max-keys=1000&prefix=${encodeURIComponent(folder + '/')}${next ? '&continuation-token=' + encodeURIComponent(next) : ''}`)
    const xml = await r.text()
    if (!r.ok) throw new Error(`list ${r.status}`)
    for (const c of xml.split('<Contents>').slice(1)) files.push({ name: tag(c, 'Key').slice(folder.length + 1), size: Number(tag(c, 'Size')) || 0 })
    next = tag(xml, 'NextContinuationToken')
    if (tag(xml, 'IsTruncated') !== 'true' || !next) break
  }
  return files
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try { return await handle(req) } catch (e) {
    console.error(e)
    return json({ error: 'RoarRef could not reach its storage. Try again in a minute.' }, 502)
  }
})

async function handle(req: Request): Promise<Response> {
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  // whether the storage is in place, without showing a key; RoarRef asks this once and stays on Supabase when it is not
  if (b.action === 'health') {
    if (b.again) ready = null
    const s = await state()
    return json({ ok: s.ok, keys, bucket: s.status, made: s.made, cors: s.cors })
  }
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: who } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
  const uid = who?.user?.id
  if (!uid) return json({ error: 'sign in' }, 401)
  if (!(await state()).ok) return json({ error: 'storage not ready' }, 503)
  const mine = (k: unknown) => typeof k === 'string' && KEY.test(k) && k.startsWith(uid + '/')
  const myFolder = (f: unknown) => typeof f === 'string' && FOLDER.test(f) && f.startsWith(uid + '/')

  // signed addresses: to send a file (put, 15 minutes) or to fetch one (get, 1 hour)
  if (b.action === 'sign') {
    const items = Array.isArray(b.items) ? b.items.slice(0, 80) : []
    if (!items.length || !items.every((x: any) => (x?.op === 'put' || x?.op === 'get') && mine(x.key))) return json({ error: 'bad request' }, 400)
    // room: a sheet's folder holds so many files and bytes, no more
    const folders = [...new Set(items.filter((x: any) => x.op === 'put').map((x: any) => x.key.split('/').slice(0, 2).join('/')))] as string[]
    for (const f of folders) {
      const files = await listFolder(f)
      const adds = items.filter((x: any) => x.op === 'put' && x.key.startsWith(f + '/') && !files.some((y) => y.name === x.key.slice(f.length + 1))).length
      if (files.length + adds > MAX_FILES || files.reduce((n, y) => n + y.size, 0) > MAX_BYTES) return json({ error: 'This project is full: take some photos out of it first.' }, 413)
    }
    const urls = await Promise.all(items.map((x: any) => presign(x.op === 'put' ? 'PUT' : 'GET', x.key, x.op === 'put' ? 900 : 3600)))
    return json({ urls })
  }
  // the files of one sheet's folder
  if (b.action === 'list') {
    if (!myFolder(b.folder)) return json({ error: 'bad request' }, 400)
    return json({ files: await listFolder(b.folder) })
  }
  // files taken out
  if (b.action === 'remove') {
    const ks = Array.isArray(b.keys) ? b.keys.slice(0, 400) : []
    if (!ks.every(mine)) return json({ error: 'bad request' }, 400)
    let removed = 0
    for (const k of ks) { const r = await r2.fetch(at(k), { method: 'DELETE' }); await r.body?.cancel(); if (r.ok || r.status === 204) removed++ }
    return json({ removed })
  }
  return json({ error: 'bad request' }, 400)
}
