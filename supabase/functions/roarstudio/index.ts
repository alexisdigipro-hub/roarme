// RoarTransfer Studio (RoarStudio until 7 Nov 2026; Alex, 7 Nov 2026): the cloud for music at studio.roartransfer.com. Files go to the same R2 bucket
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
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-roarstudio-hook', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const PAGE = 'https://studio.roartransfer.com/'
const FROM = 'RoarTransfer Studio <noreply@themadlions.com>'
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
    return json({ error: 'RoarTransfer Studio could not reach its storage. Try again in a minute.' }, 502)
  }
})

const live = (until: string | null) => !until || new Date(until).getTime() > Date.now()
const sameTime = (a: string | null, b: string | null) => (a === null && b === null) || (!!a && !!b && new Date(a).getTime() === new Date(b).getTime())

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

// an owner's studio: name, logo, banner, whether v1, v2 are hidden from people on links
async function studioOf(owner: string | null | undefined) {
  if (!owner) return null
  const { data } = await sb.from('roarstudio_studios').select('name, logo, banner, backdrop, hide_versions, watermark').eq('owner', owner).maybeSingle()
  return data || null
}

// views, plays and downloads through links (and downloads by members) for the bell; one of each per hour and file is enough
async function logEvent(project: string, kind: string, v: any, who: string | null, actor: string | null = null) {
  try {
    const hourAgo = new Date(Date.now() - 3600e3).toISOString()
    let q = sb.from('roarstudio_events').select('id', { count: 'exact', head: true }).eq('project_id', project).eq('kind', kind).gte('created_at', hourAgo)
    q = v ? q.eq('version_id', v.id) : q.is('version_id', null)
    q = actor ? q.eq('actor', actor) : who ? q.eq('actor_name', who) : q.is('actor_name', null)
    const { count } = await q
    if (count) return
    await sb.from('roarstudio_events').insert({ project_id: project, kind, actor, actor_name: who, track_id: v?.track_id || null, version_id: v?.id || null })
  } catch (e) { console.error('log', e) }
}

// Stills (Alex, 7 Nov): frames grabbed from a video, with their time on them, kept for everyone to download
async function stillsOf(versionId: string, title: string) {
  const { data } = await sb.from('roarstudio_stills').select('id, version_id, at_sec, file_key, width, height, size, author, guest_name, created_at').eq('version_id', versionId).order('at_sec').order('created_at')
  const who = await names((data || []).map((r: any) => r.author))
  const out = []
  for (const r of data || []) {
    const t = Number(r.at_sec) || 0, hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = Math.floor(t % 60), ms = Math.round((t % 1) * 1000) % 1000
    const p2 = (n: number) => String(n).padStart(2, '0')
    const fname = `${safeName(title)}_${p2(hh)}-${p2(mm)}-${p2(ss)}.${String(ms).padStart(3, '0')}.jpg`
    out.push({ id: r.id, version_id: r.version_id, at_sec: r.at_sec, width: r.width, height: r.height, size: r.size, author: r.author, by: r.author ? (who[r.author] || 'Member') : (r.guest_name || 'Guest'), created_at: r.created_at,
      url: await presign('GET', r.file_key, {}, 6 * 3600), dl: await presign('GET', r.file_key, { 'response-content-disposition': `attachment; filename="${fname}"` }, 6 * 3600) })
  }
  return out
}
async function addStill(v: any, b: Record<string, any>, author: string | null, guest: string | null) {
  const id = crypto.randomUUID()
  const key = `studio/${v.project_id}/stills/${id}.jpg`
  const size = Math.max(0, Math.min(40 * 1024 * 1024, Number(b.size) || 0))
  const row = { id, version_id: v.id, project_id: v.project_id, at_sec: Math.max(0, Number(b.at_sec) || 0), file_key: key, width: Number(b.width) || null, height: Number(b.height) || null, size, author, guest_name: guest }
  const { error } = await sb.from('roarstudio_stills').insert(row)
  if (error) return json({ error: error.message }, 500)
  return json({ id, put: await presign('PUT', key, {}, 900) })
}
async function stillKeys(col: string, val: string) {
  const { data } = await sb.from('roarstudio_stills').select('file_key').eq(col, val)
  return (data || []).map((r: any) => r.file_key)
}

// a drawing on a video note: at most 40 strokes of at most 400 points, every number between 0 and 1
function cleanSketch(v: unknown) {
  if (!Array.isArray(v) || !v.length) return null
  const out = []
  for (const st of v.slice(0, 40)) {
    if (!st || !['pen', 'arrow', 'circle'].includes(st.t) || !Array.isArray(st.p)) continue
    const p = st.p.slice(0, 400).map((q: any) => [Math.max(0, Math.min(1, Math.round(Number(q?.[0]) * 1e4) / 1e4 || 0)), Math.max(0, Math.min(1, Math.round(Number(q?.[1]) * 1e4) / 1e4 || 0))])
    if (p.length >= 2) out.push({ t: st.t, p })
  }
  return out.length ? out : null
}

// Spoken notes and stems (Alex, 8 Nov)
async function voicePut(projectId: string, type: unknown) {
  const ext = /mp4|m4a|aac/.test(String(type)) ? 'm4a' : /ogg/.test(String(type)) ? 'ogg' : 'webm'
  const key = `studio/${projectId}/voice/${crypto.randomUUID()}.${ext}`
  return json({ key, put: await presign('PUT', key, {}, 900) })
}
async function voiceUrl(commentId: unknown, projectId: string | null) {
  if (!isId(commentId)) return json({ error: 'not found' }, 404)
  const { data: c } = await sb.from('roarstudio_comments').select('id, project_id, voice').eq('id', commentId).maybeSingle()
  if (!c || !c.voice || (projectId && c.project_id !== projectId) || !String(c.voice).startsWith(`studio/${c.project_id}/voice/`)) return json({ error: 'not found' }, 404)
  return json({ url: await presign('GET', c.voice, {}, 3 * 3600), project: c.project_id })
}
async function stemsOf(versionId: string) {
  const { data } = await sb.from('roarstudio_stems').select('id, version_id, name, file_key, size, mime, position, created_by, created_at').eq('version_id', versionId).order('position').order('created_at')
  const out = []
  for (const r of data || []) out.push({ id: r.id, version_id: r.version_id, name: r.name, size: r.size, mime: r.mime, created_by: r.created_by, url: await presign('GET', r.file_key, {}, 6 * 3600) })
  return out
}
const voiceOk = (key: unknown, projectId: string) => typeof key === 'string' && key.startsWith(`studio/${projectId}/voice/`) && !key.includes('..') && key.length < 200
async function extraKeys(col: string, val: string) {
  const { data: st } = await sb.from('roarstudio_stems').select('file_key').eq(col, val)
  const { data: vo } = await sb.from('roarstudio_comments').select('voice').eq(col, val).not('voice', 'is', null)
  return [...(st || []).map((r: any) => r.file_key), ...(vo || []).map((r: any) => r.voice)]
}

// a point on a picture, both numbers between 0 and 1
function cleanPos(v: any) {
  if (!v || typeof v !== 'object') return null
  const x = Number(v.x), y = Number(v.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.max(0, Math.min(1, Math.round(x * 1e4) / 1e4)), y: Math.max(0, Math.min(1, Math.round(y * 1e4) / 1e4)) }
}
// picks (Alex, 8 Nov): a heart on a picture, one per person; the same call puts it on and takes it off
async function picksOf(projectId: string) {
  const { data } = await sb.from('roarstudio_picks').select('track_id, user_id, guest_name, created_at').eq('project_id', projectId)
  const who = await names((data || []).map((r: any) => r.user_id))
  return (data || []).map((r: any) => ({ track_id: r.track_id, user_id: r.user_id, by: r.user_id ? (who[r.user_id] || 'Member') : (r.guest_name || 'Guest'), created_at: r.created_at }))
}
async function togglePick(projectId: string, trackId: string, userId: string | null, guest: string | null) {
  let q = sb.from('roarstudio_picks').select('id').eq('track_id', trackId)
  q = userId ? q.eq('user_id', userId) : q.ilike('guest_name', String(guest).replace(/[%_\\]/g, (m) => '\\' + m))
  const { data: had } = await q.maybeSingle()
  if (had) await sb.from('roarstudio_picks').delete().eq('id', had.id)
  else await sb.from('roarstudio_picks').insert({ project_id: projectId, track_id: trackId, user_id: userId, guest_name: userId ? null : guest })
  return json({ picked: !had, picks: await picksOf(projectId) })
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

  if (b.action === 'notify-sweep') {
    const { data: conf } = await sb.from('roarstudio_conf').select('hook_token').eq('id', 1).maybeSingle()
    if (!conf || req.headers.get('x-roarstudio-hook') !== conf.hook_token) return json({ error: 'not allowed' }, 403)
    return json(await notifySweep())
  }

  // the waiting list from the pricing pages (Alex, 8 Nov 2026: "pre-order, leave your name, next to Coming soon"); no account needed
  if (b.action === 'waitlist') {
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json({ error: 'bad email' }, 400)
    const plan = b.plan === 'transfer-pro' ? 'transfer-pro' : 'studio-pro'
    const billing = b.billing === 'year' ? 'year' : b.billing === 'month' ? 'month' : null
    const { error } = await sb.from('roarstudio_waitlist').upsert({ email, plan, billing, lang: b.lang === 'el' ? 'el' : 'en' }, { onConflict: 'email,plan' })
    if (error) return json({ error: 'Try again in a minute.' }, 500)
    return json({ ok: true })
  }

  // Studio Pro of the caller (Alex, 8 Nov 2026): the admins always, else a row whose `until` is empty or ahead
  if (b.action === 'pro-me') {
    if (!uid) return json({ pro: false })
    const { data: adm } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    const { data: me } = await sb.from('roarstudio_pro').select('until').eq('user_id', uid).maybeSingle()
    return json({ pro: !!adm || (!!me && live(me.until)), admin: !!adm, until: adm ? null : me?.until || null })
  }

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
      if (s.kind === 'playlist') {
        const { data: pl } = await sb.from('roarstudio_playlists').select('items').eq('id', s.playlist_id).maybeSingle()
        if (!pl || !(pl.items || []).includes(v.track_id)) return null
      }
      return v
    }
    if (b.action === 'share-open') {
      const { data: project } = await sb.from('roarstudio_projects').select('id, title, artist, color, owner, cover, credits').eq('id', s.project_id).maybeSingle()
      const finals = s.kind === 'finals'
      let playlist: any = null
      if (s.kind === 'playlist' && s.playlist_id) {
        const { data: pl } = await sb.from('roarstudio_playlists').select('id, title, items').eq('id', s.playlist_id).maybeSingle()
        playlist = pl
      }
      let tq = sb.from('roarstudio_tracks').select('id, title, position').eq('project_id', s.project_id).order('position').order('created_at')
      if (s.track_id) tq = tq.eq('id', s.track_id)
      if (s.kind === 'playlist') tq = tq.in('id', playlist?.items?.length ? playlist.items : ['00000000-0000-0000-0000-000000000000'])
      let { data: tracks } = await tq
      if (playlist) tracks = (playlist.items as string[]).map((id) => (tracks || []).find((t: any) => t.id === id)).filter(Boolean)
      const tids = (tracks || []).map((t: any) => t.id)
      let vq = sb.from('roarstudio_versions').select('id, track_id, n, label, file_name, size, mime, duration, lufs, peak_db, sample_rate, channels, peaks, approved_at, approved_by, final_at, final_by, thumb, width, height, created_at, uploaded_by, true_peak').in('track_id', tids).order('n')
      if (finals) vq = vq.not('final_at', 'is', null)
      const { data: versions } = tids.length ? await vq : { data: [] }
      if (finals) { const has = new Set((versions || []).map((v: any) => v.track_id)); tracks = (tracks || []).filter((t: any) => has.has(t.id)) }
      const vids = (versions || []).map((v: any) => v.id)
      const { data: comments } = vids.length && !finals ? await sb.from('roarstudio_comments').select('id, version_id, parent_id, at_sec, end_sec, body, author, guest_name, done, created_at, sketch, voice_sec, pos').in('version_id', vids).order('created_at') : { data: [] }
      const who = await names([project?.owner, ...(comments || []).map((c: any) => c.author), ...(versions || []).map((v: any) => v.uploaded_by)])
      await logEvent(s.project_id, 'view', null, String(b.name || '').slice(0, 60) || 'Someone with the link')
      return json({ project: { ...project, owner_name: who[project?.owner] || '' }, tracks, versions, comments, names: who,
        picks: s.kind === 'finals' ? [] : await picksOf(s.project_id), kind: s.kind || 'review', playlist: playlist ? { id: playlist.id, title: playlist.title } : null, studio: await studioOf(project?.owner),
        can: finals ? { comment: false, approve: false, download: true } : { comment: s.can_comment, approve: s.can_approve, download: s.can_download }, expires: s.expires_at })
    }
    if (b.action === 'share-url') {
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      if (b.download && !s.can_download && s.kind !== 'finals') return json({ error: 'not allowed' }, 403)
      await logEvent(s.project_id, b.download ? 'download' : 'stream', v, String(b.name || '').slice(0, 60) || 'Someone with the link')
      const q: Record<string, string> = b.download ? { 'response-content-disposition': `attachment; filename="${safeName(v.file_name)}"` } : {}
      return json({ url: await presign('GET', v.file_key, q, 6 * 3600) })
    }
    if (b.action === 'share-comment') {
      if (!s.can_comment || s.kind === 'finals') return json({ error: 'not allowed' }, 403)
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      const body = String(b.body || '').trim().slice(0, 4000)
      const name = String(b.name || '').trim().slice(0, 60) || 'Guest'
      const voice = voiceOk(b.voice, s.project_id) ? b.voice : null
      if (!body && !voice) return json({ error: 'empty' }, 400)
      const row: Record<string, unknown> = { version_id: v.id, project_id: s.project_id, body, guest_name: name, at_sec: Number.isFinite(Number(b.at_sec)) && b.at_sec !== null ? Number(b.at_sec) : null }
      if (isId(b.parent)) row.parent_id = b.parent
      const sk = cleanSketch(b.sketch)
      if (sk) row.sketch = sk
      const ps = cleanPos(b.pos)
      if (ps) row.pos = ps
      if (voice) { row.voice = voice; row.voice_sec = Math.max(0, Math.min(600, Number(b.voice_sec) || 0)) }
      if (row.at_sec != null && Number.isFinite(Number(b.end_sec)) && b.end_sec !== null && Number(b.end_sec) > Number(row.at_sec)) row.end_sec = Number(b.end_sec)
      const { data, error } = await sb.from('roarstudio_comments').insert(row).select('id, version_id, parent_id, at_sec, end_sec, body, author, guest_name, done, created_at, sketch, voice_sec, pos').single()
      if (error) return json({ error: error.message }, 500)
      return json({ comment: data })
    }
    if (b.action === 'share-pick') {
      if (s.kind === 'finals' || !isId(b.track)) return json({ error: 'not allowed' }, 403)
      const { data: t } = await sb.from('roarstudio_tracks').select('id, project_id').eq('id', b.track).eq('project_id', s.project_id).maybeSingle()
      if (!t || (s.track_id && s.track_id !== t.id)) return json({ error: 'not found' }, 404)
      if (s.kind === 'playlist') { const { data: pl } = await sb.from('roarstudio_playlists').select('items').eq('id', s.playlist_id).maybeSingle(); if (!pl || !(pl.items || []).includes(t.id)) return json({ error: 'not found' }, 404) }
      const name = String(b.name || '').trim().slice(0, 60)
      if (!name) return json({ error: 'name' }, 400)
      return await togglePick(s.project_id, t.id, null, name)
    }
    if (b.action === 'share-voice-add') {
      if (!s.can_comment || s.kind === 'finals') return json({ error: 'not allowed' }, 403)
      return await voicePut(s.project_id, b.type)
    }
    if (b.action === 'share-voice-url') return await voiceUrl(b.comment, s.project_id)
    if (b.action === 'share-stems') {
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      return json({ stems: await stemsOf(v.id) })
    }
    if (b.action === 'share-stills') {
      if (s.kind === 'finals') return json({ stills: [] })
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      const { data: t } = await sb.from('roarstudio_tracks').select('title').eq('id', v.track_id).maybeSingle()
      return json({ stills: await stillsOf(v.id, t?.title || v.file_name) })
    }
    if (b.action === 'share-still-add') {
      if (!s.can_comment || s.kind === 'finals') return json({ error: 'not allowed' }, 403)
      const v = await inShare(b.version)
      if (!v) return json({ error: 'not found' }, 404)
      return await addStill(v, b, null, String(b.name || '').trim().slice(0, 60) || 'Guest')
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
    // a stem of a version (Alex, 8 Nov): kept beside the version, not as a new file
    if (isId(b.stem_of)) {
      const { data: pv } = await sb.from('roarstudio_versions').select('id').eq('id', b.stem_of).eq('project_id', project).maybeSingle()
      if (!pv) { await deleteKeys([b.key]); return json({ error: 'not found' }, 404) }
      const { count: sc } = await sb.from('roarstudio_stems').select('id', { count: 'exact', head: true }).eq('version_id', pv.id)
      const { data: st, error: se } = await sb.from('roarstudio_stems').insert({ version_id: pv.id, project_id: project, name: String(b.title || b.name || 'Stem').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 120), file_key: b.key, size, mime: String(b.type || '').slice(0, 100), position: sc || 0, created_by: uid }).select('id, version_id, name, size, mime, created_by').single()
      if (se) { await deleteKeys([b.key]); return json({ error: se.message }, 500) }
      return json({ stem: st })
    }
    // the track: the one given (in this project) or a new one
    let trackId = isId(b.track) ? b.track : null
    if (trackId) {
      const { data: t } = await sb.from('roarstudio_tracks').select('id').eq('id', trackId).eq('project_id', project).maybeSingle()
      if (!t) trackId = null
    }
    if (!trackId) {
      const { count } = await sb.from('roarstudio_tracks').select('id', { count: 'exact', head: true }).eq('project_id', project)
      let folder: string | null = null
      if (isId(b.folder)) { const { data: f } = await sb.from('roarstudio_folders').select('id').eq('id', b.folder).eq('project_id', project).maybeSingle(); folder = f?.id || null }
      const { data: t, error } = await sb.from('roarstudio_tracks').insert({ project_id: project, folder_id: folder, title: String(b.title || b.name || 'Untitled').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 200), position: count || 0, created_by: uid }).select('id').single()
      if (error) return json({ error: error.message }, 500)
      trackId = t.id
    }
    const m = b.meta || {}
    const num = (x: unknown) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null)
    const peaks = Array.isArray(m.peaks) ? m.peaks.slice(0, 2000).map((x: unknown) => Math.max(0, Math.min(1, Math.round(Number(x) * 1000) / 1000 || 0))) : null
    const { data: v, error } = await sb.from('roarstudio_versions').insert({
      track_id: trackId, project_id: project, file_key: b.key, file_name: String(b.name || 'file').slice(0, 300), size,
      mime: String(b.type || '').slice(0, 100), label: String(b.label || '').trim().slice(0, 80), uploaded_by: uid,
      duration: num(m.duration), lufs: num(m.lufs), peak_db: num(m.peak_db), sample_rate: num(m.sample_rate), channels: num(m.channels), peaks,
      width: num(m.width), height: num(m.height), true_peak: num(m.true_peak),
      thumb: typeof m.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(m.thumb) && m.thumb.length < 120000 ? m.thumb : null,
    }).select().single()
    if (error) { await deleteKeys([b.key]); return json({ error: error.message }, 500) }
    return json({ version: v })
  }

  if (b.action === 'url') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, track_id, file_key, file_name, project_id').eq('id', b.version).maybeSingle()
    if (!v || !can(await roleOf(uid, v.project_id), 'listener')) return json({ error: 'not found' }, 404)
    if (b.download) await logEvent(v.project_id, 'download', v, null, uid)
    const q: Record<string, string> = b.download ? { 'response-content-disposition': `attachment; filename="${safeName(v.file_name)}"` } : {}
    return json({ url: await presign('GET', v.file_key, q, 6 * 3600) })
  }

  if (b.action === 'pick') {
    if (!isId(b.track)) return json({ error: 'not found' }, 404)
    const { data: t } = await sb.from('roarstudio_tracks').select('id, project_id').eq('id', b.track).maybeSingle()
    if (!t || !can(await roleOf(uid, t.project_id), 'listener')) return json({ error: 'not found' }, 404)
    return await togglePick(t.project_id, t.id, uid, null)
  }
  if (b.action === 'voice-add' || b.action === 'stems') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, project_id').eq('id', b.version).maybeSingle()
    const r = v ? await roleOf(uid, v.project_id) : null
    if (!v || !can(r, 'listener')) return json({ error: 'not found' }, 404)
    if (b.action === 'voice-add') { if (!can(r, 'commenter')) return json({ error: 'not allowed' }, 403); return await voicePut(v.project_id, b.type) }
    return json({ stems: await stemsOf(v.id) })
  }
  if (b.action === 'voice-url') {
    const res = await voiceUrl(b.comment, null)
    const d = await res.clone().json()
    if (!d.project || !can(await roleOf(uid, d.project), 'listener')) return json({ error: 'not found' }, 404)
    return json({ url: d.url })
  }
  if (b.action === 'stem-delete') {
    if (!isId(b.stem)) return json({ error: 'not found' }, 404)
    const { data: st } = await sb.from('roarstudio_stems').select('id, project_id, file_key').eq('id', b.stem).maybeSingle()
    if (!st) return json({ ok: true })
    if (!can(await roleOf(uid, st.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    await sb.from('roarstudio_stems').delete().eq('id', st.id)
    await deleteKeys([st.file_key])
    return json({ ok: true })
  }

  if (b.action === 'stills' || b.action === 'still-add') {
    if (!isId(b.version)) return json({ error: 'not found' }, 404)
    const { data: v } = await sb.from('roarstudio_versions').select('id, project_id, track_id, file_name').eq('id', b.version).maybeSingle()
    const r = v ? await roleOf(uid, v.project_id) : null
    if (!v || !can(r, 'listener')) return json({ error: 'not found' }, 404)
    if (b.action === 'still-add') { if (!can(r, 'commenter')) return json({ error: 'not allowed' }, 403); return await addStill(v, b, uid, null) }
    const { data: t } = await sb.from('roarstudio_tracks').select('title').eq('id', v.track_id).maybeSingle()
    return json({ stills: await stillsOf(v.id, t?.title || v.file_name) })
  }
  if (b.action === 'still-delete') {
    if (!isId(b.still)) return json({ error: 'not found' }, 404)
    const { data: st } = await sb.from('roarstudio_stills').select('id, project_id, file_key, author').eq('id', b.still).maybeSingle()
    if (!st) return json({ ok: true })
    if (st.author !== uid && !can(await roleOf(uid, st.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    await sb.from('roarstudio_stills').delete().eq('id', st.id)
    await deleteKeys([st.file_key])
    return json({ ok: true })
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
    const sk = [...(await stillKeys('version_id', v.id)), ...(await extraKeys('version_id', v.id))]
    await sb.from('roarstudio_versions').delete().eq('id', v.id)
    await deleteKeys([v.file_key, ...sk])
    // a track with no version left goes too
    const { count } = await sb.from('roarstudio_versions').select('id', { count: 'exact', head: true }).eq('track_id', v.track_id)
    if (!count) await sb.from('roarstudio_tracks').delete().eq('id', v.track_id)
    return json({ ok: true, trackGone: !count })
  }

  if (b.action === 'delete-track') {
    if (!isId(b.track)) return json({ error: 'not found' }, 404)
    const { data: t } = await sb.from('roarstudio_tracks').select('id, project_id').eq('id', b.track).maybeSingle()
    if (!t || !can(await roleOf(uid, t.project_id), 'editor')) return json({ error: 'not allowed' }, 403)
    const { data: vs } = await sb.from('roarstudio_versions').select('id, file_key').eq('track_id', t.id)
    const sk: string[] = []
    for (const v of vs || []) sk.push(...(await stillKeys('version_id', v.id)), ...(await extraKeys('version_id', v.id)))
    await sb.from('roarstudio_tracks').delete().eq('id', t.id)
    await deleteKeys([...(vs || []).map((v: any) => v.file_key), ...sk])
    return json({ ok: true })
  }

  if (b.action === 'delete-project') {
    if (role !== 'owner') return json({ error: 'not allowed' }, 403)
    const { data: vs } = await sb.from('roarstudio_versions').select('file_key').eq('project_id', project)
    const sk = [...(await stillKeys('project_id', project)), ...(await extraKeys('project_id', project))]
    await sb.from('roarstudio_projects').delete().eq('id', project)
    await deleteKeys([...(vs || []).map((v: any) => v.file_key), ...sk])
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
    let playlist: string | null = null
    if (b.kind === 'playlist') {
      if (!isId(b.playlist)) return json({ error: 'not found' }, 404)
      const { data: pl } = await sb.from('roarstudio_playlists').select('id').eq('id', b.playlist).eq('project_id', project).maybeSingle()
      if (!pl) return json({ error: 'not found' }, 404)
      playlist = pl.id
    }
    if (finals || playlist) track = null
    const days = [1, 7, 30].includes(Number(b.days)) ? Number(b.days) : null
    const password = String(b.password || '').slice(0, 100)
    let token = newToken(), error: any = null
    for (let i = 0; i < 4; i++) {
      if (i) token = newToken()
      ;({ error } = await sb.from('roarstudio_shares').insert({
        token, project_id: project, track_id: track, kind: finals ? 'finals' : playlist ? 'playlist' : 'review', playlist_id: playlist,
        can_comment: finals ? false : b.comment !== false, can_approve: finals ? false : !!b.approve, can_download: finals ? true : !!b.download,
        password_hash: password ? await sha(`${token}:${password}`) : null, expires_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null, created_by: uid,
      }))
      if (!error || error.code !== '23505') break
    }
    if (error) return json({ error: error.message }, 500)
    return json({ token })
  }

  // ---------- Admin > Studio Pro (Alex, 8 Nov 2026: "let me make people Pro in the Studio, as in RoarTransfer") ----------
  // Studio Pro includes RoarTransfer Pro: giving it also gives roar_transfer_pro up to the same date, unless they already have
  // a longer one; taking it away ends only the RoarTransfer Pro this gave (supabase/studio-pro.sql)
  if (['pro-list', 'pro-grant', 'pro-revoke', 'waitlist-list'].includes(b.action)) {
    if (!uid) return json({ error: 'not allowed' }, 403)
    const { data: adm } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    if (!adm) return json({ error: 'not allowed' }, 403)
    if (b.action === 'waitlist-list') {
      const { data } = await sb.from('roarstudio_waitlist').select('email, plan, billing, lang, created_at').order('created_at', { ascending: false }).limit(2000)
      return json({ rows: data || [] })
    }
    if (b.action === 'pro-list') {
      const { data: rows } = await sb.from('roarstudio_pro').select('user_id, until, created_at, updated_at')
      const { data: admins } = await sb.from('roar_admins').select('user_id')
      const ids = [...new Set([...(rows || []).map((r: any) => r.user_id), ...(admins || []).map((a: any) => a.user_id)])]
      const nm = await names(ids)
      const people = await Promise.all(ids.map(async (id: string) => {
        const { data: u } = await sb.auth.admin.getUserById(id)
        const r = (rows || []).find((x: any) => x.user_id === id)
        const isAdmin = (admins || []).some((a: any) => a.user_id === id)
        return { id, email: u?.user?.email || '', name: nm[id] || u?.user?.user_metadata?.name || '', admin: isAdmin, until: r?.until || null, since: r?.created_at || null, given: !!r, pro: isAdmin || (!!r && live(r.until)) }
      }))
      people.sort((a, z) => Number(z.admin) - Number(a.admin) || Number(z.pro) - Number(a.pro) || (a.name || a.email).localeCompare(z.name || z.email))
      return json({ people })
    }
    if (b.action === 'pro-grant') {
      let id = String(b.id || '')
      const email = String(b.email || '').trim().toLowerCase()
      if (!id && email) {
        const { data: found } = await sb.rpc('roarstudio_user_by_email', { e: email })
        id = found || ''
        if (!id) return json({ error: 'There is no Roar account with this email. They need to sign up first.' }, 404)
      }
      if (!isId(id)) return json({ error: 'bad request' }, 400)
      const months = Number(b.months) || 0
      const until = months > 0 ? new Date(Date.now() + months * 30 * 864e5).toISOString() : null
      const { data: had } = await sb.from('roarstudio_pro').select('transfer_until, gave_transfer').eq('user_id', id).maybeSingle()
      const { data: tp } = await sb.from('roar_transfer_pro').select('until').eq('user_id', id).maybeSingle()
      // the RoarTransfer Pro this grant gave before counts as ours; a longer one of their own stays as it is
      const ours = !!had?.gave_transfer && !!tp && sameTime(tp.until, had.transfer_until)
      const longer = !!tp && !ours && live(tp.until) && (tp.until === null || (until !== null && new Date(tp.until).getTime() >= new Date(until).getTime()))
      let gave = false
      if (!longer) {
        const { error: te } = tp ? await sb.from('roar_transfer_pro').update({ until }).eq('user_id', id) : await sb.from('roar_transfer_pro').insert({ user_id: id, until })
        if (te) return json({ error: te.message }, 500)
        gave = true
      }
      const row = { user_id: id, until, transfer_until: gave ? until : null, gave_transfer: gave, granted_by: uid, updated_at: new Date().toISOString() }
      const { error } = await sb.from('roarstudio_pro').upsert(row, { onConflict: 'user_id' })
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, id, until, transfer: gave ? 'given' : 'kept' })
    }
    if (b.action === 'pro-revoke') {
      const id = String(b.id || '')
      if (!isId(id)) return json({ error: 'bad request' }, 400)
      const now = new Date().toISOString()
      const { data: had } = await sb.from('roarstudio_pro').select('transfer_until, gave_transfer').eq('user_id', id).maybeSingle()
      if (!had) return json({ ok: true })
      if (had.gave_transfer) {
        const { data: tp } = await sb.from('roar_transfer_pro').select('until').eq('user_id', id).maybeSingle()
        if (tp && sameTime(tp.until, had.transfer_until)) await sb.from('roar_transfer_pro').update({ until: now }).eq('user_id', id)
      }
      const { error } = await sb.from('roarstudio_pro').update({ until: now, gave_transfer: false, transfer_until: null, updated_at: now }).eq('user_id', id)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }
  }

  // ---------- Admin (Alex, 7 Nov: "who made accounts, what they use and how, for every account") ----------
  // only for RoarMe's admins (roar_admins); everything read with the service role
  if (b.action === 'admin-check' || b.action === 'admin-stats') {
    const { data: adm } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    if (b.action === 'admin-check') return json({ admin: !!adm })
    if (!adm) return json({ error: 'not allowed' }, 403)
    const [pr, me, vr, cm, sh, pl, fd, ev] = await Promise.all([
      sb.from('roarstudio_projects').select('id, title, owner, created_at, updated_at'),
      sb.from('roarstudio_members').select('project_id, user_id, role, created_at'),
      sb.from('roarstudio_versions').select('id, project_id, size, mime, uploaded_by, created_at, final_at, approved_at'),
      sb.from('roarstudio_comments').select('id, project_id, author, guest_name, created_at'),
      sb.from('roarstudio_shares').select('token, project_id, kind, created_at'),
      sb.from('roarstudio_playlists').select('id'),
      sb.from('roarstudio_folders').select('id'),
      sb.from('roarstudio_events').select('kind, project_id, actor, actor_name, created_at').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString()),
    ])
    const projects = pr.data || [], members = me.data || [], versions = vr.data || [], comments = cm.data || [], shares = sh.data || [], events = ev.data || []
    const kindOf = (m: string) => (/^video\//.test(m || '') ? 'video' : /^image\//.test(m || '') ? 'image' : 'audio')
    const ids = [...new Set([...projects.map((p: any) => p.owner), ...members.map((m: any) => m.user_id), ...versions.map((v: any) => v.uploaded_by)].filter(Boolean))]
    const users: Record<string, any> = {}
    await Promise.all(ids.map(async (id: string) => { const { data } = await sb.auth.admin.getUserById(id); if (data?.user) users[id] = data.user }))
    const nm = await names(ids)
    const accounts = ids.filter((id) => users[id]).map((id: string) => {
      const own = projects.filter((p: any) => p.owner === id), ownIds = new Set(own.map((p: any) => p.id))
      const mine = versions.filter((v: any) => v.uploaded_by === id), notes = comments.filter((c: any) => c.author === id)
      const last = [...mine.map((v: any) => v.created_at), ...notes.map((c: any) => c.created_at), ...own.map((p: any) => p.updated_at)].sort().pop() || null
      return { id, email: users[id].email, name: nm[id] || users[id].user_metadata?.name || '', joined: users[id].created_at, signed_in: users[id].last_sign_in_at,
        projects: own.length, member_of: members.filter((m: any) => m.user_id === id && m.role !== 'owner').length, uploads: mine.length,
        storage: versions.filter((v: any) => ownIds.has(v.project_id)).reduce((a: number, v: any) => a + Number(v.size || 0), 0), notes: notes.length, last }
    }).sort((a: any, z: any) => String(z.last || '').localeCompare(String(a.last || '')))
    const days: Record<string, any> = {}
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days[d] = { day: d, uploads: 0, notes: 0, projects: 0, views: 0 } }
    for (const v of versions) { const d = String(v.created_at).slice(0, 10); if (days[d]) days[d].uploads++ }
    for (const c of comments) { const d = String(c.created_at).slice(0, 10); if (days[d]) days[d].notes++ }
    for (const p of projects) { const d = String(p.created_at).slice(0, 10); if (days[d]) days[d].projects++ }
    for (const e of events) { const d = String(e.created_at).slice(0, 10); if (days[d] && (e.kind === 'view' || e.kind === 'stream' || e.kind === 'download')) days[d].views++ }
    const kinds: Record<string, { files: number, bytes: number }> = { audio: { files: 0, bytes: 0 }, video: { files: 0, bytes: 0 }, image: { files: 0, bytes: 0 } }
    for (const v of versions) { const k = kindOf(v.mime); kinds[k].files++; kinds[k].bytes += Number(v.size || 0) }
    const top = projects.map((p: any) => ({ id: p.id, title: p.title, owner: users[p.owner]?.email || '', files: versions.filter((v: any) => v.project_id === p.id).length, bytes: versions.filter((v: any) => v.project_id === p.id).reduce((a: number, v: any) => a + Number(v.size || 0), 0), updated: p.updated_at }))
      .sort((a: any, z: any) => z.bytes - a.bytes).slice(0, 12)
    const ev2 = { view: 0, stream: 0, download: 0 } as Record<string, number>
    for (const e of events) if (ev2[e.kind] !== undefined) ev2[e.kind]++
    return json({
      totals: { accounts: accounts.length, projects: projects.length, files: versions.length, storage: versions.reduce((a: number, v: any) => a + Number(v.size || 0), 0),
        notes: comments.length, guest_notes: comments.filter((c: any) => c.guest_name).length, links: shares.length, finals_links: shares.filter((s: any) => s.kind === 'finals').length,
        playlists: (pl.data || []).length, folders: (fd.data || []).length, finals: versions.filter((v: any) => v.final_at).length, approved: versions.filter((v: any) => v.approved_at).length,
        active7: accounts.filter((a: any) => a.last && Date.now() - new Date(a.last).getTime() < 7 * 864e5).length },
      accounts, days: Object.values(days), kinds, top, link_activity: ev2,
    })
  }

  // storage used by the caller's own projects
  if (b.action === 'usage') {
    const { data: ps } = await sb.from('roarstudio_projects').select('id, title').eq('owner', uid)
    const ids = (ps || []).map((p: any) => p.id)
    if (!ids.length) return json({ bytes: 0, projects: [] })
    const { data: vs } = await sb.from('roarstudio_versions').select('size, project_id, mime, file_name, final_at').in('project_id', ids)
    const per: Record<string, { bytes: number, files: number, finals: number }> = {}
    const kinds: Record<string, number> = { audio: 0, video: 0, image: 0 }
    for (const v of vs || []) {
      const x = per[v.project_id] ||= { bytes: 0, files: 0, finals: 0 }
      x.bytes += Number(v.size || 0); x.files++; if (v.final_at) x.finals += Number(v.size || 0)
      const k = /^video\//.test(v.mime) ? 'video' : /^image\//.test(v.mime) ? 'image' : 'audio'
      kinds[k] += Number(v.size || 0)
    }
    const projects = (ps || []).map((p: any) => ({ id: p.id, title: p.title, ...(per[p.id] || { bytes: 0, files: 0, finals: 0 }) })).sort((a: any, z: any) => z.bytes - a.bytes)
    return json({ bytes: projects.reduce((a: number, p: any) => a + p.bytes, 0), projects, kinds })
  }

  return json({ error: 'unknown action' }, 400)
}

// ---------- the emails (Alex, 7 Nov: notifications as on mixup.media) ----------
// Every 5 minutes (pg_cron roarstudio-notify): what happened since a person's last email, older than 2 minutes so a burst
// of notes goes as one email; people on the daily digest get one email a day. Never to the one who did it.
const KIND_PREF: Record<string, string> = { note: 'notify_notes', version: 'notify_versions', approve: 'notify_approvals', final: 'notify_approvals', shared: 'notify_shared' }
async function notifySweep() {
  const until = new Date(Date.now() - 2 * 60e3)
  const { data: evs } = await sb.from('roarstudio_events').select('*').gte('created_at', new Date(Date.now() - 2 * 864e5).toISOString()).lte('created_at', until.toISOString()).order('created_at')
  if (!evs || !evs.length) return { sent: 0 }
  const pids = [...new Set(evs.map((e: any) => e.project_id))]
  const { data: people } = await sb.rpc('roarstudio_member_emails', { ps: pids })
  const { data: projects } = await sb.from('roarstudio_projects').select('id, title').in('id', pids)
  const tids = [...new Set(evs.map((e: any) => e.track_id).filter(Boolean))]
  const { data: tracks } = tids.length ? await sb.from('roarstudio_tracks').select('id, title').in('id', tids) : { data: [] }
  const vids = [...new Set(evs.map((e: any) => e.version_id).filter(Boolean))]
  const { data: versions } = vids.length ? await sb.from('roarstudio_versions').select('id, n, label').in('id', vids) : { data: [] }
  const uids = [...new Set((people || []).map((p: any) => p.user_id))]
  const { data: prefs } = uids.length ? await sb.from('roarstudio_prefs').select('*').in('user_id', uids) : { data: [] }
  const nameOf: Record<string, string> = {}
  for (const p of people || []) nameOf[p.user_id] = p.name
  const byUser: Record<string, { email: string, name: string, pids: Set<string> }> = {}
  for (const p of people || []) (byUser[p.user_id] ||= { email: p.email, name: p.name, pids: new Set() }).pids.add(p.project_id)
  let sent = 0
  for (const [user, who] of Object.entries(byUser)) {
    const pref: any = (prefs || []).find((x: any) => x.user_id === user) || {}
    const since = pref.last_sent_at ? new Date(pref.last_sent_at) : new Date(Date.now() - 30 * 60e3)
    if (pref.digest && pref.last_sent_at && Date.now() - new Date(pref.last_sent_at).getTime() < 23.5 * 3600e3) continue
    const mine = evs.filter((e: any) => who.pids.has(e.project_id) && new Date(e.created_at) > since && e.actor !== user
      && KIND_PREF[e.kind] && (e.kind !== 'shared' || e.target === user) && pref[KIND_PREF[e.kind]] !== false)
    if (!mine.length) continue
    const lines = mine.map((e: any) => {
      const pt = (projects || []).find((x: any) => x.id === e.project_id)?.title || 'a project'
      const tt = (tracks || []).find((x: any) => x.id === e.track_id)?.title || ''
      const v: any = (versions || []).find((x: any) => x.id === e.version_id)
      const vt = v ? `v${v.n}${v.label ? ' · ' + v.label : ''}` : ''
      const by = e.actor_name || (e.actor ? nameOf[e.actor] : '') || 'Someone'
      const link = e.track_id ? `${PAGE}#t/${e.track_id}` : `${PAGE}#p/${e.project_id}`
      const what = e.kind === 'note' ? `${by} left a note on ${tt} ${vt}` : e.kind === 'version' ? `${by} uploaded ${tt} ${vt}` : e.kind === 'approve' ? `${by} approved ${tt} ${vt}` : e.kind === 'final' ? `${tt} ${vt} is final` : `${by} added you to ${pt}`
      return { what, pt, body: e.kind === 'note' ? e.body : '', link }
    })
    const subject = lines.length === 1 ? lines[0].what.replace(/\s+/g, ' ').trim() : `${lines.length} updates in RoarTransfer Studio`
    const r = await sendMail(who.email, subject, mailHtml(who.name, lines), lines.map((l: any) => `${l.what} (${l.pt})${l.body ? '\n  "' + l.body + '"' : ''}\n  ${l.link}`).join('\n\n'))
    if (r === true) sent++
    await sb.from('roarstudio_prefs').upsert({ user_id: user, last_sent_at: until.toISOString() }, { onConflict: 'user_id' })
  }
  // what is older than 30 days goes
  await sb.from('roarstudio_events').delete().lt('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
  return { sent }
}
async function sendMail(to: string, subject: string, html: string, text: string): Promise<true | string> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 'email is not set up'
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [to], subject, html, text }) })
  if (r.ok) return true
  try { return (await r.json()).message || `error ${r.status}` } catch { return `error ${r.status}` }
}
const escH = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
function mailHtml(name: string, lines: any[]) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const rows = lines.map((l) => `<tr><td style="padding:14px 0;border-top:1px solid #2a2d33"><div style="font:600 15px ${font};color:#eef0f3">${escH(l.what)}</div><div style="font:13px ${font};color:#9aa1ab;margin-top:2px">${escH(l.pt)}</div>${l.body ? `<div style="font:14px ${font};color:#d6dbe1;margin-top:8px;padding:10px 12px;background:#22252a;border-radius:12px">${escH(l.body)}</div>` : ''}<a href="${l.link}" style="display:inline-block;margin-top:10px;padding:8px 16px;border-radius:999px;background:#6d28d9;color:#fff;text-decoration:none;font:600 13px ${font}">Open</a></td></tr>`).join('')
  return `<div style="background:#f3f3f1;padding:30px 12px"><table role="presentation" style="max-width:560px;margin:0 auto;background:#16181c;border-radius:22px;padding:26px" width="100%"><tr><td style="font:500 22px Jost,Futura,${font};color:#fff;padding-bottom:6px">RoarTransfer <b>Studio</b></td></tr><tr><td style="font:14px ${font};color:#9aa1ab;padding-bottom:6px">Hi ${escH(name || '')}, here is what happened.</td></tr>${rows}<tr><td style="font:12px ${font};color:#6b717a;padding-top:18px;border-top:1px solid #2a2d33">Change what you get in RoarTransfer Studio · Notifications.</td></tr></table></div>`
}
