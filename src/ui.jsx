import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { initialsOf } from './lib.js'

/* ---------- small pieces ---------- */
export const svg = (d, w = 20) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
/* the bar at the foot, in solid geometric shapes (Alex, 19 Oct: style H): each one a single filled form, the cut-outs
   (the tick, the hole of the ring) left empty so they show the bar behind them in every theme */
const solid = (d) => <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" fillRule="evenodd" aria-hidden="true"><path d={d} /></svg>
export const FOOT_I = {
  contacts: solid('M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM3 21a9 9 0 0 1 18 0z'),
  // a handset (Alex, 12 Nov), filled; Halo draws its outline
  calls: solid('M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z'),
  messages: solid('M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1.6 0-3.1-.3-4.3-1L3 21l1.6-4.6C3.6 15 3 13.1 3 11c0-4.4 4-8 9-8z'),
  tasks: solid('M4 4h16v16H4zM6.8 12.3l2.1-2.1 2 2 4.9-4.9 2.1 2.1-7 7z'),
  // a toothed gear with three spokes (Alex, 12 Nov): filled in every theme (.fi-solid), drawn in lines in Halo's rail (.fi-line)
  settings: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <g className="fi-solid"><path fillRule="evenodd" d="M10.95 3.36 L11.39 1.42 L12.61 1.42 L13.05 3.36 L15.41 4.00 L16.76 2.53 L17.82 3.14 L17.22 5.04 L18.96 6.78 L20.86 6.18 L21.47 7.24 L20.00 8.59 L20.64 10.95 L22.58 11.39 L22.58 12.61 L20.64 13.05 L20.00 15.41 L21.47 16.76 L20.86 17.82 L18.96 17.22 L17.22 18.96 L17.82 20.86 L16.76 21.47 L15.41 20.00 L13.05 20.64 L12.61 22.58 L11.39 22.58 L10.95 20.64 L8.59 20.00 L7.24 21.47 L6.18 20.86 L6.78 18.96 L5.04 17.22 L3.14 17.82 L2.53 16.76 L4.00 15.41 L3.36 13.05 L1.42 12.61 L1.42 11.39 L3.36 10.95 L4.00 8.59 L2.53 7.24 L3.14 6.18 L5.04 6.78 L6.78 5.04 L6.18 3.14 L7.24 2.53 L8.59 4.00ZM5.8 12a6.2 6.2 0 1 0 12.4 0a6.2 6.2 0 1 0 -12.4 0z" /><path d="M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0zM12.75 12.00 L12.75 5.60 L11.25 5.60 L11.25 12.00ZM11.62 12.65 L17.17 15.85 L17.92 14.55 L12.38 11.35ZM11.62 11.35 L6.08 14.55 L6.83 15.85 L12.38 12.65Z" /></g>
      <g className="fi-line"><path d="M10.95 3.36 L11.39 1.42 L12.61 1.42 L13.05 3.36 L15.41 4.00 L16.76 2.53 L17.82 3.14 L17.22 5.04 L18.96 6.78 L20.86 6.18 L21.47 7.24 L20.00 8.59 L20.64 10.95 L22.58 11.39 L22.58 12.61 L20.64 13.05 L20.00 15.41 L21.47 16.76 L20.86 17.82 L18.96 17.22 L17.22 18.96 L17.82 20.86 L16.76 21.47 L15.41 20.00 L13.05 20.64 L12.61 22.58 L11.39 22.58 L10.95 20.64 L8.59 20.00 L7.24 21.47 L6.18 20.86 L6.78 18.96 L5.04 17.22 L3.14 17.82 L2.53 16.76 L4.00 15.41 L3.36 13.05 L1.42 12.61 L1.42 11.39 L3.36 10.95 L4.00 8.59 L2.53 7.24 L3.14 6.18 L5.04 6.78 L6.78 5.04 L6.18 3.14 L7.24 2.53 L8.59 4.00Z" /><path d="M7.5 12a4.5 4.5 0 1 0 9.0 0a4.5 4.5 0 1 0 -9.0 0z" /><path d="M12 12L12.00 7.50M12 12L15.90 14.25M12 12L8.10 14.25" /></g>
    </svg>
  ),
}

export const I = {
  plus: svg(<path d="M12 5v14M5 12h14" />),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 18),
  transfer: svg(<><path d="M7 18h-.5a4.5 4.5 0 0 1-.9-8.9A6 6 0 0 1 17.3 8 4.5 4.5 0 0 1 17.5 18H17" /><path d="M12 20v-8M8.5 15 12 11.5 15.5 15" /></>),
  clip: svg(<path d="M21 11.5 12.6 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />),
  send: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.2 5.7c.1.4.4.7.8.7l9.4 1-9.4 1c-.4 0-.7.3-.8.7L2.1 19.4c-.1.7.6 1.3 1.3 1z" /></svg>,
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>),
  reply: svg(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4" />, 16),
  qmark: svg(<path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h4v1.5A2.5 2.5 0 0 1 6.5 16M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h4v1.5a2.5 2.5 0 0 1-2.5 2.5" />, 16),
  edit: svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>, 16),
  trash: svg(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, 16),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>, 16),
  x: svg(<path d="M6 6l12 12M18 6 6 18" />, 18),
  person: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>, 18),
  people: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.8c2 .9 3.5 3 3.5 6.2" /></>, 18),
  file: svg(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>, 22),
  bell: svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 16),
  archive: svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" /></>, 16),
  phone: svg(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />),
  video: svg(<><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>),
  mic: svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  translate: svg(<><path d="M4 5h8M8 3v2M6 5c0 4 2.5 7 5 8M10 5c-.5 3-2.5 6-6 8" /><path d="m13 21 4-9 4 9M14.5 18h5" /></>, 16),
  link: svg(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>, 16),
  pin: svg(<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8" />, 16),
  forward: svg(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v4" />, 16),
  select: svg(<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>, 16),
  tick1: <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>,
  ticks: <svg viewBox="0 0 20 16" width="17" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1.5 8.5 3 3 7-7M8.5 11.5l7-7" /></svg>,
  chats: svg(<path d="M4 5h16v11H9l-5 4z" />, 22),
  calls: svg(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />, 22),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, 22),
  smile: svg(<><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.01M15 9.5v.01" /></>),
  camera: svg(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, 22),
  media: svg(<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><path d="M15.5 14.5v5l4-2.5z" /></>, 22),
  image: svg(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>, 22),
  folder: svg(<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />, 18),
  play: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>,
  left: svg(<path d="M15 5l-7 7 7 7" />, 22),
  right: svg(<path d="M9 5l7 7-7 7" />, 22),
  up: svg(<path d="M5 15l7-7 7 7" />, 18),
  down: svg(<path d="M5 9l7 7 7-7" />, 18),
  download: svg(<><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 20h14" /></>, 18),
  check: svg(<path d="m5 12.5 4.5 4.5L19 7.5" />, 18),
  read: svg(<path d="m2 12.5 4.5 4.5L16 7.5M10 16.5l1 .5L21 7.5" />, 22),
  popout: svg(<><path d="M14 4h6v6M20 4l-8 8" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>, 16),
  addPerson: svg(<><circle cx="10" cy="8" r="3.5" /><path d="M3.5 20c0-3.6 2.9-6.5 6.5-6.5 1.4 0 2.7.4 3.7 1.2M18 14v6M15 17h6" /></>, 18),
  brush: svg(<><path d="M14.5 4.5l5 5L11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5.5 5-1 1.5-3 0-4" /></>, 16),
  calendar: svg(<><rect x="3.5" y="5" width="17" height="15.5" rx="3.5" /><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5v4M10 15.5h4" /></>, 16),
  place: svg(<><path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>),
  locate: svg(<><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>, 18),
  minus: svg(<path d="M5 12h14" />),
  article: svg(<><rect x="4.5" y="3.5" width="15" height="17" rx="3" /><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4" /></>),
  tasks: svg(<><rect x="4" y="3.5" width="16" height="17" rx="3.5" /><path d="m8 9 1.6 1.6L12.5 7.8M8 15l1.6 1.6 2.9-2.8M14.5 9.5H16M14.5 15.5H16" /></>),
  // a film camera with a tick on it: planning a shoot (Alex, 18 Oct)
  heading: svg(<path d="M6 5v14M18 5v14M6 12h12" />, 18),
  bullets: svg(<><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" /><circle cx="5" cy="6.5" r=".9" fill="currentColor" /><circle cx="5" cy="12" r=".9" fill="currentColor" /><circle cx="5" cy="17.5" r=".9" fill="currentColor" /></>, 18),
  numbers: svg(<><path d="M10 6.5h10M10 12h10M10 17.5h10" /><path d="M4.5 5.2 5.8 4.5v4M4.3 11.2a1.3 1.3 0 0 1 2.5.4c0 .9-2.6 1.9-2.6 2.9h2.7" /></>, 18),
  checklist: svg(<><rect x="3.5" y="4.5" width="5" height="5" rx="1.4" /><path d="m4.8 16.8 1.4 1.4 2.6-2.8M11.5 7h9M11.5 17h9" /></>, 18),
  quote: svg(<path d="M7 7.5c-1.6.9-2.5 2.3-2.5 4.5v4.5h4.5V12H6.6M16 7.5c-1.6.9-2.5 2.3-2.5 4.5v4.5H18V12h-2.4" />, 18),
  divider: svg(<><path d="M4 12h16" /><path d="M8 6.5h8M8 17.5h8" opacity=".45" /></>, 18),
  timer: svg(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></>, 16),
  bellOff: svg(<><path d="M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 2H8" /><path d="M10 20a2 2 0 0 0 4 0M4 4l16 16" /></>, 16),
  unread: svg(<><path d="M20 12a8 8 0 1 1-4.5-7.2" /><circle cx="19" cy="5" r="2.5" fill="currentColor" stroke="none" /></>, 16),
  eye: svg(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>, 16),
  clear: svg(<><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>, 16),
  lock: svg(<><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></>, 16),
  unlock: svg(<><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" /></>, 16),
  devices: svg(<><rect x="2.5" y="4.5" width="14" height="10" rx="2" /><path d="M6 18.5h7" /><rect x="17" y="8.5" width="4.5" height="11" rx="1.4" /></>, 16),
}

// each person's name in a group in a colour of their own, as in the hub's chat
export const NAME_COLORS = ['#ff8a65', '#7cc4ff', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581']
const ownColors = {}
export const setNameColor = (id, c) => { if (c) ownColors[id] = c; else delete ownColors[id] }
export const colorOf = (id) => ownColors[id] || NAME_COLORS[[...String(id || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length]

// a picture made of initials wears one of these pairs, always the same for the same name (Alex, 12 Nov: the contacts in
// glass, each with a colour of its own); Glass draws them with its grain, themes-glass.css .av-init
const INIT_PAIRS = [['#3ccf86', '#11734a'], ['#ff9a3c', '#fb7b8e'], ['#aab6fb', '#2a3aa8'], ['#f48fa6', '#5a8cf5'], ['#4fd3ee', '#0e86c0'], ['#f3d27a', '#b8811a'], ['#ff5a5f', '#b3122b'], ['#b4befc', '#6f9cfd']]
const inkOf = (name) => { const [a, b] = INIT_PAIRS[[...String(name || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % INIT_PAIRS.length]; return { '--ia': a, '--ib': b } }
export function Avatar({ src, name, size = 44, online = false, group = false }) {
  return (
    <span className={`av${group ? ' av-group' : ''}${src ? '' : ' av-init'}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36), ...(src ? null : inkOf(name)) }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span>{initialsOf(name)}</span>}
      {online && <i className="av-on" />}
    </span>
  )
}

/* Sliding with a finger (Alex, 12 Nov: "every window slides right and left to get about, wherever it can").
   useSwipeClose: a window follows a finger that slides it to the right and closes when let go past 90 px or flicked, as a
   page does (Chat.jsx). It keeps out of the way of anything that itself moves sideways (fields, sliders, maps, rows of
   tabs, a canvas, anything that scrolls sideways) and of a tab view that is not on its first tab.
   useTabSwipe: a slide to the left or right inside a tab view goes to the next or the one before. */
const SIDEWAYS = 'input, textarea, select, [contenteditable="true"], canvas, .map, .seg, .tabs, .pf-tabs, .as-tabs, .walls, .themes, .accents, .attach-grid, .rx-pick, .crop, .te-field, [data-tabs-swipe="mid"]'
const scrollsSideways = (el, stop) => { for (let n = el; n && n !== stop; n = n.parentElement) { if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true } return false }
export function useSwipeClose(ref, onClose, axis = 'x', dep = 0) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let s = null
    const start = (e) => {
      s = null
      if (e.touches.length !== 1 || e.target.closest(SIDEWAYS) || (axis === 'x' && scrollsSideways(e.target, el))) return
      if (axis === 'y' && !e.target.closest('[data-grab]')) return
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), on: false }
    }
    const move = (e) => {
      if (!s) return
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y
      const a = axis === 'x' ? dx : dy, b = axis === 'x' ? dy : dx
      if (!s.on) {
        if (Math.abs(b) > 12 && Math.abs(b) > Math.abs(a)) { s = null; return }
        if (a < 12 || a < Math.abs(b) * 1.5) return
        s.on = true
        el.style.transition = 'none'
      }
      const d = Math.max(0, a)
      el.style.transform = axis === 'x' ? `translate3d(${d}px,0,0)` : `translate3d(0,${d}px,0)`
      el.style.opacity = String(1 - Math.min(0.4, d / 600))
    }
    const end = (e) => {
      if (!s) return
      const { x, y, t, on } = s
      s = null
      if (!on) return
      const dx = e.changedTouches[0].clientX - x, dy = e.changedTouches[0].clientY - y
      const a = axis === 'x' ? dx : dy
      const go = a > 90 || (a > 40 && Date.now() - t < 280)
      el.style.transition = 'transform .18s ease-out, opacity .18s'
      if (!go) { el.style.transform = ''; el.style.opacity = ''; setTimeout(() => { el.style.transition = '' }, 200); return }
      el.style.transform = axis === 'x' ? 'translate3d(100%,0,0)' : 'translate3d(0,100%,0)'
      el.style.opacity = '0'
      setTimeout(() => close.current(), 170)
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end) }
  }, [ref, axis, dep])
}
export function useTabSwipe(ref, keys, current, setCurrent, dep = 0) {
  const st = useRef({})
  st.current = { keys, current, setCurrent }
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let s = null
    const start = (e) => { s = e.touches.length === 1 && !e.target.closest('input, textarea, canvas, .map, .seg, input[type="range"]') && !scrollsSideways(e.target, el) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null }
    const end = (e) => {
      if (!s) return
      const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y
      const quick = Date.now() - s.t < 500
      s = null
      if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return
      const { keys: k, current: c, setCurrent: set } = st.current
      const i = k.indexOf(c)
      const n = dx < 0 ? i + 1 : i - 1
      if (i < 0 || n < 0 || n >= k.length) return
      set(k[n])
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchend', end)
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchend', end) }
  }, [ref, dep])
}

export function Modal({ title, onClose, children, foot, wide = false }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  const box = useRef(null)
  useSwipeClose(box, onClose)
  // on the page itself, not inside a glass panel (a panel's blur would hold it inside the panel)
  return createPortal(
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={box} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>,
    document.body,
  )
}


/* on the page itself: menus and full-screen views that must sit where the pointer is */
export const OnTop = ({ children }) => createPortal(children, document.body)

/* motion is off in power saving and when the computer asks for less motion */
export const calm = () => !!document.documentElement.dataset.lite || !!document.documentElement.dataset.still || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* the glass lens that slides to the chosen tab (tabs, the foot bar, segmented choices) */
export function useLens(dep) {
  const ref = useRef(null)
  const was = useRef({})
  const go = useRef([0, 0, false])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const put = () => {
      const on = el.querySelector(':scope > .on')
      if (!on) { el.classList.remove('lens-on'); return }
      const to = { x: on.offsetLeft, w: on.offsetWidth }
      const from = was.current
      const moved = from.el && from.el !== on && from.el.isConnected
      was.current = { el: on, ...to }
      el.style.setProperty('--ly', `${on.offsetTop}px`)
      el.style.setProperty('--lh', `${on.offsetHeight}px`)
      el.classList.add('lens-on')
      // a bar that asks for it ([data-travel], the menu at the foot: Alex, 12 Nov, as the glass bar of iOS): the lens
      // lifts and stretches from the old tab over to the new one, then draws in onto it and settles. While it travels,
      // a call that changes nothing (a resize, an unread count) leaves it alone; it lands on where the tab is by then
      if (moved && el.dataset.travel !== undefined && !calm()) {
        clearTimeout(go.current[0]); clearTimeout(go.current[1])
        const x0 = Math.min(from.x, to.x)
        const x1 = Math.max(from.x + from.w, to.x + to.w)
        go.current[2] = true
        el.classList.remove('lens-land')
        el.classList.add('lens-go')
        el.style.setProperty('--lx', `${x0}px`)
        el.style.setProperty('--lw', `${x1 - x0}px`)
        const land = () => { el.style.setProperty('--lx', `${was.current.x}px`); el.style.setProperty('--lw', `${was.current.w}px`) }
        go.current[0] = setTimeout(() => { land(); el.classList.add('lens-land') }, 150)
        go.current[1] = setTimeout(() => { go.current[2] = false; land(); el.classList.remove('lens-go', 'lens-land') }, 470)
        return
      }
      if (go.current[2]) return
      el.classList.remove('lens-go', 'lens-land')
      el.style.setProperty('--lx', `${to.x}px`)
      el.style.setProperty('--lw', `${to.w}px`)
    }
    put()
    // follow size changes of the bar and of each tab, and a change of theme or text size
    const ro = new ResizeObserver(put)
    ro.observe(el)
    ;[...el.children].forEach((c) => ro.observe(c))
    const later = () => requestAnimationFrame(() => requestAnimationFrame(put))
    window.addEventListener('roarme-prefs', later)
    return () => { ro.disconnect(); window.removeEventListener('roarme-prefs', later) }
  }, [dep])
  return ref
}
/* Liquid glass on a bar of tabs (Alex, 12 Nov, from WhatsApp's): a finger pressed on the bar swells the chosen lens into
   clear glass with a rainbow rim that follows the finger; letting go picks the tab under it. A bar that scrolls sideways
   keeps its scrolling instead. Only in Halo, and not with Power Saving or reduced motion. */
export function useLiquid(ref, dep) {
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const on = () => document.documentElement.dataset.skin === 'halo' && !calm()
    const fits = () => el.scrollWidth <= el.clientWidth + 2
    const fix = () => { el.style.touchAction = on() && fits() ? 'pan-y' : '' }
    fix()
    const ro = new ResizeObserver(fix)
    ro.observe(el)
    let g = null
    const childAt = (x, y) => { const t = document.elementFromPoint(x, y); const c = t && t.closest('button'); return c && c.parentElement === el && !c.disabled ? c : null }
    const put = (x) => { const r = el.getBoundingClientRect(); el.style.setProperty('--fx', `${Math.max(0, Math.min(r.width, x - r.left))}px`) }
    const down = (e) => {
      if (e.button || !on() || !fits() || !el.querySelector(':scope > .on')) return
      g = { x: e.clientX, moved: false, id: e.pointerId }
      put(e.clientX)
      el.classList.add('liquid')
    }
    const move = (e) => {
      if (!g || e.pointerId !== g.id) return
      if (!g.moved && Math.abs(e.clientX - g.x) > 8) { g.moved = true; el.classList.add('liquid-drag') }
      if (g.moved) {
        put(e.clientX)
        const c = childAt(e.clientX, e.clientY)
        el.querySelectorAll(':scope > .liquid-at').forEach((b) => { if (b !== c) b.classList.remove('liquid-at') })
        if (c) c.classList.add('liquid-at')
      }
    }
    const end = (e, pick) => {
      if (!g || (e.pointerId != null && e.pointerId !== g.id)) return
      const moved = g.moved
      g = null
      el.classList.remove('liquid', 'liquid-drag')
      el.querySelectorAll(':scope > .liquid-at').forEach((b) => b.classList.remove('liquid-at'))
      if (!moved || !pick) return
      const c = childAt(e.clientX, e.clientY)
      // the finger's own click lands where it began: keep it from choosing that one too
      const stop = (ev) => { ev.stopPropagation(); ev.preventDefault() }
      el.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 400)
      if (c) setTimeout(() => c.click(), 0)
    }
    const up = (e) => end(e, true)
    const cancel = (e) => end(e, false)
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => { ro.disconnect(); el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  }, [ref, dep])
}
/* A slider that follows the finger at once (Alex, 12 Nov: "smoother, a better answer, easy to catch"): the knob moves on
   its own state, what it changes is told at most once a frame, and the filled part of the line is drawn from --p */
export function Slide({ value, onChange, min = 0, max = 100, step = 1, ...rest }) {
  const [v, setV] = useState(value)
  const live = useRef(false)
  const raf = useRef(0)
  const last = useRef(value)
  useEffect(() => { if (!live.current) setV(value) }, [value])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const tell = (n) => { last.current = n; if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; onChange(last.current) }) }
  const done = () => { live.current = false }
  return (
    <input type="range" className="slide" min={min} max={max} step={step} value={v} style={{ '--p': `${((v - min) / (max - min || 1)) * 100}%` }}
      onChange={(e) => { const n = Number(e.target.value); live.current = true; setV(n); tell(n) }}
      onPointerUp={done} onPointerCancel={done} onBlur={done} onTouchEnd={done} {...rest} />
  )
}
export function Lens({ as: Tag = 'span', className = '', dep, children }) {
  const ref = useLens(dep)
  // every lens bar moves in Glass Travel (see useLens): the lens lifts, stretches across and lands
  return <Tag ref={ref} className={`${className} lens`} data-travel="">{children}</Tag>
}

/* a little burst of the emoji where you reacted */
export function burst(emoji, x, y) {
  if (calm() || x == null) return
  for (let i = 0; i < 7; i += 1) {
    const s = document.createElement('span')
    s.className = 'burst'
    s.textContent = emoji
    const a = ((-90 + (i - 3) * 24) * Math.PI) / 180
    const d = 46 + Math.random() * 42
    s.style.cssText = `left:${x}px;top:${y}px;--bx:${Math.cos(a) * d}px;--by:${Math.sin(a) * d - 18}px;--br:${(Math.random() - 0.5) * 70}deg;animation-delay:${Math.abs(i - 3) * 30}ms;font-size:${i === 3 ? 34 : 17 + Math.random() * 9}px`
    document.body.appendChild(s)
    setTimeout(() => s.remove(), 1200)
  }
}

/* dark to light (and back) as a circle that opens from where you clicked */
export function revealFrom(e, change) {
  if (calm() || !document.startViewTransition) { change(); return }
  const r = document.documentElement
  r.style.setProperty('--vx', `${e?.clientX ?? window.innerWidth / 2}px`)
  r.style.setProperty('--vy', `${e?.clientY ?? 0}px`)
  r.classList.add('vt-reveal')
  const t = document.startViewTransition(change)
  t.finished.finally(() => r.classList.remove('vt-reveal'))
}

/* RoarMe's mark (Alex, 16 Oct): a lion cub's paw, in the theme's accent colour */
export function Paw({ size = 22 }) {
  return (
    <svg className="paw" width={size} height={size} viewBox="14 16 36 37" aria-hidden="true" fill="currentColor">
      <path d="M32 33.5c-7.4 0-13.5 6.4-13.5 12.2 0 4 3 6.3 6.6 6.3 2.7 0 4.3-1.4 6.9-1.4s4.2 1.4 6.9 1.4c3.6 0 6.6-2.3 6.6-6.3 0-5.8-6.1-12.2-13.5-12.2z" />
      <ellipse cx="18.6" cy="30.6" rx="3.9" ry="5" transform="rotate(-22 18.6 30.6)" />
      <ellipse cx="26.3" cy="21.4" rx="4.1" ry="5.4" transform="rotate(-8 26.3 21.4)" />
      <ellipse cx="37.7" cy="21.4" rx="4.1" ry="5.4" transform="rotate(8 37.7 21.4)" />
      <ellipse cx="45.4" cy="30.6" rx="3.9" ry="5" transform="rotate(22 45.4 30.6)" />
    </svg>
  )
}
// the name as THE MAD LIONS writes its own (Alex, 17 Oct): capitals in Jost, ROAR hairline-thin, ME heavy, in white;
// (the "beta" tag beside it is gone: Alex, 12 Nov)
// "by THEMADLIONS", the studio's name as its own logo writes it: THE and LIONS thin, MAD heavy (Alex, 17 Oct)
/* the RoarMe mark (Alex, 17 Oct): five bars, leaning, drawn from his logo; white in the app like the wordmark (the
   app icon outside keeps it red) */
const MARK_BARS = [[-489, -279], [-289, -488], [-92, -349], [104, -272], [304, -481]]
export const Mark = ({ size = 28, className = '' }) => (
  <svg className={`rm-mark ${className}`} viewBox="320 320 1290 1290" width={size} height={size} aria-hidden="true">
    <g fill="currentColor" transform="translate(964 966) rotate(-23.6)">{MARK_BARS.map(([x, y]) => <rect key={x} x={x} y={y} width="192" height="754" rx="18" />)}</g>
  </svg>
)
export const ByTML = () => <span className="by-tml" data-raw="1">by <b>THE<strong>MAD</strong>LIONS</b></span>
export const Wordmark = ({ by = false }) => (
  <span className={`wordmark${by ? ' with-by' : ''}`}>
    {by && <Mark size={72} />}
    <b className="wm"><span className="wm-a">ROAR</span><span className="wm-b">ME</span></b>
    {by && <ByTML />}
  </span>
)

/* Adjust a new picture before it is saved (Alex, 16 Oct): drag to place it, slide or scroll to zoom,
   inside the round frame it will be shown in. Gives back a square JPEG, 400 px (Alex, 21 Oct: RoarMe lighter; the biggest circle it fills is 132 px, so 400 is sharp on any phone). */
const FRAME = 280
export function CropModal({ file, title = 'Adjust photo', onDone, onClose }) {
  const [img, setImg] = useState(null)
  const [z, setZ] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef(null)
  useEffect(() => {
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => setImg(i)
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])
  const base = img ? Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight) : 1
  const dw = img ? img.naturalWidth * base * z : FRAME
  const dh = img ? img.naturalHeight * base * z : FRAME
  const clamp = (p, w = dw, h = dh) => ({ x: Math.max(-(w - FRAME) / 2, Math.min((w - FRAME) / 2, p.x)), y: Math.max(-(h - FRAME) / 2, Math.min((h - FRAME) / 2, p.y)) })
  const zoomTo = (nz) => {
    const v = Math.max(1, Math.min(4, nz))
    setZ(v)
    if (img) setPos((p) => clamp(p, img.naturalWidth * base * v, img.naturalHeight * base * v))
  }
  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, ...pos } }
  const move = (e) => { if (drag.current) setPos(clamp({ x: drag.current.x + e.clientX - drag.current.sx, y: drag.current.y + e.clientY - drag.current.sy })) }
  const up = () => { drag.current = null }
  const save = () => {
    if (!img) return
    const O = 400
    const r = O / FRAME
    const c = document.createElement('canvas')
    c.width = O
    c.height = O
    const g = c.getContext('2d')
    g.fillStyle = '#111'
    g.fillRect(0, 0, O, O)
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, O / 2 + pos.x * r - (dw * r) / 2, O / 2 + pos.y * r - (dh * r) / 2, dw * r, dh * r)
    c.toBlob((b) => b && onDone(new File([b], 'photo.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.9)
  }
  return (
    <Modal title={title} onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" onClick={save} disabled={!img}>Save</button></>}>
      <div className="crop">
        <div className="crop-frame" style={{ width: FRAME, height: FRAME }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onWheel={(e) => zoomTo(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
          {img && <img src={img.src} alt="" draggable={false} style={{ width: dw, height: dh, transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))` }} />}
          <span className="crop-ring" />
        </div>
        <label className="crop-zoom">
          {svg(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M8.5 11h5" /></>, 18)}
          <input type="range" min="1" max="4" step="0.01" value={z} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" />
          {svg(<><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M8.5 11h5M11 8.5v5" /></>, 18)}
        </label>
        <small className="muted">Drag to place it, slide or scroll to zoom</small>
      </div>
    </Modal>
  )
}

// true once the element has come near the screen: a grid of hundreds of tiles asks for each picture only then
export function useSeen() {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}
