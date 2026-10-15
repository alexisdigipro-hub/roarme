import { useEffect, useState } from 'react'

/* Chat settings, kept on this device (as in the THEMADLIONS chat): how the chat looks and behaves.
   A change is announced with the 'roarme-prefs' event so every open part of the app follows it. */
export const DEFAULTS = {
  textSize: 2, // 0..4
  bigEmoji: true,
  compact: false,
  enterSends: true,
  spell: true,
  faces: true,
  largePhotos: false,
  compress: true,
  quick: '🎥',
  doubleTap: 'react', // react | reply
  sound: true,
  folderTags: false,
  background: 'soft', // soft | dots
}
export const TEXT_SIZES = [13.5, 14.5, 15.5, 17, 18.5]
const KEY = 'roarme-prefs'

export function getPrefs() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } } catch { return { ...DEFAULTS } }
}
export function setPrefs(patch) {
  const next = patch === null ? { ...DEFAULTS } : { ...getPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private window */ }
  window.dispatchEvent(new Event('roarme-prefs'))
  return next
}
export function usePrefs() {
  const [p, setP] = useState(getPrefs)
  useEffect(() => {
    const on = () => setP(getPrefs())
    window.addEventListener('roarme-prefs', on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener('roarme-prefs', on); window.removeEventListener('storage', on) }
  }, [])
  return p
}

/* Things kept per device: custom folders, chats hidden from the list */
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } window.dispatchEvent(new Event('roarme-local')) }
export function useLocal(key, initial) {
  const [v, setV] = useState(() => read(key, initial))
  useEffect(() => {
    const on = () => setV(read(key, initial))
    window.addEventListener('roarme-local', on)
    return () => window.removeEventListener('roarme-local', on)
  }, [key])
  return [v, (next) => write(key, typeof next === 'function' ? next(read(key, initial)) : next)]
}

/* The two-note chime when a message arrives (WebAudio, no file) */
let ctx = null
export function chime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    const t = ctx.currentTime
    ;[[880, 0], [1320, 0.12]].forEach(([f, d]) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d)
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28)
      o.connect(g).connect(ctx.destination)
      o.start(t + d)
      o.stop(t + d + 0.3)
    })
  } catch { /* no sound here */ }
}

/* 1 to 3 emoji alone: shown large, without a bubble */
export const isEmojiOnly = (s) => {
  const t = String(s || '').trim()
  if (!t || t.length > 24) return false
  const re = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,3}$/u
  return re.test(t)
}

export const EMOJIS = ['😀', '😂', '🥹', '😍', '😘', '😎', '🤩', '🥳', '😉', '😊', '🙂', '🤔', '😮', '😢', '😭', '😡', '🙏', '👍', '👎', '👏', '🙌', '💪', '🤝', '✌️', '👌', '👀', '🔥', '❤️', '💙', '💯', '✨', '🎉', '🎬', '🎥', '📸', '🎧', '🎤', '🎶', '🏆', '⭐', '☕', '🍕', '🍻', '🚀', '✅', '❌', '⏰', '📍']
export const REACTIONS = ['🎥', '❤️', '👍', '🔥', '🏆', '👏', '😂']
