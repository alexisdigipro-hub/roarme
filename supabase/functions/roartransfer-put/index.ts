// A RoarTransfer piece sent through here instead of straight to R2 (Alex, 25 Nov 2026: from the iPhone's Safari the
// pieces reached R2 but its answer never came back, so a 277 KB photo hung at 100%). RoarMe's r2upload.js turns to it
// once a piece fails or hangs on the way to R2. POST ?key=&uploadId=&part= with the piece's bytes as the body; only
// one's own upload (as roartransfer-r2's mine), one piece at most 16 MB. Answers { etag } for roartransfer-r2's complete.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const PART = 16 * 1024 * 1024
const MOST = 3200 // 50 GB in 16 MB pieces
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const base = `https://${account}.r2.cloudflarestorage.com/roartransfer`
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (req.method !== 'POST') return json({ error: 'bad request' }, 400)
    const q = new URL(req.url).searchParams
    const key = q.get('key') || '', uploadId = q.get('uploadId') || '', part = Number(q.get('part')) || 0
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: who } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
    const uid = who?.user?.id
    const mine = !key.split('/').some((p) => p === '..' || p === '.') && (uid
      ? (key.startsWith(`free/${uid}/`) || key.startsWith(`week/${uid}/`) || key.startsWith(`pro/${uid}/`))
      : /^free\/guest\/[0-9a-f-]{36}\//.test(key))
    if (!mine || !uploadId || part < 1 || part > MOST) return json({ error: 'not allowed' }, 403)
    const bytes = await req.arrayBuffer()
    if (bytes.byteLength < 1 || bytes.byteLength > PART) return json({ error: 'bad piece' }, 400)
    const url = `${base}/${key.split('/').map(encodeURIComponent).join('/')}?partNumber=${part}&uploadId=${encodeURIComponent(uploadId)}`
    const r = await r2.fetch(url, { method: 'PUT', body: bytes })
    if (!r.ok) return json({ error: `Upload failed (${r.status})` }, 502)
    return json({ etag: r.headers.get('etag') || '' })
  } catch (e) {
    console.error(e)
    return json({ error: 'RoarTransfer could not reach its storage. Try again in a minute.' }, 502)
  }
})
