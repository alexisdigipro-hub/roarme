// RoarMe · a project's link to a TML Hub (Supabase Edge Function "roar-hub")
//
// Alex (22 Nov 2026): "every location made in RoarMe goes straight into the hub". The hub's key (made in the hub:
// Settings > Integrations > Connected apps) is kept in roar_hub_links (supabase/hub-link.sql), read only here.
//   connect { room, key }   a group admin: checks the key with the hub (hello), keeps it, sends every location
//   disconnect { room }     a group admin: forgets the key (what is in the hub stays there)
//   sync { room }           any member: sends the project's Location Scout to the hub's locations; a place taken
//                           out of Location Scout is taken out of the hub too
// Photos go as links signed for ten minutes, which the hub copies. verify_jwt on.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const HUB = 'https://naibamqexcqnqhbbqafa.supabase.co/functions/v1/hub-bridge'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const hub = async (key: string, body: any) => {
  const r = await fetch(HUB, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-key': key }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `The hub answered ${r.status}`)
  return j
}
const IMG = /\.(jpe?g|png|webp|gif)$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = await db.auth.getUser(jwt)
  const me = u?.user?.id
  if (!me) return json({ error: 'Sign in first' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Nothing sent' }, 400) }
  const room = String(body?.room || '')
  if (!/^[0-9a-f-]{36}$/.test(room)) return json({ error: 'No chat' }, 400)
  const { data: mem } = await db.from('roar_members').select('role').eq('room_id', room).eq('user_id', me).maybeSingle()
  if (!mem) return json({ error: 'You are not in this chat' }, 403)
  const action = String(body?.action || '')

  if (action === 'connect' || action === 'disconnect') {
    if (mem.role !== 'admin') return json({ error: 'Only an admin of the group can link it to a hub' }, 403)
    if (action === 'disconnect') { await db.from('roar_hub_links').delete().eq('room_id', room); return json({ ok: true }) }
    const key = String(body?.key || '').trim()
    if (!/^tmlhub_[0-9a-f]{48}$/.test(key)) return json({ error: 'That does not look like a hub key. It starts with tmlhub_.' }, 400)
    let hello: any
    try { hello = await hub(key, { action: 'hello' }) } catch (e) { return json({ error: (e as Error).message }, 400) }
    await db.from('roar_hub_links').upsert({ room_id: room, hub_key: key, hub_name: String(hello.workspace || 'Hub').slice(0, 80), set_by: me, set_at: new Date().toISOString(), last_error: null })
  } else if (action !== 'sync') return json({ error: 'Unknown action' }, 400)

  // sync (also right after connect)
  const { data: link } = await db.from('roar_hub_links').select('*').eq('room_id', room).maybeSingle()
  if (!link) return json({ ok: true, linked: false })
  const { data: proj } = await db.from('roar_pro_projects').select('scouts').eq('room_id', room).maybeSingle()
  const { data: rm } = await db.from('roar_rooms').select('title').eq('id', room).maybeSingle()
  const scouts: any[] = Array.isArray(proj?.scouts) ? proj!.scouts : []
  const sent: string[] = []
  let err = ''
  for (const x of scouts.slice(0, 300)) {
    if (!x?.id) continue
    const photos: any[] = []
    for (const p of (Array.isArray(x.photos) ? x.photos : []).slice(0, 40)) {
      const path = p?.small || p?.path
      if (!path || !(IMG.test(path) || /^image\//.test(p?.type || ''))) continue
      const { data: s } = await db.storage.from('roar-files').createSignedUrl(path, 600)
      if (s?.signedUrl) photos.push({ id: String(p.path).split('/').pop()!.slice(0, 40), url: s.signedUrl })
    }
    try {
      await hub(link.hub_key, {
        action: 'location.put', ext: `${room}:${x.id}`, photos, from: { app: 'roarme', project: rm?.title || '' },
        loc: { name: x.name, address: x.address || x.addr, type: x.type, contact: x.contact, phone: x.phone, notes: x.notes, mapsUrl: x.mapsUrl, lat: x.lat, lon: x.lon, tags: x.tags },
      })
      sent.push(String(x.id))
    } catch (e) { err = (e as Error).message; if (/key/i.test(err)) break }
  }
  if (!err) {
    for (const gone of (link.synced || []).filter((id: string) => !sent.includes(id))) {
      try { await hub(link.hub_key, { action: 'location.delete', ext: `${room}:${gone}` }) } catch { /* tried again next time */ }
    }
  }
  const keep = err ? [...new Set([...(link.synced || []), ...sent])] : sent
  await db.from('roar_hub_links').update({ synced: keep, last_sync_at: new Date().toISOString(), last_error: err || null }).eq('room_id', room)
  return json({ ok: !err, linked: true, hub: link.hub_name, sent: sent.length, error: err || undefined })
})
