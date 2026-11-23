// RoarMoji (Alex, 23 Nov): RoarMe's own 3D emoji, made with Seedream 5.5, each with a comic motion of its own
// (squash, stretch, bounce; action lines round the strong ones). A message's ordinary emoji are drawn with these
// wherever there is one of ours; the cameras have no emoji of their own, so they go as '🎥' with file.moji.
import { Fragment } from 'react'

const KEYS = new Set(['lion', 'fire', 'heart', 'joy', 'rofl', 'hearteyes', 'love', 'kiss', 'smile', 'cool', 'thinking', 'mindblown', 'scream', 'sob', 'pleading', 'angry', 'sleepy', 'party', 'starstruck', 'wink', 'thumbsup', 'clap', 'pray', 'strong', 'eyes', 'hundred', 'sparkles', 'tada', 'rocket', 'clapper', 'popcorn', 'camera', 'trophy', 'cam-cinema', 'cam-cage', 'cam-gimbal', 'cam-drone', 'cam-shoulder', 'cam-tripod', 'cam-crane', 'cam-anamorphic', 'cam-dolly', 'cam-steadicam'])
const src = (k) => (KEYS.has(k) ? new URL(`./assets/moji/${k}.webp`, import.meta.url).href : null)

// key, the emoji it stands for (several where they look alike), its motion, a name
export const MOJI = [
  ['lion', '🦁', 'roar', 'Lion'], ['fire', '🔥', 'flick', 'Fire'], ['heart', '❤ ♥ 💖 💗', 'beat', 'Heart'],
  ['joy', '😂', 'shake', 'Tears of Joy'], ['rofl', '🤣', 'shake', 'Rolling'], ['hearteyes', '😍', 'beat', 'Heart Eyes'],
  ['love', '🥰', 'beat', 'In Love'], ['kiss', '😘', 'boing', 'Kiss'], ['smile', '😊 ☺ 🙂', 'boing', 'Smile'],
  ['cool', '😎', 'boing', 'Cool'], ['thinking', '🤔', 'jelly', 'Thinking'], ['mindblown', '🤯', 'blast', 'Mind Blown'],
  ['scream', '😱', 'shake', 'Scream'], ['sob', '😭', 'shake', 'Sob'], ['pleading', '🥺 🥹', 'jelly', 'Pleading'],
  ['angry', '😡 😠', 'shake', 'Angry'], ['sleepy', '😴', 'jelly', 'Sleepy'], ['party', '🥳', 'blast', 'Party'],
  ['starstruck', '🤩', 'blast', 'Star-Struck'], ['wink', '😜 😉', 'boing', 'Wink'], ['thumbsup', '👍', 'boing', 'Thumbs Up'],
  ['clap', '👏', 'clap', 'Clap'], ['pray', '🙏', 'boing', 'Thanks'], ['strong', '💪', 'boing', 'Strong'],
  ['eyes', '👀', 'jelly', 'Eyes'], ['hundred', '💯', 'blast', '100'], ['sparkles', '✨', 'blast', 'Sparkles'],
  ['tada', '🎉 🎊', 'blast', 'Tada'], ['rocket', '🚀', 'zoom', 'Rocket'], ['clapper', '🎬', 'clap', 'Clapper'],
  ['popcorn', '🍿', 'boing', 'Popcorn'], ['camera', '🎥', 'jelly', 'Film Camera'], ['trophy', '🏆', 'blast', 'Trophy'],
  ['cam-cinema', '📹', 'jelly', 'Cinema Camera'], ['cam-cage', '', 'jelly', 'Camera Cage'], ['cam-gimbal', '', 'jelly', 'Gimbal'],
  ['cam-drone', '', 'zoom', 'Drone'], ['cam-shoulder', '', 'jelly', 'Shoulder Rig'], ['cam-tripod', '', 'jelly', 'Tripod'],
  ['cam-crane', '', 'jelly', 'Crane'], ['cam-anamorphic', '', 'blast', 'Anamorphic'], ['cam-dolly', '', 'zoom', 'Dolly'],
  ['cam-steadicam', '', 'jelly', 'Steadicam'],
].map(([k, e, a, name]) => ({ k, e: e ? e.split(' ') : [], a, name })).filter((m) => src(m.k))

const BY_KEY = Object.fromEntries(MOJI.map((m) => [m.k, m]))
const plain = (e) => String(e || '').replace(/️/g, '')
const BY_EMOJI = {}
MOJI.forEach((m) => m.e.forEach((e) => { BY_EMOJI[plain(e)] = m }))
const LINES = new Set(['roar', 'shake', 'blast', 'zoom', 'clap', 'beat'])

export const mojiOf = (e) => BY_EMOJI[plain(e)] || null
export const mojiKey = (k) => BY_KEY[k] || null
// what a picked moji sends: its own emoji as the words (lists, notifications and other apps read that),
// and for the cameras, which have none, '🎥' with file.moji
export const mojiSend = (k) => {
  const m = BY_KEY[k]
  if (!m) return null
  return m.e.length ? { body: m.e[0], file: null } : { body: '🎥', file: { moji: k } }
}

let n = 0
export function Moji({ k, e, still }) {
  const m = k ? BY_KEY[k] : mojiOf(e)
  if (!m) return e || null
  const d = ((m.k.length * 7 + (n++ % 9) * 3) % 24) / 10 // not all in step
  return (
    <span className={`moji m-${m.a}${LINES.has(m.a) ? ' ln' : ''}${still ? ' still' : ''}`} style={{ '--md': `-${d}s` }} role="img" aria-label={m.name}>
      <img src={src(m.k)} alt="" draggable="false" />
    </span>
  )
}

// ordinary text with ours in place of the emoji we have
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
const PICT = /\p{Extended_Pictographic}/u
export function mojify(s) {
  if (!seg || typeof s !== 'string' || !PICT.test(s)) return s
  const out = []
  let buf = ''
  let i = 0
  for (const { segment } of seg.segment(s)) {
    const m = PICT.test(segment) ? mojiOf(segment) : null
    if (m) { if (buf) out.push(buf); buf = ''; out.push(<Moji key={`mj${i++}`} k={m.k} />) } else buf += segment
  }
  if (buf) out.push(buf)
  return out.length === 1 && typeof out[0] === 'string' ? out[0] : out.map((p, j) => (typeof p === 'string' ? <Fragment key={`mt${j}`}>{p}</Fragment> : p))
}

// how many of ours a message of only emoji holds (0 when any is not ours)
export function mojiCount(s) {
  if (!seg) return 0
  let c = 0
  for (const { segment } of seg.segment(String(s || '').trim())) {
    if (/^\s+$/.test(segment)) continue
    if (!mojiOf(segment)) return 0
    c++
  }
  return c
}

// the RoarMoji tab of the attach sheet: every one of ours, a tap sends it
export function MojiPick({ onPick }) {
  const faces = MOJI.filter((m) => !m.k.startsWith('cam-'))
  const cams = MOJI.filter((m) => m.k.startsWith('cam-'))
  return (
    <div className="mj-pick">
      <div className="mj-cap">Cameras</div>
      <div className="mj-grid">{cams.map((m) => <button key={m.k} type="button" title={m.name} onClick={() => onPick(m.k)}><Moji k={m.k} /></button>)}</div>
      <div className="mj-cap">RoarMoji</div>
      <div className="mj-grid">{faces.map((m) => <button key={m.k} type="button" title={m.name} onClick={() => onPick(m.k)}><Moji k={m.k} /></button>)}</div>
    </div>
  )
}
