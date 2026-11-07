// RoarStudio (Alex, 7 Nov 2026): the cloud for music at studio.roartransfer.com. Files go to the same R2 bucket
// as RoarTransfer (roartransfer), under studio/<project id>/…, which none of RoarTransfer's lifecycle rules touch.
// The page never holds a key: a member asks here with their Roar account and gets signed addresses for 16 MB pieces,
// then this puts the file together and writes the version (roarstudio_versions, supabase/studio.sql). People without an
// account come in through a share link (roarstudio_shares): they listen, comment and approve only through this function.
// Secrets (shared with roartransfer-r2): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const BUCKET = 'roartransfer'
const GB = 1024 ** 3
const MAX_FILE = 20 * GB
const PART = 16 * 1024 * 1024
const RANK = ['listener', 'commenter', 'editor', 'owner']
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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
const safeName = (n: string) => (n || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
const newToken = (n = 10) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => abc[x % abc.length]).join('')
}
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}
const isId = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try { return await handle(req) } catch (e) {
    console.error(e)
    return json({ error: 'RoarStudio could not reach its storage. Try again in a minute.' }, 502)
  }
})

async function roleOf(uid: string | null, project: string): Promise<string | null> {
  if (!uid || !isId(project)) return null
  const { data: p } = await sb.from('roarstudio_projects').select('owner').eq('id', project).maybeSingle()
  if (!p) return null
  if (p.owner === uid) return 'owner'
  const { data: m } = await sb.from('roarstudio_members').select('role').eq('project_id', project).eq('user_id', uid).maybeSingle()
  return m?.role || null
}
const can = (role: string | null, need: string) => !!role && RANK.indexOf(role) >= RANK.indexOf(need)

// a share link, checked: not ended, password right
async function openShare(b: Record<string, any>) {
  const token = String(b.token || '')
  if (!/^[A-Za-z0-9]{6,32}$/.test(token)) return { error: 'This link does not exist.', status: 404 }
  const { data: s } = await sb.from('roarstudio_shares').select('*').eq('token', token).maybeSingle()
  if (!s) return { error: 'This link does not exist.', status: 404 }
  if (s.expires_at && new Date(s.expires_at) < new Date()) return { error: 'This link has ended.', status: 410 }
  if (s.password_hash && s.password_hash !== (await sha(`${token}:${String(b.password || '')}`))) return { error: 'password', status: 401, locked: true }
  return { share: s }
}

async function names(ids: string[]) {
  const out: Record<string, string> = {}
  const uniq = [...new Set(ids.filter(Boolean))]
  if (!uniq.length) return out
  const { data } = await sb.from('roar_profiles').select('id, display_name, username').in('id', uniq)
  for (const r of data || []) out[r.id] = r.display_name || r.username || 'Member'
  return out
}

async function deleteKeys(keys: string[]) {
  for (const k of keys) if (k && k.startsWith('studio/')) { try { await r2.fetch(at(k), { method: 'DELETE' }) } catch (e) { console.error('delete', k, e) } }
}

async function handle(req: Request): Promise<Response> {
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  let uid: string | null = null
  if (jwt && jwt.split('.').length === 3) {
    const { data } = await sb.auth.getUser(jwt)
    uid = data?.user?.id || null
  }

  if (b.action === 'health') return json({ ok: !!(account && Deno.env.get('R2_ACCESS_KEY_ID')) })

  // ---------- people without an account, through a share link ----------
  if (typeof b.action === 'string' && b.action.startsWith('share-') && b.action !== 'share-create') {
    const o = await openShare(b)
    if (!o.share) return json({ error: o.error, locked: o.locked }, o.status)
    const s = o.share
    const inShare = async (versionId: string) => {
      if (!isId(versionId)) return null
      const { data: v } = await sb.from('roarstudio_versions').select('*').eq('id', versionId).eq('project_id', s.project_id).maybeSingle()
      if (!v || (s.track_id && v.track_id !== s.track_id)) return null
      if (s.kind === 'finals' && !v.final_at) return null
      return v
    }
    if (b.action === 'share-open') {
      const { data: project } = await sb.from('roarstudio_projects').select('id, title, artist, color, owner').eq('id', s.project_id).maybeSingle()
      const finals = s.kind === 'finals'
      let tq = sb.from('roarstudio_tracks').select('id, title, position').eq('project_id', s.project_id).order('position').order('created_at')
      if (s.track_id) tq = tq.eq('id', s.track_id)
      let { data: tracks } = await tq
      const tids = (tracks || []).map((t: any) => t.id)
      let vq = sb.from('roarstudio_versions').select('id, track_id, n, label, file_name, size, mime, duration, lufs, peak_db, sample_rate, channels, peaks, approved_at, approved_by, final_at, final_by, thumb, width, height, created_at, uploaded_by').in('track_id', tids).order('n')
      if (finals) vq = vq.not('final_at', 'is', null)
      const { data: versions } = tids.length ? await vq : { data: [] }
      if (finals) { const has = new Set((versions || []).map((v: any) => v.track_id)); tracks = (tracks || []).filter((t: any) => has.has(t.id)) }
      const vids = (versions || []).map((v: any) => v.id)
      const { data: comments } = vids.length && !finals ? await sb.from('roarstudio_comments').select('id, version_id, parent_id, at_sec, body, author, guest_name, done, created_at').in('version_id', vids).order('created_at') : { data: [] }
      const who = await names([project?.owner, ...(comments || []).map((c: any) => c.author), ...(versions || []).map((v: any) => v.uploaded_by)])
      return json({ project: { ...project, owner_name: who[project?.owner] || '' }, tracks, versions, comments, names: who,
        kind: finals ? 'finals' : 'review',
        can: finals ? { comment: false, approve: false, download: true } : { comment: s.can_comment, approve: s.can_approve, download: s.can_download }, expires: s.expires_at })
    }
    if (b.action === 'share-url') {
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      if (b.download && !s.can_download && s.kind !== 'finals') return json({ error: 'not allowed' }, 403)
      const q: Record<string, string> = b.download ? { 'response-content-disposition': `attachment; filename="${safeName(v.file_name)}"` } : {}
      return json({ url: await presign('GET', v.file_key, q, 6 * 3600) })
    }
    if (b.action === 'share-comment') {
      if (!s.can_comment || s.kind === 'finals') return json({ error: 'not allowed' }, 403)
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      const body = String(b.body || '').trim().slice(0, 4000)
      const name = String(b.name || '').trim().slice(0, 60) || 'Guest'
      if (!body) return json({ error: 'empty' }, 400)
      const row: Record<string, unknown> = { version_id: v.id, project_id: s.project_id, body, guest_name: name, at_sec: Number.isFinite(Number(b.at_sec)) && b.at_sec !== null ? Number(b.at_sec) : null }
      if (isId(b.parent)) row.parent_id = b.parent
      const { data, error } = await sb.from('roarstudio_comments').insert(row).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ comment: data })
    }
    if (b.action === 'share-approve') {
      if (!s.can_approve || s.kind === 'finals') return json({ error: 'not allowed' }, 403)
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      const name = String(b.name || '').trim().slice(0, 60) || 'Guest'
      const { data } = await sb.from('roarstudio_versions').update({ approved_at: new Date().toISOString(), approved_by: name }).eq('id', v.id).select('approved_at, approved_by').single()
      return json(data || {})
    }
    return json({ error: 'unknown action' }, 400)
  }

  // ---------- members, with a Roar account ----------
  if (!uid) return json({ error: 'signed-out' }, 401)

  const project = String(b.project || '')
  const role = await roleOf(uid, project)

  if (b.action === 'upload-create') {
    if (!can(role, 'editor')) return json({ error: 'not allowed' }, 403)
    const size = Number(b.size) || 0
    if (size <= 0 || size > MAX_FILE) return json({ error: 'Files can be up to 20 GB.' }, 400)
    const key = `studio/${project}/${crypto.randomUUID()}-${safeName(b.name)}`
    const r = await r2.fetch(`${at(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': String(b.type || 'application/octet-stream') } })
    const uploadId = tag(await r.text(), 'UploadId')
    if (!r.ok || !uploadId) return json({ error: `Could not start the upload (${r.status})` }, 502)
    return json({ key, uploadId })
  }
  const ownKey = (key: unknown) => typeof key === 'string' && key.startsWith(`studio/${project}/`) && !key.includes('..')

  if (b.action === 'upload-sign') {
    if (!can(role, 'editor') || !ownKey(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    const most = Math.ceil(MAX_FILE / PART)
    const parts = (Array.isArray(b.parts) ? b.parts : []).map(Number).filter((n: number) => n >= 1 && n <= most).slice(0, 50)
    const urls: Record<number, string> = {}
    for (const n of parts) urls[n] = await presign('PUT', b.key, { partNumber: String(n), uploadId: String(b.uploadId) })
    return json({ urls })
  }

  if (b.action === 'upload-abort') {
    if (!can(role, 'editor') || !ownKey(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(String(b.uploadId))}`, { method: 'DELETE' })
    return json({ ok: true })
  }

  if (b.action === 'upload-complete') {
    if (!can(role, 'editor') || !ownKey(b.key) || !b.uploadId || !Array.isArray(b.parts) || !b.parts.length) return json({ error: 'not allowed' }, 403)
    const xml = '<CompleteMultipartUpload>' + b.parts.sort((x: any, y: any) => x.n - y.n)
      .map((p: any) => `<Part><PartNumber>${Number(p.n)}</PartNumber><ETag>${String(p.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('') + '</CompleteMultipartUpload>'
    const r = await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(String(b.uploadId))}`, { method: 'POST', body: xml, headers: { 'Content-Type': 'application/xml' } })
    const text = await r.text()
    if (!r.ok || text.includes('<Error>')) return json({ error: `Could not finish the upload (${tag(text, 'Code') || r.status})` }, 502)
    const head = await r2.fetch(at(b.key), { method: 'HEAD' })
    const size = Number(head.headers.get('content-length')) || Number(b.size) || 0
    if (size > MAX_FILE) { await deleteKeys([b.key]); return json({ error: 'Files can be up to 20 GB.' }, 400) }
    // the track: the one given (in this project) or a new one
    let trackId = isId(b.track) ? b.track : null
    if (trackId) {
      const { data: t } = await sb.from('roarstudio_tracks').select('id').eq('id', trackId).eq('project_id', project).maybeSingle()
      if (!t) trackId = null
    }
    if (!trackId) {
      const { count } = await sb.from('roarstudio_tracks').select('id', { count: 'exact', head: true }).eq('project_id', project)
      const { data: t, error } = await sb.from('roarstudio_tracks').insert({ project_id: project, title: String(b.title || b.name || 'Untitled').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 200), position: count || 0, created_by: uid }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      trackId = t.id
    }
    const m = b.meta || {}
    const num = (x: unknown) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null)
    const peaks = Array.isArray(m.peaks) ? m.peaks.slice(0, 2000).map((x: unknown) => Math.max(0, Math.min(1, Math.round(Number(x) * 1000) / 1000 || 0))) : null
    const { data: v, error } = await sb.from('roarstudio_versions').insert({
      track_id: trackId, project_id: project, file_key: b.key, file_name: String(b.name || 'file').slice(0, 300), size,
      mime: String(b.type || '').slice(0, 100), label: String(b.label || '').slice(0, 80), uploaded_by: uid,
      duration: num(m.duration), lufs: num(m.lufs), peak_db: num(m.peak_db), sample_rate: num(m.sample_rate), channels: num(m.channels), peaks,
      width: num(m.width), height: num(m.height),
      thumb: typeof m.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.thumb) && m.thumb.length < 120000 ? m.thumb : null,
    }).select().single()
    if (error) { await deleteKeys([b.key]); return json({ error: error.message }, 500) }
    return json({ version: v })
  }

  if (b.action === 'url') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('file_key, file_name, project_id').eq('id', b.version).maybeSingle()
    if (!v || !can(await roleOf(uid, v.project_id), 'listener')) return json({ error: 'not found' }, 404)
    const q: Record<string, string> = b.download ? { 'response-content-disposition': `attachment; filename="${safeName(v.file_name)}"` } : {}
    return json({ url: await presign('GET', v.file_key, q, 6 * 3600) })
  }

  if (b.action === 'approve') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, project_id, approved_at').eq('id', b.version).maybeSingle()
    if (!v || !can(await roleOf(uid, v.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    const who = (await names([uid]))[uid] || 'Member'
    const upd = b.undo ? { approved_at: null, approved_by: null } : { approved_at: new Date().toISOString(), approved_by: who }
    const { data } = await sb.from('roarstudio_versions').update(upd).eq('id', v.id).select('approved_at, approved_by').single()
    return json(data || {})
  }

  // Make it final (Alex, 7 Nov): the version goes into the project's Finals folder, or leaves it with undo
  if (b.action === 'final') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, project_id').eq('id', b.version).maybeSingle()
    if (!v || !can(await roleOf(uid, v.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    const who = (await names([uid]))[uid] || 'Member'
    const upd = b.undo ? { final_at: null, final_by: null } : { final_at: new Date().toISOString(), final_by: who }
    const { data } = await sb.from('roarstudio_versions').update(upd).eq('id', v.id).select('final_at, final_by').single()
    return json(data || {})
  }

  if (b.action === 'delete-version') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, project_id, file_key, track_id').eq('id', b.version).maybeSingle()
    if (!v || !can(await roleOf(uid, v.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    await sb.from('roarstudio_versions').delete().eq('id', v.id)
    await deleteKeys([v.file_key])
    // a track with no version left goes too
    const { count } = await sb.from('roarstudio_versions').select('id', { count: 'exact', head: true }).eq('track_id', v.track_id)
    if (!count) await sb.from('roarstudio_tracks').delete().eq('id', v.track_id)
    return json({ ok: true, trackGone: !count })
  }

  if (b.action === 'delete-track') {
    if (!isId(b.track)) return json({ error: 'not found' }, 404)
    const { data: t } = await sb.from('roarstudio_tracks').select('id, project_id').eq('id', b.track).maybeSingle()
    if (!t || !can(await roleOf(uid, t.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    const { data: vs } = await sb.from('roarstudio_versions').select('file_key').eq('track_id', t.id)
    await sb.from('roarstudio_tracks').delete().eq('id', t.id)
    await deleteKeys((vs || []).map((v: any) => v.file_key))
    return json({ ok: true })
  }

  if (b.action === 'delete-project') {
    if (role !== 'owner') return json({ error: 'not allowed' }, 403)
    const { data: vs } = await sb.from('roarstudio_versions').select('file_key').eq('project_id', project)
    await sb.from('roarstudio_projects').delete().eq('id', project)
    await deleteKeys((vs || []).map((v: any) => v.file_key))
    return json({ ok: true })
  }

  if (b.action === 'share-create') {
    if (!can(role, 'editor')) return json({ error: 'not allowed' }, 403)
    let track: string | null = null
    if (isId(b.track)) {
      const { data: t } = await sb.from('roarstudio_tracks').select('id').eq('id', b.track).eq('project_id', project).maybeSingle()
      track = t?.id || null
    }
    const finals = b.kind === 'finals'
    if (finals) track = null
    const days = [1, 7, 30].includes(Number(b.days)) ? Number(b.days) : null
    const password = String(b.password || '').slice(0, 100)
    let token = newToken(), error: any = null
    for (let i = 0; i < 4; i++) {
      if (i) token = newToken()
      ;({ error } = await sb.from('roarstudio_shares').insert({
        token, project_id: project, track_id: track, kind: finals ? 'finals' : 'review',
        can_comment: finals ? false : b.comment !== false, can_approve: finals ? false : !!b.approve, can_download: finals ? true : !!b.download,
        password_hash: password ? await sha(`${token}:${password}`) : null, expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null, created_by: uid,
      }))
      if (!error || error.code !== '23505') break
    }
    if (error) return json({ error: error.message }, 500)
    return json({ token })
  }

  // storage used by the caller's own projects
  if (b.action === 'usage') {
    const { data: ps } = await sb.from('roarstudio_projects').select('id').eq('owner', uid)
    const ids = (ps || []).map((p: any) => p.id)
    if (!ids.length) return json({ bytes: 0 })
    const { data: vs } = await sb.from('roarstudio_versions').select('size').in('project_id', ids)
    return json({ bytes: (vs || []).reduce((a: number, v: any) => a + Number(v.size || 0), 0) })
  }

  return json({ error: 'unknown action' }, 400)
}
