import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar, CropModal, I, Lens, Modal } from './ui.jsx'
import { AUDIO_EXT, mmss, player, shapeOf, usePlayer } from './player.jsx'
import { errText, fileLink, nameOf, picLink, shrinkImage, supabase } from './lib.js'
import { inApp } from './push.js'
import { getPrefs, setPrefs, usePrefs } from './prefs.js'

const PollCard = lazy(() => import('./poll.jsx').then((m) => ({ default: m.PollCard })))
const PdfView = lazy(() => import('./pdfview.jsx').then((m) => ({ default: m.PdfView })))

/* RoarMe Pro (Alex, 22 Nov, from the sample https://claude.ai/artifact/HzxD32EAhTGsWVS7QPs4dT, "Pro grouped"): the same
   chat, with a group able to be a project. Only on the website on a computer for now (not the iPhone app, not the Mac
   apps). The chat list stays the chat list (Projects and Direct join its folders, a project shows its stage); the open
   chat keeps everything it has, and a panel at its right holds the project: stage, due date, brief, fields, its files in
   folders and its tasks. Turning Pro off hides all of this; the rows in roar_pro_projects stay (supabase/pro.sql). */

// everywhere: the website, the computer apps and the iPhone app (Alex, 22 Nov: "put it out everywhere")
export const proOk = () => typeof window !== 'undefined'
// a screen too narrow for the chat and the workspace side by side: they become two pages (Alex, 22 Nov, version B)
const NARROW = '(max-width: 960px)'
function useNarrow() {
  const [n, setN] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => { const q = window.matchMedia(NARROW); const f = () => setN(q.matches); q.addEventListener('change', f); return () => q.removeEventListener('change', f) }, [])
  return n
}

// a project's stages: these to start, renamed, added or taken away per project (Alex, 22 Nov: "the names will change")
export const DEFAULT_STAGES = [{ id: 'dev', name: 'Development', c: '#8a8f98' }, { id: 'prep', name: 'Pre-production', c: '#d48806' }, { id: 'shoot', name: 'Shooting', c: '#e5483f' }, { id: 'post', name: 'Post-production', c: '#7b4dff' }, { id: 'done', name: 'Delivered', c: '#14a37f' }]
const STAGE_COLOURS = ['#8a8f98', '#d48806', '#e5483f', '#7b4dff', '#14a37f', '#3a8ee6', '#d6338a', '#0f6e7a']
export const stagesOf = (p) => (Array.isArray(p?.stages) && p.stages.length ? p.stages : DEFAULT_STAGES)
export const stageOf = (p) => stagesOf(p).find((s) => s.id === p?.status) || stagesOf(p)[0]
export const ProChip = ({ p }) => { const s = stageOf(p); return <span className="prj-chip" style={{ '--pc': s.c }}>{s.name}</span> }

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
// a project's first facts (Alex, 22 Nov: "artist / client, apart title, apart category"; Budget stays); Add Field adds more
const FIELD_START = ['Artist / Client', 'Title', 'Category', 'Budget']
const CATEGORIES = ['Music Video', 'Commercial', 'Feature Film', 'Short Film', 'Documentary', 'TV Series', 'Branded Content', 'Photoshoot', 'Live Event']

// every project I can see, live
export function useProjects(me, on) {
  const [map, setMap] = useState({})
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('roar_pro_projects').select('*')
    if (!error) setMap(Object.fromEntries((data || []).map((p) => [p.room_id, p])))
  }, [])
  useEffect(() => {
    if (!on) return undefined
    load()
    const ch = supabase.channel(`roar-pro-projects-${me.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_pro_projects' }, (ev) => {
        if (ev.eventType === 'DELETE') setMap((m) => { const n = { ...m }; delete n[ev.old.room_id]; return n })
        else if (ev.new?.room_id) setMap((m) => ({ ...m, [ev.new.room_id]: ev.new }))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [on, me.id, load])
  const save = useCallback(async (roomId, patch) => {
    setMap((m) => ({ ...m, [roomId]: { ...(m[roomId] || {}), room_id: roomId, ...patch } }))
    const { data, error } = await supabase.from('roar_pro_projects').upsert({ room_id: roomId, ...patch }, { onConflict: 'room_id' }).select().single()
    if (error) { load(); throw error }
    setMap((m) => ({ ...m, [roomId]: data }))
    return data
  }, [load])
  const remove = useCallback(async (roomId) => {
    const { error } = await supabase.from('roar_pro_projects').delete().eq('room_id', roomId)
    if (error) throw error
    setMap((m) => { const n = { ...m }; delete n[roomId]; return n })
  }, [])
  return { map, save, remove, reload: load }
}

/* ---------- files in folders ---------- */
const EXT = (f) => ((f?.name || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase() || ''
const DOCS = /^(pdf|docx?|pages|txt|rtf|odt|xlsx?|numbers|csv|pptx?|key|fdx|fountain|celtx|md)$/
const folderOf = (m) => {
  const f = m.file || {}, t = f.type || '', e = EXT(f)
  if (m.kind === 'image' || /^image\//.test(t) || /^(jpe?g|png|heic|webp|gif|tiff?|dng|raw|psd)$/.test(e)) return 'photos'
  if (/^video\//.test(t) || /^(mov|mp4|m4v|avi|mkv|mxf|braw|r3d)$/.test(e)) return 'videos'
  if (/^audio\//.test(t) || /^(wav|mp3|m4a|aiff?|flac|ogg)$/.test(e)) return 'audio'
  if (DOCS.test(e) || /pdf|word|text|sheet|presentation/.test(t)) return 'docs'
  return 'other'
}
// what goes to the side in a project (Alex, 22 Nov: "voice stays in the chat, all the rest and the maps too go to the
// right"): photos, videos, round videos, documents, sound files, places, live locations, polls and contacts. Text, voice
// messages, call cards, scheduled calls and locked messages stay in the chat.
export const isAsset = (m) => {
  const f = m.file
  if (!f || m.kind === 'voice') return false
  if ((m.kind === 'image' || m.kind === 'file') && f.path) return true
  // a scheduled meeting stays in the chat as its card (tap it to join) and is listed in Calls & Meetings too (Alex, 22 Nov)
  return !!(f.location || f.live || f.poll || f.contact || f.groupcall)
}
// the tabs things go to, with the words for one and for many (the line left in the chat)
export const ASIDE_TABS = { media: ['Media', 'photo or video', 'photos and videos'], files: ['Files', 'file', 'files'], music: ['Music', 'song or sound', 'songs and sounds'], places: ['Places', 'place', 'places'], polls: ['Polls', 'poll', 'polls'], contacts: ['Contacts', 'contact', 'contacts'], calls: ['Calls', 'call', 'calls'] }
// which tab of the project a message went to
export const asideTab = (m) => {
  const f = m.file || {}
  if (f.groupcall || f.event) return 'calls'
  if (f.location || f.live) return 'places'
  if (f.poll) return 'polls'
  if (f.contact) return 'contacts'
  return isMediaMsg(m) ? 'media' : 'files'
}
const isFileMsg = (m) => (m.kind === 'image' || m.kind === 'file') && !!m.file?.path && !m.file.groupcall
const isMediaMsg = (m) => isFileMsg(m) && (folderOf(m) === 'photos' || folderOf(m) === 'videos')
const FOLDERS = [['docs', 'Documents'], ['photos', 'Photos'], ['videos', 'Videos'], ['audio', 'Audio'], ['other', 'Other']]
const tagOf = (m) => (EXT(m.file) || (m.kind === 'image' ? 'jpg' : 'file')).slice(0, 4).toUpperCase()
const sizeText = (n) => (!n ? '' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

function useRoomFiles(roomId) {
  const [files, setFiles] = useState(null)
  useEffect(() => {
    let gone = false, timer = 0
    setFiles(null)
    const load = () => supabase.from('roar_messages').select('id, user_id, kind, body, file, created_at').eq('room_id', roomId).not('file', 'is', null)
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(500)
      .then(({ data }) => { if (!gone) setFiles((data || []).filter(isAsset)) })
    load()
    // what is sent or deleted while the panel is open shows here at once
    const ch = supabase.channel(`pro-files-${roomId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_messages', filter: `room_id=eq.${roomId}` }, () => { clearTimeout(timer); timer = setTimeout(load, 700) })
      .subscribe()
    return () => { gone = true; clearTimeout(timer); supabase.removeChannel(ch) }
  }, [roomId])
  return files
}

function Thumb({ m }) {
  const [src, setSrc] = useState('')
  const pic = folderOf(m) === 'photos' || m.file?.thumb
  useEffect(() => {
    let gone = false
    if (pic) picLink(m.file).then((u) => { if (!gone && u) setSrc(u) }).catch(() => {})
    return () => { gone = true }
  }, [m.id])
  return <i className={`prj-tag prj-k-${folderOf(m)}`}>{src ? <img src={src} alt="" /> : tagOf(m)}</i>
}

async function openFile(m) {
  // the computer apps open a link in the browser themselves; a blank window first would go nowhere there
  if (window.roarDesktop) { const u = await fileLink(m.file).catch(() => ''); if (u) window.open(u, '_blank'); return }
  const w = window.open('', '_blank')
  try {
    const u = await fileLink(m.file)
    if (w) w.location.href = u; else window.location.assign(u)
  } catch { if (w) w.close() }
}
function Files({ files, onJump, aside = false }) {
  const [open, setOpen] = useState('')
  if (!files) return <p className="prj-quiet">Loading…</p>
  files = files.filter(isFileMsg)
  if (!files.length) return <p className="prj-quiet">Nothing shared yet. Files and photos sent here gather in folders.</p>
  const by = Object.fromEntries(FOLDERS.map(([k]) => [k, files.filter((m) => folderOf(m) === k)]))
  return (
    <div className="prj-folders">
      {FOLDERS.filter(([k]) => by[k].length).map(([k, label]) => (
        <div key={k} className={`prj-folder${open === k ? ' open' : ''}`}>
          <button type="button" className="prj-frow" onClick={() => setOpen(open === k ? '' : k)}>
            <span className={`prj-fico prj-k-${k}`}>{I.folder}</span><b>{label}</b><small>{by[k].length}</small><span className="prj-car">{I.right}</span>
          </button>
          {open === k && (
            <div className="prj-flist">
              {by[k].slice(0, 60).map((m) => (
                <button key={m.id} type="button" className="prj-file" onClick={() => (aside ? openFile(m) : onJump(m.id))} title={aside ? 'Open' : 'Show in chat'}>
                  <Thumb m={m} /><span className="prj-ftext"><b>{m.file.name || (m.kind === 'image' ? 'Photo' : 'File')}</b>{aside && m.body?.trim() && <em>{m.body.trim()}</em>}<small>{[sizeText(m.file.size), new Date(m.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------- places, polls and contacts at the side ---------- */
// a place opens in Google Maps (Alex, 22 Nov)
const mapUrl = (l) => `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`
// a link to a map (Alex, 22 Nov: "Google Maps links, like https://maps.app.goo.gl/…, go to Places; the link stays in the chat")
const MAP_RX = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|(www\.)?openstreetmap\.org)/i
export const isMapLink = (u) => MAP_RX.test(u)
const mapName = (u) => {
  const m = u.match(/\/place\/([^/@?]+)/) || u.match(/[?&]q=([^&]+)/)
  if (m) { try { return decodeURIComponent(m[1].replace(/\+/g, ' ')) } catch { /* left as it is */ } }
  return /apple/i.test(u) ? 'Apple Maps' : /openstreetmap/i.test(u) ? 'OpenStreetMap' : 'Google Maps'
}
// a small bin on most things in the workspace (Alex, 22 Nov: "a small bin, it asks twice, and it deletes")
const Trash = ({ onClick, className = '' }) => (onClick ? <button type="button" className={`round prw-trash ${className}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick() }} title="Delete" aria-label="Delete">{I.trash}</button> : null)
// a button at the right of a map link or a place: Add to Location Scout (Alex, 22 Nov), or Added once it is there
const AddScout = ({ onAdd, has }) => (onAdd ? <button type="button" className={`pill-btn prw-addscout${has ? ' done' : ''}`} disabled={has} onClick={onAdd}>{has ? I.check : I.plus}<span>{has ? 'In Location Scout' : 'Add to Location Scout'}</span></button> : null)
function Places({ list, maps = [], people = {}, me, onAdd, hasUrl = () => false, onDrop }) {
  return (
    <div className="prj-list">
      {maps.map(({ u, m }, i) => (
        <div key={`${m.id}-${i}`} className="prw-link">
          <a className="prj-row" href={u} target="_blank" rel="noopener noreferrer" title={u}>
            <i className="prj-tag prj-k-place">{I.place}</i>
            <span className="prj-ftext"><b>{mapName(u)}</b><small>{[m.user_id === me?.id ? 'You' : nameOf(people[m.user_id]).split(' ')[0], new Date(m.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })].join(' · ')}</small></span>
          </a>
          <AddScout has={hasUrl(u)} onAdd={onAdd && (() => onAdd({ name: mapName(u), mapsUrl: u, address: '' }))} />
          <Trash onClick={onDrop && (() => onDrop(m, 'this message with the link'))} />
        </div>
      ))}
      {list.map((m) => {
        const l = m.file.location || {}
        const live = !!m.file.live
        const on = live && (!m.file.live.until || new Date(m.file.live.until) > new Date())
        const row = (
          <a key={m.id} className="prj-row" href={mapUrl(l)} target="_blank" rel="noopener noreferrer" title="Open the map">
            <i className="prj-tag prj-k-place">{I.place}</i>
            <span className="prj-ftext"><b>{live ? 'Live Location' : l.name || 'Place'}</b><small>{[live ? (on ? 'Sharing now' : 'Ended') : l.addr, new Date(m.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</small></span>
            {on && <span className="prj-live" />}
          </a>
        )
        return <div key={m.id} className="prw-link">{row}{onAdd && !live && <AddScout has={hasUrl(mapUrl(l))} onAdd={() => onAdd({ name: l.name || 'Place', address: l.addr || '', mapsUrl: mapUrl(l), lat: l.lat, lon: l.lng })} />}<Trash onClick={onDrop && (() => onDrop(m, 'this place'))} /></div>
      })}
    </div>
  )
}
function Polls({ list, me, people, canStop }) {
  return <div className="prj-polls">{list.map((m) => <div key={m.id} className="prj-poll"><Suspense fallback={<p className="prj-quiet">Poll</p>}><PollCard id={m.id} me={me.id} people={people} canStop={canStop} /></Suspense></div>)}</div>
}
function Contacts({ list, people, onDrop }) {
  return (
    <div className="prj-list">
      {list.map((m) => {
        const c = m.file.contact, p = people[c.id]
        return (
          <div key={m.id} className="prw-link">
            <button type="button" className="prj-row" onClick={() => window.dispatchEvent(new CustomEvent('roarme-card', { detail: { id: c.id } }))}>
              <Avatar src={p?.avatar_url || c.avatar} name={p ? nameOf(p) : c.name} size={32} />
              <span className="prj-ftext"><b>{p ? nameOf(p) : c.name}</b><small>@{p?.username || c.username}</small></span>
            </button>
            <Trash onClick={onDrop && (() => onDrop(m, 'this contact'))} />
          </div>
        )
      })}
    </div>
  )
}

/* ---------- a section that folds ---------- */
function Section({ id, title, count, children, extra }) {
  const key = `roarme-pro-${id}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0' } catch { return true } })
  const flip = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1') } catch { /* private window */ } }
  return (
    <section className={`prj-sec${open ? ' open' : ''}`}>
      <div className="prj-sechead">
        <button type="button" className="prj-secbtn" onClick={flip}><span className="prj-car">{I.right}</span><span>{title}</span>{count != null && <small>{count}</small>}</button>
        {extra}
      </div>
      {open && <div className="prj-secbody">{children}</div>}
    </section>
  )
}

/* ---------- text that saves when it lets go ---------- */
function Field({ value, onSave, placeholder, area = false, className = '', list }) {
  const [v, setV] = useState(value || '')
  const ref = useRef(null)
  useEffect(() => { if (document.activeElement !== ref.current) setV(value || '') }, [value])
  useEffect(() => { if (area && ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${ref.current.scrollHeight}px` } }, [v, area])
  const done = () => { if ((v || '') !== (value || '')) onSave(v) }
  const P = { ref, value: v, placeholder, className, list, onChange: (e) => setV(e.target.value), onBlur: done, onKeyDown: (e) => { if (e.key === 'Enter' && (!area || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { setV(value || ''); setTimeout(() => e.target.blur()) } } }
  return area ? <textarea rows={2} {...P} /> : <input {...P} />
}

/* ---------- tasks ---------- */
const TASK_COLS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']]
/* ---------- the panel ---------- */
function ProInner({ room, other, project, kit, rooms, titleOf, toast, onJump, onOpenRoom, me, people = {} }) {
  const files = useRoomFiles(room.room_id)
  const save = (patch) => kit.save(room.room_id, patch).catch((e) => toast(errText(e)))

  if (room.kind !== 'group') {
    const together = rooms.filter((r) => r.kind === 'group' && kit.map[r.room_id] && other && (r.members || []).includes(other.id))
    return (
      <>
        <Section id="together" title="Projects together" count={together.length}>
          {together.length ? together.map((r) => (
            <button key={r.room_id} type="button" className="prj-link" onClick={() => onOpenRoom(r.room_id)}><b>{titleOf(r)}</b><ProChip p={kit.map[r.room_id]} /></button>
          )) : <p className="prj-quiet">No projects with {other ? nameOf(other).split(' ')[0] : 'them'} yet.</p>}
        </Section>
        <Section id="files" title="Shared files" count={files ? files.filter(isFileMsg).length : null}><Files files={files} onJump={onJump} /></Section>
      </>
    )
  }

  if (!project) {
    return (
      <>
        <div className="prj-make">
          <span className="prj-make-ico">{I.folder}</span>
          <b>Make this group a project</b>
          <p>A stage, a due date, a brief, its files in folders and its tasks, beside the chat. The chat stays as it is.</p>
          <button type="button" className="btn btn-main" onClick={() => save({ status: 'prep', fields: FIELD_START.map((k) => ({ k, v: '' })) })}>Make It a Project</button>
        </div>
        <Section id="files" title="Files" count={files ? files.filter(isFileMsg).length : null}><Files files={files} onJump={onJump} /></Section>
      </>
    )
  }

  // a project shows the workspace instead (Work)
  return null
}

/* ===================================================================================================================
   The project's workspace (Alex, 22 Nov, from the sample https://claude.ai/artifact/AKd1UNfScaixsPqkoaQqSg: "yes, let's
   go"): in a project the panel is the main thing and the chat a narrow column beside it. One row on top: the name,
   the stage as one button (a menu of stages, Rename Stages), the date as a button whose name changes (Shoot Date, Due
   Date, ... or one's own) and the people. Under it tabs: Overview, Media, Files, Location Scout, Calls, Links, Tags,
   and Polls, Places, Contacts when there are any, and Tasks.
   =================================================================================================================== */

const URL_RX = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g
const day = (d) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' })

// everything the workspace shows from the chat: messages with something attached, and text with links or #tags
function useRoomStuff(roomId) {
  const [stuff, setStuff] = useState({ assets: null, words: [] })
  useEffect(() => {
    let gone = false, timer = 0
    setStuff({ assets: null, words: [] })
    const load = async () => {
      const [a, w, h] = await Promise.all([
        supabase.from('roar_messages').select('id, user_id, kind, body, file, created_at').eq('room_id', roomId).not('file', 'is', null).is('deleted_at', null).order('created_at', { ascending: false }).limit(600),
        supabase.from('roar_messages').select('id, user_id, kind, body, created_at').eq('room_id', roomId).eq('kind', 'text').ilike('body', '%http%').is('deleted_at', null).order('created_at', { ascending: false }).limit(600),
        supabase.from('roar_msg_hides').select('message_id').eq('room_id', roomId),
      ])
      const hid = new Set((h.data || []).map((x) => x.message_id))
      const keep = (l) => (l || []).filter((m) => !hid.has(m.id))
      if (!gone) setStuff({ assets: keep(a.data).filter(isAsset), meets: keep(a.data).filter((m) => m.file?.event), words: keep(w.data) })
    }
    load()
    const ch = supabase.channel(`pro-stuff-${roomId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_messages', filter: `room_id=eq.${roomId}` }, () => { clearTimeout(timer); timer = setTimeout(load, 700) })
      .subscribe()
    return () => { gone = true; clearTimeout(timer); supabase.removeChannel(ch) }
  }, [roomId])
  return stuff
}

/* ---------- a big viewer for photos and videos ---------- */
function Viewer({ items, index, onClose, people = {}, me }) {
  const [i, setI] = useState(index)
  const [src, setSrc] = useState('')
  const m = items[i]
  useEffect(() => {
    let gone = false
    setSrc('')
    if (m) fileLink(m.file).then((u) => { if (!gone) setSrc(u) }).catch(() => {})
    return () => { gone = true }
  }, [m])
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') setI((n) => Math.min(items.length - 1, n + 1)); if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1)) }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [items.length, onClose])
  if (!m) return null
  const video = folderOf(m) === 'videos'
  const who = m.user_id === me?.id ? 'You' : nameOf(people[m.user_id])
  return createPortal(
    <div className="prv" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <button type="button" className="round prv-x" onClick={onClose} aria-label="Close">{I.x}</button>
      {i > 0 && <button type="button" className="round prv-prev" onClick={() => setI(i - 1)} aria-label="Previous">{I.right}</button>}
      {i < items.length - 1 && <button type="button" className="round prv-next" onClick={() => setI(i + 1)} aria-label="Next">{I.right}</button>}
      <div className="prv-stage">{src ? (video ? <video key={src} src={src} controls autoPlay playsInline /> : <img src={src} alt="" />) : <span className="prv-wait" />}</div>
      <div className="prv-cap"><b>{m.file.name || (video ? 'Video' : 'Photo')}</b><small>{who} · {day(m.created_at)} · {i + 1} of {items.length}</small>{m.body?.trim() && <p>{m.body.trim()}</p>}</div>
    </div>,
    document.body,
  )
}

function Tile({ m, onOpen, onDrop }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let gone = false
    picLink(m.file).then((u) => { if (!gone && u) setSrc(u) }).catch(() => {})
    return () => { gone = true }
  }, [m.id])
  const video = folderOf(m) === 'videos'
  return (
    <span className="prw-tilewrap">
      <button type="button" className={`prw-tile${m.file.round ? ' round' : ''}`} onClick={onOpen} title={m.file.name || ''}>
        {src ? <img src={src} alt="" loading="lazy" /> : <i className="prw-tile-ph" />}
        {video && <span className="prw-play"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></span>}
        <span className="prw-tile-meta">{m.file.name && !m.file.round ? m.file.name : day(m.created_at)}</span>
      </button>
      <Trash className="on-pic" onClick={onDrop && (() => onDrop(m, video ? 'this video' : 'this photo'))} />
    </span>
  )
}

/* ---------- small menus that hang from a button ---------- */
function Hang({ open, onClose, children, className = '' }) {
  if (!open) return null
  return (
    <>
      <span className="prw-scrim" onClick={onClose} />
      <div className={`menu prw-menu ${className}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </>
  )
}

const DATE_NAMES = ['Shoot Date', 'Due Date', 'Delivery', 'Premiere']

function Stages({ project, save, onClose }) {
  const [list, setList] = useState(() => stagesOf(project).map((s) => ({ ...s })))
  const put = (i, patch) => setList((l) => l.map((s, n) => (n === i ? { ...s, ...patch } : s)))
  return (
    <Modal title="Stages" onClose={onClose} foot={<><button type="button" className="btn" onClick={() => setList(DEFAULT_STAGES.map((s) => ({ ...s })))}>Reset</button><button type="button" className="btn btn-main" onClick={() => { const clean = list.map((s) => ({ ...s, name: s.name.trim().slice(0, 30) || 'Stage' })); save({ stages: clean, ...(clean.some((s) => s.id === project.status) ? {} : { status: clean[0].id }) }); onClose() }}>Save</button></>}>
      <div className="prw-stages">
        {list.map((s, i) => (
          <div key={s.id} className="prw-stage-row">
            <button type="button" className="prw-dotbtn" style={{ '--pc': s.c }} onClick={() => put(i, { c: STAGE_COLOURS[(STAGE_COLOURS.indexOf(s.c) + 1) % STAGE_COLOURS.length] })} aria-label="Change colour" title="Change colour" />
            <input value={s.name} maxLength={30} onChange={(e) => put(i, { name: e.target.value })} />
            {list.length > 1 && <button type="button" className="round prw-del" onClick={() => setList((l) => l.filter((_, n) => n !== i))} aria-label="Remove stage">{I.trash}</button>}
          </div>
        ))}
        {list.length < 10 && <button type="button" className="pill-btn prj-kvadd" onClick={() => setList((l) => [...l, { id: uid().slice(0, 8), name: 'New Stage', c: STAGE_COLOURS[l.length % STAGE_COLOURS.length] }])}>{I.plus}<span>Add Stage</span></button>}
      </div>
    </Modal>
  )
}

/* ---------- Location Scout ---------- */
const SCOUT_ST = [['option', 'Option', '#d48806'], ['confirmed', 'Confirmed', '#14a37f'], ['rejected', 'Rejected', '#e5483f']]
const scoutSt = (k) => SCOUT_ST.find((x) => x[0] === k) || SCOUT_ST[0]
const mapSearch = (q) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`

async function putPhotos(roomId, files) {
  const out = []
  for (const raw of files) {
    if (!/^image\//.test(raw.type) && !/^video\//.test(raw.type)) continue
    const f = /^image\/(jpeg|png|webp)$/.test(raw.type) ? await shrinkImage(raw, 2048, 0.85).catch(() => raw) : raw
    if (f.size > 50e6) continue
    const safe = (raw.name || 'photo').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-60)
    const path = `${roomId}/scout-${uid()}-${safe}`
    const { error } = await supabase.storage.from('roar-files').upload(path, f, { contentType: f.type || raw.type })
    if (error) throw error
    out.push({ path, name: raw.name, type: f.type || raw.type, size: f.size })
  }
  return out
}

function ScoutPhoto({ p, className = '', onClick }) {
  const [src, setSrc] = useState('')
  useEffect(() => { let gone = false; picLink(p).then((u) => { if (!gone && u) setSrc(u) }).catch(() => {}); return () => { gone = true } }, [p.path])
  return <button type="button" className={`prw-sph ${className}`} onClick={onClick}>{src ? <img src={src} alt="" loading="lazy" /> : <i className="prw-tile-ph" />}</button>
}

function ScoutEdit({ item, onSave, onDelete, onClose, roomId, toast }) {
  const [x, setX] = useState(item)
  const [busy, setBusy] = useState(false)
  const pick = useRef(null)
  const set = (patch) => setX((v) => ({ ...v, ...patch }))
  return (
    <Modal title={item.name ? 'Edit Location' : 'New Location'} onClose={onClose} foot={<>{onDelete && <button type="button" className="btn danger" onClick={onDelete}>Delete</button>}<button type="button" className="btn btn-main" disabled={busy} onClick={() => onSave({ ...x, name: (x.name || '').trim().slice(0, 80) || 'Location' })}>Save</button></>}>
      <div className="prw-form">
        <label><span>Name</span><input value={x.name || ''} maxLength={80} placeholder="Kypseli corner" onChange={(e) => set({ name: e.target.value })} autoFocus /></label>
        <label><span>Address</span><input value={x.address ?? x.addr ?? ''} maxLength={160} placeholder="Street, area, city" onChange={(e) => set({ address: e.target.value, addr: undefined })} /></label>
        <div className="prw-formrow"><span>Type</span><Lens className="seg" dep={x.type || 'Interior'}>{['Interior', 'Exterior', 'Both'].map((k) => <button key={k} type="button" className={(x.type || 'Interior') === k ? 'on' : ''} onClick={() => set({ type: k })}>{k}</button>)}</Lens></div>
        <div className="prw-formrow"><span>Status</span><Lens className="seg" dep={x.st}>{SCOUT_ST.map(([k, l]) => <button key={k} type="button" className={x.st === k ? 'on' : ''} onClick={() => set({ st: k })}>{l}</button>)}</Lens></div>
        <label><span>Contact</span><input value={x.contact || ''} maxLength={120} placeholder="Who to ask for" onChange={(e) => set({ contact: e.target.value })} /></label>
        <label><span>Phone</span><input value={x.phone || ''} maxLength={40} placeholder="+30 …" onChange={(e) => set({ phone: e.target.value })} /></label>
        <label><span>Map link</span><input value={x.mapsUrl || ''} maxLength={500} placeholder="https://maps.app.goo.gl/…" onChange={(e) => set({ mapsUrl: e.target.value.trim() })} /></label>
        <label><span>Permit</span><input value={x.permit || ''} maxLength={120} placeholder="Asked, granted, dates" onChange={(e) => set({ permit: e.target.value })} /></label>
        <label><span>Notes</span><textarea rows={3} value={x.notes || ''} maxLength={1000} placeholder="Power, sound, light, parking…" onChange={(e) => set({ notes: e.target.value })} /></label>
        <label><span>Tags</span><input value={(x.tags || []).join(', ')} maxLength={200} placeholder="rooftop, night, street" onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12) })} /></label>
        <div className="prw-formrow top"><span>Photos</span>
          <div className="prw-sgrid">
            {(x.photos || []).map((p, n) => (
              <span key={p.path} className="prw-sgrid-it"><ScoutPhoto p={p} /><button type="button" className="round prw-del" onClick={() => set({ photos: x.photos.filter((_, k) => k !== n) })} aria-label="Remove photo">{I.x}</button></span>
            ))}
            <button type="button" className="prw-sadd" disabled={busy} onClick={() => pick.current?.click()}>{busy ? '…' : I.plus}</button>
            <input ref={pick} type="file" accept="image/*,video/*" multiple hidden onChange={async (e) => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length) return; setBusy(true); try { const got = await putPhotos(roomId, fs); setX((v) => ({ ...v, photos: [...(v.photos || []), ...got].slice(0, 40) })) } catch (er) { toast(errText(er)) } setBusy(false) }} />
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Scout({ project, save, room, toast, onView }) {
  const list = Array.isArray(project.scouts) ? project.scouts : []
  const [edit, setEdit] = useState(null)
  // Cards or List (Alex, 22 Nov), kept on the device
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('roarme-scout-mode') || 'cards' } catch { return 'cards' } })
  const pickMode = (m) => { setMode(m); try { localStorage.setItem('roarme-scout-mode', m) } catch { /* private window */ } }
  const put = (next) => save({ scouts: next })
  const step = (x) => put(list.map((y) => (y.id === x.id ? { ...y, st: SCOUT_ST[(SCOUT_ST.findIndex((s) => s[0] === y.st) + 1) % SCOUT_ST.length][0] } : y)))
  const where = (x) => x.address || x.addr || ''
  const mapOf = (x) => (x.mapsUrl || where(x) ? x.mapsUrl || mapSearch(where(x)) : '')
  const fresh = () => setEdit({ id: uid(), name: '', address: '', type: 'Interior', st: 'option', contact: '', phone: '', notes: '', mapsUrl: '', tags: [], photos: [] })
  const status = (x) => { const [, label, c] = scoutSt(x.st); return <button type="button" className="prj-chip prw-st" style={{ '--pc': c }} onClick={() => step(x)} title="Change status">{label}</button> }
  const mapBtn = (x) => (mapOf(x) ? <a className="round prw-ibtn" href={mapOf(x)} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" aria-label="Open in Google Maps">{I.place}</a> : null)
  const editBtn = (x) => <button type="button" className="round prw-ibtn" onClick={() => setEdit(x)} title="Edit" aria-label="Edit">{I.edit}</button>
  const dropBtn = (x) => <Trash className="prw-ibtn" onClick={() => { if (window.confirm(`Delete ${x.name || 'this location'} from Location Scout?`) && window.confirm('Are you sure? Its photos and notes go too.')) put(list.filter((y) => y.id !== x.id)) }} />
  return (
    <>
      <div className="prw-scouthead">
        <Lens className="seg prw-seg" dep={mode}>{[['cards', 'Cards'], ['list', 'List']].map(([k, l]) => <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => pickMode(k)}>{l}</button>)}</Lens>
        <button type="button" className="pill-btn prw-boxbtn" onClick={fresh}>{I.plus}<span>New Location</span></button>
      </div>
      {!list.length && <p className="prj-quiet">No locations yet. New Location, or Add to Location Scout from a map link in Places.</p>}
      {mode === 'cards' ? (
        <div className="prw-cards">
          {list.map((x) => {
            const ph = x.photos || []
            return (
              <article key={x.id} className="prw-card">
                <div className="prw-cover">
                  {ph[0] ? <ScoutPhoto p={ph[0]} className="cover" onClick={() => onView(ph, 0)} /> : <button type="button" className="prw-cover-empty" onClick={() => setEdit(x)}>{I.image}<span>Add photos</span></button>}
                  {status(x)}
                  {ph.length > 1 && <span className="prw-count">{I.image}{ph.length}</span>}
                </div>
                <div className="prw-card-in">
                  <div className="prw-card-top">
                    <button type="button" className="prw-card-title" onClick={() => setEdit(x)}><h3>{x.name}</h3>{where(x) && <small>{where(x)}</small>}</button>
                    <span className="prw-card-btns">{mapBtn(x)}{editBtn(x)}{dropBtn(x)}</span>
                  </div>
                  <span className="prw-card-meta"><i className="type">{x.type || 'Interior'}</i>{(x.contact || x.phone) && <i>{[x.contact, x.phone].filter(Boolean).join(' · ')}</i>}{(x.tags || []).map((t) => <i key={t}>{t}</i>)}</span>
                </div>
              </article>
            )
          })}
        </div>
      ) : list.length > 0 && (
        <div className="prw-slist">
          {list.map((x) => {
            const ph = x.photos || []
            return (
              <div key={x.id} className="prw-srow">
                {ph[0] ? <ScoutPhoto p={ph[0]} className="prw-sthumb" onClick={() => onView(ph, 0)} /> : <button type="button" className="prw-sthumb empty" onClick={() => setEdit(x)}>{I.image}</button>}
                <button type="button" className="prw-stext" onClick={() => setEdit(x)}><b>{x.name}</b><small>{[where(x), x.type || 'Interior'].filter(Boolean).join(' · ')}</small></button>
                <span className="prw-scontact">{[x.contact, x.phone].filter(Boolean).join(' · ')}</span>
                {status(x)}
                <span className="prw-card-btns">{mapBtn(x)}{editBtn(x)}{dropBtn(x)}</span>
              </div>
            )
          })}
        </div>
      )}
      {edit && <ScoutEdit item={edit} roomId={room.room_id} toast={toast} onClose={() => setEdit(null)}
        onDelete={list.some((y) => y.id === edit.id) ? () => { if (window.confirm(`Delete ${edit.name || 'this location'}?`)) { put(list.filter((y) => y.id !== edit.id)); setEdit(null) } } : null}
        onSave={(x) => { put(list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]); setEdit(null) }} />}
    </>
  )
}

/* ---------- Calls ---------- */
function Calls({ list, room, people, me, onDrop }) {
  const [live, setLive] = useState(null)
  useEffect(() => {
    let gone = false
    const look = () => supabase.from('roar_group_calls').select('id, video, started_by, started_at').eq('room_id', room.room_id).is('ended_at', null).order('started_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (!gone) setLive(data?.[0] || null) })
    look()
    const t = setInterval(look, 15000)
    return () => { gone = true; clearInterval(t) }
  }, [room.room_id])
  const go = (video, id) => window.dispatchEvent(new CustomEvent('roarme-gcall', { detail: { room: room.room_id, video, ...(id ? { id } : {}) } }))
  const now = Date.now()
  const events = list.filter((m) => m.file.event).map((m) => ({ m, ev: m.file.event, s: new Date(m.file.event.start).getTime() }))
  const soon = events.filter((x) => x.s + 2 * 3600e3 > now).sort((a, b) => a.s - b.s)
  const past = [...list.filter((m) => m.file.groupcall), ...events.filter((x) => x.s + 2 * 3600e3 <= now).map((x) => x.m)].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const who = (id) => (id === me.id ? 'You' : nameOf(people[id]).split(' ')[0])
  return (
    <div className="prw-calls">
      <div className="prw-calls-top">
        <button type="button" className="btn btn-main" onClick={() => go(true)}>{I.video}<span>Start Video Chat</span></button>
        <button type="button" className="btn" onClick={() => go(false)}>{I.phone}<span>Voice Call</span></button>
        <button type="button" className="btn" onClick={() => window.dispatchEvent(new CustomEvent('roarme-roomact', { detail: { what: 'schedule' } }))}>{I.calendar}<span>Schedule Meeting</span></button>
      </div>
      {live && <div className="prw-call on"><span className="prw-call-ico">{I.video}</span><span className="prj-ftext"><b>{live.video ? 'Video chat' : 'Call'} is on</b><small>Started by {who(live.started_by)} at {new Date(live.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><button type="button" className="btn btn-main" onClick={() => go(live.video, live.id)}>Join</button></div>}
      {soon.length > 0 && <h6 className="prw-h">Meetings</h6>}
      {soon.map(({ m, ev, s }) => {
        const open = now >= s - 10 * 60e3
        return <div key={m.id} className="prw-call"><span className="prw-call-ico sched">{I.calendar}</span><span className="prj-ftext"><b>{ev.title || 'Call'}</b><small>{new Date(s).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span>{open && <button type="button" className="btn btn-main" onClick={() => go(true)}>Join</button>}<Trash onClick={onDrop && (() => onDrop(m, 'this meeting'))} /></div>
      })}
      {past.length > 0 && <h6 className="prw-h">Past</h6>}
      {past.map((m) => <div key={m.id} className="prw-call past"><span className="prw-call-ico past">{m.file.event ? I.calendar : I.video}</span><span className="prj-ftext"><b>{m.file.event ? m.file.event.title || 'Scheduled call' : `${m.file.groupcall?.video === false ? 'Call' : 'Video chat'} by ${who(m.user_id)}`}</b><small>{new Date(m.file.event ? m.file.event.start : m.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span><Trash onClick={onDrop && (() => onDrop(m, m.file.event ? 'this meeting' : 'this call'))} /></div>)}
      {!live && !soon.length && !past.length && <p className="prj-quiet">No calls or meetings yet. Schedule Meeting puts a card in the chat that everyone taps to join, and it is listed here.</p>}
    </div>
  )
}

/* ---------- Links and Tags ---------- */
function Links({ words, people, me, onJump, onDrop }) {
  const list = words.flatMap((m) => [...new Set(String(m.body).match(URL_RX) || [])].filter((u) => !isMapLink(u)).map((u) => ({ u, m })))
  if (!list.length) return <p className="prj-quiet">No links yet. Links sent in the chat stay there and gather here too.</p>
  return (
    <div className="prj-list prw-links">
      {list.map(({ u, m }, i) => {
        let host = u
        try { host = new URL(u).hostname.replace(/^www\./, '') } catch { /* not a full address */ }
        return (
          <div key={`${m.id}-${i}`} className="prw-link">
            <a className="prj-row" href={u} target="_blank" rel="noopener noreferrer"><i className="prj-tag prj-k-docs">{host.slice(0, 1).toUpperCase()}</i><span className="prj-ftext"><b>{host}</b><small>{u}</small></span></a>
            <button type="button" className="pill-btn prw-goto" onClick={() => onJump(m.id)}>{m.user_id === me.id ? 'You' : nameOf(people[m.user_id]).split(' ')[0]} · {day(m.created_at)}</button>
            <Trash onClick={onDrop && (() => onDrop(m, 'this message with the link'))} />
          </div>
        )
      })}
    </div>
  )
}

/* ---------- tasks on a board ---------- */
function Board({ list, onChange }) {
  const [add, setAdd] = useState('')
  const step = (t) => onChange(list.map((x) => (x.id === t.id ? { ...x, s: x.s === 'todo' ? 'doing' : x.s === 'doing' ? 'done' : 'todo' } : x)))
  return (
    <div className="prw-board-wrap">
      <form className="prj-add" onSubmit={(e) => { e.preventDefault(); const t = add.trim(); if (!t) return; onChange([...list, { id: uid(), t: t.slice(0, 200), s: 'todo' }]); setAdd('') }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a task" maxLength={200} />
        <button type="submit" className="round" aria-label="Add task" disabled={!add.trim()}>{I.plus}</button>
      </form>
      <div className="prw-board">
        {TASK_COLS.map(([s, label]) => {
          const rows = list.filter((t) => t.s === s)
          return (
            <div key={s} className={`prw-col prj-t-${s}`}>
              <h5>{label}<small>{rows.length}</small></h5>
              {rows.map((t) => (
                <div key={t.id} className="prw-kc prj-task">
                  <button type="button" className="prj-tick" onClick={() => step(t)} title={s === 'todo' ? 'Start' : s === 'doing' ? 'Done' : 'Back to To do'} aria-label="Move on">{s === 'done' ? I.check : s === 'doing' ? <i className="prj-half" /> : null}</button>
                  <span className="prj-ttext">{t.t}</span>
                  <button type="button" className="prj-tdel" onClick={() => onChange(list.filter((x) => x.id !== t.id))} aria-label="Delete task" title="Delete">{I.x}</button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- the tabs as a menu: a line sign over the word, spread across (Alex, 22 Nov: "like a menu") ---------- */
const tsv = (d) => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const TAB_I = {
  overview: tsv(<><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>),
  media: tsv(<><rect x="3" y="4.5" width="18" height="15" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-8.5 8.5" /></>),
  files: tsv(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h4" /></>),
  music: tsv(<><path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>),
  scout: tsv(<><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.5-2h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><circle cx="12" cy="12.5" r="3.5" /></>),
  calls: tsv(<><rect x="3" y="6" width="12.5" height="12" rx="3" /><path d="m15.5 10.5 5-3v9l-5-3" /></>),
  links: tsv(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>),
  polls: tsv(<path d="M5 20V12M10 20V5M15 20v-9M20 20V8" />),
  places: tsv(<><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>),
  contacts: tsv(<><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>),
  tasks: tsv(<><rect x="4" y="3.5" width="16" height="17" rx="3.5" /><path d="m8 9 1.6 1.6L12.5 7.8M8 15l1.6 1.6 2.9-2.8M14.5 9.5H16M14.5 15.5H16" /></>),
  admin: tsv(<><rect x="3.5" y="6.5" width="17" height="13" rx="3" /><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5M3.5 12h17M12 11v2.5" /></>),
  stats: tsv(<><path d="M4 20h16" /><rect x="5.5" y="11" width="3" height="6.5" rx="1" /><rect x="10.5" y="6" width="3" height="11.5" rx="1" /><rect x="15.5" y="13.5" width="3" height="4" rx="1" /></>),
}
const OPTIONAL = [['scout', 'Location Scout'], ['calls', 'Calls & Meetings'], ['links', 'Links'], ['tasks', 'Tasks'], ['stats', 'Stats']]
const hiddenKey = (roomId) => `roarme-pro-hide-${roomId}`

/* ---------- a document read inside RoarMe (Alex, 22 Nov: "tap a document and read it, a preview of the text"):
   a PDF in RoarMe's PDF viewer, a Word file's words (read from the .docx itself, on the device), plain text as it is ---------- */
const TEXT_EXT = /^(txt|md|csv|tsv|json|srt|vtt|fountain|log|xml|html?|rtf)$/
async function unzipEntry(buf, want) {
  const dv = new DataView(buf)
  let e = buf.byteLength - 22
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e -= 1
  if (e < 0) return null
  const count = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  for (let i = 0; i < count; i += 1) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), at = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nl))
    if (name === want) {
      const data = new Uint8Array(buf, at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true), size)
      if (method === 0) return new TextDecoder().decode(data)
      return new Response(new Blob([data]).stream().pipeThrough(new window.DecompressionStream('deflate-raw'))).text()
    }
    p += 46 + nl + el + cl
  }
  return null
}
const unxml = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const docxParas = (xml) => xml.split(/<\/w:p>/).map((p) => ({
  head: /<w:pStyle w:val="(Heading|Title)/i.test(p),
  t: unxml(p.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').match(/<w:t[^>]*>[^<]*<\/w:t>|\t|\n/g)?.map((x) => x.replace(/<[^>]+>/g, '')).join('') || ''),
})).filter((x, i, a) => x.t.trim() || (i > 0 && a[i - 1].t.trim()))

function DocView({ m, onClose }) {
  const ext = EXT(m.file)
  const pdf = ext === 'pdf' || m.file.type === 'application/pdf'
  const [url, setUrl] = useState('')
  const [doc, setDoc] = useState(null) // { paras } | { text } | { none }
  useEffect(() => {
    let gone = false
    fileLink(m.file).then(async (u) => {
      if (gone) return
      setUrl(u)
      if (pdf) return
      try {
        if (ext === 'docx') { const buf = await (await fetch(u)).arrayBuffer(); const xml = await unzipEntry(buf, 'word/document.xml'); if (!gone) setDoc(xml ? { paras: docxParas(xml) } : { none: true }) }
        else if (TEXT_EXT.test(ext) || /^text\//.test(m.file.type || '')) { const t = await (await fetch(u)).text(); if (!gone) setDoc({ text: t.slice(0, 400000) }) }
        else setDoc({ none: true })
      } catch { if (!gone) setDoc({ none: true }) }
    }).catch(() => { if (!gone) setDoc({ none: true }) })
    return () => { gone = true }
  }, [m.id])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  if (pdf) return url ? createPortal(<Suspense fallback={null}><PdfView url={url} name={m.file.name} onClose={onClose} /></Suspense>, document.body) : null
  const save = async () => { const u = await fileLink(m.file, m.file.name || 'file'); if (u) window.open(u, '_blank') }
  return createPortal(
    <div className="prd" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="prd-card">
        <div className="prd-head">
          <i className={`prj-tag prj-k-${folderOf(m)}`}>{tagOf(m)}</i>
          <span className="prj-ftext"><b>{m.file.name || 'File'}</b><small>{sizeText(m.file.size)}</small></span>
          <button type="button" className="pill-btn" onClick={save}>{I.down}<span>Download</span></button>
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
        </div>
        <div className="prd-body">
          {!doc ? <span className="prv-wait dark" />
            : doc.paras ? <article className="prd-page">{doc.paras.map((x, i) => (x.head ? <h3 key={i}>{x.t}</h3> : <p key={i}>{x.t || ' '}</p>))}</article>
            : doc.text != null ? <pre className="prd-page prd-pre">{doc.text}</pre>
            : <div className="prd-none">{TAB_I.files}<b>No preview for this kind of file</b><p>Download it to open it on your computer.</p><button type="button" className="btn btn-main" onClick={save}>Download</button></div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ---------- Roardino inside RoarMe (Alex, 22 Nov: "tap there, the ordino app pops up, you make it and it stays here"):
   themadlions.com/roardino/?embed=1 in a window; it asks, RoarMe hands it this account's short-lived access token (never
   the refresh token), and its Send hands back the ordino's link and details, kept in the project (ordinos). ---------- */
const ROARDINO = 'https://themadlions.com'
function OrdinoWindow({ onClose, onSent }) {
  const frame = useRef(null)
  useEffect(() => {
    const hand = async () => {
      const { data } = await supabase.auth.getSession()
      const t = data?.session?.access_token
      if (t) frame.current?.contentWindow?.postMessage({ type: 'roardino:session', access_token: t }, ROARDINO)
    }
    const on = (e) => {
      if (e.origin !== ROARDINO || e.source !== frame.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'roardino:ready') hand()
      if (d.type === 'roardino:send' && d.ordino?.url && /^https:\/\//.test(d.ordino.url)) {
        const o = d.ordino
        onSent({ url: String(o.url).slice(0, 600), token: String(o.token || '').slice(0, 80), title: String(o.title || '').slice(0, 120), artist: String(o.artist || '').slice(0, 120), label: String(o.label || '').slice(0, 60), date: String(o.date || '').slice(0, 20), call: String(o.call || '').slice(0, 20), place: String(o.place || '').slice(0, 120), accent: /^#[0-9a-f]{3,8}$/i.test(o.accent || '') ? o.accent : '#d40000' })
      }
    }
    window.addEventListener('message', on)
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => { if (ev === 'TOKEN_REFRESHED') hand() })
    return () => { window.removeEventListener('message', on); sub?.subscription?.unsubscribe() }
  }, [onSent])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return createPortal(
    <div className="prd" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="prd-card prw-ordwin">
        <div className="prd-head">
          <span className="prj-ftext"><b>Roardino</b><small>Make the ordino, then press Send to keep it in this project</small></span>
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
        </div>
        <iframe ref={frame} className="prw-ordframe" src={`${ROARDINO}/roardino/?embed=1`} title="Roardino" allow="clipboard-write" />
      </div>
    </div>,
    document.body,
  )
}

/* ---------- Stats: the whole chat in numbers (Alex, 22 Nov: "the statistics of the whole chat, made nicely, and more") ----------
   the newest 5,000 messages, counted on the device; bars in the accent (one series, one hue), a hover names each one */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function Stats({ room, people, me, project, compact = false }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let gone = false
    setRows(null)
    ;(async () => {
      const all = []
      for (let from = 0; from < 5000; from += 1000) {
        const { data, error } = await supabase.from('roar_messages').select('user_id, kind, body, file, created_at').eq('room_id', room.room_id).is('deleted_at', null).order('created_at', { ascending: false }).range(from, from + 999)
        if (error || !data) break
        all.push(...data)
        if (data.length < 1000) break
      }
      if (!gone) setRows(all.filter((m) => m.kind !== 'system'))
    })()
    return () => { gone = true }
  }, [room.room_id])
  if (!rows) return <p className="prj-quiet">Counting…</p>
  if (!rows.length) return <p className="prj-quiet">No messages yet.</p>
  const media = rows.filter((m) => isFileMsg(m) && isMediaMsg(m)).length
  const files = rows.filter((m) => isFileMsg(m) && !isMediaMsg(m)).length
  const voice = rows.filter((m) => m.kind === 'voice')
  const voiceMin = Math.round(voice.reduce((a, m) => a + (Number(m.file?.dur) || 0), 0) / 60)
  const links = rows.reduce((a, m) => a + ((m.kind === 'text' && String(m.body || '').match(URL_RX)) || []).length, 0)
  const bytes = rows.reduce((a, m) => a + (isFileMsg(m) ? Number(m.file.size) || 0 : 0), 0)
  const first = rows[rows.length - 1].created_at
  const days = new Set(rows.map((m) => new Date(m.created_at).toDateString())).size
  const by = {}
  rows.forEach((m) => { by[m.user_id] = (by[m.user_id] || 0) + 1 })
  const talkers = Object.entries(by).sort((a, b) => b[1] - a[1])
  const top = talkers[0]?.[1] || 1
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const month = Array.from({ length: 30 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - 29 + i); return { d, n: 0 } })
  const hours = Array(24).fill(0)
  const week = Array(7).fill(0)
  rows.forEach((m) => {
    const t = new Date(m.created_at)
    hours[t.getHours()] += 1
    week[t.getDay()] += 1
    const k = Math.floor((today - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5)
    if (k >= 0 && k < 30) month[29 - k].n += 1
  })
  const mMax = Math.max(1, ...month.map((x) => x.n)), hMax = Math.max(1, ...hours)
  const busyHour = hours.indexOf(Math.max(...hours)), busyDay = week.indexOf(Math.max(...week))
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const scouts = Array.isArray(project.scouts) ? project.scouts : []
  const nameFor = (id) => (id === me.id ? 'You' : nameOf(people[id]))
  const KPI = [['Messages', rows.length.toLocaleString()], ['Photos and videos', media], ['Files', files], ['Voice messages', voice.length, voiceMin ? `${voiceMin} min` : ''], ['Links', links], ['Shared', sizeText(bytes) || '0 KB'], ['Days active', days, `since ${day(first)}`]]
  return (
    <div className={`prs${compact ? ' compact' : ''}`}>
      <div className="prs-kpis">{KPI.map(([l, v, sub]) => <div key={l} className="prs-kpi"><b>{v}</b><span>{l}</span>{sub && <small>{sub}</small>}</div>)}</div>
      <div className="prs-grid">
        <div className="prw-box">
          <h4>Who Writes Most</h4>
          <div className="prs-people">
            {talkers.slice(0, 8).map(([id, n]) => (
              <div key={id} className="prs-person" title={`${nameFor(id)}: ${n} messages`}>
                <Avatar src={people[id]?.avatar_url} name={nameOf(people[id])} size={28} />
                <span className="prs-pname">{nameFor(id)}</span>
                <span className="prs-track"><i style={{ width: `${Math.max(2, (n / top) * 100)}%` }} /></span>
                <b>{n}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="prw-box">
          <h4>Last 30 Days</h4>
          <div className="prs-cols">{month.map((x, i) => <span key={i} className="prs-col" title={`${x.d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}: ${x.n} messages`}><i style={{ height: `${x.n ? Math.max(4, (x.n / mMax) * 100) : 0}%` }} /></span>)}</div>
          <div className="prs-axis"><span>{month[0].d.toLocaleDateString([], { day: 'numeric', month: 'short' })}</span><span>Today</span></div>
        </div>
        <div className="prw-box">
          <h4>By Hour</h4>
          <div className="prs-cols hours">{hours.map((n, h) => <span key={h} className={`prs-col${h === busyHour ? ' top' : ''}`} title={`${String(h).padStart(2, '0')}:00: ${n} messages`}><i style={{ height: `${n ? Math.max(4, (n / hMax) * 100) : 0}%` }} /></span>)}</div>
          <div className="prs-axis four"><span>00</span><span>06</span><span>12</span><span>18</span></div>
          <p className="prs-note">Busiest at <b>{String(busyHour).padStart(2, '0')}:00</b>, most on <b>{WEEKDAYS[busyDay]}s</b></p>
        </div>
        <div className="prw-box">
          <h4>The Project</h4>
          <div className="prs-proj">
            <div><span>Tasks done</span><b>{tasks.filter((t) => t.s === 'done').length} of {tasks.length}</b><span className="prs-track"><i style={{ width: `${tasks.length ? (tasks.filter((t) => t.s === 'done').length / tasks.length) * 100 : 0}%` }} /></span></div>
            <div><span>Locations confirmed</span><b>{scouts.filter((x) => x.st === 'confirmed').length} of {scouts.length}</b><span className="prs-track"><i style={{ width: `${scouts.length ? (scouts.filter((x) => x.st === 'confirmed').length / scouts.length) * 100 : 0}%` }} /></span></div>
            <div><span>Ordinos</span><b>{(project.ordinos || []).length}</b></div>
            <div><span>Members</span><b>{(room.members || []).length}</b></div>
          </div>
        </div>
      </div>
      {rows.length >= 5000 && <p className="prj-quiet">Counted from the newest 5,000 messages.</p>}
    </div>
  )
}

/* ---------- the Overview's cover (Alex, 22 Nov: "make this page much more beautiful"): the newest photo behind, darkened,
   the category and the stage, Artist and Title large, how long until the date, and the brief written on it ---------- */
// the cover's pictures, in turn with the arrows (Alex, 22 Nov: "the group's picture, switched left and right, and one I upload,
// with crop and zoom"): one's own cover, the group's photo, then the project's newest photos
function Hero({ photos = [], room, me, project, st, dateName, fields, onBrief, onCover, toast }) {
  const list = [project.cover && { url: project.cover, own: true }, room.avatar_url && { url: room.avatar_url, group: true }, ...photos.slice(0, 8).map((m) => ({ m }))].filter(Boolean)
  const [i, setI] = useState(() => { const n = Number(project.cover_pick); return Number.isFinite(n) ? n : 0 })
  const at = list.length ? ((i % list.length) + list.length) % list.length : 0
  const cur = list[at]
  const [bg, setBg] = useState('')
  const [crop, setCrop] = useState(null)
  const [busy, setBusy] = useState(false)
  const pick = useRef(null)
  useEffect(() => {
    let gone = false
    if (!cur) { setBg(''); return undefined }
    if (cur.url) { setBg(cur.url); return undefined }
    picLink(cur.m.file).then((u) => { if (!gone && u) setBg(u) }).catch(() => {})
    return () => { gone = true }
  }, [cur?.url, cur?.m?.id])
  const turn = (d) => { const n = at + d; setI(n); onCover({ cover_pick: ((n % list.length) + list.length) % list.length }) }
  const upload = async (f) => {
    setCrop(null)
    if (!f) return
    setBusy(true)
    try {
      const path = `${me.id}/cover-${room.room_id}-${Date.now()}.jpg`
      const up = await supabase.storage.from('roar-avatars').upload(path, f, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const url = supabase.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl
      onCover({ cover: url, cover_pick: 0 })
      setI(0)
    } catch (e) { toast(errText(e)) }
    setBusy(false)
  }
  const val = (k) => (fields.find((f) => f.k === k)?.v || '').trim()
  const artist = val('Artist / Client'), work = val('Title'), cat = val('Category')
  let when = ''
  if (project.due) {
    const d = Math.round((new Date(`${project.due}T00:00:00`) - new Date(new Date().toDateString())) / 864e5)
    when = d === 0 ? `${dateName} is today` : d === 1 ? `${dateName} is tomorrow` : d > 1 ? `${dateName} in ${d} days` : `${dateName} was ${-d} day${d === -1 ? '' : 's'} ago`
  }
  return (
    <section className={`prw-hero wide${bg ? ' has-bg' : ''}`}>
      {bg && <i key={bg} className="prw-hero-bg" style={{ backgroundImage: `url(${bg})` }} />}
      <span className="prw-hero-tools">
        {list.length > 1 && <button type="button" className="round prw-hero-btn" onClick={() => turn(-1)} aria-label="Previous picture" title="Previous picture"><span className="flip">{I.right}</span></button>}
        {list.length > 1 && <span className="prw-hero-dots">{list.map((x, n) => <i key={n} className={n === at ? 'on' : ''} />)}</span>}
        {list.length > 1 && <button type="button" className="round prw-hero-btn" onClick={() => turn(1)} aria-label="Next picture" title="Next picture">{I.right}</button>}
        <button type="button" className="round prw-hero-btn" disabled={busy} onClick={() => pick.current?.click()} aria-label="Upload a cover" title={project.cover ? 'Replace the cover' : 'Upload a cover'}>{I.image}</button>
        {project.cover && cur?.own && <button type="button" className="round prw-hero-btn" onClick={() => { if (window.confirm('Remove your cover? The group photo and the project photos stay.')) { onCover({ cover: null, cover_pick: 0 }); setI(0) } }} aria-label="Remove the cover" title="Remove the cover">{I.trash}</button>}
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setCrop(f) }} />
      </span>
      <div className="prw-hero-in">
        <span className="prw-hero-kick">{cat && <span className="prw-hero-cat">{cat}</span>}<span className="prw-hero-st" style={{ '--pc': st.c }}><i className="prw-dot" />{st.name}</span>{when && <span className="prw-hero-when">{I.calendar}{when}</span>}</span>
        {(artist || work) && <h2>{artist}{artist && work && <span className="prw-hero-sep"> – </span>}{work && <em>{work}</em>}</h2>}
        <Field area className="prw-hero-brief" value={project.brief} placeholder="Write the brief: what it is, where, when, the look…" onSave={onBrief} />
      </div>
      {crop && <CropModal file={crop} wide={3} title="Project cover" onDone={upload} onClose={() => setCrop(null)} />}
    </section>
  )
}

const SWAP_I = tsv(<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4" />)
const SEND_I = tsv(<path d="M4 12 20 4l-5 16-3.5-6.5z" />)
const FWD_I = tsv(<><path d="M14 5l6 6-6 6" /><path d="M20 11H9a5 5 0 0 0-5 5v3" /></>)
// an ordino message in the chat: sent with file.ordino, or (sent before that) the text "📋 Label: Title / when / link"
// the ordino's name with its artist (Alex, 22 Nov: "we want the name too: Ιουλία Καλλιμάνη – INTRO VIDEO")
export const ordName = (o, artist = '') => [o.artist || artist, o.title].filter(Boolean).join(' – ') || 'Ordino'
const ORD_URL = /https:\/\/themadlions\.com\/roardino\/\?t=[\w-]+/
export function ordinoOf(m) {
  if (m.file?.ordino?.url) return m.file.ordino
  if (m.kind !== 'text' || !String(m.body || '').startsWith('📋')) return null
  const url = (String(m.body).match(ORD_URL) || [])[0]
  if (!url) return null
  const lines = String(m.body).split('\n').map((x) => x.trim()).filter(Boolean)
  const head = lines[0].replace(/^📋\s*/, '')
  const cut = head.indexOf(': ')
  return { url, label: cut > 0 ? head.slice(0, cut) : 'Ordino', title: cut > 0 ? head.slice(cut + 2) : head, when: lines.length > 2 ? lines[1] : '' }
}
// its card: the label, the title, the day / call / place, View for everyone, and the link with Copy
export function OrdinoCard({ o, onView }) {
  const [done, setDone] = useState(false)
  const when = o.when || [o.date && new Date(o.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), o.call && `Call ${o.call}`, o.place].filter(Boolean).join(' · ')
  const copy = async (e) => {
    e.stopPropagation()
    try { await navigator.clipboard.writeText(o.url) } catch {
      const t = document.createElement('textarea'); t.value = o.url; document.body.appendChild(t); t.select(); try { document.execCommand('copy') } catch { /* nothing more to try */ } t.remove()
    }
    setDone(true); setTimeout(() => setDone(false), 1600)
  }
  return (
    <span className="ordc" style={{ '--oa': o.accent || '#d4a017' }} onClick={(e) => e.stopPropagation()}>
      <span className="ordc-top">
        <i className="ordc-ico">{TAB_I.files}</i>
        <span className="ordc-text"><span className="ordc-label">{o.label || 'Ordino'}</span><b>{ordName(o)}</b>{when && <small>{when}</small>}</span>
      </span>
      <button type="button" className="ordc-view" onClick={(e) => { e.stopPropagation(); onView() }}>View the Ordino</button>
      <span className="ordc-link"><a href={o.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{o.url.replace(/^https:\/\//, '')}</a><button type="button" className="ordc-copy" onClick={copy}>{done ? I.check : COPY_I}<span>{done ? 'Copied' : 'Copy'}</span></button></span>
    </span>
  )
}
const COPY_I = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>

// the ordino read inside RoarMe, its own published page in a window
export function OrdinoView({ o, onClose, onSend }) {
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return createPortal(
    <div className="prd" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="prd-card prw-ordwin">
        <div className="prd-head">
          <span className="prj-ftext"><b>{ordName(o)}</b><small>{o.label || 'Ordino'}</small></span>
          {onSend && <button type="button" className="pill-btn" onClick={onSend}>{FWD_I}<span>Send to…</span></button>}
          <a className="pill-btn" href={o.url} target="_blank" rel="noopener noreferrer">{I.right}<span>Open</span></a>
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
        </div>
        <iframe className="prw-ordframe" src={o.url} title={o.title || 'Ordino'} />
      </div>
    </div>,
    document.body,
  )
}
// pick chats to send to: groups first, this chat marked
function SendPick({ rooms, titleOf, here, onClose, onSend, title = 'Send the Ordino' }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState([])
  const [busy, setBusy] = useState(false)
  const list = rooms.filter((r) => !r.archived).filter((r) => !q.trim() || titleOf(r).toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'group' ? -1 : 1))
  const flip = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  return (
    <Modal title={title} onClose={onClose} foot={<button type="button" className="btn btn-main" disabled={!pick.length || busy} onClick={async () => { setBusy(true); await onSend(pick); setBusy(false) }}>{pick.length ? `Send to ${pick.length}` : 'Send'}</button>}>
      <input className="prw-sendq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" autoFocus />
      <div className="prw-sendlist">
        {list.map((r) => (
          <button key={r.room_id} type="button" className={`prw-sendrow${pick.includes(r.room_id) ? ' on' : ''}`} onClick={() => flip(r.room_id)}>
            <Avatar src={r.avatar_url} name={titleOf(r)} size={34} group={r.kind === 'group'} />
            <span className="prj-ftext"><b>{titleOf(r)}</b><small>{r.room_id === here ? 'This chat' : r.kind === 'group' ? `${(r.members || []).length} members` : 'Direct'}</small></span>
            <i className="prw-check">{pick.includes(r.room_id) && I.check}</i>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/* ---------- a song as a slim bar (Alex, 22 Nov: "like the ordino, a small box, the song with its waveform, play; it keeps
   playing when the chat changes and when the phone is locked; and send it as the other chats do"): the one player of the
   app plays it (so it goes on across chats, in the big player and on the lock screen); its waveform fills as it plays and
   a tap on it goes to that moment ---------- */
function SongBar({ m, from, roomId, who, onSendHere, onSendTo, onDrop }) {
  const p = usePlayer()
  const [url, setUrl] = useState('')
  useEffect(() => { let alive = true; fileLink(m.file).then((u) => { if (alive) setUrl(u) }).catch(() => {}); return () => { alive = false } }, [m.file?.path])
  const key = m.file.path
  const mine = p.key === key
  const playing = mine && p.playing
  const frac = mine && p.dur ? p.at / p.dur : 0
  const peaks = (mine && p.peaks) || shapeOf(key)
  const name = (m.file.name || 'Audio').replace(AUDIO_EXT, '')
  const ext = ((m.file.name || '').match(AUDIO_EXT) || [])[1]?.toUpperCase() || 'AUDIO'
  const go = () => { if (url) player.toggle({ key, url, title: name, from, roomId, file: m.file }) }
  const seek = (e) => { if (!mine || !p.dur) { go(); return } const r = e.currentTarget.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width) }
  return (
    <div className={`prw-song${playing ? ' on' : ''}`}>
      <button type="button" className="prw-song-play" onClick={go} disabled={!url} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" /></svg> : <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>}</button>
      <span className="prw-song-mid">
        <span className="prw-song-top"><b>{name}</b><small>{ext} · {sizeText(m.file.size)}{who ? ` · ${who}` : ''}</small></span>
        <span className="prw-wave" onClick={seek} role="slider" aria-label="Position" aria-valuenow={Math.round(frac * 100)} tabIndex={0}>
          {peaks.map((h, i) => <i key={i} className={i / peaks.length < frac ? 'done' : ''} style={{ height: `${Math.round(h * 100)}%` }} />)}
        </span>
      </span>
      <span className="prw-song-time">{mine ? `${mmss(p.at)} / ${p.dur ? mmss(p.dur) : '–:––'}` : ''}</span>
      <span className="prw-ordacts">
        {onSendHere && <button type="button" className="round prw-ibtn" onClick={onSendHere} title="Send to This Chat" aria-label="Send to This Chat">{SEND_I}</button>}
        {onSendTo && <button type="button" className="round prw-ibtn" onClick={onSendTo} title="Send to…" aria-label="Send to…">{FWD_I}</button>}
        {onDrop && <Trash className="prw-ibtn" onClick={onDrop} />}
      </span>
    </div>
  )
}

/* ---------- Admin, for the group's admins (Alex, 22 Nov: "budget, entering expenses, who worked and their fees, and the
   statistics a little more gathered below"): roar_pro_admin, read and written only by the group's admins ---------- */
const EXP_CATS = ['Equipment', 'Location', 'Crew', 'Transport', 'Food', 'Post-production', 'Props and Wardrobe', 'Other']
const today = () => new Date().toISOString().slice(0, 10)
function Admin({ room, people, me, project, toast }) {
  // the group's admins, and the members they let in (access), see this; only the group's admins choose who
  const boss = room.role === 'admin'
  const [row, setRow] = useState(undefined)
  const [exp, setExp] = useState({ what: '', amount: '', cat: 'Equipment', date: today(), by: '' })
  const [man, setMan] = useState({ name: '', role: '', fee: '' })
  useEffect(() => {
    let gone = false
    supabase.from('roar_pro_admin').select('*').eq('room_id', room.room_id).maybeSingle().then(({ data, error }) => { if (!gone) setRow(error ? null : data || (boss ? { room_id: room.room_id, budget: null, currency: 'EUR', expenses: [], crew: [], access: [] } : null)) })
    return () => { gone = true }
  }, [room.room_id])
  const save = async (patch) => {
    const next = { ...row, ...patch }
    setRow(next)
    const body = { budget: next.budget, currency: next.currency || 'EUR', expenses: next.expenses || [], crew: next.crew || [], ...(boss ? { access: next.access || [] } : {}) }
    const { error } = boss ? await supabase.from('roar_pro_admin').upsert({ room_id: room.room_id, ...body }, { onConflict: 'room_id' })
      : await supabase.from('roar_pro_admin').update(body).eq('room_id', room.room_id)
    if (error) toast(errText(error))
  }
  if (row === undefined) return <p className="prj-quiet">Loading…</p>
  if (row === null) return <p className="prj-quiet">Only the group's admins can see this.</p>
  const cur = row.currency || 'EUR'
  const money = (n) => { try { return new Intl.NumberFormat([], { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(Number(n) || 0) } catch { return `${Math.round(Number(n) || 0)} ${cur}` } }
  const expenses = Array.isArray(row.expenses) ? row.expenses : []
  const crew = Array.isArray(row.crew) ? row.crew : []
  const spent = expenses.reduce((a, x) => a + (Number(x.amount) || 0), 0)
  const fees = crew.reduce((a, x) => a + (Number(x.fee) || 0), 0)
  const unpaid = crew.filter((x) => !x.paid).reduce((a, x) => a + (Number(x.fee) || 0), 0)
  const budget = Number(row.budget) || 0
  const used = spent + fees
  const left = budget - used
  const byCat = EXP_CATS.map((c) => [c, expenses.filter((x) => x.cat === c).reduce((a, x) => a + (Number(x.amount) || 0), 0)]).filter(([, n]) => n > 0)
  const names = (room.members || []).map((id) => nameOf(people[id])).filter(Boolean)
  return (
    <div className="pra">
      {boss && (
        <div className="prw-box pra-access">
          <div className="prw-boxhead"><h4>Who Sees Admin</h4><small className="pra-total">The group's admins always do</small></div>
          <div className="pra-people">
            {(room.members || []).filter((id) => id !== me.id).map((id) => {
              const on = (row.access || []).includes(id)
              return <button key={id} type="button" className={`pra-person${on ? ' on' : ''}`} onClick={() => save({ access: on ? (row.access || []).filter((x) => x !== id) : [...(row.access || []), id] })}><Avatar src={people[id]?.avatar_url} name={nameOf(people[id])} size={26} /><span>{nameOf(people[id])}</span><i className="prw-check">{on && I.check}</i></button>
            })}
          </div>
        </div>
      )}
      <div className="pra-sum">
        <label className="pra-tile budget"><span>Budget</span><span className="pra-money"><input type="number" min="0" step="50" value={row.budget ?? ''} placeholder="0" onChange={(e) => setRow({ ...row, budget: e.target.value === '' ? null : Number(e.target.value) })} onBlur={() => save({ budget: row.budget })} /><select value={cur} onChange={(e) => save({ currency: e.target.value })}>{['EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select></span></label>
        <div className="pra-tile"><span>Expenses</span><b>{money(spent)}</b></div>
        <div className="pra-tile"><span>Fees</span><b>{money(fees)}</b>{unpaid > 0 && <small>{money(unpaid)} unpaid</small>}</div>
        <div className={`pra-tile${left < 0 ? ' over' : ''}`}><span>{left < 0 ? 'Over budget' : 'Left'}</span><b>{money(Math.abs(left))}</b></div>
      </div>
      {budget > 0 && <span className="prs-track pra-bar" title={`${Math.round((used / budget) * 100)}% of the budget`}><i style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} className={used > budget ? 'over' : ''} /></span>}
      <div className="pra-grid">
        <div className="prw-box">
          <div className="prw-boxhead"><h4>Expenses</h4><small className="pra-total">{money(spent)}</small></div>
          <form className="pra-form" onSubmit={(e) => { e.preventDefault(); const a = Number(exp.amount); if (!exp.what.trim() || !a) return; save({ expenses: [{ id: uid(), what: exp.what.trim().slice(0, 120), amount: a, cat: exp.cat, date: exp.date, by: exp.by.trim().slice(0, 60) }, ...expenses] }); setExp({ ...exp, what: '', amount: '' }) }}>
            <input className="w2" value={exp.what} onChange={(e) => setExp({ ...exp, what: e.target.value })} placeholder="What" maxLength={120} />
            <input type="number" min="0" step="0.01" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="Amount" />
            <select value={exp.cat} onChange={(e) => setExp({ ...exp, cat: e.target.value })}>{EXP_CATS.map((c) => <option key={c}>{c}</option>)}</select>
            <input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} />
            <input list="pra-names" value={exp.by} onChange={(e) => setExp({ ...exp, by: e.target.value })} placeholder="Paid by" maxLength={60} />
            <button type="submit" className="round pra-add" aria-label="Add expense" disabled={!exp.what.trim() || !Number(exp.amount)}>{I.plus}</button>
          </form>
          {byCat.length > 0 && <div className="pra-cats">{byCat.map(([c, n]) => <span key={c}><b>{money(n)}</b>{c}</span>)}</div>}
          <div className="pra-list">
            {expenses.map((x) => (
              <div key={x.id} className="pra-row">
                <span className="pra-what"><b>{x.what}</b><small>{[x.cat, x.date && new Date(x.date).toLocaleDateString([], { day: 'numeric', month: 'short' }), x.by].filter(Boolean).join(' · ')}</small></span>
                <b className="pra-amt">{money(x.amount)}</b>
                <Trash onClick={() => { if (window.confirm(`Delete ${x.what}?`)) save({ expenses: expenses.filter((y) => y.id !== x.id) }) }} />
              </div>
            ))}
            {!expenses.length && <p className="prj-quiet">No expenses yet.</p>}
          </div>
        </div>
        <div className="prw-box">
          <div className="prw-boxhead"><h4>Who Worked</h4><small className="pra-total">{money(fees)}</small></div>
          <form className="pra-form crew" onSubmit={(e) => { e.preventDefault(); if (!man.name.trim()) return; save({ crew: [...crew, { id: uid(), name: man.name.trim().slice(0, 80), role: man.role.trim().slice(0, 60), fee: Number(man.fee) || 0, paid: false }] }); setMan({ name: '', role: '', fee: '' }) }}>
            <input list="pra-names" value={man.name} onChange={(e) => setMan({ ...man, name: e.target.value })} placeholder="Name" maxLength={80} />
            <input value={man.role} onChange={(e) => setMan({ ...man, role: e.target.value })} placeholder="Role (DoP, Gaffer…)" maxLength={60} />
            <input type="number" min="0" step="10" value={man.fee} onChange={(e) => setMan({ ...man, fee: e.target.value })} placeholder="Fee" />
            <button type="submit" className="round pra-add" aria-label="Add person" disabled={!man.name.trim()}>{I.plus}</button>
          </form>
          <div className="pra-list">
            {crew.map((x) => (
              <div key={x.id} className={`pra-row${x.paid ? ' paid' : ''}`}>
                <span className="pra-what"><b>{x.name}</b><small>{x.role || '—'}</small></span>
                <b className="pra-amt">{money(x.fee)}</b>
                <button type="button" className={`pra-paid${x.paid ? ' on' : ''}`} onClick={() => save({ crew: crew.map((y) => (y.id === x.id ? { ...y, paid: !y.paid } : y)) })}>{x.paid ? <>{I.check}Paid</> : 'Unpaid'}</button>
                <Trash onClick={() => { if (window.confirm(`Delete ${x.name}?`)) save({ crew: crew.filter((y) => y.id !== x.id) }) }} />
              </div>
            ))}
            {!crew.length && <p className="prj-quiet">No one added yet.</p>}
          </div>
        </div>
      </div>
      <datalist id="pra-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <h6 className="prw-h pra-stats-h">The Chat in Numbers</h6>
      <Stats room={room} people={people} me={me} project={project} compact />
    </div>
  )
}

function Work({ room, project, kit, me, people = {}, toast, title, onJump, onChanged, rooms = [], titleOf = () => '', onSwap, phone = false }) {
  const stuff = useRoomStuff(room.room_id)
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem(`roarme-pro-tab-${room.room_id}`) || 'overview' } catch { return 'overview' } })
  const [menu, setMenu] = useState('')
  const [stagesOpen, setStagesOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [mf, setMf] = useState('all')
  const [view, setView] = useState(null)
  const [doc, setDoc] = useState(null)
  const [ordinoOpen, setOrdinoOpen] = useState(false)
  const [ordView, setOrdView] = useState(null)
  const artistOf = () => ((Array.isArray(project.fields) ? project.fields : []).find((f) => f.k === 'Artist / Client')?.v || '').trim()
  const [ordSend, setOrdSend] = useState(null)
  const [songSend, setSongSend] = useState(null)
  const [adminIn, setAdminIn] = useState(room.role === 'admin')
  useEffect(() => { if (room.role === 'admin') { setAdminIn(true); return } supabase.from('roar_pro_admin').select('room_id').eq('room_id', room.room_id).maybeSingle().then(({ data }) => setAdminIn(!!data), () => {}) }, [room.room_id, room.role])
  // a song sent on: into this chat again, or a copy of the file into each chosen chat (each chat keeps its own files)
  const sendSong = async (m, ids) => {
    let bad = null
    for (const id of ids) {
      let file = m.file
      if (id !== room.room_id) {
        const to = `${id}/${uid()}-${file.path.split('/').pop().replace(/^[0-9a-f-]{36}-/, '')}`
        const { error } = await supabase.storage.from(file.bucket || 'roar-files').copy(file.path, to)
        if (error) { bad = error; continue }
        file = { ...file, path: to }
      }
      const { error } = await supabase.from('roar_messages').insert({ room_id: id, user_id: me.id, kind: 'file', body: '', file })
      if (error) bad = error
    }
    if (bad) { toast(errText(bad)); return false }
    toast(ids.length === 1 && ids[0] === room.room_id ? 'Sent to this chat' : `Sent to ${ids.length} chat${ids.length === 1 ? '' : 's'}`)
    return true
  }
  const songBar = (m) => <SongBar key={m.id} m={m} from={title} roomId={room.room_id} who={m.user_id === me.id ? 'You' : nameOf(people[m.user_id]).split(' ')[0]} onSendTo={() => setSongSend(m)} onDrop={() => drop(m, 'this song')} />
  // the ordino goes into a chat as a message with its link (Alex, 22 Nov: "throw it in the group, or send it to another")
  const sendOrdino = async (o, ids) => {
    const when = [o.date && new Date(o.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), o.call && `Call ${o.call}`, o.place].filter(Boolean).join(' · ')
    const name = ordName({ ...o, title: o.title || title }, artistOf())
    const body = `📋 ${o.label || 'Ordino'}: ${name}${when ? `\n${when}` : ''}\n${o.url}`
    const { error } = await supabase.from('roar_messages').insert(ids.map((id) => ({ room_id: id, user_id: me.id, kind: 'text', body, file: { ordino: { url: o.url, token: o.token || '', label: o.label || '', title: o.title || title, artist: o.artist || artistOf(), date: o.date || '', call: o.call || '', place: o.place || '', accent: o.accent || '' } } })))
    if (error) { toast(errText(error)); return false }
    toast(ids.length === 1 && ids[0] === room.room_id ? 'Ordino sent to this chat' : `Ordino sent to ${ids.length} chat${ids.length === 1 ? '' : 's'}`)
    return true
  }
  const notesOn = !!usePrefs().proNotes
  const [gone, setGone] = useState(() => new Set())
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => { supabase.rpc('roar_is_admin').then(({ data }) => setIsAdmin(data === true), () => {}) }, [])
  // a bin asks twice (Alex, 22 Nov): one's own thing is deleted for everyone (it leaves the chat too), an admin deletes
  // anyone's, someone else's is only taken away for me (Delete for Me)
  const drop = async (m, what = 'this') => {
    const mine = m.user_id === me.id
    const all = mine || isAdmin
    if (!window.confirm(all ? `Delete ${what} for everyone? It leaves the chat too.` : `Remove ${what} for you? The others still see it.`)) return
    if (!window.confirm('Are you sure? This cannot be undone.')) return
    const { error } = mine ? await supabase.from('roar_messages').update({ deleted_at: new Date().toISOString(), body: '' }).eq('id', m.id)
      : isAdmin ? await supabase.rpc('roar_admin_delete_message', { m: m.id })
      : await supabase.from('roar_msg_hides').upsert({ user_id: me.id, message_id: m.id, room_id: room.room_id })
    if (error) { toast(errText(error)); return }
    setGone((g) => new Set([...g, m.id]))
    if (!all) window.dispatchEvent(new CustomEvent('roarme-hide', { detail: { room: room.room_id, id: m.id } }))
    toast(all ? 'Deleted' : 'Removed for you')
  }
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem(hiddenKey(room.room_id)) || '[]') } catch { return [] } })
  const flipTab = (k) => { const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k]; setHidden(next); try { localStorage.setItem(hiddenKey(room.room_id), JSON.stringify(next)) } catch { /* private window */ } }
  const save = (patch) => kit.save(room.room_id, patch).catch((e) => toast(errText(e)))
  // the first facts brought to today's set, once: Location and Lead go, Client becomes Artist / Client, Title and Category
  // come in, in FIELD_START's order with anything else after (Alex, 22 Nov)
  useEffect(() => {
    const f = (Array.isArray(project.fields) ? project.fields : []).filter((x) => x.k !== 'Location' && x.k !== 'Lead' && ((x.k || '').trim() || (x.v || '').trim()) && !(x.k === 'Field' && !(x.v || '').trim())).map((x) => (x.k === 'Client' ? { ...x, k: 'Artist / Client' } : x))
    const next = [...FIELD_START.map((k) => f.find((x) => x.k === k) || { k, v: '' }), ...f.filter((x) => !FIELD_START.includes(x.k))]
    if (JSON.stringify(next) !== JSON.stringify(project.fields || [])) save({ fields: next })
  }, [project.room_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const tabsRef = useRef([])
  useEffect(() => {
    if (!phone) return undefined
    const f = (e) => {
      if (e.detail?.room !== room.room_id) return
      const keys = tabsRef.current, i = keys.indexOf(tabRef.current)
      const n = i + e.detail.dir
      if (n < 0) window.dispatchEvent(new CustomEvent('roarme-pro-chat', { detail: { room: room.room_id } }))
      else if (n < keys.length) goTabRef.current(keys[n])
    }
    window.addEventListener('roarme-pro-swipe', f)
    return () => window.removeEventListener('roarme-pro-swipe', f)
  }, [phone, room.room_id])
  const tabRef = useRef('')
  const goTabRef = useRef(null)
  const goTab = (t) => { setTab(t); requestAnimationFrame(() => document.querySelector('.prw-tabs.slide .prw-bar > button.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })); try { sessionStorage.setItem(`roarme-pro-tab-${room.room_id}`, t) } catch { /* private window */ } }
  // a tap on the small line in the chat ("2 photos went to Media") or on a #tag opens that tab
  useEffect(() => {
    const f = (e) => { if (e.detail?.room !== room.room_id) return; const t = { places: 'links', music: 'files', contacts: 'contacts' }[e.detail.tab] || e.detail.tab; if (t) goTab(t) }
    window.addEventListener('roarme-pro-tab', f)
    return () => window.removeEventListener('roarme-pro-tab', f)
  }, [room.room_id])
  const assets = (stuff.assets || []).filter((m) => !gone.has(m.id))
  const media = assets.filter(isMediaMsg)
  const files = assets.filter((m) => isFileMsg(m) && !isMediaMsg(m) && folderOf(m) !== 'audio')
  const music = assets.filter((m) => isFileMsg(m) && folderOf(m) === 'audio')
  const places = assets.filter((m) => m.file.location || m.file.live)
  const polls = assets.filter((m) => m.file.poll)
  const cards = assets.filter((m) => m.file.contact)
  const calls = [...assets.filter((m) => m.file.groupcall), ...(stuff.meets || []).filter((m) => !gone.has(m.id))]
  const words = stuff.words.filter((m) => !gone.has(m.id))
  const links = words.filter((m) => URL_RX.test(m.body) && ((URL_RX.lastIndex = 0), true))
  const linkCount = links.reduce((a, m) => a + [...new Set(String(m.body).match(URL_RX) || [])].filter((u) => !isMapLink(u)).length, 0)
  const maps = words.flatMap((m) => [...new Set(String(m.body).match(URL_RX) || [])].filter(isMapLink).map((u) => ({ u, m })))
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const scouts = Array.isArray(project.scouts) ? project.scouts : []
  const fields = Array.isArray(project.fields) ? project.fields : []
  const ordinos = Array.isArray(project.ordinos) ? project.ordinos : []
  const st = stageOf(project)
  const dateName = project.date_label || 'Shoot Date'
  const TABS = [['overview', 'Overview'], ['media', 'Media', media.length], ['files', 'Files', files.length + music.length], ['scout', 'Location Scout', scouts.length], ['calls', 'Calls & Meetings', calls.length], ['links', 'Links', linkCount + places.length + maps.length], 
    ...(polls.length ? [['polls', 'Polls', polls.length]] : []), ...(cards.length ? [['contacts', 'Contacts', cards.length]] : []),
    ['tasks', 'Tasks', tasks.length ? `${tasks.filter((t) => t.s === 'done').length}/${tasks.length}` : 0], adminIn ? ['admin', 'Admin'] : ['stats', 'Stats']].filter(([k]) => !hidden.includes(k))
  // on a phone the project opens on a home of its own (the cover, the songs, the ordino, the details) and tiles for the
  // rest; a tile opens its page with a back (Alex, 22 Nov: "the second, with the tiles")
  // a phone has version A (Alex, 22 Nov: "in the end I want version A"): the same tabs as a row that slides sideways
  const shownTab = TABS.some((t) => t[0] === tab) ? tab : 'overview'
  tabsRef.current = TABS.map((t) => t[0])
  tabRef.current = shownTab
  goTabRef.current = goTab
  const shownMedia = media.filter((m) => mf === 'all' || folderOf(m) === mf)
  const openMedia = (list, i) => setView({ items: list, index: i })
  // Artist / Client and Title name the group (Alex, 22 Nov: "as soon as something is written there it becomes the group's
  // name"): "Artist – Title", or the one that is there
  const setField = (i, patch) => {
    const next = fields.map((f, n) => (n === i ? { ...f, ...patch } : f))
    save({ fields: next })
    const val = (k) => (next.find((f) => f.k === k)?.v || '').trim()
    const name = [val('Artist / Client'), val('Title')].filter(Boolean).join(' – ').slice(0, 80)
    if (name && name !== title && ['Artist / Client', 'Title'].includes(next[i]?.k)) {
      supabase.from('roar_rooms').update({ title: name }).eq('id', room.room_id).then(({ error }) => { if (error) toast('Only an admin of the group can change its name'); else onChanged?.() })
    }
  }
  const members = (room.members || []).slice(0, 5)
  return (
    <div className="prw-work">
      <div className="prw-top">
        <span className="prw-hang">
          <button type="button" className="prw-pill stage" style={{ '--pc': st.c }} onClick={() => setMenu(menu === 'stage' ? '' : 'stage')}><i className="prw-dot" /><span className="prw-st-name">{st.name}</span><span className="prw-caret">{I.down}</span></button>
          <Hang open={menu === 'stage'} onClose={() => setMenu('')}>
            {stagesOf(project).map((s) => <button key={s.id} type="button" onClick={() => { save({ status: s.id }); setMenu('') }}><i className="prw-dot" style={{ '--pc': s.c }} /><span>{s.name}</span>{s.id === st.id && <b className="prw-tick">{I.check}</b>}</button>)}
            <hr />
            <button type="button" onClick={() => { setMenu(''); setStagesOpen(true) }}>{I.edit || I.plus}<span>Rename Stages</span></button>
          </Hang>
        </span>
        <span className="prw-pill date">
          <span className="prw-hang">
            <button type="button" className="prw-datename" onClick={() => setMenu(menu === 'date' ? '' : 'date')}>{I.calendar}<span>{dateName}</span><span className="prw-caret">{I.down}</span></button>
            <Hang open={menu === 'date'} onClose={() => setMenu('')}>
              {DATE_NAMES.map((d) => <button key={d} type="button" onClick={() => { save({ date_label: d }); setMenu('') }}><span>{d}</span>{d === dateName && <b className="prw-tick">{I.check}</b>}</button>)}
              <hr />
              <form className="prw-custom" onSubmit={(e) => { e.preventDefault(); const v = custom.trim(); if (v) { save({ date_label: v.slice(0, 30) }); setCustom(''); setMenu('') } }}>
                <input value={custom} maxLength={30} placeholder="Your own name" onChange={(e) => setCustom(e.target.value)} />
              </form>
            </Hang>
          </span>
          <input type="date" value={project.due || ''} onChange={(e) => save({ due: e.target.value || null })} aria-label={dateName} />
        </span>
        <span className="prw-faces">{members.map((id) => <Avatar key={id} src={people[id]?.avatar_url} name={nameOf(people[id])} size={30} />)}{(room.members || []).length > 5 && <i>+{room.members.length - 5}</i>}</span>
        {onSwap && !phone && <button type="button" className="round prw-gear prw-swap" onClick={onSwap} title="Swap the chat and this side" aria-label="Swap sides">{SWAP_I}</button>}
        <span className="prw-hang prw-gear-wrap">
          <button type="button" className={`round prw-gear${menu === 'gear' ? ' on' : ''}`} onClick={() => setMenu(menu === 'gear' ? '' : 'gear')} aria-label="Project settings" title="Project settings">{I.gear}</button>
          <Hang open={menu === 'gear'} onClose={() => setMenu('')} className="right">
            <span className="prw-mcap">Tabs</span>
            {OPTIONAL.map(([k, l]) => (k === 'stats' && adminIn ? ['admin', 'Admin'] : [k, l])).map(([k, l]) => <button key={k} type="button" onClick={() => flipTab(k)}>{TAB_I[k]}<span>{l}</span><i className={`prw-sw${hidden.includes(k) ? '' : ' on'}`} /></button>)}
            <hr />
            <span className="prw-mcap">Chat</span>
            <button type="button" onClick={() => setPrefs({ proNotes: !getPrefs().proNotes })}>{TAB_I.media}<span>Show What Went to the Side</span><i className={`prw-sw${notesOn ? ' on' : ''}`} /></button>
            <hr />
            <button type="button" onClick={() => { setMenu(''); setStagesOpen(true) }}>{I.edit}<span>Rename Stages</span></button>
            <button type="button" className="danger" onClick={() => { setMenu(''); if (window.confirm('Stop this group being a project? Its stage, brief, fields, tasks and locations are deleted; the chat stays.')) kit.remove(room.room_id).catch((e) => toast(errText(e))) }}>{I.trash}<span>Stop Being a Project</span></button>
          </Hang>
        </span>
      </div>
      <div className={`prw-tabs${phone ? ' slide' : ''}`}><Lens as="nav" className="prw-bar" dep={`${shownTab}${TABS.length}`}>{TABS.map(([k, l, n]) => <button key={k} type="button" className={shownTab === k ? 'on' : ''} onClick={() => goTab(k)} title={l} aria-label={l}><span className="prw-bi">{TAB_I[k]}{n ? <small>{n}</small> : null}</span></button>)}</Lens></div>
      <div className="prw-body"><div key={shownTab} className="prw-pane">
        {shownTab === 'overview' && (
          <div className="prw-over">
            <Hero photos={media.filter((m) => folderOf(m) === 'photos' || m.file?.thumb)} room={room} me={me} project={project} st={st} dateName={dateName} fields={fields} toast={toast} onCover={save} onBrief={(v) => save({ brief: v.slice(0, 4000) })} />
            <div className="prw-box prw-brief-box wide">
              <h4>Details</h4>
              <datalist id="prw-cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              <div className="prw-facts">
                {fields.map((f, i) => (
                  <div key={i} className="prw-fact">
                    <Field className="prw-fact-k" value={f.k} placeholder="Field" onSave={(k) => setField(i, { k: k.slice(0, 40) })} />
                    <Field className="prw-fact-v" value={f.v} placeholder="—" list={f.k === 'Category' ? 'prw-cats' : undefined} onSave={(v) => setField(i, { v: v.slice(0, 200) })} />
                    <Trash className="prw-fact-del" onClick={() => { if (!(f.v || '').trim() || window.confirm(`Delete ${f.k || 'this field'}?`)) save({ fields: fields.filter((_, n) => n !== i) }) }} />
                  </div>
                ))}
                {fields.length < 20 && <button type="button" className="prw-fact add" onClick={() => save({ fields: [...fields, { k: '', v: '' }] })}>{I.plus}<span>Add Field</span></button>}
              </div>
            </div>
            {music.length > 0 && <div className="prw-songs wide">{music.slice(0, 3).map((m) => songBar(m))}{music.length > 3 && <button type="button" className="pill-btn prw-boxbtn prw-more-songs" onClick={() => goTab('files')}><span>All {music.length} songs</span>{I.right}</button>}</div>}
            {/* the ordino as a slim bar under the cover (Alex, 22 Nov: "there is usually one, the big box stays empty") */}
            <div className="prw-ordbar wide">
              {ordinos.length ? ordinos.map((o) => (
                <div key={o.token || o.url} className="prw-ordrow" style={{ '--oa': o.accent || '#d40000' }}>
                  {o.date && !Number.isNaN(new Date(o.date).getTime()) ? <i className="prw-ordino-cal"><small>{new Date(o.date).toLocaleDateString([], { month: 'short' })}</small><b>{new Date(o.date).getDate()}</b></i> : <i className="prw-ordino-cal"><b>{TAB_I.files}</b></i>}
                  <button type="button" className="prw-ordtext" onClick={() => setOrdView({ ...o, artist: o.artist || artistOf() })}>
                    <span className="prw-ordino-label">{o.label || 'Ordino'}</span>
                    <b>{ordName(o, artistOf())}</b>
                    <small>{[o.date && new Date(o.date).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), o.call && `Call ${o.call}`, o.place].filter(Boolean).join(' · ')}</small>
                  </button>
                  <span className="prw-ordacts">
                    <button type="button" className="pill-btn" onClick={() => setOrdView({ ...o, artist: o.artist || artistOf() })}>{TAB_I.files}<span>View</span></button>
                    <button type="button" className="pill-btn" onClick={() => sendOrdino(o, [room.room_id])}>{SEND_I}<span>Send to This Chat</span></button>
                    <button type="button" className="pill-btn" onClick={() => setOrdSend(o)}>{FWD_I}<span>Send to…</span></button>
                    <button type="button" className="round prw-ibtn" onClick={() => setOrdinoOpen(true)} title="Edit in Roardino" aria-label="Edit in Roardino">{I.edit}</button>
                    <Trash className="prw-ibtn" onClick={() => { if (window.confirm('Take this ordino out of the project?') && window.confirm('Are you sure? The call sheet itself stays in Roardino.')) save({ ordinos: ordinos.filter((x) => x !== o) }) }} />
                  </span>
                </div>
              )) : (
                <button type="button" className="prw-ordmake" onClick={() => setOrdinoOpen(true)}><i className="prw-ordino-cal"><b>{TAB_I.files}</b></i><span><b>Make the Ordino</b><small>The call sheet, in Roardino; it stays here and can be sent to any chat</small></span>{I.plus}</button>
              )}
            </div>
            {media.length > 0 && <div className="prw-box wide"><div className="prw-boxhead"><h4>Latest Media</h4><button type="button" className="pill-btn prw-boxbtn" onClick={() => goTab('media')}><span>See All</span>{I.right}</button></div><div className="prw-grid mosaic">{media.slice(0, 7).map((m, i) => <Tile key={m.id} m={m} onOpen={() => openMedia(media, i)} onDrop={drop} />)}</div></div>}
          </div>
        )}
        {shownTab === 'media' && (
          <>
            <div className="prw-sub"><Lens className="seg prw-seg" dep={mf}>{[['all', 'All'], ['photos', 'Photos'], ['videos', 'Videos']].map(([k, l]) => <button key={k} type="button" className={mf === k ? 'on' : ''} onClick={() => setMf(k)}>{l}</button>)}</Lens></div>
            {stuff.assets === null ? <p className="prj-quiet">Loading…</p> : shownMedia.length ? <div className="prw-grid big">{shownMedia.map((m, i) => <Tile key={m.id} m={m} onOpen={() => openMedia(shownMedia, i)} onDrop={drop} />)}</div> : <p className="prj-quiet">No photos or videos yet. What is sent in the chat comes here.</p>}
          </>
        )}
        {shownTab === 'files' && (files.length + music.length ? (
          <div className="prw-filesecs">
            {[['docs', 'Documents'], ['audio', 'Music'], ['other', 'Other']].map(([k, label]) => {
              const list = k === 'audio' ? music : files.filter((m) => (k === 'docs' ? folderOf(m) === 'docs' : folderOf(m) !== 'docs'))
              if (!list.length) return null
              return (
                <section key={k} className="prw-filesec">
                  <h6 className="prw-h">{label}<small>{list.length}</small></h6>
                  {k === 'audio' ? <div className="prw-songs">{list.map((m) => songBar(m))}</div> : (
                    <div className="prj-list prw-files">{list.map((m) => (
                      <div key={m.id} className="prw-link"><button type="button" className="prj-row" onClick={() => setDoc(m)}><Thumb m={m} /><span className="prj-ftext"><b>{m.file.name || 'File'}</b><small>{[sizeText(m.file.size), m.user_id === me.id ? 'You' : nameOf(people[m.user_id]), day(m.created_at)].filter(Boolean).join(' · ')}</small>{m.body?.trim() && <em>{m.body.trim()}</em>}</span></button><Trash onClick={() => drop(m, 'this file')} /></div>
                    ))}</div>
                  )}
                </section>
              )
            })}
          </div>
        ) : <p className="prj-quiet">{stuff.assets === null ? 'Loading…' : 'No files yet. Documents, music and anything else sent in the chat come here.'}</p>)}
        {shownTab === 'scout' && <Scout project={project} save={save} room={room} toast={toast} onView={(ph, i) => openMedia(ph.map((p) => ({ id: p.path, user_id: '', created_at: project.updated_at, file: p, body: '' })), i)} />}
        {shownTab === 'calls' && <Calls list={calls} room={room} people={people} me={me} onDrop={drop} />}
        {shownTab === 'links' && (linkCount + places.length + maps.length ? (
          <div className="prw-filesecs">
            {linkCount > 0 && <section className="prw-filesec"><h6 className="prw-h">Links<small>{linkCount}</small></h6><Links words={links} people={people} me={me} onJump={onJump} onDrop={drop} /></section>}
            {places.length + maps.length > 0 && <section className="prw-filesec"><h6 className="prw-h">Places<small>{places.length + maps.length}</small></h6><Places list={places} maps={maps} people={people} me={me} onDrop={drop} hasUrl={(u) => scouts.some((x) => x.mapsUrl === u)}
          onAdd={(p) => { save({ scouts: [...scouts, { id: uid(), type: 'Exterior', st: 'option', contact: '', phone: '', notes: '', tags: [], photos: [], ...p }] }); toast(`${p.name} added to Location Scout`) }} /></section>}
          </div>
        ) : <p className="prj-quiet">No links yet. Links and places sent in the chat stay there and gather here too.</p>)}
        {shownTab === 'polls' && <div className="prw-polls">{polls.map((m) => <div key={m.id} className="prj-poll prw-pollwrap"><Trash className="corner" onClick={() => drop(m, 'this poll')} /><Suspense fallback={<p className="prj-quiet">Poll</p>}><PollCard id={m.id} me={me.id} people={people} canStop={room.role === 'admin'} /></Suspense></div>)}</div>}
        {shownTab === 'contacts' && <Contacts list={cards} people={people} onDrop={drop} />}
        {shownTab === 'tasks' && <Board list={tasks} onChange={(next) => save({ tasks: next })} />}
        {shownTab === 'stats' && <Stats room={room} people={people} me={me} project={project} />}
        {shownTab === 'admin' && <Admin room={room} people={people} me={me} project={project} toast={toast} />}
      </div>
      </div>
      {stagesOpen && <Stages project={project} save={save} onClose={() => setStagesOpen(false)} />}
      {doc && <DocView m={doc} onClose={() => setDoc(null)} />}
      {ordView && <OrdinoView o={ordView} onClose={() => setOrdView(null)} onSend={() => { setOrdSend(ordView); setOrdView(null) }} />}
      {songSend && <SendPick title="Send the Song" rooms={rooms} titleOf={titleOf} here={room.room_id} onClose={() => setSongSend(null)} onSend={async (ids) => { if (await sendSong(songSend, ids)) setSongSend(null) }} />}
      {ordSend && <SendPick rooms={rooms} titleOf={titleOf} here={room.room_id} onClose={() => setOrdSend(null)} onSend={async (ids) => { if (await sendOrdino(ordSend, ids)) setOrdSend(null) }} />}
      {ordinoOpen && <OrdinoWindow onClose={() => setOrdinoOpen(false)} onSent={(o) => { save({ ordinos: [o, ...ordinos.filter((x) => x.token !== o.token)].slice(0, 60) }); setOrdinoOpen(false); toast('Ordino saved in the project') }} />}
      {view && <Viewer items={view.items} index={view.index} people={people} me={me} onClose={() => setView(null)} />}
    </div>
  )
}

/* the panel: in a project the workspace, and the chat a column whose width is dragged by the edge between them; elsewhere
   the small panel of 22 Nov, its width dragged by its left edge. Widths kept on the device, a double click resets. */
const PRJ_W = 330, CHAT_W = 400
const prjMax = () => Math.max(300, Math.min(640, window.innerWidth - 760))
const lsNum = (k, d) => { try { return Number(localStorage.getItem(k)) || d } catch { return d } }
const lsPut = (k, v) => { try { localStorage.setItem(k, String(Math.round(v))) } catch { /* private window */ } }
export function ProPanel(props) {
  // a project, or (Alex, 22 Nov) a chat with one person, whose profile page stands at the right
  const big = (props.room.kind === 'group' && !!props.project) || !!props.profile
  const [w, setW] = useState(() => lsNum('roarme-pro-w', PRJ_W))
  const [cw, setCw] = useState(() => lsNum('roarme-pro-chat', CHAT_W))
  // the chat on the left or on the right of the workspace (Alex, 22 Nov: "a small button to bring the chat to the right")
  const [swap, setSwap] = useState(() => { try { return localStorage.getItem('roarme-pro-swap') === '1' } catch { return false } })
  const flipSides = () => { const v = !swap; setSwap(v); try { localStorage.setItem('roarme-pro-swap', v ? '1' : '0') } catch { /* private window */ } }
  const [dragging, setDragging] = useState(false)
  const wrap = useRef(null)
  useLayoutEffect(() => { const p = wrap.current?.parentElement; if (p) { p.style.setProperty('--pro-chat', `${cw}px`); p.classList.toggle('swap', big && swap) } }, [cw, big, swap])
  const drag = (e) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = big ? cw : w
    const room = wrap.current?.parentElement?.clientWidth || window.innerWidth
    let last = w0
    document.documentElement.classList.add('prj-dragging')
    const move = (ev) => {
      if (big) { last = Math.max(320, Math.min(room - 460, w0 + (swap ? -1 : 1) * (ev.clientX - x0))); setCw(last) } else { last = Math.max(260, Math.min(prjMax(), w0 + (x0 - ev.clientX))); setW(last) }
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.documentElement.classList.remove('prj-dragging'); lsPut(big ? 'roarme-pro-chat' : 'roarme-pro-w', last) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const reset = () => { if (big) { setCw(CHAT_W); lsPut('roarme-pro-chat', CHAT_W) } else { setW(PRJ_W); lsPut('roarme-pro-w', PRJ_W) } }
  const narrow = useNarrow()
  const [side, setSide] = useState('chat')
  // a slide sideways moves about (Alex, 22 Nov): on the chat, a slide to the left that starts off a message opens the
  // project (on a message it is the reply); on the project, left and right go through its tabs, and right on the first
  // one goes back to the chat
  const anchor = useRef(null)
  const sideRef = useRef(side)
  sideRef.current = side
  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!narrow || !host) return undefined
    let s = null
    const start = (e) => {
      const t = e.target
      s = e.touches.length === 1 && !t.closest?.('input, textarea, select, canvas, .prw-tabs, .prw-sw2, .prw-wave, .prs-cols, .prw-strip, .prw-hero-tools, .map, [id^="m-"], .compose, .composer') ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null
    }
    const end = (e) => {
      if (!s) return
      const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y
      const ok = Date.now() - s.t < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6
      s = null
      if (!ok) return
      if (sideRef.current === 'chat') { if (dx < 0) setSide('proj'); return }
      window.dispatchEvent(new CustomEvent('roarme-pro-swipe', { detail: { dir: dx < 0 ? 1 : -1, room: props.room.room_id } }))
    }
    host.addEventListener('touchstart', start, { passive: true })
    host.addEventListener('touchend', end)
    const back = (e) => { if (e.detail?.room === props.room.room_id) setSide('chat') }
    window.addEventListener('roarme-pro-chat', back)
    return () => { host.removeEventListener('touchstart', start); host.removeEventListener('touchend', end); window.removeEventListener('roarme-pro-chat', back) }
  }, [narrow, props.room.room_id])
  if (narrow) {
    // two pages: the chat as it is, and the project over it; a Chat | Project switch under the chat's head
    const sw = <span className="prw-sw2" role="tablist"><button type="button" className={side === 'chat' ? 'on' : ''} onClick={() => setSide('chat')}>Chat</button><button type="button" className={side === 'proj' ? 'on' : ''} onClick={() => setSide('proj')}><span className="prw-gold">Project</span></button></span>
    return (
      <>
        <span ref={anchor} hidden />
        {side === 'chat' && <div className="prw-sw2-float">{sw}</div>}
        {side === 'proj' && (
          <div className="prw-phone">
            <div className="prw-phone-top">{sw}</div>
            {big ? <Work {...props} phone /> : <aside className="prj prw-phone-small"><ProInner {...props} /></aside>}
          </div>
        )}
      </>
    )
  }
  return (
    <div ref={wrap} className={`prj-wrap${big ? ' big' : ''}${dragging ? ' dropping' : ''}`} style={big ? undefined : { width: Math.min(w, prjMax()) }}
      onDragOver={(e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const files = [...(e.dataTransfer?.files || [])]; if (files.length) window.dispatchEvent(new CustomEvent('roarme-drop', { detail: { room: props.room.room_id, files } })) }}>
      {dragging && <span className="prw-drop"><b>Drop to send to the chat</b></span>}
      <span className="prj-grip" onPointerDown={drag} onDoubleClick={reset} title={big ? 'Drag to make the chat wider or narrower, double-click to reset' : 'Drag to widen or narrow, double-click to reset'} />
      {props.profile ? <div className="prw-pf"><button type="button" className="round prw-swap prw-swap-float" onClick={flipSides} title="Swap the chat and this side" aria-label="Swap sides">{SWAP_I}</button>{props.profile}</div> : big ? <Work {...props} onSwap={flipSides} /> : <aside className="prj"><ProInner {...props} /></aside>}
    </div>
  )
}
