import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { I, useSwipeClose } from './ui.jsx'
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
let state = { key: '', title: '', from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false, queue: [], repeat: 'off', shuffle: false, big: false }
let queueFor = ''
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((fn) => fn()) }

const el = () => {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('play', () => set({ playing: true, bad: false }))
  audio.addEventListener('pause', () => set({ playing: false }))
  audio.addEventListener('ended', () => { set({ playing: false, at: 0 }); ended() })
  audio.addEventListener('timeupdate', () => set({ at: audio.currentTime }))
  audio.addEventListener('loadedmetadata', () => set({ dur: audio.duration || 0 }))
  audio.addEventListener('error', () => { if (audio.src) set({ playing: false, bad: true }) })
  // a voice message or a video starting elsewhere pauses the music
  window.addEventListener('roarme-play', (e) => { if (e.detail !== audio && !audio.paused) audio.pause() })
  return audio
}

/* the songs of a chat, newest first; asked once per chat while a song of it is on */
async function loadQueue(roomId) {
  if (!roomId || queueFor === roomId) return
  queueFor = roomId
  const { data } = await supabase.from('roar_messages').select('id, kind, file, created_at').eq('room_id', roomId).eq('kind', 'file').is('deleted_at', null).order('created_at', { ascending: false }).limit(400)
  if (queueFor !== roomId || state.roomId !== roomId) return
  const seen = new Set()
  const queue = (data || []).filter((m) => isAudioFile(m.file) && !m.file?.asFile && !m.file?.round).map((m) => ({ key: keyOf(m.file), title: nameOf(m.file), file: m.file, id: m.id }))
    .filter((q) => q.key && !seen.has(q.key) && seen.add(q.key))
  set({ queue })
}
const start = (a, url) => { a.src = url; window.dispatchEvent(new CustomEvent('roarme-play', { detail: a })); a.play().catch(() => set({ bad: true })) }
/* play a song of the list */
async function playItem(q) {
  if (!q) return
  const a = el()
  a.pause()
  set({ key: q.key, title: q.title, url: '', at: 0, dur: 0, bad: false, playing: false })
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
  toggle({ key, url, title, from = '', roomId = '' }) {
    const a = el()
    if (state.key === key) {
      if (a.paused) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: a })); a.play().catch(() => set({ bad: true })) } else a.pause()
      return
    }
    const sameRoom = roomId && roomId === state.roomId
    set({ key, url, title, from, roomId, at: 0, dur: 0, bad: false, playing: false, queue: sameRoom ? state.queue : [] })
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
  open() { if (state.key) { set({ big: true }); loadQueue(state.roomId) } },
  close() { set({ big: false }) },
  pause() { if (audio && !audio.paused) audio.pause() },
  resume() { if (audio && audio.paused && state.key) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: audio })); audio.play().catch(() => set({ bad: true })) } },
  seek(frac) { if (audio && state.dur) audio.currentTime = Math.max(0, Math.min(1, frac)) * state.dur },
  stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() } queueFor = ''; set({ key: '', title: '', from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false, queue: [], big: false }) },
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
        <span className="nowbar-text"><b>{p.title}</b><small>{p.bad ? 'Cannot play here' : p.from || 'Now playing'}</small></span>
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
  chat: ln(<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.4V16A2.5 2.5 0 0 1 5 13.5z" />, 20),
  prev: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M6 5.5h2.2v13H6zM19 6.2v11.6a.8.8 0 0 1-1.25.66L9.6 12.66a.8.8 0 0 1 0-1.32l8.15-5.8A.8.8 0 0 1 19 6.2z" /></svg>,
  next: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M15.8 5.5H18v13h-2.2zM5 6.2v11.6a.8.8 0 0 0 1.25.66l8.15-5.8a.8.8 0 0 0 0-1.32l-8.15-5.8A.8.8 0 0 0 5 6.2z" /></svg>,
  play: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a.8.8 0 0 0 1.22.68l10.9-6.8a.8.8 0 0 0 0-1.36L9.22 4.52A.8.8 0 0 0 8 5.2z" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" aria-hidden="true"><rect x="6.2" y="5" width="4" height="14" rx="1.2" /><rect x="13.8" y="5" width="4" height="14" rx="1.2" /></svg>,
  shuffle: ln(<path d="M4 7h3.2c2 0 3.2 1 4.3 2.6l1 1.6c1.1 1.7 2.3 2.8 4.3 2.8H20M17.5 4.5 20 7l-2.5 2.5M4 17h3.2c1.3 0 2.3-.5 3.1-1.3M17.5 14.5 20 17l-2.5 2.5M20 17h-3.2M13.6 8.4C14.4 7.5 15.4 7 16.8 7H20" />),
  repeat: ln(<path d="M17 3.5 20 6.5 17 9.5M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" />),
}

/* the big player: what is on, a line to move through it, the buttons, and the chat's songs under them */
export function PlayerSheet({ onOpen }) {
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
  if (!open) return null
  const frac = p.dur ? Math.min(1, p.at / p.dur) : 0
  const at = (e) => { const r = line.current.getBoundingClientRect(); player.seek((e.clientX - r.left) / r.width) }
  const down = (e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); at(e) }
  const move = (e) => { if (drag.current) at(e) }
  const up = () => { drag.current = false }
  const many = p.queue.length > 1
  const goChat = () => { const id = p.roomId; player.close(); if (id) onOpen?.(id) }
  return createPortal(
    <div className="rpl-back" onMouseDown={(e) => { if (e.target === e.currentTarget) player.close() }}>
      <div ref={box} className={`rpl${p.playing ? ' on' : ''}`} role="dialog" aria-label="Player">
        <div className="rpl-head" data-grab="">
          <button type="button" className="rpl-round" onClick={() => player.close()} aria-label="Close" title="Close">{RPL_I.down}</button>
          <span className="rpl-from"><small>Playing from</small><b>{p.from || 'RoarMe'}</b></span>
          <button type="button" className="rpl-round" onClick={goChat} disabled={!p.roomId} aria-label="Show in Chat" title="Show in Chat">{RPL_I.chat}</button>
        </div>
        <div className="rpl-art" aria-hidden="true">
          <i className="rpl-glow a" /><i className="rpl-glow b" /><i className="rpl-glow c" />
          <span className="rpl-bars">{[0, 1, 2, 3, 4, 5, 6].map((n) => <i key={n} style={{ '--n': n }} />)}</span>
        </div>
        <div className="rpl-title"><b>{p.title}</b><small>{p.bad ? 'Cannot play here' : many ? `${p.queue.findIndex((q) => q.key === p.key) + 1} of ${p.queue.length}` : 'Now playing'}</small></div>
        <div className="rpl-seek">
          <span ref={line} className="rpl-line" style={{ '--rp': frac }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(p.dur)} aria-valuenow={Math.round(p.at)}><i /><em /></span>
          <span className="rpl-times"><small>{mmss(p.at)}</small><small>{p.dur ? `-${mmss(p.dur - p.at)}` : '–:––'}</small></span>
        </div>
        <div className="rpl-ctl">
          <button type="button" className={`rpl-opt${p.shuffle ? ' on' : ''}`} onClick={() => player.shuffle()} aria-pressed={p.shuffle} aria-label="Shuffle" title="Shuffle">{RPL_I.shuffle}</button>
          <button type="button" className="rpl-skip" onClick={() => player.prev()} aria-label="Previous" title="Previous">{RPL_I.prev}</button>
          <button type="button" className="rpl-play" onClick={() => (p.playing ? player.pause() : player.resume())} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause' : 'Play'}>{p.playing ? RPL_I.pause : RPL_I.play}</button>
          <button type="button" className="rpl-skip" onClick={() => player.next()} disabled={!many} aria-label="Next" title="Next">{RPL_I.next}</button>
          <button type="button" className={`rpl-opt${p.repeat !== 'off' ? ' on' : ''}`} onClick={() => player.repeat()} aria-label={p.repeat === 'one' ? 'Repeat One' : p.repeat === 'all' ? 'Repeat All' : 'Repeat'} title={p.repeat === 'one' ? 'Repeat One' : p.repeat === 'all' ? 'Repeat All' : 'Repeat'}>{RPL_I.repeat}{p.repeat === 'one' && <em>1</em>}</button>
        </div>
        {many && (
          <div className="rpl-list">
            <small className="rpl-label">Songs in this chat</small>
            {p.queue.map((q) => (
              <button type="button" key={q.key} className={`rpl-row${q.key === p.key ? ' on' : ''}`} onClick={() => player.play(q)}>
                <i className="rpl-dot">{q.key === p.key && p.playing ? <span className="rpl-eq"><i /><i /><i /></span> : I.play}</i>
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
