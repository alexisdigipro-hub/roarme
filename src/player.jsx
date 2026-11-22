import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { I, calm, useSwipeClose } from './ui.jsx'
import { fileLink, fmtBytes, supabase } from './lib.js'

/* One music player for the whole app (Alex, 17 Oct): a song started in a chat keeps playing when you move to another
   chat, and a bar on top (Now playing) pauses it, moves through it, takes you back to its chat, or stops it.
   Voice messages and videos still play in their own place; starting one pauses the music (the 'roarme-play' event). */

export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|aif|aiff|weba)$/i
export const isAudioFile = (f) => !!f && (/^audio\//.test(f.type || '') || AUDIO_EXT.test(f.name || ''))
const keyOf = (f) => f?.path || f?.name || ''
const nameOf = (f) => (f?.name || 'Audio').replace(AUDIO_EXT, '')

/* The big player (Alex, 18 Nov: "a player with a bigger window, more 2026"): the songs of the chat the song came from
   are its list (queue, newest first), with next / previous, repeat (off, all, one) and shuffle; a song that ends goes
   on to the next. `big` is the window being open. */
let audio = null
let state = { key: '', title: '', file: null, from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false, queue: [], repeat: 'off', shuffle: false, big: false, rate: 1, peaks: null, sleep: null, notes: [], notesFor: '' }
let queueFor = ''
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((fn) => fn()) }

const el = () => {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('play', () => { set({ playing: true, bad: false }); lockShow() })
  audio.addEventListener('pause', () => { set({ playing: false }); lockState() })
  audio.addEventListener('ended', () => { set({ playing: false, at: 0 }); if (state.sleep === 'end') { set({ sleep: null }); return } ended() })
  audio.addEventListener('timeupdate', () => { set({ at: audio.currentTime }); lockPos(); if (state.sleep && state.sleep !== 'end' && Date.now() >= state.sleep) { set({ sleep: null }); audio.pause() } })
  audio.addEventListener('loadedmetadata', () => set({ dur: audio.duration || 0 }))
  audio.addEventListener('error', () => { if (audio.src) set({ playing: false, bad: true }) })
  // a voice message or a video starting elsewhere pauses the music
  window.addEventListener('roarme-play', (e) => { if (e.detail !== audio && !audio.paused) audio.pause() })
  return audio
}

/* The lock screen and AirPods (Alex, 21 Nov): the song, where it is from, play / pause, previous / next, 15 seconds back and
   on, and a drag through it, through the browser's Media Session (the iPhone app keeps playing locked: UIBackgroundModes
   audio in ios.yml). */
const ms = () => (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null)
let lockAt = 0
function lockShow() {
  const m = ms()
  if (!m) return
  try {
    m.metadata = new window.MediaMetadata({ title: state.title || 'Audio', artist: state.from || 'RoarMe', album: 'RoarMe', artwork: [{ src: `${import.meta.env.BASE_URL}icon-512.png`, sizes: '512x512', type: 'image/png' }] })
    const on = (a, fn) => { try { m.setActionHandler(a, fn) } catch { /* not on this device */ } }
    on('play', () => player.resume())
    on('pause', () => player.pause())
    on('previoustrack', () => player.prev())
    on('nexttrack', state.queue.length > 1 ? () => player.next() : null)
    on('seekbackward', () => player.skip(-15))
    on('seekforward', () => player.skip(15))
    on('seekto', (d) => { if (audio && d.seekTime != null) { audio.currentTime = d.seekTime; set({ at: d.seekTime }) } })
  } catch { /* none */ }
  lockState()
}
function lockState() { const m = ms(); if (m) try { m.playbackState = state.playing ? 'playing' : state.key ? 'paused' : 'none' } catch { /* none */ } }
function lockPos() {
  const m = ms()
  if (!m?.setPositionState || !state.dur || Date.now() - lockAt < 4000) return
  lockAt = Date.now()
  try { m.setPositionState({ duration: state.dur, position: Math.min(state.dur, state.at), playbackRate: state.rate }) } catch { /* none */ }
}

/* the songs of a chat, newest first; asked once per chat while a song of it is on */
async function loadQueue(roomId) {
  if (!roomId || queueFor === roomId) return
  queueFor = roomId
  const { data } = await supabase.from('roar_messages').select('id, kind, file, created_at, user_id').eq('room_id', roomId).eq('kind', 'file').is('deleted_at', null).order('created_at', { ascending: false }).limit(400)
  if (queueFor !== roomId || state.roomId !== roomId) return
  const seen = new Set()
  const queue = (data || []).filter((m) => isAudioFile(m.file) && !m.file?.asFile && !m.file?.round).map((m) => ({ key: keyOf(m.file), title: nameOf(m.file), file: m.file, id: m.id, by: m.user_id, at: m.created_at }))
    .filter((q) => q.key && !seen.has(q.key) && seen.add(q.key))
  // who sent each song, by the name they go by
  const ids = [...new Set(queue.map((q) => q.by).filter(Boolean))]
  if (ids.length) {
    const { data: ppl } = await supabase.from('roar_people').select('id, username, display_name').in('id', ids)
    const nm = Object.fromEntries((ppl || []).map((x) => [x.id, x.display_name || (x.username ? `@${x.username}` : '')]))
    queue.forEach((q) => { q.byName = nm[q.by] || '' })
  }
  if (queueFor !== roomId || state.roomId !== roomId) return
  set({ queue })
  lockShow()
  loadNotes()
}
/* Notes at a time in the song (Alex, 21 Nov): each is a reply to the song in its chat, '🎵 1:23 · words', with
   file.songNote { t } (seconds), so everyone in the chat reads it there too; the big player shows them on the waveform
   and in a list, and a tap goes to that moment. */
const nowItem = () => state.queue.find((q) => q.key === state.key) || null
async function loadNotes() {
  const q = nowItem()
  if (!q?.id || state.notesFor === q.id) return
  set({ notesFor: q.id, notes: [] })
  const { data } = await supabase.from('roar_messages').select('id, user_id, body, file, created_at').eq('reply_to', q.id).is('deleted_at', null).not('file->songNote', 'is', null).order('created_at').limit(200)
  if (state.notesFor !== q.id) return
  const ids = [...new Set((data || []).map((n) => n.user_id))]
  let nm = {}
  if (ids.length) {
    const { data: ppl } = await supabase.from('roar_people').select('id, username, display_name').in('id', ids)
    nm = Object.fromEntries((ppl || []).map((x) => [x.id, x.display_name || (x.username ? `@${x.username}` : '')]))
  }
  set({ notes: (data || []).map((n) => ({ id: n.id, t: Number(n.file?.songNote?.t) || 0, text: String(n.body || '').replace(/^🎵\s*\d+:\d{2}\s*·\s*/, ''), by: nm[n.user_id] || '' })).sort((a, b) => a.t - b.t) })
}
const start = (a, url) => { lockAt = 0; a.src = url; a.defaultPlaybackRate = state.rate; a.playbackRate = state.rate; window.dispatchEvent(new CustomEvent('roarme-play', { detail: a })); a.play().catch(() => set({ bad: true })) }
/* The song's shape for the big player's line (Alex, 18 Nov: "a waveform in place of the plain line"): WAVE levels. From the
   sound itself when the file is small enough to open whole on a phone (up to WAVE_MAX), else a calm shape of its own,
   the same every time for the same file. Kept for the visit; asked only while the big player is open. */
export const WAVE = 56
const WAVE_MAX = 12e6
const waves = new Map()
export const shapeOf = (key) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000 }
  const out = []
  let v = 0.5
  for (let i = 0; i < WAVE; i++) { v = Math.min(1, Math.max(0.16, v + (rnd() - 0.5) * 0.5)); out.push(0.25 + v * 0.75 * (0.75 + 0.25 * Math.sin((i / WAVE) * Math.PI))) }
  return out
}
async function loadWave(key, file) {
  if (!key || !file) return
  if (waves.has(key)) { if (state.key === key) set({ peaks: waves.get(key) }); return }
  const calm = shapeOf(key)
  waves.set(key, calm)
  if (state.key === key) set({ peaks: calm })
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctx || !(file.size > 0) || file.size > WAVE_MAX) return
  try {
    const url = await fileLink(file)
    const data = await (await fetch(url)).arrayBuffer()
    const ac = new Ctx(1, 1, 44100)
    const buf = await new Promise((ok, bad) => { const pr = ac.decodeAudioData(data, ok, bad); if (pr?.then) pr.then(ok, bad) })
    const ch = buf.getChannelData(0)
    const step = Math.max(1, Math.floor(ch.length / WAVE))
    const raw = []
    for (let i = 0; i < WAVE; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 64) { const a = Math.abs(ch[j]); if (a > m) m = a } raw.push(m) }
    const top = Math.max(...raw, 0.01)
    const real = raw.map((x) => 0.14 + 0.86 * (x / top))
    waves.set(key, real)
    if (state.key === key) set({ peaks: real })
  } catch { /* the calm shape stays */ }
}

/* play a song of the list */
async function playItem(q) {
  if (!q) return
  const a = el()
  a.pause()
  set({ key: q.key, title: q.title, file: q.file, peaks: null, url: '', at: 0, dur: 0, bad: false, playing: false, notes: [], notesFor: '' })
  loadNotes()
  const url = await fileLink(q.file)
  if (state.key !== q.key) return
  if (!url) { set({ bad: true }); return }
  set({ url })
  start(a, url)
}
const step = (d, wrap) => {
  const { queue, key, shuffle } = state
  if (queue.length < 2) return null
  const i = queue.findIndex((q) => q.key === key)
  if (shuffle) { const rest = queue.filter((q) => q.key !== key); return rest[Math.floor(Math.random() * rest.length)] }
  const j = i + d
  if (j < 0 || j >= queue.length) return wrap ? queue[(j + queue.length) % queue.length] : null
  return queue[j]
}
function ended() {
  if (state.repeat === 'one') { player.resume(); return }
  const q = step(1, state.repeat === 'all')
  if (q) playItem(q)
}

export const player = {
  get: () => state,
  subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn) },
  // play this song (or pause it, if it is the one playing)
  toggle({ key, url, title, from = '', roomId = '', file = null }) {
    const a = el()
    if (state.key === key) {
      if (a.paused) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: a })); a.play().catch(() => set({ bad: true })) } else a.pause()
      return
    }
    const sameRoom = roomId && roomId === state.roomId
    set({ key, url, title, file, peaks: null, from, roomId, at: 0, dur: 0, bad: false, playing: false, queue: sameRoom ? state.queue : [], notes: [], notesFor: '' })
    if (sameRoom) loadNotes()
    if (!sameRoom) queueFor = ''
    start(a, url)
    loadQueue(roomId)
  },
  play(q) { if (q.key === state.key) { if (state.playing) player.pause(); else player.resume() } else playItem(q) },
  next() { const q = step(1, true); if (q) playItem(q) },
  // back to the start of the song; within its first three seconds, the song before
  prev() { const q = audio && audio.currentTime > 3 ? null : step(-1, true); if (q) playItem(q); else if (audio) { audio.currentTime = 0; set({ at: 0 }) } },
  repeat() { set({ repeat: { off: 'all', all: 'one', one: 'off' }[state.repeat] }) },
  shuffle() { set({ shuffle: !state.shuffle }) },
  // the speed: 1x, 1.5x, 2x, 0.5x, round again; it stays for the songs that follow
  speed() { const r = { 1: 1.5, 1.5: 2, 2: 0.5, 0.5: 1 }[state.rate] || 1; if (audio) { audio.defaultPlaybackRate = r; audio.playbackRate = r } set({ rate: r }) },
  // 15 seconds back or on
  skip(d) { if (audio && state.dur) { audio.currentTime = Math.max(0, Math.min(state.dur - 0.2, audio.currentTime + d)); set({ at: audio.currentTime }) } },
  wave(file) { loadWave(state.key, file) },
  open() { if (state.key) { set({ big: true }); loadQueue(state.roomId) } },
  // it leaves with a short slide; `big` is 'out' while it does
  close() { if (state.big !== true) return; if (calm()) { set({ big: false }); return } set({ big: 'out' }); setTimeout(() => { if (state.big === 'out') set({ big: false }) }, 230) },
  pause() { if (audio && !audio.paused) audio.pause() },
  resume() { if (audio && audio.paused && state.key) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: audio })); audio.play().catch(() => set({ bad: true })) } },
  seek(frac) { if (audio && state.dur) audio.currentTime = Math.max(0, Math.min(1, frac)) * state.dur },
  stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() } queueFor = ''; set({ key: '', title: '', file: null, peaks: null, from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false, queue: [], big: false, sleep: null, notes: [], notesFor: '' }); lockState() },
  // the sleep timer: minutes from now, 'end' (when this song ends) or null (off)
  sleep(v) { set({ sleep: v === 'end' ? 'end' : v ? Date.now() + v * 60000 : null }) },
  // a note at this moment of the song, as a reply to it in its chat
  async note(text, at) {
    const q = nowItem(), words = String(text || '').trim().slice(0, 500)
    if (!q?.id || !words || !state.roomId) return false
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return false
    const t = Math.floor(at ?? audio?.currentTime ?? state.at ?? 0)
    const { data, error } = await supabase.from('roar_messages').insert({ room_id: state.roomId, user_id: uid, kind: 'text', body: `🎵 ${mmss(t)} · ${words}`, reply_to: q.id, file: { songNote: { t } } }).select('id').single()
    if (error) return false
    set({ notes: [...state.notes, { id: data.id, t, text: words, by: 'You' }].sort((a, b) => a.t - b.t) })
    return true
  },
  jump(t) { if (audio && state.dur) { audio.currentTime = Math.max(0, Math.min(state.dur - 0.2, t)); set({ at: audio.currentTime }) } },
}

export const usePlayer = () => useSyncExternalStore(player.subscribe, player.get)
export const mmss = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`

/* the bar while a song is on: play/pause, the title and the chat it came from, a line to move through it, the time,
   and × to stop it */
export function NowPlaying({ onOpen, className = '' }) {
  const p = usePlayer()
  if (!p.key) return null
  const seek = (e) => { const r = e.currentTarget.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width) }
  return (
    <div className={`nowbar${p.playing ? ' on' : ''} ${className}`} style={{ '--np': p.dur ? Math.min(1, p.at / p.dur) : 0 }}>
      <button type="button" className="nowbar-btn" onClick={() => (p.playing ? player.pause() : player.resume())} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause' : 'Play'}>{p.playing ? I.pause : I.play}</button>
      <button type="button" className="nowbar-main" onClick={() => player.open()} title="Open Player">
        <span className="nowbar-eq" aria-hidden="true"><i /><i /><i /></span>
        <span className="nowbar-text" key={p.key}><b>{p.title}</b><small>{p.bad ? 'Cannot play here' : p.from || 'Now playing'}</small></span>
      </button>
      <small className="nowbar-time">{mmss(p.at)}{p.dur ? ` / ${mmss(p.dur)}` : ''}</small>
      <button type="button" className="nowbar-x" onClick={() => player.stop()} aria-label="Stop" title="Stop">{I.x}</button>
      <span className="nowbar-line" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(p.dur)} aria-valuenow={Math.round(p.at)}><i style={{ width: `${p.dur ? Math.min(100, (p.at / p.dur) * 100) : 0}%` }} /></span>
    </div>
  )
}

/* line signs of the big player, in the app's hand */
const ln = (d, w = 22) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const RPL_I = {
  down: ln(<path d="M6 9.5l6 6 6-6" />),
  back15: ln(<path d="M4.5 12a7.5 7.5 0 1 0 2.6-5.7M4 3.5v4h4" />, 30),
  fwd15: ln(<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7M20 3.5v4h-4" />, 30),
  share: ln(<path d="M12 15V4M8 7.5 12 3.5l4 4M6.5 11H6a2 2 0 0 0-2 2v5.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V13a2 2 0 0 0-2-2h-.5" />, 20),
  chat: ln(<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.4V16A2.5 2.5 0 0 1 5 13.5z" />, 20),
  prev: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M6 5.5h2.2v13H6zM19 6.2v11.6a.8.8 0 0 1-1.25.66L9.6 12.66a.8.8 0 0 1 0-1.32l8.15-5.8A.8.8 0 0 1 19 6.2z" /></svg>,
  next: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M15.8 5.5H18v13h-2.2zM5 6.2v11.6a.8.8 0 0 0 1.25.66l8.15-5.8a.8.8 0 0 0 0-1.32l-8.15-5.8A.8.8 0 0 0 5 6.2z" /></svg>,
  play: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.22.68l10.9-6.8a.8.8 0 0 0 0-1.36L9.22 4.52A.8.8 0 0 0 8 5.2z" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><rect x="6.2" y="5" width="4" height="14" rx="1.2" /><rect x="13.8" y="5" width="4" height="14" rx="1.2" /></svg>,
  shuffle: ln(<path d="M4 7h3.2c2 0 3.2 1 4.3 2.6l1 1.6c1.1 1.7 2.3 2.8 4.3 2.8H20M17.5 4.5 20 7l-2.5 2.5M4 17h3.2c1.3 0 2.3-.5 3.1-1.3M17.5 14.5 20 17l-2.5 2.5M20 17h-3.2M13.6 8.4C14.4 7.5 15.4 7 16.8 7H20" />),
  repeat: ln(<path d="M17 3.5 20 6.5 17 9.5M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" />),
  moon: ln(<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />, 24),
  note: ln(<><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3h9A2.5 2.5 0 0 1 19 5.5v9a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 5 14.5z" /><path d="M9 8.5h6M9 12h4" /></>, 24),
  send: ln(<path d="M12 19V5M6 11l6-6 6 6" />, 20),
}
const SLEEP = [[15, '15 Minutes'], [30, '30 Minutes'], [60, '1 Hour'], ['end', 'End of Song']]
const dayOf = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }) } catch { return '' } }

const FLAT = Array.from({ length: WAVE }, () => 0.3)

/* the big player: what is on, a line to move through it, the buttons, and the chat's songs under them */
export function PlayerSheet({ onOpen, onShare }) {
  const p = usePlayer()
  const box = useRef(null)
  const line = useRef(null)
  const drag = useRef(false)
  const open = p.big && !!p.key
  useSwipeClose(box, player.close, 'y', open ? 1 : 0)
  useEffect(() => {
    if (!open) return undefined
    const k = (e) => { if (e.key === 'Escape') player.close() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [open])
  // the song that is on stays in sight in the list
  useEffect(() => { if (open) box.current?.querySelector('.rpl-row.on')?.scrollIntoView({ block: 'nearest' }) }, [open, p.key, p.queue.length])
  // every hook stands before the early return below: one after it made React fail and the page went white when the
  // player opened (18 Nov)
  const nowFile = p.file || p.queue.find((q) => q.key === p.key)?.file || null
  // the song's shape, asked once the window is open
  useEffect(() => { if (open && nowFile) player.wave(nowFile) }, [open, p.key, nowFile?.path])
  const [pop, setPop] = useState('') // 'sleep' | 'note' | ''
  const [noteText, setNoteText] = useState('')
  const [noteAt, setNoteAt] = useState(0)
  const [sending, setSending] = useState(false)
  useEffect(() => { if (!open) setPop('') }, [open])
  if (!open) return null
  const frac = p.dur ? Math.min(1, p.at / p.dur) : 0
  const at = (e) => { const r = line.current.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width) }
  const down = (e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); at(e) }
  const move = (e) => { if (drag.current) at(e) }
  const up = () => { drag.current = false }
  const many = p.queue.length > 1
  const peaks = p.peaks || FLAT
  const goChat = () => { const id = p.roomId; player.close(); if (id) onOpen?.(id) }
  const item = p.queue.find((q) => q.key === p.key)
  const sentBy = item ? [item.byName && `Sent by ${item.byName}`, item.at && dayOf(item.at)].filter(Boolean).join(' · ') : ''
  const sleepLeft = typeof p.sleep === 'number' ? Math.max(1, Math.ceil((p.sleep - Date.now()) / 60000)) : 0
  const openNote = () => { setNoteAt(Math.floor(p.at)); setNoteText(''); setPop(pop === 'note' ? '' : 'note') }
  const sendNote = async () => { if (sending || !noteText.trim()) return; setSending(true); const ok = await player.note(noteText, noteAt); setSending(false); if (ok) { setNoteText(''); setPop('') } }
  return createPortal(
    <div className={`rpl-back${p.big === 'out' ? ' out' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) player.close() }}>
      <div ref={box} className={`rpl${p.playing ? ' on' : ''}`} role="dialog" aria-label="Player">
        <div className="rpl-head" data-grab="">
          <button type="button" className="rpl-round" onClick={() => player.close()} aria-label="Close" title="Close">{RPL_I.down}</button>
          <button type="button" className="rpl-from" onClick={goChat} disabled={!p.roomId} title="Show in Chat"><small>Playing from</small><b>{p.from || 'RoarMe'}</b></button>
          <button type="button" className="rpl-round" onClick={() => nowFile && onShare?.(nowFile, p.roomId)} disabled={!nowFile} aria-label="Share" title="Share">{RPL_I.share}</button>
        </div>
        <div className="rpl-art" aria-hidden="true" key={p.key}>
          <i className="rpl-glow a" /><i className="rpl-glow b" /><i className="rpl-glow c" />
          <span className="rpl-bars">{[0, 1, 2, 3, 4, 5, 6].map((n) => <i key={n} style={{ '--n': n }} />)}</span>
        </div>
        <div className="rpl-title" key={p.key}><b>{p.title}</b><small>{p.bad ? 'Cannot play here' : many ? `${p.queue.findIndex((q) => q.key === p.key) + 1} of ${p.queue.length}` : 'Now playing'}</small>{sentBy && <small className="rpl-by">{sentBy}</small>}</div>
        <div className="rpl-seek">
          <span ref={line} className="rpl-wave" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(p.dur)} aria-valuenow={Math.round(p.at)}>
            {peaks.map((v, i) => <i key={i} className={(i + 0.5) / WAVE <= frac ? 'on' : undefined} style={{ '--h': v }} />)}
            {p.dur > 0 && p.notes.map((n) => <b key={n.id} className="rpl-mark" style={{ left: `${Math.min(100, (n.t / p.dur) * 100)}%` }} />)}
          </span>
          <span className="rpl-times"><small>{mmss(p.at)}</small><small>{p.dur ? `-${mmss(p.dur - p.at)}` : '–:––'}</small></span>
        </div>
        <div className="rpl-ctl">
          <button type="button" className={`rpl-opt${p.shuffle ? ' on' : ''}`} onClick={() => player.shuffle()} aria-pressed={p.shuffle} aria-label="Shuffle" title="Shuffle"><i className="rpl-sign" key={p.shuffle ? 'a' : 'b'}>{RPL_I.shuffle}</i></button>
          <button type="button" className="rpl-skip prev" onClick={() => player.prev()} aria-label="Previous" title="Previous">{RPL_I.prev}</button>
          <button type="button" className="rpl-play" onClick={() => (p.playing ? player.pause() : player.resume())} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause' : 'Play'}><i className="rpl-sign" key={p.playing ? 'a' : 'b'}>{p.playing ? RPL_I.pause : RPL_I.play}</i></button>
          <button type="button" className="rpl-skip next" onClick={() => player.next()} disabled={!many} aria-label="Next" title="Next">{RPL_I.next}</button>
          <button type="button" className={`rpl-opt${p.repeat !== 'off' ? ' on' : ''}`} onClick={() => player.repeat()} aria-label={p.repeat === 'one' ? 'Repeat One' : p.repeat === 'all' ? 'Repeat All' : 'Repeat'} title={p.repeat === 'one' ? 'Repeat One' : p.repeat === 'all' ? 'Repeat All' : 'Repeat'}><i className="rpl-sign" key={p.repeat}>{RPL_I.repeat}</i>{p.repeat === 'one' && <em>1</em>}</button>
        </div>
        <div className="rpl-more">
          <button type="button" className={`rpl-tool${p.sleep ? ' on' : ''}`} onClick={() => setPop(pop === 'sleep' ? '' : 'sleep')} aria-label="Sleep Timer" title="Sleep Timer">{RPL_I.moon}{p.sleep && <em>{p.sleep === 'end' ? 'End' : `${sleepLeft}m`}</em>}</button>
          <button type="button" className="rpl-jump" onClick={() => player.skip(-15)} aria-label="Back 15 Seconds" title="Back 15 Seconds">{RPL_I.back15}<em>15</em></button>
          <button type="button" className={`rpl-rate${p.rate !== 1 ? ' on' : ''}`} onClick={() => player.speed()} aria-label={`Speed ${p.rate}x`} title="Speed"><b key={p.rate}>{p.rate}x</b></button>
          <button type="button" className="rpl-jump" onClick={() => player.skip(15)} aria-label="Forward 15 Seconds" title="Forward 15 Seconds">{RPL_I.fwd15}<em>15</em></button>
          <button type="button" className={`rpl-tool${pop === 'note' ? ' on' : ''}`} onClick={openNote} disabled={!item?.id} aria-label="Add a Note Here" title="Add a Note Here">{RPL_I.note}</button>
        </div>
        {pop === 'sleep' && (
          <div className="rpl-pop" role="menu">
            <small className="rpl-label">Stop Playing In</small>
            {SLEEP.map(([v, l]) => <button type="button" key={v} className={`rpl-pick${(v === 'end' ? p.sleep === 'end' : false) ? ' on' : ''}`} onClick={() => { player.sleep(v); setPop('') }}>{l}</button>)}
            {p.sleep && <button type="button" className="rpl-pick off" onClick={() => { player.sleep(null); setPop('') }}>Turn Off</button>}
          </div>
        )}
        {pop === 'note' && (
          <form className="rpl-notebox" onSubmit={(e) => { e.preventDefault(); sendNote() }}>
            <span className="rpl-at">{mmss(noteAt)}</span>
            <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} maxLength={500} placeholder="A note at this moment" />
            <button type="submit" className="rpl-note-send" disabled={sending || !noteText.trim()} aria-label="Send Note">{RPL_I.send}</button>
          </form>
        )}
        {p.notes.length > 0 && (
          <div className="rpl-notes">
            <small className="rpl-label">Notes</small>
            {p.notes.map((n) => (
              <button type="button" key={n.id} className="rpl-nrow" onClick={() => player.jump(n.t)}>
                <span className="rpl-at">{mmss(n.t)}</span>
                <span className="rpl-ntext"><b>{n.text}</b>{n.by && <small>{n.by}</small>}</span>
              </button>
            ))}
          </div>
        )}
        {many && (
          <div className="rpl-list">
            <small className="rpl-label">Songs in this chat</small>
            {p.queue.map((q) => (
              <button type="button" key={q.key} className={`rpl-row${q.key === p.key ? ' on' : ''}`} onClick={() => player.play(q)}>
                <i className="rpl-dot" key={q.key === p.key ? 'on' : 'off'}>{q.key === p.key && p.playing ? <span className="rpl-eq"><i /><i /><i /></span> : I.play}</i>
                <span className="rpl-name"><b>{q.title}</b><small>{(((q.file?.name || '').match(AUDIO_EXT) || [])[1] || 'audio').toUpperCase()} · {fmtBytes(q.file?.size)}</small></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
