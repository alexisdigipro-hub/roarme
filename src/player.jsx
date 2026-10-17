import { useSyncExternalStore } from 'react'
import { I } from './ui.jsx'

/* One music player for the whole app (Alex, 17 Oct): a song started in a chat keeps playing when you move to another
   chat, and a bar on top (Now playing) pauses it, moves through it, takes you back to its chat, or stops it.
   Voice messages and videos still play in their own place; starting one pauses the music (the 'roarme-play' event). */

let audio = null
let state = { key: '', title: '', from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false }
const subs = new Set()
const set = (patch) => { state = { ...state, ...patch }; subs.forEach((fn) => fn()) }

const el = () => {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.addEventListener('play', () => set({ playing: true, bad: false }))
  audio.addEventListener('pause', () => set({ playing: false }))
  audio.addEventListener('ended', () => set({ playing: false, at: 0 }))
  audio.addEventListener('timeupdate', () => set({ at: audio.currentTime }))
  audio.addEventListener('loadedmetadata', () => set({ dur: audio.duration || 0 }))
  audio.addEventListener('error', () => { if (audio.src) set({ playing: false, bad: true }) })
  // a voice message or a video starting elsewhere pauses the music
  window.addEventListener('roarme-play', (e) => { if (e.detail !== audio && !audio.paused) audio.pause() })
  return audio
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
    set({ key, url, title, from, roomId, at: 0, dur: 0, bad: false, playing: false })
    a.src = url
    window.dispatchEvent(new CustomEvent('roarme-play', { detail: a }))
    a.play().catch(() => set({ bad: true }))
  },
  pause() { if (audio && !audio.paused) audio.pause() },
  resume() { if (audio && audio.paused && state.key) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: audio })); audio.play().catch(() => set({ bad: true })) } },
  seek(frac) { if (audio && state.dur) audio.currentTime = Math.max(0, Math.min(1, frac)) * state.dur },
  stop() { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() } set({ key: '', title: '', from: '', roomId: '', url: '', playing: false, at: 0, dur: 0, bad: false }) },
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
    <div className={`nowbar${p.playing ? ' on' : ''} ${className}`}>
      <button type="button" className="nowbar-btn" onClick={() => (p.playing ? player.pause() : player.resume())} aria-label={p.playing ? 'Pause' : 'Play'} title={p.playing ? 'Pause' : 'Play'}>{p.playing ? I.pause : I.play}</button>
      <button type="button" className="nowbar-main" onClick={() => p.roomId && onOpen?.(p.roomId)} title={p.from ? `Open ${p.from}` : undefined}>
        <span className="nowbar-eq" aria-hidden="true"><i /><i /><i /></span>
        <span className="nowbar-text"><b>{p.title}</b><small>{p.bad ? 'Cannot play here' : p.from || 'Now playing'}</small></span>
      </button>
      <small className="nowbar-time">{mmss(p.at)}{p.dur ? ` / ${mmss(p.dur)}` : ''}</small>
      <button type="button" className="nowbar-x" onClick={() => player.stop()} aria-label="Stop" title="Stop">{I.x}</button>
      <span className="nowbar-line" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(p.dur)} aria-valuenow={Math.round(p.at)}><i style={{ width: `${p.dur ? Math.min(100, (p.at / p.dur) * 100) : 0}%` }} /></span>
    </div>
  )
}
