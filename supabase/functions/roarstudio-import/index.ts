// RoarTransfer Studio: a song from a Suno link (Alex, 9 Nov 2026: "put a Suno link in the project and it plays there, no
// download and upload"). Suno does not let anyone take the audio file itself (its address answers "forbidden"), so the
// song is not copied: the Studio keeps a link item (a version with mime application/x-suno;id=<song id>) and plays it in
// Suno's own embedded player, with notes, versions and approvals beside it as for any file. The song must be public on Suno.
// Spotify too (Alex, 9 Nov): a track, album, playlist or episode link becomes a link item (application/x-spotify;type=…;id=…)
// played in Spotify's embedded player.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const isId = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)
const RANK = ['listener', 'commenter', 'editor', 'owner']
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' }
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

async function roleOf(uid: string, project: string) {
  if (!isId(project)) return null
  const { data: p } = await sb.from('roarstudio_projects').select('owner').eq('id', project).maybeSingle()
  if (!p) return null
  if (p.owner === uid) return 'owner'
  const { data: m } = await sb.from('roarstudio_members').select('role').eq('project_id', project).eq('user_id', uid).maybeSingle()
  return m?.role || null
}
const can = (role: string | null, need: string) => !!role && RANK.indexOf(role) >= RANK.indexOf(need)

// suno.com/song/<id>, suno.com/embed/<id>, suno.com/s/<short> (a redirect to the song), or the bare id
async function sunoId(link: string): Promise<string | null> {
  const u = String(link || '').trim()
  let m = u.match(UUID)
  if (m) return m[0].toLowerCase()
  if (!/^https:\/\/(www\.)?suno\.(com|ai)\/s\/[A-Za-z0-9]{4,40}\/?(\?.*)?$/.test(u)) return null
  const r = await fetch(u, { redirect: 'manual', headers: UA })
  m = (r.headers.get('location') || '').match(UUID)
  if (m) { await r.body?.cancel(); return m[0].toLowerCase() }
  const html = r.status === 200 ? await r.text() : ''
  m = html.match(/suno\.com\/song\/([0-9a-f-]{36})/i)
  return m ? m[1].toLowerCase() : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    let b: Record<string, any> = {}
    try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: who } = jwt && jwt.split('.').length === 3 ? await sb.auth.getUser(jwt) : { data: { user: null } }
    const uid = who?.user?.id
    if (!uid) return json({ error: 'signed-out' }, 401)

    // Spotify: open.spotify.com/<type>/<id> (or /intl-xx/…), spotify:<type>:<id>, or a spotify.link short link
    const spot = async (link: string) => {
      let u = String(link || '').trim()
      if (/^https:\/\/(spotify\.link|spoti\.fi)\//.test(u)) { const r = await fetch(u, { redirect: 'manual', headers: UA }); u = r.headers.get('location') || u; await r.body?.cancel() }
      const m = u.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{22})/) || u.match(/^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]{22})$/)
      return m ? { type: m[1], id: m[2] } : null
    }
    if ((b.action === 'link' || b.action === 'spotify') && /spotify/i.test(String(b.url || ''))) {
      const project = String(b.project || '')
      if (!can(await roleOf(uid, project), 'editor')) return json({ error: 'not allowed' }, 403)
      const sp = await spot(b.url)
      if (!sp) return json({ error: 'That is not a Spotify link. On Spotify press Share, Copy link (a song, an album or a playlist), and paste it here.' }, 400)
      let title = '', thumb = ''
      try {
        const o = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/${sp.type}/${sp.id}`)}`, { headers: UA })
        if (o.ok) { const j = await o.json(); title = String(j.title || '').trim().slice(0, 200); thumb = String(j.thumbnail_url || '') }
        else { await o.body?.cancel(); if (o.status === 404) return json({ error: 'Spotify does not know this link. Check it.' }, 404) }
      } catch (_) { /* the title is a nicety */ }
      title = title || 'Spotify ' + sp.type
      let track = isId(b.track) ? b.track : null
      if (track) { const { data: t } = await sb.from('roarstudio_tracks').select('id').eq('id', track).eq('project_id', project).maybeSingle(); track = t?.id || null }
      if (!track) {
        let folder: string | null = null
        if (isId(b.folder)) { const { data: f } = await sb.from('roarstudio_folders').select('id').eq('id', b.folder).eq('project_id', project).maybeSingle(); folder = f?.id || null }
        const { count } = await sb.from('roarstudio_tracks').select('id', { count: 'exact', head: true }).eq('project_id', project)
        const { data: t, error } = await sb.from('roarstudio_tracks').insert({ project_id: project, folder_id: folder, title, position: count || 0, created_by: uid }).select('id').single()
        if (error) return json({ error: error.message }, 500)
        track = t.id
      }
      const { data: v, error } = await sb.from('roarstudio_versions').insert({
        track_id: track, project_id: project, file_key: `spotify:${sp.type}:${sp.id}`, file_name: title, size: 0, mime: `application/x-spotify;type=${sp.type};id=${sp.id}`,
        label: 'Spotify', uploaded_by: uid,
      }).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ version: v, track, title, thumb })
    }

    if (b.action === 'suno' || b.action === 'link') {
      const project = String(b.project || '')
      if (!can(await roleOf(uid, project), 'editor')) return json({ error: 'not allowed' }, 403)
      const id = await sunoId(b.url)
      if (!id) return json({ error: 'That is not a Suno or Spotify link. Press Share, Copy link there, and paste it here.' }, 400)
      const r = await fetch(`https://studio-api.prod.suno.com/api/clip/${id}`, { headers: UA })
      if (!r.ok) { await r.body?.cancel(); return json({ error: 'Suno does not know this song. Check the link.' }, 404) }
      const c = await r.json()
      if (c.is_public === false || c.is_hidden || c.is_trashed) return json({ error: 'This song is private on Suno. Make it public there (Share) and add it again.' }, 400)
      const title = String(c.title || 'Suno song').trim().slice(0, 200) || 'Suno song'
      const duration = Number(c.metadata && c.metadata.duration) || null
      let track = isId(b.track) ? b.track : null
      if (track) { const { data: t } = await sb.from('roarstudio_tracks').select('id').eq('id', track).eq('project_id', project).maybeSingle(); track = t?.id || null }
      if (!track) {
        let folder: string | null = null
        if (isId(b.folder)) { const { data: f } = await sb.from('roarstudio_folders').select('id').eq('id', b.folder).eq('project_id', project).maybeSingle(); folder = f?.id || null }
        const { count } = await sb.from('roarstudio_tracks').select('id', { count: 'exact', head: true }).eq('project_id', project)
        const { data: t, error } = await sb.from('roarstudio_tracks').insert({ project_id: project, folder_id: folder, title, position: count || 0, created_by: uid }).select('id').single()
        if (error) return json({ error: error.message }, 500)
        track = t.id
      }
      const { data: v, error } = await sb.from('roarstudio_versions').insert({
        track_id: track, project_id: project, file_key: `suno:${id}`, file_name: title, size: 0, mime: `application/x-suno;id=${id}`,
        label: 'Suno', uploaded_by: uid, duration,
      }).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ version: v, track, title })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error(e)
    return json({ error: 'Could not reach Suno. Try again in a minute.' }, 502)
  }
})
