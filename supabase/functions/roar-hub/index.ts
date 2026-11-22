// RoarMe · Production Hub (Supabase Edge Function "roar-hub")
//
// Alex (22 Nov 2026): "the key goes in RoarMe's Settings, Production Hub; every group in PROJECTS is a project of the
// hub; a project made in the hub makes a chat here, a project made here makes one in the hub". The key (made in the
// hub: Settings > Integrations > Connected apps) is kept per account in roar_hub_accounts; each project group is tied
// to one hub project in roar_hub_links (supabase/hub-link.sql). Actions:
//   connect { key } / disconnect           this account's Production Hub (disconnect unties its groups; the hub keeps all)
//   linkall                               ties every project group I run to a hub project (same title, or a new one) and
//                                         makes a group for every hub project made since I connected that has none
//   link { room }                         ties one project group (Make It a Project)
//   sync { room }                         both ways, for one group: title, stage, shoot day, category, tasks, locations
//   (pg_cron, x-roar-cron)                every minute, for every linked account: a group for each hub project whose
//                                         Create PROject was pressed, or that was made in the hub since linking, and a
//                                         sync of every tied project the hub changed since its last sync (live both ways)
// What changed on which side since the last sync decides (base hashes in roar_hub_links.base); when both changed the
// same thing, RoarMe's wins. verify_jwt off: the function checks the sign-in, or pg_cron's Vault secret, itself.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2'

const HUB = 'https://naibamqexcqnqhbbqafa.supabase.co/functions/v1/hub-bridge'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const hubCall = async (key: string, body: any) => {
  const r = await fetch(HUB, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-key': key }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `The hub answered ${r.status}`)
  return j
}
const IMG = /\.(jpe?g|png|webp|gif)$/i
const uid = () => crypto.randomUUID()
const hashOf = (o: any) => JSON.stringify(o)
const norm = (t: string) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[–—-]+/g, '-').replace(/\s+/g, ' ').trim()

// RoarMe's stage names and the hub's statuses
const STAGE_TO_HUB: Record<string, string> = { shooting: 'Production' }
const HUB_TO_STAGE: Record<string, string> = { production: 'Shooting' }
const DEFAULT_STAGES = [{ id: 'dev', name: 'Development' }, { id: 'prep', name: 'Pre-production' }, { id: 'shoot', name: 'Shooting' }, { id: 'post', name: 'Post-production' }, { id: 'done', name: 'Delivered' }]

// the parts both sides keep, the same shape on both, so a hash says whether it changed
const taskCommon = (t: any) => ({ t: String(t.t || '').slice(0, 300), s: ['todo', 'doing', 'blocked', 'done'].includes(t.s) ? t.s : 'todo', due: t.due || '', pri: t.pri || 'normal', subs: (t.subs || []).map((x: any) => ({ id: x.id, t: x.t, d: !!x.d })) })
const fromHubTask = (h: any) => taskCommon({ t: h.title, s: h.status, due: h.due, pri: h.priority, subs: (h.subtasks || []).map((x: any) => ({ id: x.id, t: x.title, d: x.done })) })
const locCommon = (l: any) => ({ name: l.name || '', address: l.address || l.addr || '', type: l.type || 'Interior', contact: l.contact || '', phone: l.phone || '', notes: l.notes || '', mapsUrl: l.mapsUrl || '' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // pg_cron, every minute (supabase/hub-link.sql 'roar-hub-pull'): with the Vault secret, no sign-in
  const cronKey = req.headers.get('x-roar-cron') || ''
  const isCron = !!cronKey && (await db.rpc('roar_cron_ok', { s: cronKey })).data === true
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const me = isCron ? '' : (await db.auth.getUser(jwt)).data?.user?.id
  if (!me && !isCron) return json({ error: 'Sign in first' }, 401)
  let body: any
  try { body = await req.json() } catch { return json({ error: 'Nothing sent' }, 400) }
  const action = String(body?.action || '')

  const accountOf = async (user: string) => (await db.from('roar_hub_accounts').select('*').eq('user_id', user).maybeSingle()).data

  /* ---------- one group, both ways ---------- */
  async function syncRoom(room: string) {
    const { data: link } = await db.from('roar_hub_links').select('*').eq('room_id', room).maybeSingle()
    if (!link?.hub_project) return { linked: false }
    const acc = await accountOf(link.owner)
    if (!acc) return { linked: false, error: 'The Production Hub of who tied this project is not connected any more.' }
    const key = acc.hub_key
    const { data: proj } = await db.from('roar_pro_projects').select('*').eq('room_id', room).maybeSingle()
    if (!proj) return { linked: false }
    const { data: rm } = await db.from('roar_rooms').select('title').eq('id', room).maybeSingle()
    const { data: mem } = await db.from('roar_members').select('user_id').eq('room_id', room)
    const ids = (mem || []).map((m: any) => m.user_id)
    const { data: profs } = ids.length ? await db.from('roar_profiles').select('id, display_name, username').in('id', ids) : { data: [] }
    const nameOf = (id: string) => { const p = (profs || []).find((x: any) => x.id === id); return p ? (p.display_name || p.username || '') : '' }
    const byName = (n: string) => (profs || []).find((x: any) => n && norm(x.display_name || x.username) === norm(n))?.id
    let hub: any
    try { hub = (await hubCall(key, { action: 'project.get', id: link.hub_project })).project } catch (e) {
      await db.from('roar_hub_links').update({ last_error: (e as Error).message, last_sync_at: new Date().toISOString() }).eq('room_id', room)
      return { linked: true, error: (e as Error).message }
    }
    const base = link.base || {}
    const first = !link.last_sync_at
    const stages = Array.isArray(proj.stages) && proj.stages.length ? proj.stages : DEFAULT_STAGES
    const stageName = (stages.find((s: any) => s.id === proj.status) || stages[0])?.name || ''
    const toHubStatus = (n: string) => STAGE_TO_HUB[norm(n)] || n
    const toStageId = (hs: string) => { const n = norm(HUB_TO_STAGE[norm(hs)] || hs); return stages.find((s: any) => norm(s.name) === n)?.id }
    const fields: any[] = Array.isArray(proj.fields) ? proj.fields : []
    const cat = fields.find((f) => f.k === 'Category')?.v || ''

    // the four plain things: hub wins on the first sync when it has a value, after that what changed since the last one
    const R: any = { title: rm?.title || '', status: toHubStatus(stageName), startDate: proj.due || '', category: cat }
    const H: any = { title: hub.title || '', status: hub.status || '', startDate: hub.startDate || '', category: hub.category || '' }
    const F: any = {}
    for (const k of Object.keys(R)) {
      const b = base.f?.[k]
      if (R[k] === H[k]) F[k] = R[k]
      else if (first) F[k] = H[k] || R[k]
      else if (R[k] === b) F[k] = H[k]
      else F[k] = R[k]
    }

    // a list, item by item: what is new on one side goes to the other, what one side took away leaves the other
    const merge = (rItems: any[], hItems: any[], rC: (x: any) => any, hC: (x: any) => any, b: Record<string, string> = {}) => {
      const rm: Record<string, any> = Object.fromEntries(rItems.map((x) => [x.id, x]))
      const hm: Record<string, any> = Object.fromEntries(hItems.map((x) => [x.id, x]))
      const order = [...rItems.map((x) => x.id), ...hItems.map((x) => x.id).filter((id) => !rm[id])]
      const out: { id: string; c: any; r?: any; h?: any }[] = []
      for (const id of order) {
        const r = rm[id], h = hm[id]
        if (r && h) {
          const rc = rC(r), hc = hC(h)
          const c = hashOf(rc) === hashOf(hc) ? rc : hashOf(rc) === b[id] ? hc : rc
          out.push({ id, c, r, h })
        } else if (r) { if (!b[id]) out.push({ id, c: rC(r), r }) } // new here, or taken away in the hub
        else if (h) { if (!b[id]) out.push({ id, c: hC(h), h }) } // new in the hub, or taken away here
      }
      return out
    }

    const tasks = merge(Array.isArray(proj.tasks) ? proj.tasks : [], Array.isArray(hub.tasks) ? hub.tasks : [], taskCommon, fromHubTask, base.t)
    const roarTasks = tasks.map(({ id, c, r, h }) => {
      const who = r?.who?.length ? r.who : (h?.assignee && byName(h.assignee) ? [byName(h.assignee)] : undefined)
      return { ...(r || {}), id, t: c.t, s: c.s, ...(c.due ? { due: c.due } : { due: undefined }), ...(c.pri !== 'normal' ? { pri: c.pri } : { pri: undefined }), ...(c.subs.length ? { subs: c.subs } : { subs: undefined }), ...(who ? { who } : {}) }
    })
    const hubTasks = tasks.map(({ id, c, r, h }) => {
      const who = r?.who?.[0]
      return { dept: 'Production', notes: '', createdAt: new Date().toISOString(), doneAt: '', assignee: '', assigneeId: '', ...(h || {}), id, projectId: link.hub_project, title: c.t, status: c.s, due: c.due, priority: c.pri, subtasks: c.subs.map((x: any) => ({ id: x.id, title: x.t, done: x.d })), ...(who && nameOf(who) ? { assignee: nameOf(who), ...(h?.assignee === nameOf(who) ? {} : { assigneeId: '' }) } : {}), ...(c.s === 'done' && !h?.doneAt ? { doneAt: new Date().toISOString() } : {}) }
    })

    // locations: a scout here is a location of the hub's project, with an entry in the hub's library for its photos
    const scouts: any[] = Array.isArray(proj.scouts) ? proj.scouts : []
    const locs = merge(scouts, Array.isArray(hub.locations) ? hub.locations : [], locCommon, locCommon, base.l)
    const roarScouts = locs.map(({ id, c, r, h }) => ({ st: 'option', tags: [], photos: [], ...(r || {}), ...(h && !r ? { lat: h.lat || '', lon: h.lon || '', fromHub: true } : {}), id, ...c }))
    const hubLocs: any[] = []
    for (const { id, c, r, h } of locs) {
      let libraryId = h?.libraryId || ''
      if (r && !r.fromHub) {
        const photos: any[] = []
        for (const p of (Array.isArray(r.photos) ? r.photos : []).slice(0, 40)) {
          const path = p?.small || p?.path
          if (!path || p?.url || !(IMG.test(path) || /^image\//.test(p?.type || ''))) continue
          const { data: s } = await db.storage.from('roar-files').createSignedUrl(path, 600)
          if (s?.signedUrl) photos.push({ id: String(p.path).split('/').pop()!.slice(0, 40), url: s.signedUrl })
        }
        try {
          const put = await hubCall(key, { action: 'location.put', ext: `${room}:${id}`, photos, from: { app: 'roarme', project: F.title }, loc: { ...c, lat: r.lat, lon: r.lon, tags: r.tags } })
          libraryId = put.id || libraryId
        } catch { /* the project's own entry still goes */ }
      }
      hubLocs.push({ lat: '', lon: '', sceneLocations: [], ...(h || {}), id, ...c, ...(libraryId ? { libraryId, libraryMissing: false } : {}) })
    }
    // a scout taken out here: its library entry, if RoarMe made it, leaves the hub too
    for (const id of Object.keys(base.l || {})) if (!locs.some((x) => x.id === id)) { try { await hubCall(key, { action: 'location.delete', ext: `${room}:${id}` }) } catch { /* next time */ } }

    // write both sides, only what changed
    const hubSet: any = {}
    for (const k of Object.keys(F)) if (F[k] !== H[k]) hubSet[k] = F[k]
    const tasksChanged = hashOf(hubTasks.map(fromHubTask)) !== hashOf((hub.tasks || []).map(fromHubTask)) || hubTasks.length !== (hub.tasks || []).length
    const locsChanged = hashOf(hubLocs.map(locCommon)) !== hashOf((hub.locations || []).map(locCommon)) || hubLocs.some((x, i) => x.libraryId !== hub.locations?.[i]?.libraryId)
    if (Object.keys(hubSet).length || tasksChanged || locsChanged || hub.roarme?.room !== room) {
      await hubCall(key, { action: 'project.put', id: link.hub_project, set: { ...hubSet, roarme: { room } }, ...(tasksChanged ? { tasks: hubTasks } : {}), ...(locsChanged ? { locations: hubLocs } : {}) })
    }
    const roarPatch: any = {}
    if (hashOf(roarTasks) !== hashOf(proj.tasks || [])) roarPatch.tasks = roarTasks
    if (hashOf(roarScouts) !== hashOf(scouts)) roarPatch.scouts = roarScouts
    if (F.startDate !== (proj.due || '')) roarPatch.due = F.startDate || null
    if (F.status !== R.status) { const sid = toStageId(F.status); if (sid) roarPatch.status = sid }
    if (F.category !== cat) roarPatch.fields = fields.some((f) => f.k === 'Category') ? fields.map((f) => (f.k === 'Category' ? { ...f, v: F.category } : f)) : [...fields, { k: 'Category', v: F.category }]
    if (Object.keys(roarPatch).length) await db.from('roar_pro_projects').update(roarPatch).eq('room_id', room)
    if (F.title && F.title !== R.title) await db.from('roar_rooms').update({ title: F.title }).eq('id', room)

    const nextBase = {
      hu: hub.updatedAt || '',
      f: F,
      t: Object.fromEntries(tasks.map((x) => [x.id, hashOf(x.c)])),
      l: Object.fromEntries(locs.map((x) => [x.id, hashOf(x.c)])),
    }
    await db.from('roar_hub_links').update({ base: nextBase, last_sync_at: new Date().toISOString(), last_error: null, synced: locs.map((x) => x.id) }).eq('room_id', room)
    return { linked: true, hub: acc.hub_name, code: hub.code || '' }
  }

  /* ---------- tie one project group to a hub project ---------- */
  async function linkRoom(room: string, acc: any, list?: any[]) {
    const { data: rm } = await db.from('roar_rooms').select('title, kind').eq('id', room).maybeSingle()
    if (rm?.kind !== 'group') return null
    const { data: proj } = await db.from('roar_pro_projects').select('room_id, status, due, stages, fields').eq('room_id', room).maybeSingle()
    if (!proj) return null
    const projects = list || (await hubCall(acc.hub_key, { action: 'projects.list' })).projects
    const { data: taken } = await db.from('roar_hub_links').select('hub_project').not('hub_project', 'is', null)
    const used = new Set((taken || []).map((x: any) => x.hub_project))
    let match = projects.find((p: any) => p.room === room) || projects.find((p: any) => !used.has(p.id) && !p.room && norm(p.title) === norm(rm.title || ''))
    let pid = match?.id
    if (!pid) {
      const stages = Array.isArray(proj.stages) && proj.stages.length ? proj.stages : DEFAULT_STAGES
      const sn = (stages.find((s: any) => s.id === proj.status) || stages[0])?.name || 'Development'
      const made = await hubCall(acc.hub_key, { action: 'project.create', title: rm.title, status: STAGE_TO_HUB[norm(sn)] || sn, startDate: proj.due || '', category: (proj.fields || []).find((f: any) => f.k === 'Category')?.v || '', room })
      pid = made.id
    }
    await db.from('roar_hub_links').upsert({ room_id: room, owner: acc.user_id, hub_project: pid, hub_name: acc.hub_name, set_by: acc.user_id, set_at: new Date().toISOString(), base: {}, last_sync_at: null, last_error: null })
    return pid
  }

  // a group for a hub project, its owner the account that holds the key (a project made in the hub after linking, or
  // one whose Create PROject was pressed there)
  async function makeGroup(acc: any, p: any) {
    const { data: room, error } = await db.from('roar_rooms').insert({ kind: 'group', title: p.title || 'Project', created_by: acc.user_id }).select('id').single()
    if (error || !room) return false
    await db.from('roar_members').insert({ room_id: room.id, user_id: acc.user_id, role: 'admin' })
    await db.from('roar_pro_projects').insert({ room_id: room.id, status: 'dev', due: p.startDate || null, fields: [] })
    await db.from('roar_hub_links').upsert({ room_id: room.id, owner: acc.user_id, hub_project: p.id, hub_name: acc.hub_name, set_by: acc.user_id, set_at: new Date().toISOString(), base: {} })
    try { await syncRoom(room.id) } catch { /* next time */ }
    return true
  }
  const wanted = (acc: any, p: any, taken: Set<string>) => !taken.has(p.id) && !p.room && ((p.request && !p.delivered) || (p.createdAt && p.createdAt >= acc.set_at))

  try {
    if (action === 'connect') {
      const key = String(body?.key || '').trim()
      if (!/^tmlhub_[0-9a-f]{48}$/.test(key)) return json({ error: 'That does not look like a hub key. It starts with tmlhub_.' }, 400)
      const hello = await hubCall(key, { action: 'hello' })
      await db.from('roar_hub_accounts').upsert({ user_id: me, hub_key: key, hub_name: String(hello.workspace || 'Hub').slice(0, 80), set_at: new Date().toISOString() })
      body.action = 'linkall'
    } else if (action === 'disconnect') {
      await db.from('roar_hub_links').delete().eq('owner', me)
      await db.from('roar_hub_accounts').delete().eq('user_id', me)
      return json({ ok: true })
    }

    if (isCron) {
      // every linked account: a group for each hub project that asked for one (Create PROject) or was made since linking
      const { data: accs } = await db.from('roar_hub_accounts').select('*')
      let made = 0, synced = 0
      for (const acc of accs || []) {
        try {
          const projects = (await hubCall(acc.hub_key, { action: 'projects.list' })).projects || []
          const taken = new Set(((await db.from('roar_hub_links').select('hub_project')).data || []).map((x: any) => x.hub_project))
          for (const p of projects) if (wanted(acc, p, taken) && await makeGroup(acc, p)) { taken.add(p.id); made++ }
          // live from the hub too (Alex, 22 Nov: "what I delete in the hub goes in RoarMe, and back"): every tied project
          // the hub changed since its last sync is synced now, whether RoarMe is open or not
          const byId = Object.fromEntries(projects.map((p: any) => [p.id, p]))
          const { data: links } = await db.from('roar_hub_links').select('room_id, hub_project, base').eq('owner', acc.user_id).not('hub_project', 'is', null)
          for (const l of links || []) {
            const p = byId[l.hub_project]
            if (!p) { await db.from('roar_hub_links').update({ last_error: 'This project is not in the hub any more.' }).eq('room_id', l.room_id); continue }
            if (p.updatedAt && p.updatedAt !== l.base?.hu) { try { await syncRoom(l.room_id); synced++ } catch { /* next minute */ } }
          }
        } catch { /* that hub next minute */ }
      }
      return json({ ok: true, made, synced })
    }

    if (body.action === 'linkall') {
      const acc = await accountOf(me)
      if (!acc) return json({ ok: true, linked: false })
      const projects = (await hubCall(acc.hub_key, { action: 'projects.list' })).projects || []
      // my project groups not tied yet
      const { data: mine } = await db.from('roar_members').select('room_id').eq('user_id', me).eq('role', 'admin')
      const rooms = (mine || []).map((m: any) => m.room_id)
      const { data: projRows } = rooms.length ? await db.from('roar_pro_projects').select('room_id').in('room_id', rooms) : { data: [] }
      const { data: links } = await db.from('roar_hub_links').select('room_id, hub_project')
      const tied = new Set((links || []).filter((l: any) => l.hub_project).map((l: any) => l.room_id))
      let made = 0, joined = 0
      for (const r of (projRows || []).map((x: any) => x.room_id).filter((r: string) => !tied.has(r))) {
        try { if (await linkRoom(r, acc, projects)) { joined++; await syncRoom(r) } } catch { /* next time */ }
      }
      // hub projects made since I connected, with no group: a group for each
      const taken = new Set(((await db.from('roar_hub_links').select('hub_project')).data || []).map((x: any) => x.hub_project))
      for (const p of projects) if (wanted(acc, p, taken) && await makeGroup(acc, p)) { taken.add(p.id); made++ }
      return json({ ok: true, linked: true, hub: acc.hub_name, joined, made })
    }

    const room = String(body?.room || '')
    if (!/^[0-9a-f-]{36}$/.test(room)) return json({ error: 'No chat' }, 400)
    const { data: mem } = await db.from('roar_members').select('role').eq('room_id', room).eq('user_id', me).maybeSingle()
    if (!mem) return json({ error: 'You are not in this chat' }, 403)
    if (action === 'link') {
      const acc = await accountOf(me)
      if (!acc) return json({ ok: true, linked: false })
      const { data: l } = await db.from('roar_hub_links').select('hub_project').eq('room_id', room).maybeSingle()
      if (!l?.hub_project) await linkRoom(room, acc)
      return json({ ok: true, ...(await syncRoom(room)) })
    }
    if (action === 'sync') return json({ ok: true, ...(await syncRoom(room)) })
    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 400)
  }
})
