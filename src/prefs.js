import { useEffect, useRef, useState } from 'react'

/* Chat settings, kept on this device (as in the THEMADLIONS chat): how the chat looks and behaves.
   A change is announced with the 'roarme-prefs' event so every open part of the app follows it. */
export const DEFAULTS = {
  mode: 'light', // dark | light | auto (follows the computer); a first start opens Stone in light (Alex, 21 Oct)
  lang: 'en', // en | el, the interface language (i18n.js)
  theme: 'glass', // Glass is the main theme since 12 Nov (Alex: "this will be the app's main theme"); Stone was since 21 Oct. Whoever chose a theme keeps it
  accent: '', // the theme's own colour (Stone's graphite) on a first start (Alex, 21 Oct); or one of ACCENTS
  density: 'standard', // relaxed | standard | tight
  font: 'system', // one of FONTS
  radius: 12, // corners of the Ember theme, 4 to 16
  motion: true, // smooth animations
  focusRings: false, // a bold ring around whatever has the keyboard
  textSize: 2, // 0..4
  bigEmoji: true,
  glassBubbles: true, // your own messages see-through with an accent edge, like a RoarTransfer (Alex, 17 Oct)
  listPreview: true, // the last message and its time in the chat list; on since 12 Nov, when Alex picked the list as a glass panel that shows them (it was off since 17 Oct)
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
  tasksTab: false, // Tasks in the bar at the foot: off until turned on in Settings (Alex, 7 Nov)
  lite: false, // power saving: no animations, no glass blur
  peekBadge: false, // a click on the unread badge previews the chat
  peerIds: false,
  notifyPreview: true,
  // top | bottom (left until 16 Oct, now bottom); on a phone they start at the bottom, by the thumb (Alex, 19 Oct)
  folderTabs: 'bottom', // the folder tabs at the bottom from the start, on every device (Alex, 21 Oct)
  folderOrder: [], // folder ids in the order dragged in Settings > Folders
  folderNames: {}, // the ready-made folders renamed: { unread: 'New' }
  hiddenFolders: [], // ready-made folders deleted (Unread, Groups, Archived; All stays)
  folderExtra: {}, // chats added by hand to a ready-made folder: { groups: [room ids], unread: [room ids] }
  sound: true,
  soundKind: 'glass', // one of SOUNDS
  badge: true, // the unread count on the Mac/Windows app's icon
  micId: '', // the microphone, camera and speakers for calls ('' = the computer's own choice)
  camId: '',
  speakerId: '',
  folderTags: false,
  folderAlone: false, // each chat in one folder only (Alex, 21 Oct)
  background: 'halo-orange', // a wallpaper's key; a new install starts on Orange (Alex, 12 Nov), 'soft' is Plain
  listPanel: false, // the sheet of glass behind the chats in the list (Alex, 13 Nov: to put on and take off; the same day: off is how RoarMe starts and what Reset goes back to)
  listPanelOp: 50, // 0 to 100: how solid that glass is
  listPanelFill: '', // '' plain glass, 'orange' or one of HALO_ACCENTS' keys: the panel in that pair of colours (Alex, 13 Nov)
  listShape: 'panel', // the chat list: one sheet of glass ('panel'), or each chat a capsule ('pill') or a card ('card'); Alex, 13 Nov
  contactShape: 'plain', // Contacts: each person a capsule ('pill') or a card with soft corners ('card'; Alex, 13 Nov)
  listPanelGrain: false, // a fine grain over the panel
  uiText: 100, // 85 to 130 (%): the size of all of RoarMe's letters (Alex, 13 Nov); the messages' own size is textSize
  accentOpacity: 100, // 30 to 100: how solid the accent colour's fill is (your messages, the coloured buttons)
  appBackground: '', // Halo: the wallpaper behind the whole app, chosen apart from the chats' (Alex, 12 Nov); '' = the same as the chats
  pauseOnRec: true, // a song or a voice message playing stops while a voice or video message is recorded
  callLessData: false, // video calls at 360p and 15 frames, for weak networks
  appWallStrength: null, // 10 to 100: the App background's own strength (Alex, 13 Nov); null = the chats' wallStrength
  wallStrength: 100, // 10 to 100: how strong RoarMe's wallpapers and a colour show (one's own photo keeps its own)
  // one's own chat theme (Alex, 9 Nov, "as a feature in Settings"): '' each = the theme's own
  chatTheme: '', // one of CHAT_THEMES, or '' when built by hand
  accentHex: '', // any accent colour, over the ready-made ones
  myBubble: '', // the colour of one's own messages
  theirBubble: '', // the colour of the others' messages
  bubbleR: 0, // Message Corners in px (0 = the theme's own)
}
export const WALLS = [['soft', 'Plain'], ['dots', 'Pattern'], ['grid', 'Grid'], ['night', 'Night'], ['ocean', 'Ocean'], ['dusk', 'Dusk'], ['forest', 'Forest'], ['ember', 'Ember']]
// a step smaller (Alex, 8 Nov: "the letters a little smaller"); the middle one, the default, is 14.5
export const TEXT_SIZES = [12.5, 13.5, 14.5, 16, 17.5]
const KEY = 'roarme-prefs'


export function getPrefs() {
  try {
    const p = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }
    // the folder tabs on the left became tabs at the bottom (Alex, 16 Oct)
    if (p.folderTabs === 'left') p.folderTabs = 'bottom'
    // Glass was for a few hours a mode beside Light; it is a theme of its own (Alex, 12 Nov)
    if (p.mode === 'glass') { p.mode = 'light'; p.theme = 'glass' }
    // Stone, Halo and Air are gone (Alex, 12 Nov): everyone is on Glass. Halo's own look carries over as it is; a colour or
    // bubbles picked for Stone or Air were made for another palette, so they are let go
    if (p.theme !== 'glass') {
      if (p.theme !== 'halo') Object.assign(p, { chatTheme: '', myBubble: '', theirBubble: '', accentHex: '', accent: '' })
      p.theme = 'glass'
    }
    // the double click reacts with the red heart, no longer the camera (Alex, 16 Oct); a later pick of the camera stays
    if (!p.quickHeart) { if (p.quick === '🎥') p.quick = '❤️'; p.quickHeart = true }
    // the new Glass sound for everyone still on the old default, Chime (Alex, 3 Nov); a later pick of Chime stays
    if (!p.glassSound) { if (p.soundKind === 'chime') p.soundKind = 'glass'; p.glassSound = true }
    // the chat list shows the last message and its time, once, for everyone (Alex, 12 Nov); turning it off later stays
    if (!p.prevOn) { p.listPreview = true; p.prevOn = true }
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
    // the same settings again leave the screen alone: no re-render of the whole app for nothing
    const on = () => { const n = getPrefs(); setP((o) => (JSON.stringify(o) === JSON.stringify(n) ? o : n)) }
    window.addEventListener('roarme-prefs', on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener('roarme-prefs', on); window.removeEventListener('storage', on) }
  }, [])
  return p
}

/* Things kept on this device: chats hidden from the list, pins, drafts… (custom folders too, and folderSync.js keeps them in step across devices) */
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
// the event names the key that changed, so a draft being saved does not wake every other list kept here
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private window */ } window.dispatchEvent(new CustomEvent('roarme-local', { detail: k })) }
const raw = (k) => { try { return localStorage.getItem(k) } catch { return null } }
export function useLocal(key, initial) {
  const [v, setV] = useState(() => read(key, initial))
  const seen = useRef(raw(key))
  useEffect(() => {
    const on = (e) => {
      if (e.detail && e.detail !== key) return
      const now = raw(key)
      if (now === seen.current) return
      seen.current = now
      setV(read(key, initial))
    }
    window.addEventListener('roarme-local', on)
    return () => window.removeEventListener('roarme-local', on)
  }, [key])
  return [v, (next) => write(key, typeof next === 'function' ? next(read(key, initial)) : next)]
}

/* The sound when a message arrives (WebAudio, no files): a few to choose from in Settings */
export const SOUNDS = [
  // Glass (Alex, 3 Nov: "like the iPhone's"): our own short, bright two-note mallet, a soft woody overtone that fades fast
  ['glass', 'Glass', 'sine', [[1047, 0], [1568, 0.1]], true],
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
    const [, , wave, notes, mallet] = SOUNDS.find(([k]) => k === (kind || getPrefs().soundKind)) || SOUNDS[0]
    if (mallet) {
      // a struck bar: the note and its fourth harmonic, a 3 ms attack, the overtone gone first
      notes.forEach(([f, d]) => [[f, 0.16, 0.42], [f * 4, 0.035, 0.09]].forEach(([hz, peak, len]) => {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = hz
        g.gain.setValueAtTime(0.0001, t + d)
        g.gain.exponentialRampToValueAtTime(peak, t + d + 0.003)
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + len)
        o.connect(g).connect(ctx.destination)
        o.start(t + d)
        o.stop(t + d + len + 0.05)
      }))
      return
    }
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
  const set = () => { const r = document.documentElement; r.dataset.mode = (mode === 'auto' ? (mq?.matches ? 'light' : 'dark') : mode === 'glass' ? 'light' : mode) } // glass (Alex, 12 Nov): Halo's light with the glass capsule bars, to be made right later
  set()
  if (mode !== 'auto' || !mq) return () => {}
  mq.addEventListener?.('change', set)
  return () => mq.removeEventListener?.('change', set)
}

/* the look that sits on top of any theme (Alex, 16 Oct, from his Themes reference):
   accent colour, density, font, corner radius, animations, focus rings */
/* two themes, each dark and light (Alex, 31 Oct: "only Stone and Simba"): Stone, the main one since 21 Oct, and Simba
   ('ember'). Glass, Aura, Studio, Pumba, Aurum and Lions are gone; anyone left on one of them is on Stone. */
// Simba ('ember'), Velvet and Mango were removed on 12 Nov (Alex); whoever wore one is on Stone, as with the older ones
// one theme (Alex, 12 Nov: "delete Air, Stone and Halo"): Glass, which is Halo's build in liquid glass on Stone's base
export const PUBLIC_THEMES = ['glass']
// kept for the code that asked "is this Halo's build?": it always is now
export const haloish = () => true
// Alex's own account: Settings > Admin opens only for him
const THEME_LAB = ['98f8b6e1-0ce2-4576-805b-cffa25667d22'] // @iamalexkon
export const inThemeLab = (me) => !!me && THEME_LAB.includes(me.id)
// Glass is worn as data-theme 'stone' + data-skin 'halo' + data-glass: every Stone and Halo rule holds and themes-glass.css
// differs on top. Its styles come with the app (main.jsx imports them after styles.css), so there is nothing to load.
export const wearTheme = () => {}
export const dressTheme = () => {
  const r = document.documentElement
  r.dataset.theme = 'stone'; r.dataset.skin = 'halo'; r.dataset.glass = '1'
}
export const themeFor = () => 'glass'
// Halo's own colours (Alex, 12 Nov, from a palette he sent): the colour, its lighter form for the dark, the gradient your
// messages and the main buttons wear, and the ink on them
export const HALO_ACCENTS = [
  ['h-navy', 'Navy', '#031B88', '#8f9ce8', ['#2a3aa8', '#8f9ce8'], '#ffffff'],
  ['h-blue', 'Blue', '#6096FD', '#7fa9fd', ['#6f97f6', '#e48aa0'], '#ffffff'],
  ['h-lilac', 'Lilac', '#AAB6FB', '#AAB6FB', ['#b4befc', '#6f9cfd'], '#1b2152'], // dark words, as on Pink (Alex, 12 Nov)
  ['h-rose', 'Rose', '#FB7B8E', '#FB7B8E', ['#e0788f', '#2b2a8c'], '#ffffff'],
  ['h-pink', 'Pink', '#FAA7B8', '#FAA7B8', ['#fba9b9', '#fb7f92'], '#3a1824'],
  // three more pairs from the same palette (Alex, 12 Nov)
  ['h-sunset', 'Sunset', '#F7805F', '#fb9a7c', ['#ff9a3c', '#fb7b8e'], '#ffffff'],
  ['h-twilight', 'Twilight', '#4F5CC9', '#9aa5f5', ['#aab6fb', '#2a3aa8'], '#ffffff'],
  ['h-candy', 'Candy', '#8E8FE6', '#a9a9f2', ['#f48fa6', '#5a8cf5'], '#ffffff'],
  // seven more (Alex, 12 Nov: red, green, gold, dark blue, cyan, black, and one of red into gold)
  ['h-ruby', 'Ruby', '#D92D3A', '#ff6b72', ['#ff5a5f', '#b3122b'], '#ffffff'],
  ['h-forest', 'Forest', '#1F9D61', '#4fd18f', ['#3ccf86', '#11734a'], '#ffffff'],
  ['h-gold', 'Gold', '#C9962B', '#e8bf5a', ['#f3d27a', '#b8811a'], '#3a2a05'],
  ['h-midnight', 'Midnight', '#14245C', '#8fa0e8', ['#2f4aa8', '#0b1640'], '#ffffff'],
  ['h-cyan', 'Cyan', '#11A9C9', '#4fd3ee', ['#4fd3ee', '#0e86c0'], '#ffffff'],
  ['h-onyx', 'Onyx', '#1b1b20', '#c9c9d2', ['#4a4a55', '#0e0e12'], '#ffffff'],
  ['h-fire', 'Fire', '#E2572B', '#ff8a5c', ['#f6b73c', '#d92d3a'], '#ffffff'],
]
const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`
export const ACCENTS = [['blue', 'Blue', '#3b82f6'], ['green', 'Green', '#22c55e'], ['yellow', 'Yellow', '#facc15'], ['orange', 'Orange', '#f97316'], ['red', 'Red', '#d40000'], ['magenta', 'Magenta', '#d946ef'], ['violet', 'Violet', '#8b5cf6'], ['cyan', 'Cyan', '#22d3ee'], ['coral', 'Coral', '#ff6b57'], ['white', 'White', '#ffffff'], ['black', 'Black', '#111111']]
export const FONTS = [
  ['system', 'SF Pro / System', "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif"],
  ['inter', 'Inter', "'Inter', -apple-system, sans-serif"],
  ['manrope', 'Manrope', "'Manrope', -apple-system, sans-serif"],
  ['dm', 'DM Sans', "'DM Sans', -apple-system, sans-serif"],
  ['grotesk', 'Space Grotesk', "'Space Grotesk', -apple-system, sans-serif"],
  // more faces (Alex, 13 Nov), all with Greek letters; DM Sans and Space Grotesk above have none, so Greek in them is the system's
  ['roboto', 'Roboto', "'Roboto', -apple-system, sans-serif"],
  ['opensans', 'Open Sans', "'Open Sans', -apple-system, sans-serif"],
  ['fira', 'Fira Sans', "'Fira Sans', -apple-system, sans-serif"],
  ['plex', 'IBM Plex Sans', "'IBM Plex Sans', -apple-system, sans-serif"],
  ['ubuntu', 'Ubuntu', "'Ubuntu', -apple-system, sans-serif"],
  ['commissioner', 'Commissioner', "'Commissioner', -apple-system, sans-serif"],
  ['comfortaa', 'Comfortaa', "'Comfortaa', -apple-system, sans-serif"],
  ['notoserif', 'Noto Serif', "'Noto Serif', Georgia, serif"],
  ['serif', 'Serif', "Georgia, 'Times New Roman', serif"],
  ['mono', 'Mono', "'JetBrains Mono', ui-monospace, Menlo, monospace"],
]
export const inkOn = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#111111' : '#ffffff'
}
export function applyLook(p) {
  const r = document.documentElement
  const hex = (/^#[0-9a-f]{6}$/i.test(p.accentHex || '') && p.accentHex) || ACCENTS.find(([k]) => k === p.accent)?.[2]
  if (hex) { r.style.setProperty('--accent', hex); r.style.setProperty('--accent-2', hex); r.style.setProperty('--accent-ink', inkOn(hex)) } else { ['--accent', '--accent-2', '--accent-ink'].forEach((v) => r.style.removeProperty(v)) }
  // in Halo one of its own colours stands in for the orange: on your messages, Send, the chosen things
  const ha = haloish(p.theme) && HALO_ACCENTS.find(([k]) => k === p.accent)
  // Accent Opacity (Alex, 12 Nov): how see-through the accent's fill is on your messages and the coloured buttons
  const so = Math.min(100, Math.max(30, Number(p.accentOpacity) || 100)) / 100
  if (ha) {
    const [, , c, cd, [a, b], ink] = ha
    r.style.setProperty('--halo-l', c); r.style.setProperty('--halo-d', cd); r.style.setProperty('--halo-2', a)
    r.style.setProperty('--halo-mine-top', hexA(a, 0.82 * so)); r.style.setProperty('--halo-mine', hexA(b, 0.82 * so)); r.style.setProperty('--halo-ink', ink)
    r.dataset.haloAccent = '1'
  } else {
    ['--halo-l', '--halo-d', '--halo-2', '--halo-mine-top', '--halo-mine', '--halo-ink'].forEach((v) => r.style.removeProperty(v))
    delete r.dataset.haloAccent
    // the theme's own orange, thinned the same way (at full strength the style sheet's own values stand)
    if (so < 1) { r.style.setProperty('--halo-mine-top', hexA('#fa8e3e', 0.74 * so)); r.style.setProperty('--halo-mine', hexA('#f47318', 0.74 * so)) }
  }
  // the size of all the letters (Alex, 13 Nov). On a phone the browser's own text scaling does it, so only the letters
  // grow and the layout stays; a computer's browser ignores that, so there the whole page is zoomed, as its own zoom does
  const ut = Math.min(130, Math.max(85, Number(p.uiText) || 100))
  const touch = !!window.matchMedia?.('(pointer: coarse)').matches
  r.style.setProperty('-webkit-text-size-adjust', touch ? `${ut}%` : '100%'); r.style.setProperty('text-size-adjust', touch ? `${ut}%` : '100%')
  r.style.zoom = !touch && ut !== 100 ? String(ut / 100) : ''
  if (p.listPanel === false) r.dataset.nopanel = '1'; else delete r.dataset.nopanel
  const lp = Math.min(100, Math.max(0, Number(p.listPanelOp ?? 50))) / 100
  r.style.setProperty('--lp', String(lp))
  // the panel in one of the accents' pairs of colours, as see-through as Panel Opacity says; once the colour is strong
  // enough to carry them, the words on it take the pair's own ink
  const pf = p.listPanelFill === 'orange' ? ['#ff9a3c', '#f47318', '#ffffff'] : (() => { const h = HALO_ACCENTS.find(([k]) => k === p.listPanelFill); return h ? [h[4][0], h[4][1], h[5]] : null })()
  if (pf) {
    r.dataset.panelFill = '1'
    r.style.setProperty('--lpa', hexA(pf[0], lp)); r.style.setProperty('--lpb', hexA(pf[1], lp))
    if (lp >= 0.6) { r.dataset.panelInk = '1'; r.style.setProperty('--lp-ink', pf[2]) } else { delete r.dataset.panelInk; r.style.removeProperty('--lp-ink') }
  } else { delete r.dataset.panelFill; delete r.dataset.panelInk; ['--lpa', '--lpb', '--lp-ink'].forEach((v) => r.style.removeProperty(v)) }
  if (p.listPanelGrain) r.dataset.panelGrain = '1'; else delete r.dataset.panelGrain
  if (['pill', 'card', 'inset'].includes(p.listShape)) r.dataset.rooms = p.listShape; else delete r.dataset.rooms
  const cs = p.contactShape || 'plain'
  if (['card', 'inset', 'plain'].includes(cs)) r.dataset.contacts = cs; else delete r.dataset.contacts
  const f = FONTS.find(([k]) => k === p.font)
  if (f && p.font !== 'system') { r.style.setProperty('--font', f[2]); r.dataset.font = p.font } else { r.style.removeProperty('--font'); delete r.dataset.font }
  r.dataset.density = p.density || 'standard'
  r.style.setProperty('--r', `${Number(p.radius) || 12}px`)
  if (p.motion === false) r.dataset.still = '1'; else delete r.dataset.still
  if (p.focusRings) r.dataset.focus = 'bold'; else delete r.dataset.focus
  r.dataset.bubbles = p.glassBubbles === false ? 'solid' : 'glass'
  // one's own chat theme: the message colours (with a readable ink on each) and the message corners
  const tint = (key, name) => {
    const c = /^#[0-9a-f]{6}$/i.test(p[key] || '') ? p[key] : ''
    if (c) { r.style.setProperty(`--${name}`, c); r.style.setProperty(`--${name}-ink`, inkOn(c)); r.dataset[key] = '1' } else { r.style.removeProperty(`--${name}`); r.style.removeProperty(`--${name}-ink`); delete r.dataset[key] }
  }
  tint('myBubble', 'my-bubble')
  tint('theirBubble', 'their-bubble')
  const br = Number(p.bubbleR) || 0
  if (br) { r.style.setProperty('--bubble-r', `${br}px`); r.dataset.bubbleR = '1' } else { r.style.removeProperty('--bubble-r'); delete r.dataset.bubbleR }
}

/* ready-made chat themes (Alex, 9 Nov): a wallpaper, the two message colours and an accent, picked at once */
export const CHAT_THEMES = [
  ['graphite', 'Graphite', { background: 'soft', myBubble: '#2a2a2c', theirBubble: '#ffffff', accentHex: '' }],
  ['ocean', 'Ocean', { background: 'ocean', myBubble: '#2f6fd6', theirBubble: '#ffffff', accentHex: '#2f6fd6' }],
  ['dusk', 'Dusk', { background: 'dusk', myBubble: '#7b4fe0', theirBubble: '#fff6ef', accentHex: '#7b4fe0' }],
  ['forest', 'Forest', { background: 'forest', myBubble: '#2f8a5a', theirBubble: '#f2fbf5', accentHex: '#2f8a5a' }],
  ['ember', 'Ember', { background: 'ember', myBubble: '#e2553a', theirBubble: '#fff3ee', accentHex: '#e2553a' }],
  ['night', 'Night', { background: 'night', myBubble: '#4b5fc7', theirBubble: '#262b3d', accentHex: '#6f83ff' }],
]
