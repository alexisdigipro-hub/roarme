import { useEffect, useState } from 'react'

/* Chat settings, kept on this device (as in the THEMADLIONS chat): how the chat looks and behaves.
   A change is announced with the 'roarme-prefs' event so every open part of the app follows it. */
export const DEFAULTS = {
  mode: 'dark', // dark | light | auto (follows the computer)
  lang: 'en', // en | el, the interface language (i18n.js)
  theme: 'ember', // ember, shown as Simba (the main one, Alex 16 Oct) | prism (Pumba); the rest only for Alex, see THEME_LAB
  accent: 'red', // a first start opens Simba in red (Alex, 17 Oct); '' = the theme's own colour, or one of ACCENTS
  density: 'standard', // relaxed | standard | tight
  font: 'system', // one of FONTS
  radius: 12, // corners of the Ember theme, 4 to 16
  motion: true, // smooth animations
  focusRings: false, // a bold ring around whatever has the keyboard
  textSize: 2, // 0..4
  bigEmoji: true,
  glassBubbles: true, // your own messages see-through with an accent edge, like a RoarTransfer (Alex, 17 Oct)
  listPreview: false, // the last message under each chat's name in the list (Alex, 17 Oct: off unless one wants it)
  compact: false,
  enterSends: true,
  spell: true,
  faces: true,
  largePhotos: false,
  compress: true,
  quick: '❤️',
  doubleTap: 'react', // react | reply | edit | forward
  autoEmoji: true,
  copyFormat: true, // Copy Text keeps **bold** and the other marks
  dlPrivate: true, // photos and videos load by themselves in private chats
  dlGroups: true, // and in groups
  autoplayVideos: false,
  autoplayGifs: true,
  callsTab: true,
  lite: false, // power saving: no animations, no glass blur
  peekBadge: false, // a click on the unread badge previews the chat
  peerIds: false,
  notifyPreview: true,
  translateTo: 'auto', // auto = Greek to English and back
  // top | bottom (left until 16 Oct, now bottom); on a phone they start at the bottom, by the thumb (Alex, 19 Oct)
  folderTabs: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches ? 'bottom' : 'top',
  folderOrder: [], // folder ids in the order dragged in Settings > Folders
  folderNames: {}, // the ready-made folders renamed: { unread: 'New' }
  hiddenFolders: [], // ready-made folders deleted (Unread, Groups, Archived; All stays)
  sound: true,
  soundKind: 'chime', // one of SOUNDS
  badge: true, // the unread count on the Mac/Windows app's icon
  micId: '', // the microphone, camera and speakers for calls ('' = the computer's own choice)
  camId: '',
  speakerId: '',
  folderTags: false,
  background: 'soft', // one of WALLS
}
export const WALLS = [['soft', 'Plain'], ['dots', 'Pattern'], ['grid', 'Grid'], ['night', 'Night'], ['ocean', 'Ocean'], ['dusk', 'Dusk'], ['forest', 'Forest'], ['ember', 'Ember']]
export const TEXT_SIZES = [13.5, 14.5, 15.5, 17, 18.5]
const KEY = 'roarme-prefs'

// Ember became the main theme (Alex, 16 Oct): a device that still has the old default moves to it once
try {
  if (!localStorage.getItem('roarme-ember-main')) {
    const saved = JSON.parse(localStorage.getItem('roarme-prefs') || 'null')
    if (saved && (!saved.theme || saved.theme === 'glass')) localStorage.setItem('roarme-prefs', JSON.stringify({ ...saved, theme: 'ember' }))
    localStorage.setItem('roarme-ember-main', '1')
  }
} catch { /* private window */ }

export function getPrefs() {
  try {
    const p = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }
    // the folder tabs on the left became tabs at the bottom (Alex, 16 Oct)
    if (p.folderTabs === 'left') p.folderTabs = 'bottom'
    // the double click reacts with the red heart, no longer the camera (Alex, 16 Oct); a later pick of the camera stays
    if (!p.quickHeart) { if (p.quick === '🎥') p.quick = '❤️'; p.quickHeart = true }
    return p
  } catch { return { ...DEFAULTS } }
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

/* The sound when a message arrives (WebAudio, no files): a few to choose from in Settings */
export const SOUNDS = [
  ['chime', 'Chime', 'sine', [[880, 0], [1320, 0.12]]],
  ['pop', 'Pop', 'sine', [[620, 0], [930, 0.05]]],
  ['ping', 'Ping', 'triangle', [[1568, 0]]],
  ['drop', 'Drop', 'sine', [[1200, 0], [700, 0.09]]],
  ['bells', 'Bells', 'triangle', [[1047, 0], [1319, 0.1], [1568, 0.2]]],
  ['roar', 'Roar', 'sawtooth', [[110, 0], [165, 0.06], [220, 0.12]]],
]
let ctx = null
export function chime(kind) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)()
    const t = ctx.currentTime
    const [, , wave, notes] = SOUNDS.find(([k]) => k === (kind || getPrefs().soundKind)) || SOUNDS[0]
    notes.forEach(([f, d]) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = wave
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t + d)
      g.gain.exponentialRampToValueAtTime(wave === 'sawtooth' ? 0.05 : 0.12, t + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + (wave === 'sawtooth' ? 0.45 : 0.28))
      o.connect(g).connect(ctx.destination)
      o.start(t + d)
      o.stop(t + d + 0.5)
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

/* :) and friends become emoji when the message is sent (only as words on their own, never inside a link) */
const SMILEYS = { ':)': '🙂', ':-)': '🙂', ':D': '😀', ':-D': '😀', 'xD': '😆', 'XD': '😆', ':(': '🙁', ':-(': '🙁', ";)": '😉', ";-)": '😉', ':P': '😛', ':p': '😛', ':o': '😮', ':O': '😮', ":'(": '😢', ':*': '😘', '<3': '❤️', 'B)': '😎', '(y)': '👍', '(n)': '👎' }
const SMILEY_RE = new RegExp(`(^|\\s)(${Object.keys(SMILEYS).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=\\s|$)`, 'g')
export const swapEmoji = (s) => String(s || '').replace(SMILEY_RE, (_, pre, k) => pre + SMILEYS[k])

export const EMOJIS = ['😀', '😂', '🥹', '😍', '😘', '😎', '🤩', '🥳', '😉', '😊', '🙂', '🤔', '😮', '😢', '😭', '😡', '🙏', '👍', '👎', '👏', '🙌', '💪', '🤝', '✌️', '👌', '👀', '🔥', '❤️', '💙', '💯', '✨', '🎉', '🎬', '🎥', '📸', '🎧', '🎤', '🎶', '🏆', '⭐', '☕', '🍕', '🍻', '🚀', '✅', '❌', '⏰', '📍']
export const REACTIONS = ['❤️', '🎥', '👍', '🔥', '🏆', '👏', '😂']

/* dark or light on the page: 'auto' follows the computer's own setting */
export function applyMode(mode) {
  const mq = window.matchMedia?.('(prefers-color-scheme: light)')
  const set = () => { document.documentElement.dataset.mode = mode === 'auto' ? (mq?.matches ? 'light' : 'dark') : mode }
  set()
  if (mode !== 'auto' || !mq) return () => {}
  mq.addEventListener?.('change', set)
  return () => mq.removeEventListener?.('change', set)
}

/* the look that sits on top of any theme (Alex, 16 Oct, from his Themes reference):
   accent colour, density, font, corner radius, animations, focus rings */
/* everyone gets Simba (ember) and Pumba (prism); the other themes stay in Alex's lab until they are ready (Alex, 17 Oct) */
export const PUBLIC_THEMES = ['ember', 'prism']
const THEME_LAB = ['98f8b6e1-0ce2-4576-805b-cffa25667d22'] // @iamalexkon
export const inThemeLab = (me) => !!me && THEME_LAB.includes(me.id)
export const themeFor = (theme, me) => (PUBLIC_THEMES.includes(theme) || inThemeLab(me) ? theme || 'ember' : 'ember')
export const ACCENTS = [['blue', 'Blue', '#3b82f6'], ['green', 'Green', '#22c55e'], ['yellow', 'Yellow', '#facc15'], ['orange', 'Orange', '#f97316'], ['red', 'Red', '#d40000'], ['magenta', 'Magenta', '#d946ef'], ['violet', 'Violet', '#8b5cf6'], ['cyan', 'Cyan', '#22d3ee'], ['coral', 'Coral', '#ff6b57'], ['white', 'White', '#ffffff']]
export const FONTS = [
  ['system', 'SF Pro / System', "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif"],
  ['inter', 'Inter', "'Inter', -apple-system, sans-serif"],
  ['manrope', 'Manrope', "'Manrope', -apple-system, sans-serif"],
  ['dm', 'DM Sans', "'DM Sans', -apple-system, sans-serif"],
  ['grotesk', 'Space Grotesk', "'Space Grotesk', -apple-system, sans-serif"],
  ['serif', 'Serif', "Georgia, 'Times New Roman', serif"],
  ['mono', 'Mono', "'JetBrains Mono', ui-monospace, Menlo, monospace"],
]
const inkOn = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#111111' : '#ffffff'
}
export function applyLook(p) {
  const r = document.documentElement
  const hex = ACCENTS.find(([k]) => k === p.accent)?.[2]
  if (hex) { r.style.setProperty('--accent', hex); r.style.setProperty('--accent-2', hex); r.style.setProperty('--accent-ink', inkOn(hex)) } else { ['--accent', '--accent-2', '--accent-ink'].forEach((v) => r.style.removeProperty(v)) }
  const f = FONTS.find(([k]) => k === p.font)
  if (f && p.font !== 'system') { r.style.setProperty('--font', f[2]); r.dataset.font = p.font } else { r.style.removeProperty('--font'); delete r.dataset.font }
  r.dataset.density = p.density || 'standard'
  r.style.setProperty('--r', `${Number(p.radius) || 12}px`)
  if (p.motion === false) r.dataset.still = '1'; else delete r.dataset.still
  if (p.focusRings) r.dataset.focus = 'bold'; else delete r.dataset.focus
  r.dataset.bubbles = p.glassBubbles === false ? 'solid' : 'glass'
}
