import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { inkOn, setPrefs } from './prefs.js'
import { ownColor } from './walls.js'

/* Edit Your Theme (Alex, 9 Nov, after the screens he sent): the chat on top, as it will look, and under it the part being
   changed (Background, Accent or Messages: yours or theirs) with a colour field of its own: hue across, white at the
   foot, a darkness bar under it, and the colour as #RRGGBB. Nothing changes until Set; Cancel leaves all as it was. */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const hex2 = (n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase()
const fromHex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255] }
const hsl2rgb = (h, s, l) => {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))))
}
const rgb2hsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}
// a colour as the field reads it: hue (0..360), whiteness down the field (0 = full colour .. 1 = white), brightness (1 .. 0 black)
const toPos = (hex) => {
  const c = fromHex(hex) || [0, 136, 255]
  const v = Math.max(...c) / 255 || 0
  if (!v) return { h: 210, y: 0, v: 0 }
  const [h, , l] = rgb2hsl(c.map((x) => x / v))
  return { h, y: clamp((l - 0.5) / 0.5), v }
}
const fromPos = ({ h, y, v }) => toHex(hsl2rgb(h, 1, 0.5 + 0.5 * y).map((x) => x * v))

function useDrag(onAt) {
  const ref = useRef(null)
  const at = (e) => { const r = ref.current.getBoundingClientRect(); onAt(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)) }
  return {
    ref,
    onPointerDown: (e) => { e.preventDefault(); ref.current.setPointerCapture?.(e.pointerId); at(e) },
    onPointerMove: (e) => { if (e.buttons || e.pointerType === 'touch') { if (ref.current.hasPointerCapture?.(e.pointerId) ?? true) at(e) } },
  }
}

function ColorField({ value, onChange }) {
  const [pos, setPos] = useState(() => toPos(value))
  const [typed, setTyped] = useState(value || '')
  const set = (p) => { setPos(p); const h = fromPos(p); setTyped(h); onChange(h) }
  const field = useDrag((x, y) => set({ ...pos, h: x * 360, y }))
  const dark = useDrag((x) => set({ ...pos, v: 1 - x }))
  const pure = fromPos({ ...pos, v: 1 })
  return (
    <div className="te-picker">
      <div className="te-hexrow">
        <span className="te-swatch" style={{ background: fromPos(pos) }} />
        <input className="input te-hex" value={typed} maxLength={7} spellCheck={false} autoCapitalize="characters"
          onChange={(e) => { const t = e.target.value.toUpperCase(); setTyped(t); const c = fromHex(t); if (c) { const h = toHex(c); setPos(toPos(h)); onChange(h) } }} />
      </div>
      <div className="te-field" {...field}>
        <i className="te-knob" style={{ left: `${(pos.h / 360) * 100}%`, top: `${pos.y * 100}%`, background: fromPos({ ...pos, v: 1 }) }} />
      </div>
      <div className="te-dark" {...dark} style={{ background: `linear-gradient(90deg, ${pure}, #000)` }}>
        <i className="te-knob" style={{ left: `${(1 - pos.v) * 100}%`, top: '50%', background: fromPos(pos) }} />
      </div>
    </div>
  )
}

export function ThemeEditor({ p, onClose }) {
  const [tab, setTab] = useState('messages')
  const [who, setWho] = useState('mine')
  const [d, setD] = useState({ myBubble: p.myBubble || '', theirBubble: p.theirBubble || '', accentHex: p.accentHex || '', background: p.background })
  const bg = ownColor(d.background)
  const my = d.myBubble || '#2A2A2C', their = d.theirBubble || '#FFFFFF', accent = d.accentHex || '#D40000'
  const key = tab === 'background' ? 'background' : tab === 'accent' ? 'accentHex' : who === 'mine' ? 'myBubble' : 'theirBubble'
  const value = key === 'background' ? bg || '#E9E9EB' : d[key] || (key === 'accentHex' ? accent : key === 'myBubble' ? my : their)
  const put = (h) => setD((x) => ({ ...x, [key]: key === 'background' ? `color:${h.toLowerCase()}` : h }))
  const save = () => { setPrefs({ ...d, chatTheme: '' }); onClose() }
  const b = (c, extra = {}) => ({ background: `linear-gradient(135deg, color-mix(in srgb, ${c} 82%, #fff), ${c} 70%)`, color: inkOn(c), ...extra })
  return createPortal(
    <div className="te-back" role="dialog" aria-label="Edit Your Theme">
      <div className="te-sheet">
        <div className="te-preview" style={bg ? { background: bg } : undefined} data-bg={bg ? undefined : d.background}>
          <div className="te-tabs seg">
            {[['background', 'Background'], ['accent', 'Accent'], ['messages', 'Messages']].map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          <span className="te-b" style={b(their)}>He wants you to look into the camera. Okay?<small>20:20</small></span>
          <span className="te-b mine" style={b(my)}>That is all he said?<small>20:20 <b style={{ color: tab === 'accent' ? accent : 'inherit' }}>✓✓</b></small></span>
          <span className="te-b" style={b(their)}><i style={{ borderColor: accent, color: accent }}>You<em style={{ color: inkOn(their) }}>That is all he said?</em></i>Yes, turn to the camera. <u style={{ color: accent }}>roarme.app</u><small>20:21</small></span>
          <span className="te-b mine" style={b(my)}>From the right or from the left? 🤔<small>20:21</small></span>
        </div>
        {tab === 'messages' && (
          <div className="te-who seg">
            <button type="button" className={who === 'mine' ? 'on' : ''} onClick={() => setWho('mine')}>Yours</button>
            <button type="button" className={who === 'theirs' ? 'on' : ''} onClick={() => setWho('theirs')}>Theirs</button>
          </div>
        )}
        <ColorField key={key} value={value} onChange={put} />
        <div className="te-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-main" onClick={save}>Set</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
