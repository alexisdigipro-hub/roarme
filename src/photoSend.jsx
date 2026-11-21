import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { process as runFx, processed, lookValues, isNeutral, lutOf, LOOKS, BANDS, noHsl, noCurves } from './photoFx.js'

/* The photo before it is sent, full screen (Alex, 21 Nov, from Telegram's editor, sample
   https://claude.ai/artifact/HzvtsMf5inTA3G2i3tYQzE version 2: "βάλ' το"; the pro tools the same day: "Όλα").
   Top: close, "1 of 3", Revert and a hold-to-see-the-original eye once the photo is changed, the ring that keeps or
   drops this photo. Foot: the caption, a glass capsule of Crop · Draw · Adjust · Looks · Quality (HD) and Send.
   Crop: a frame with handles, Free / 1:1 / 4:5 / 4:3 / 16:9 / 1.85 / 2.39 / 9:16, black bars for the wide ones, a ruler to
   straighten, turn, mirror, reset. Draw: Draw (Pen, Arrow, Marker, Neon, Blur, Pixelate, Eraser), Shapes (line, arrow,
   box, circle), Text (four faces, filled / outlined / plain, sized by the wedge, dragged into place), eight colours and
   any colour, Undo, Clear All. Adjust: Light and Colour (13 dials), Curves (light, red, green, blue), HSL (eight colours).
   Looks: eight looks with a strength. ✕ throws a tool's changes away, ✓ bakes them into the photo (a new JPEG, on the
   device; the pixel work is photoFx.js). HD sends the photo whole instead of lighter. Videos and GIFs show as they are. */
const ADJ = [
  ['enhance', 'Enhance', 0, 100, <path key="e" d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />],
  ['exposure', 'Exposure', -100, 100, <><circle cx="12" cy="12" r="8.5" /><path d="M7.5 9.5h4M9.5 7.5v4M12.5 15h4" /></>],
  ['brightness', 'Brightness', -100, 100, <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>],
  ['contrast', 'Contrast', -100, 100, <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></>],
  ['highlights', 'Highlights', -100, 100, <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5H12z" fill="currentColor" /></>],
  ['shadows', 'Shadows', -100, 100, <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17a8.5 8.5 0 0 1-17 0z" fill="currentColor" opacity=".55" /></>],
  ['saturation', 'Saturation', -100, 100, <path key="s" d="M12 3.5c3 3.6 6 7 6 10.2A6 6 0 0 1 6 13.7C6 10.5 9 7.1 12 3.5z" />],
  ['warmth', 'Warmth', -100, 100, <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 11v5" /></>],
  ['tint', 'Tint', -100, 100, <><circle cx="9" cy="12" r="5.5" /><circle cx="15" cy="12" r="5.5" /></>],
  ['fade', 'Fade', 0, 100, <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M4.5 15.5l15-7" /></>],
  ['grain', 'Grain', 0, 100, <><circle cx="8" cy="8" r=".9" fill="currentColor" /><circle cx="16" cy="8" r=".9" fill="currentColor" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><circle cx="8" cy="16" r=".9" fill="currentColor" /><circle cx="16" cy="16" r=".9" fill="currentColor" /><rect x="4" y="4" width="16" height="16" rx="4" /></>],
  ['sharpen', 'Sharpen', 0, 100, <path key="sh" d="M12 4l8.5 15h-17z" />],
  ['vignette', 'Vignette', 0, 100, <><rect x="3.5" y="5" width="17" height="14" rx="3" /><circle cx="12" cy="12" r="4" /></>],
]
const ZERO = Object.fromEntries(ADJ.map(([k]) => [k, 0]))
const COLORS = ['#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#64d2ff', '#0a84ff', '#bf5af2']
const PENS = ['pen', 'arrow', 'marker', 'neon', 'blur', 'pixel', 'eraser']
const FXPEN = (s) => s.pen === 'blur' || s.pen === 'pixel'
const SHAPES = [
  ['line', <path key="l" d="M5 19L19 5" />], ['arrow', <path key="a" d="M5 19L19 5M10 5h9v9" />],
  ['rect', <rect key="r" x="4.5" y="6" width="15" height="12" rx="2.5" />], ['circle', <circle key="c" cx="12" cy="12" r="7.5" />],
]
const FONTS = [
  ['sans', 'Sans', '-apple-system, system-ui, sans-serif', 800],
  ['serif', 'Serif', '"New York", Georgia, "Times New Roman", serif', 700],
  ['round', 'Rounded', 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif', 800],
  ['mono', 'Mono', 'ui-monospace, Menlo, monospace', 700],
]
const TSTYLES = ['fill', 'outline', 'plain']
const ASPECTS = [['Free', 0], ['1:1', 1], ['4:5', 0.8], ['4:3', 4 / 3], ['16:9', 16 / 9], ['1.85', 1.85], ['2.39', 2.39], ['9:16', 9 / 16]]
const CH = [['l', 'Light', '#ffffff'], ['r', 'Red', '#ff453a'], ['g', 'Green', '#32d74b'], ['b', 'Blue', '#0a84ff']]
const MAX = 4096 // the longest side kept while editing (HD sends what comes out)

const S = (d, w = 22) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const IC = {
  x: S(<path d="M6 6l12 12M18 6L6 18" />),
  ok: S(<path d="M5 12.5l4.5 4.5L19 7" />, 26),
  send: S(<path d="M5 12h12M12 6l6 6-6 6" />, 26),
  crop: S(<path d="M6 2.5v13.5a2 2 0 0 0 2 2h13.5M2.5 6H16a2 2 0 0 1 2 2v13.5" />, 21),
  draw: S(<><path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L8.6 18.8z" /><path d="M13.5 7l3.5 3.5" /></>, 21),
  adjust: S(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 7.5a4.5 4.5 0 0 1 0 9" fill="currentColor" /></>, 21),
  looks: S(<><circle cx="9" cy="9.5" r="5" /><circle cx="15" cy="9.5" r="5" /><circle cx="12" cy="15" r="5" /></>, 21),
  turn: S(<><rect x="3.5" y="10" width="10" height="10" rx="2" /><path d="M10 4.5h4a5 5 0 0 1 5 5v1.5M16.5 9l2.5 2.5L21.5 9" /></>),
  flip: S(<><path d="M12 3v18" strokeDasharray="2 2.5" /><path d="M9 6.5L3.5 17.5H9zM15 6.5l5.5 11H15z" /></>),
  bars: S(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 8.5h18M3 15.5h18" /></>),
  reset: S(<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5" />),
  undo: S(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  auto: S(<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />),
  eye: S(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>),
  tstyle: { fill: S(<><rect x="3.5" y="5" width="17" height="14" rx="3.5" fill="currentColor" opacity=".35" /><path d="M8.5 15.5L12 8l3.5 7.5M9.8 13h4.4" /></>), outline: S(<path d="M7 18.5L12 5.5l5 13M8.8 14h6.4" strokeWidth="2.6" />), plain: S(<path d="M7.5 17.5L12 6.5l4.5 11M9 14h6" />) },
}
const isPhoto = (f) => /^image\//.test(f?.type || '') && !/gif/.test(f.type)
const tick = () => { try { navigator.vibrate?.(4) } catch { /* none */ } }
const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }
const contrastOf = (c) => (/^#(f|e|d)/i.test(c) ? '#111' : '#fff')

// the image turned (90° steps), mirrored and straightened, scaled so the straightened picture still fills its frame
const turned = (img, rot, flip, deg) => {
  const sw = img.width, sh = img.height, side = rot % 180 !== 0
  const w = side ? sh : sw, h = side ? sw : sh
  const c = canvasOf(w, h)
  const g = c.getContext('2d'), t = (Math.abs(deg) * Math.PI) / 180
  const fill = Math.max((w * Math.cos(t) + h * Math.sin(t)) / w, (w * Math.sin(t) + h * Math.cos(t)) / h)
  g.translate(w / 2, h / 2); g.rotate(((rot + deg) * Math.PI) / 180); if (flip) g.scale(-1, 1); g.scale(fill, fill)
  g.drawImage(img, -sw / 2, -sh / 2)
  return c
}
const toFile = (canvas, name) => new Promise((ok) => canvas.toBlob((b) => ok(new File([b], (name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() })), 'image/jpeg', 0.92))
const loadImg = (file) => new Promise((ok, no) => {
  const u = URL.createObjectURL(file), im = new Image()
  im.onload = () => {
    const k = Math.min(1, MAX / Math.max(im.naturalWidth, im.naturalHeight))
    const c = canvasOf(im.naturalWidth * k, im.naturalHeight * k)
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c)
  }
  im.onerror = () => { URL.revokeObjectURL(u); no(new Error('image')) }
  im.src = u
})
// a blurred and a pixelated copy of the picture, for the Blur and Pixelate brushes (by scaling: canvas filters are not on every iPhone)
const makeFx = (src, w, h) => {
  const step = (from, sw, sh) => { const c = canvasOf(sw, sh), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(from, 0, 0, c.width, c.height); return c }
  const a = step(src, w / 6, h / 6), b = step(a, w / 24, h / 24), c2 = step(b, w / 6, h / 6), blur = step(c2, w, h)
  const cell = Math.max(6, Math.round(Math.min(w, h) / 36)), small = canvasOf(w / cell, h / cell)
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height)
  const pixel = canvasOf(w, h), pg = pixel.getContext('2d'); pg.imageSmoothingEnabled = false; pg.drawImage(small, 0, 0, w, h)
  return { blur, pixel }
}

// a ruler dragged sideways: degrees for straighten, values for adjust
function Ruler({ from, to, step, value, onChange, label }) {
  const px = 9.5 / step
  const d = useRef(null)
  const ticks = []
  for (let v = from; v <= to; v += step) ticks.push(<i key={v} className={Math.round((v - from) / step) % 5 === 0 ? 'big' : ''} data-n={label(v)} />)
  return (
    <div className="phx-ruler" onPointerDown={(e) => { d.current = { x: e.clientX, v: value }; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => {
        if (!d.current) return
        const v = Math.max(from, Math.min(to, Math.round(d.current.v - (e.clientX - d.current.x) / px)))
        if (v !== value) { onChange(v); if (Math.round(v - from) % (step * 5) === 0) tick() }
      }}
      onPointerUp={() => { d.current = null }} onPointerCancel={() => { d.current = null }}>
      <div className="phx-ticks" style={{ transform: `translateX(calc(-50% + ${-(value - (from + to) / 2) * px}px))` }}>{ticks}</div>
      <i className="phx-needle" />
    </div>
  )
}

// a bar whose chosen button wears a sliding lens (the bar may scroll sideways)
function Lensed({ className, children, dep }) {
  const ref = useRef(null)
  const [st, setSt] = useState({ w: 0, x: 0, go: false })
  useLayoutEffect(() => {
    const bar = ref.current, on = bar?.querySelector(':scope > button.on')
    if (!bar || !on) { setSt((s) => ({ ...s, w: 0 })); return undefined }
    const br = bar.getBoundingClientRect(), r = on.getBoundingClientRect()
    setSt({ w: r.width, x: r.left - br.left + bar.scrollLeft, go: true })
    if (bar.scrollWidth > bar.clientWidth) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setSt((s) => ({ ...s, go: false })), 260)
    return () => clearTimeout(t)
  }, [dep])
  return <div ref={ref} className={className}><i className={`phx-lens${st.go ? ' go' : ''}`} style={{ width: st.w, transform: `translateX(${st.x}px)` }} />{children}</div>
}

// a tone curve: tap to add a point, drag to move it, drag a middle point off the top or bottom to take it away
function Curve({ pts, color, onChange }) {
  const ref = useRef(null)
  const d = useRef(null)
  const W = 300, H = 160
  const lut = lutOf(pts)
  let path = ''
  for (let i = 0; i <= 255; i += 3) path += `${i ? 'L' : 'M'}${((i / 255) * W).toFixed(1)} ${(H - (lut[i] / 255) * H).toFixed(1)}`
  path += `L${W} ${(H - (lut[255] / 255) * H).toFixed(1)}`
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height] }
  const down = (e) => {
    const [x, y] = pos(e), r = ref.current.getBoundingClientRect()
    let i = pts.findIndex(([px, py]) => Math.hypot((px - x) * r.width, (py - y) * r.height) < 24)
    let next = pts
    if (i < 0) {
      const nx = Math.min(0.98, Math.max(0.02, x))
      next = [...pts, [nx, Math.min(1, Math.max(0, y))]].sort((a, b) => a[0] - b[0])
      i = next.findIndex((p) => p[0] === nx)
      onChange(next); tick()
    }
    d.current = { i, pts: next }; e.currentTarget.setPointerCapture(e.pointerId)
  }
  const move = (e) => {
    const s = d.current
    if (!s || s.gone) return
    const [x, y] = pos(e), p = s.pts.map((q) => [...q]), i = s.i, last = p.length - 1
    if (i === 0 || i === last) p[i] = [p[i][0], Math.min(1, Math.max(0, y))]
    else {
      if (y > 1.18 || y < -0.18) { s.gone = true; onChange(p.filter((_, k) => k !== i)); tick(); return }
      p[i] = [Math.min(p[i + 1][0] - 0.03, Math.max(p[i - 1][0] + 0.03, x)), Math.min(1, Math.max(0, y))]
    }
    s.pts = p; onChange(p)
  }
  const up = () => { d.current = null }
  return (
    <svg ref={ref} className="phx-curve" viewBox={`0 0 ${W} ${H}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {[1, 2, 3].map((k) => <g key={k}><line x1={(W * k) / 4} y1="0" x2={(W * k) / 4} y2={H} /><line x1="0" y1={(H * k) / 4} x2={W} y2={(H * k) / 4} /></g>)}
      <line className="dia" x1="0" y1={H} x2={W} y2="0" />
      <path d={path} style={{ stroke: color }} />
      {pts.map(([x, y], k) => <circle key={k} cx={x * W} cy={H - y * H} r="7" style={{ stroke: color }} />)}
    </svg>
  )
}

export function PhotoSend({ files, start = 0, caption, setCaption, onBack, onReplace, onSend }) {
  const [idx, setIdx] = useState(Math.min(start, files.length - 1))
  const [dropped, setDropped] = useState(() => new Set())
  const [hd, setHd] = useState(false)
  const [mode, setMode] = useState('')
  const [busy, setBusy] = useState(false)
  const [img, setImg] = useState(null) // the working picture (a canvas) of the photo shown
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [fit, setFit] = useState(0) // a resize draws the photo again
  const [peek, setPeek] = useState(false) // held: the photo as it was
  // crop
  const [rot, setRot] = useState(0)
  const [flip, setFlip] = useState(false)
  const [deg, setDeg] = useState(0)
  const [aspect, setAspect] = useState(0)
  const [bars, setBars] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [dragging, setDragging] = useState(false)
  // adjust and looks
  const [adj, setAdj] = useState(ZERO)
  const [dial, setDial] = useState('enhance')
  const [adjTab, setAdjTab] = useState('light')
  const [curves, setCurves] = useState(noCurves)
  const [ch, setCh] = useState('l')
  const [hsl, setHsl] = useState(noHsl)
  const [band, setBand] = useState('orange')
  const [look, setLook] = useState('none')
  const [strength, setStrength] = useState(100)
  const [thumbs, setThumbs] = useState({})
  // draw
  const [strokes, setStrokes] = useState([])
  const [pen, setPen] = useState('pen')
  const [shape, setShape] = useState('arrow')
  const [color, setColor] = useState('#ffffff')
  const [size, setSize] = useState(7)
  const [sizing, setSizing] = useState(false)
  const [drawTab, setDrawTab] = useState('draw')
  const [font, setFont] = useState('sans')
  const [tstyle, setTstyle] = useState('fill')
  const [sel, setSel] = useState(null) // the text being worked on
  const stage = useRef(null)
  const view = useRef(null)
  const ink = useRef(null)
  const line = useRef(null)
  const drag = useRef(null)
  const base = useRef(null) // the shown picture's pixels, for the live preview of Adjust and Looks
  const fxScreen = useRef(null)
  const origFile = useRef(new Map()) // each photo as it came in, for Revert
  const origPic = useRef(new Map())
  const tdrag = useRef(null)
  const hold = useRef(null)
  const swipe = useRef(null)
  const file = files[idx]
  const photo = isPhoto(file)
  const kept = files.filter((_, k) => !dropped.has(k))
  if (file && !origFile.current.has(idx)) origFile.current.set(idx, file)
  const changed = photo && origFile.current.get(idx) !== file

  // the working picture for the photo shown
  useEffect(() => {
    let alive = true
    setImg(null)
    if (photo) loadImg(file).then((c) => { if (!alive) return; if (origFile.current.get(idx) === file) origPic.current.set(idx, c); setImg(c) }).catch(() => {})
    return () => { alive = false }
  }, [file, photo, idx])
  const [vidUrl, setVidUrl] = useState('')
  useEffect(() => {
    if (photo || !file) { setVidUrl(''); return undefined }
    const u = URL.createObjectURL(file); setVidUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, photo])

  // the values the preview and the bake use
  const params = useMemo(() => (mode === 'looks' ? (lookValues(look, strength) || {}) : mode === 'adjust' ? { ...adj, hsl, curves } : {}), [mode, look, strength, adj, hsl, curves])

  // what is drawn on screen: the photo (the whole turned picture while cropping) fitted into the stage
  useLayoutEffect(() => {
    const el = stage.current
    const pic = mode === 'crop' && img ? turned(img, rot, flip, deg) : (peek && !mode && origPic.current.get(idx)) || img
    if (!el || !pic) return
    const cs = getComputedStyle(el), pad = mode === 'crop' ? 36 : 0
    const aw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - pad
    const ah = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - pad
    const k = Math.min(aw / pic.width, ah / pic.height)
    const w = Math.max(40, Math.round(pic.width * k)), h = Math.max(40, Math.round(pic.height * k))
    const c = view.current, dpr = Math.min(mode === 'adjust' || mode === 'looks' ? 1.25 : 2, window.devicePixelRatio || 1)
    c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px`
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(pic, 0, 0, c.width, c.height)
    base.current = mode === 'adjust' || mode === 'looks' ? g.getImageData(0, 0, c.width, c.height) : null
    fxScreen.current = null
    setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
  }, [img, mode, rot, flip, deg, fit, peek])
  useEffect(() => { const f = () => setFit((n) => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])

  // the live preview of Adjust and Looks, one frame at a time
  useEffect(() => {
    if ((mode !== 'adjust' && mode !== 'looks') || !base.current) return undefined
    const id = requestAnimationFrame(() => {
      const b = base.current, c = view.current
      if (!b || !c) return
      const im = new ImageData(new Uint8ClampedArray(b.data), b.width, b.height)
      if (!peek && !isNeutral(params)) runFx(im, b.width, b.height, params)
      c.getContext('2d', { willReadFrequently: true }).putImageData(im, 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [params, peek, mode, box, img])

  // small pictures of each look
  useEffect(() => {
    if (mode !== 'looks' || !img) return
    const t = canvasOf(112, 112), s = Math.min(img.width, img.height)
    t.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 112, 112)
    const out = {}
    for (const [k] of LOOKS) out[k] = (k === 'none' ? t : processed(t, lookValues(k, 100))).toDataURL('image/jpeg', 0.8)
    setThumbs(out)
  }, [mode, img])

  // ink on screen (its own layer: the eraser takes ink away, never the photo)
  useEffect(() => {
    const c = ink.current
    if (!c || !box.w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== Math.round(box.w * dpr) || c.height !== Math.round(box.h * dpr)) { c.width = box.w * dpr; c.height = box.h * dpr }
    if (strokes.some(FXPEN) && !fxScreen.current && view.current) fxScreen.current = makeFx(view.current, c.width, c.height)
    paint(c.getContext('2d'), c.width, c.height, strokes, dpr, fxScreen.current)
  }, [strokes, box])

  const reset = () => {
    setRot(0); setFlip(false); setDeg(0); setAspect(0); setBars(false); setCrop({ x: 0, y: 0, w: 1, h: 1 })
    setAdj(ZERO); setCurves(noCurves()); setHsl(noHsl()); setLook('none'); setStrength(100)
    setStrokes([]); setDrawTab('draw'); setSel(null); setPeek(false)
  }
  const open = (m) => { reset(); setMode(m); tick() }
  const cancel = () => { reset(); setMode('') }
  const revert = () => { const o = origFile.current.get(idx); if (o && o !== file) { onReplace(idx, o); tick() } }

  // ✓: the tool's changes become the photo
  const done = async () => {
    if (!img) { setMode(''); return }
    const texts = strokes.filter((s) => s.text !== undefined && s.text.trim())
    const same = (mode === 'crop' && !rot && !flip && !deg && !bars && crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1)
      || ((mode === 'adjust' || mode === 'looks') && isNeutral(params))
      || (mode === 'draw' && !strokes.some((s) => s.text === undefined) && !texts.length)
    if (same) { reset(); setMode(''); return }
    setBusy(true)
    await new Promise((r) => setTimeout(r, 40)) // let the spinner show before the long work
    let out = img
    try {
      if (mode === 'crop') {
        const t = turned(img, rot, flip, deg)
        out = canvasOf(t.width * crop.w, t.height * crop.h)
        out.getContext('2d').drawImage(t, t.width * crop.x, t.height * crop.y, out.width, out.height, 0, 0, out.width, out.height)
        if (bars && aspect >= 1.8) {
          // the wide frame on a 16:9 picture with black bars above and below
          const b = canvasOf(out.width, (out.width * 9) / 16), bg = b.getContext('2d')
          bg.fillStyle = '#000'; bg.fillRect(0, 0, b.width, b.height); bg.drawImage(out, 0, Math.round((b.height - out.height) / 2))
          out = b
        }
      } else if (mode === 'adjust' || mode === 'looks') {
        out = processed(img, params)
      } else if (mode === 'draw') {
        const k = img.width / box.w
        const layer = canvasOf(img.width, img.height)
        const list = strokes.filter((s) => s.text === undefined || s.text.trim()).map((s) => (s.text !== undefined ? { ...s, paintText: true } : s))
        paint(layer.getContext('2d'), img.width, img.height, list, k, list.some(FXPEN) ? makeFx(img, img.width, img.height) : null)
        out = canvasOf(img.width, img.height)
        const g = out.getContext('2d'); g.drawImage(img, 0, 0); g.drawImage(layer, 0, 0)
      }
      if (out !== img) { const nf = await toFile(out, file.name); onReplace(idx, nf); setImg(out) }
    } catch { /* a picture too big for this device's memory: leave it as it was */ }
    reset(); setMode(''); setBusy(false); tick()
  }

  // crop frame dragging, in fractions of the picture on screen
  const frameDown = (e) => { drag.current = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, c: { ...crop } }; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); e.preventDefault() }
  const frameMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.x) / box.w, dy = (e.clientY - d.y) / box.h, c = { ...d.c }, min = 0.12, h = d.h
    if (h === 'move') { c.x = Math.min(1 - c.w, Math.max(0, c.x + dx)); c.y = Math.min(1 - c.h, Math.max(0, c.y + dy)) }
    else {
      if (h.includes('l')) { const nx = Math.min(c.x + c.w - min, Math.max(0, c.x + dx)); c.w += c.x - nx; c.x = nx }
      if (h.includes('r')) c.w = Math.min(1 - c.x, Math.max(min, c.w + dx))
      if (h.includes('t')) { const ny = Math.min(c.y + c.h - min, Math.max(0, c.y + dy)); c.h += c.y - ny; c.y = ny }
      if (h.includes('b')) c.h = Math.min(1 - c.y, Math.max(min, c.h + dy))
      if (aspect) { c.h = Math.min((c.w * box.w) / aspect / box.h, 1 - c.y); c.w = (c.h * box.h * aspect) / box.w }
    }
    setCrop(c)
  }
  const frameUp = () => { drag.current = null; setDragging(false) }
  const pickAspect = (a) => {
    setAspect(a); tick()
    if (a < 1.8) setBars(false)
    if (!a) { setCrop({ x: 0, y: 0, w: 1, h: 1 }); return }
    let w = 1, h = box.w / a / box.h
    if (h > 1) { h = 1; w = (box.h * a) / box.w }
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h })
  }

  // drawing, in fractions of the picture on screen; sizes in screen pixels
  const at = (e) => { const r = ink.current.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] }
  const inkDown = (e) => {
    if (mode !== 'draw') return
    if (drawTab === 'text') {
      // the words are typed in place, on the photo (no window: Electron shows no prompt)
      const [x, y] = at(e), id = Date.now()
      setStrokes((s) => [...s, { text: 'Text', x, y, color, font, style: tstyle, sz: size, edit: true, id }]); setSel(id)
      return
    }
    setSel(null)
    const p = at(e)
    line.current = drawTab === 'shapes' ? { shape, color, size, a: p, b: p } : { pen, color, size, pts: [p] }
    setStrokes((s) => [...s, line.current]); e.currentTarget.setPointerCapture(e.pointerId)
  }
  const inkMove = (e) => {
    const l = line.current
    if (!l) return
    if (l.shape) l.b = at(e); else l.pts.push(at(e))
    setStrokes((s) => [...s])
  }
  const inkUp = () => { line.current = null }
  // a property of the text being worked on (and of the next one)
  const textProp = (k, v) => { if (drawTab === 'text' && sel) setStrokes((s) => s.map((t) => (t.id === sel ? { ...t, [k]: v } : t))) }
  const pickColor = (c) => { setColor(c); textProp('color', c); tick() }
  // a text: dragged to move it, tapped to write in it
  const textDown = (e, s) => {
    if (mode !== 'draw') return
    tdrag.current = { s, x: e.clientX, y: e.clientY, sx: s.x, sy: s.y, moved: false, el: e.currentTarget, id: e.pointerId }
    if (document.activeElement !== e.currentTarget) e.preventDefault()
  }
  const textMove = (e) => {
    const d = tdrag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
    if (!d.moved) { d.moved = true; try { d.el.setPointerCapture(d.id) } catch { /* none */ } }
    const r = ink.current.getBoundingClientRect()
    d.s.x = Math.min(1, Math.max(0, d.sx + (e.clientX - d.x) / r.width)); d.s.y = Math.min(1, Math.max(0, d.sy + (e.clientY - d.y) / r.height))
    setStrokes((s) => [...s])
  }
  const textUp = (s) => {
    const d = tdrag.current
    tdrag.current = null
    if (!d) return
    setSel(s.id); setDrawTab('text'); setFont(s.font || 'sans'); setTstyle(s.style || 'fill'); setColor(s.color); setSize(s.sz || 7)
    if (!d.moved) {
      d.el.focus()
      try { const r = document.createRange(); r.selectNodeContents(d.el); r.collapse(false); const g = document.getSelection(); g.removeAllRanges(); g.addRange(r) } catch { /* none */ }
    }
  }

  const go = (k) => { if (mode || k < 0 || k >= files.length) return; setIdx(k); tick() }
  // hold on the photo (or the eye) to see it as it was
  const holdOn = () => { if (!changed && mode !== 'adjust' && mode !== 'looks') return; setPeek(true); tick() }
  const stageDown = (e) => {
    if (!mode && files.length > 1) swipe.current = e.clientX
    if (!mode || mode === 'adjust' || mode === 'looks') { clearTimeout(hold.current); hold.current = setTimeout(holdOn, 260) }
  }
  const stageUp = (e) => {
    clearTimeout(hold.current)
    if (peek) { setPeek(false); swipe.current = null; return }
    if (swipe.current == null) return
    const dx = e.clientX - swipe.current; swipe.current = null; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1))
  }

  const send = () => { if (busy || !kept.length) return; onSend(kept, !hd) }
  const toggleKeep = () => setDropped((d) => { const n = new Set(d); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })

  const val = adj[dial], [, dialName, dMin, dMax] = ADJ.find(([k]) => k === dial)
  const C = 2 * Math.PI * 27
  const hb = hsl[band], bandColor = BANDS.find(([k]) => k === band)[3]
  const setHb = (k, v) => setHsl((o) => ({ ...o, [band]: { ...o[band], [k]: v } }))
  const eye = (
    <button type="button" className={`phx-g phx-ic phx-eye${peek ? ' on' : ''}`} aria-label="Hold to see the original"
      onPointerDown={(e) => { e.preventDefault(); setPeek(true); tick() }} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
      onContextMenu={(e) => e.preventDefault()}>{IC.eye}</button>
  )
  const textStyle = (s) => {
    const f = FONTS.find(([k]) => k === (s.font || 'sans')), st = s.style || 'fill', c = contrastOf(s.color)
    const css = { left: `${s.x * 100}%`, top: `${s.y * 100}%`, fontFamily: f[2], fontWeight: f[3], fontSize: `${12 + (s.sz || 7) * 2}px` }
    if (st === 'fill') return { ...css, background: s.color, color: c }
    if (st === 'outline') return { ...css, color: s.color, WebkitTextStroke: `${Math.max(1.5, (s.sz || 7) / 5)}px ${c}`, paintOrder: 'stroke fill', background: 'none', boxShadow: 'none' }
    return { ...css, color: s.color, background: 'none', boxShadow: 'none', textShadow: '0 2px 12px rgba(0,0,0,.55)' }
  }

  return createPortal(
    <div className={`phx${mode ? ` phx-m-${mode}` : ''}${peek ? ' phx-peeking' : ''}`}>
      {!mode && (
        <div className="phx-top">
          <button type="button" className="phx-g phx-ic" onClick={onBack} aria-label="Back">{IC.x}</button>
          {files.length > 1 ? <span className="phx-g phx-count">{idx + 1} of {files.length}</span> : <span />}
          <div className="phx-topr">
            {changed && <button type="button" className="phx-g phx-ic" onClick={revert} aria-label="Revert to the original">{IC.reset}</button>}
            {changed && eye}
            {files.length > 1 && <button type="button" className={`phx-g phx-ic phx-pick${dropped.has(idx) ? '' : ' on'}`} onClick={toggleKeep} aria-label={dropped.has(idx) ? 'Keep this photo' : 'Leave this photo out'}><b>{dropped.has(idx) ? '' : kept.indexOf(file) + 1}</b></button>}
          </div>
        </div>
      )}
      {(mode === 'adjust' || mode === 'looks') && <div className="phx-top"><span /><span />{eye}</div>}
      {mode === 'draw' && (
        <div className="phx-top">
          <button type="button" className="phx-g phx-ic" onClick={() => { setStrokes((s) => s.slice(0, -1)); setSel(null); tick() }} aria-label="Undo">{IC.undo}</button>
          <button type="button" className="phx-g phx-txt" onClick={() => { setStrokes([]); setSel(null); tick() }}>Clear All</button>
        </div>
      )}
      {peek && <span className="phx-g phx-orig">Original</span>}

      <div className="phx-stage" ref={stage} onPointerDown={stageDown} onPointerUp={stageUp} onPointerCancel={() => { clearTimeout(hold.current); setPeek(false); swipe.current = null }}
        onContextMenu={(e) => e.preventDefault()}>
        {photo ? (
          <div className="phx-pic" style={{ width: box.w || undefined, height: box.h || undefined }}>
            <canvas ref={view} />
            <canvas ref={ink} className="phx-ink" style={{ pointerEvents: mode === 'draw' ? 'auto' : 'none' }} onPointerDown={inkDown} onPointerMove={inkMove} onPointerUp={inkUp} onPointerCancel={inkUp} />
            {strokes.filter((s) => s.text !== undefined).map((s) => (
              <div key={s.id} className={`phx-text${sel === s.id && mode === 'draw' ? ' sel' : ''}`} contentEditable={mode === 'draw'} suppressContentEditableWarning spellCheck={false}
                style={textStyle(s)}
                ref={(el) => { if (el && s.edit) { s.edit = false; el.focus(); try { document.getSelection().selectAllChildren(el) } catch { /* none */ } } }}
                onPointerDown={(e) => textDown(e, s)} onPointerMove={textMove} onPointerUp={() => textUp(s)} onPointerCancel={() => { tdrag.current = null }}
                onInput={(e) => { s.text = e.currentTarget.innerText }}
                onBlur={(e) => { if (!e.currentTarget.innerText.trim()) { setStrokes((l) => l.filter((t) => t !== s)); setSel(null) } }}>{s.text}</div>
            ))}
            {mode === 'crop' && (
              <div className={`phx-crop${dragging ? ' dragging' : ''}${bars && aspect >= 1.8 ? ' bars' : ''}`} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={frameDown} onPointerMove={frameMove} onPointerUp={frameUp} onPointerCancel={frameUp}>
                {['tl', 'tr', 'bl', 'br'].map((h) => <i key={h} className={`phx-h ${h}`} data-h={h} />)}
                {['t', 'b', 'l', 'r'].map((h) => <i key={h} className={`phx-e ${h}`} data-h={h} />)}
                <i className="phx-grid" />
              </div>
            )}
          </div>
        ) : file && /^video\//.test(file.type) ? <video className="phx-video" src={vidUrl || undefined} controls playsInline />
          : file ? <img className="phx-video" src={vidUrl || undefined} alt="" /> : null}
        {mode === 'draw' && (
          <div className={`phx-size${sizing ? ' active' : ''}`}>
            <i className="phx-wedge" />
            <input type="range" min="2" max="28" value={size} onChange={(e) => { setSize(+e.target.value); textProp('sz', +e.target.value) }} onPointerDown={() => setSizing(true)} onPointerUp={() => setSizing(false)} aria-label="Size" />
            <b className="phx-dot" style={{ '--d': `${size * 2}px`, '--y': `${(1 - (size - 2) / 26) * 100}%`, '--c': color }} />
          </div>
        )}
        {busy && <div className="phx-busy"><i /></div>}
      </div>

      {!mode && (
        <div className="phx-foot">
          <label className="phx-cap"><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" /></label>
          <div className="phx-row">
            <div className="phx-g phx-tools">
              <button type="button" disabled={!photo || !img} onClick={() => open('crop')}>{IC.crop}<small>Crop</small></button>
              <button type="button" disabled={!photo || !img} onClick={() => open('draw')}>{IC.draw}<small>Draw</small></button>
              <button type="button" disabled={!photo || !img} onClick={() => open('adjust')}>{IC.adjust}<small>Adjust</small></button>
              <button type="button" disabled={!photo || !img} onClick={() => open('looks')}>{IC.looks}<small>Looks</small></button>
              <button type="button" className={hd ? 'on-hd' : ''} onClick={() => { setHd((v) => !v); tick() }} aria-pressed={hd}><span className="phx-hd">HD</span><small>{hd ? 'Full' : 'Quality'}</small></button>
            </div>
            <button type="button" className="phx-send" disabled={busy || !kept.length} onClick={send} aria-label={kept.length > 1 ? `Send ${kept.length}` : 'Send'}>{IC.send}{kept.length > 1 && <i className="phx-n">{kept.length}</i>}</button>
          </div>
        </div>
      )}

      {mode === 'crop' && (
        <div className="phx-foot">
          <Lensed className="phx-g phx-seg phx-seg-scroll" dep={aspect}>{ASPECTS.map(([l, a]) => <button key={l} type="button" className={aspect === a ? 'on' : ''} onClick={() => pickAspect(a)}>{l}</button>)}</Lensed>
          <Ruler from={-45} to={45} step={1} value={deg} onChange={setDeg} label={(v) => `${v}°`} />
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <div className="phx-g phx-mini">
              <button type="button" onClick={() => { setRot((r) => (r + 270) % 360); setCrop({ x: 0, y: 0, w: 1, h: 1 }); setAspect(0); setBars(false); tick() }} aria-label="Turn">{IC.turn}</button>
              <button type="button" onClick={() => { setFlip((f) => !f); tick() }} aria-label="Mirror">{IC.flip}</button>
              {aspect >= 1.8 && <button type="button" className={bars ? 'on' : ''} onClick={() => { setBars((b) => !b); tick() }} aria-pressed={bars} aria-label="Black bars">{IC.bars}</button>}
              <button type="button" onClick={() => { setRot(0); setFlip(false); setDeg(0); setAspect(0); setBars(false); setCrop({ x: 0, y: 0, w: 1, h: 1 }); tick() }} aria-label="Reset">{IC.reset}</button>
            </div>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}

      {mode === 'draw' && (
        <div className="phx-foot">
          {drawTab === 'draw' && (
            <div className="phx-pens">
              {PENS.map((p) => <button key={p} type="button" className={pen === p ? 'on' : ''} onClick={() => { setPen(p); tick() }} aria-label={p}><i className={`phx-pen ${p}`} style={{ '--c': color }} /></button>)}
            </div>
          )}
          {drawTab === 'shapes' && (
            <div className="phx-shapes">
              {SHAPES.map(([k, d]) => <button key={k} type="button" className={`phx-g${shape === k ? ' on' : ''}`} onClick={() => { setShape(k); tick() }} aria-label={k} style={{ '--c': color }}>{S(d, 24)}</button>)}
            </div>
          )}
          {drawTab === 'text' && (
            <div className="phx-topts">
              <Lensed className="phx-g phx-seg phx-fonts" dep={font}>
                {FONTS.map(([k, l, f, w]) => <button key={k} type="button" className={font === k ? 'on' : ''} style={{ fontFamily: f, fontWeight: w }} onClick={() => { setFont(k); textProp('font', k); tick() }}>{l}</button>)}
              </Lensed>
              <button type="button" className="phx-g phx-ic" aria-label={`Text style: ${tstyle}`}
                onClick={() => { const n = TSTYLES[(TSTYLES.indexOf(tstyle) + 1) % TSTYLES.length]; setTstyle(n); textProp('style', n); tick() }}>{IC.tstyle[tstyle]}</button>
            </div>
          )}
          <div className="phx-colors">
            {COLORS.map((c) => <button key={c} type="button" className={color === c ? 'on' : ''} style={{ '--c': c }} onClick={() => pickColor(c)} aria-label={c} />)}
            <button type="button" className={`phx-wheel${COLORS.includes(color) ? '' : ' on'}`} style={COLORS.includes(color) ? undefined : { '--c': color }} aria-label="Any colour">
              <input type="color" value={COLORS.includes(color) ? '#ff375f' : color} onChange={(e) => { setColor(e.target.value); textProp('color', e.target.value) }} />
            </button>
          </div>
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <Lensed className="phx-g phx-seg phx-seg-w" dep={drawTab}>
              {[['draw', 'Draw'], ['shapes', 'Shapes'], ['text', 'Text']].map(([k, l]) => <button key={k} type="button" className={drawTab === k ? 'on' : ''} onClick={() => { setDrawTab(k); if (k !== 'text') setSel(null); tick() }}>{l}</button>)}
            </Lensed>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}

      {mode === 'adjust' && (
        <div className="phx-foot">
          <Lensed className="phx-g phx-seg" dep={adjTab}>
            {[['light', 'Light & Colour'], ['curves', 'Curves'], ['hsl', 'HSL']].map(([k, l]) => <button key={k} type="button" className={adjTab === k ? 'on' : ''} onClick={() => { setAdjTab(k); tick() }}>{l}</button>)}
          </Lensed>
          {adjTab === 'light' && <>
            <div className="phx-adj-name"><b>{dialName}</b><span>{val > 0 ? `+${val}` : val}</span></div>
            <div className="phx-dials">
              {ADJ.map(([k, l, , b, ic]) => {
                const v = adj[k], part = Math.abs(v) / b
                return (
                  <button key={k} type="button" className={`phx-dial${dial === k ? ' on' : ''}${v < 0 ? ' neg' : ''}`} onClick={(e) => { setDial(k); tick(); e.currentTarget.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }) }} aria-label={l}>
                    <svg className="ring" viewBox="0 0 58 58"><circle className="bg" cx="29" cy="29" r="27" /><circle className="fg" cx="29" cy="29" r="27" strokeDasharray={C} strokeDashoffset={C * (1 - part)} /></svg>
                    {S(ic)}
                  </button>
                )
              })}
            </div>
            <Ruler key={dial} from={dMin} to={dMax} step={(dMax - dMin) / 50} value={val} onChange={(v) => setAdj((o) => ({ ...o, [dial]: v }))} label={(v) => v} />
          </>}
          {adjTab === 'curves' && <>
            <div className="phx-chs">
              {CH.map(([k, l, c]) => <button key={k} type="button" className={ch === k ? 'on' : ''} style={{ '--c': c }} onClick={() => { setCh(k); tick() }} aria-label={l}><i />{l}</button>)}
            </div>
            <Curve pts={curves[ch]} color={CH.find(([k]) => k === ch)[2]} onChange={(p) => setCurves((o) => ({ ...o, [ch]: p }))} />
          </>}
          {adjTab === 'hsl' && <>
            <div className="phx-bands">
              {BANDS.map(([k, l, , c]) => <button key={k} type="button" className={band === k ? 'on' : ''} style={{ '--c': c }} onClick={() => { setBand(k); tick() }} aria-label={l} />)}
            </div>
            {[['h', 'Hue'], ['s', 'Saturation'], ['l', 'Luminance']].map(([k, l]) => (
              <label key={k} className={`phx-sl phx-sl-${k}`} style={{ '--c': bandColor }}>
                <span>{l}</span>
                <input type="range" min="-100" max="100" value={hb[k]} onChange={(e) => setHb(k, +e.target.value)} onDoubleClick={() => setHb(k, 0)} />
                <b>{hb[k] > 0 ? `+${hb[k]}` : hb[k]}</b>
              </label>
            ))}
          </>}
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <div className="phx-g phx-mini">
              <button type="button" onClick={() => { setAdj({ ...ZERO, enhance: 50, contrast: 10, saturation: 8, shadows: 14, highlights: -10 }); tick() }} aria-label="Auto">{IC.auto}</button>
              <button type="button" onClick={() => { setAdj(ZERO); setCurves(noCurves()); setHsl(noHsl()); tick() }} aria-label="Reset">{IC.reset}</button>
            </div>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}

      {mode === 'looks' && (
        <div className="phx-foot">
          <div className="phx-looks">
            {LOOKS.map(([k, l]) => (
              <button key={k} type="button" className={look === k ? 'on' : ''} onClick={(e) => { setLook(k); setStrength(100); tick(); e.currentTarget.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }) }}>
                <span className="phx-look-pic">{thumbs[k] ? <img src={thumbs[k]} alt="" /> : null}</span>
                <small>{l}</small>
              </button>
            ))}
          </div>
          <div className={`phx-strength${look === 'none' ? ' off' : ''}`}>
            <div className="phx-adj-name"><b>Strength</b><span>{strength}</span></div>
            <Ruler from={0} to={100} step={2} value={strength} onChange={setStrength} label={(v) => v} />
          </div>
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

const SCRATCH = { c: null }
// strokes, shapes and words onto a canvas of w by h; k is how many canvas pixels make one screen pixel; fx the blurred and
// pixelated copies of the picture at the same size, for those two brushes
function paint(g, w, h, strokes, k, fx) {
  g.clearRect(0, 0, w, h)
  for (const s of strokes) {
    if (s.text !== undefined) { if (s.paintText) paintText(g, w, h, s, k); continue }
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'
    if (s.shape) {
      const ax = s.a[0] * w, ay = s.a[1] * h, bx = s.b[0] * w, by = s.b[1] * h
      g.lineWidth = s.size * k; g.strokeStyle = s.color
      g.beginPath()
      if (s.shape === 'rect') { const x = Math.min(ax, bx), y = Math.min(ay, by); if (g.roundRect) g.roundRect(x, y, Math.abs(bx - ax), Math.abs(by - ay), 6 * k); else g.rect(x, y, Math.abs(bx - ax), Math.abs(by - ay)) }
      else if (s.shape === 'circle') g.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2)
      else { g.moveTo(ax, ay); g.lineTo(bx, by) }
      g.stroke()
      if (s.shape === 'arrow' && Math.hypot(bx - ax, by - ay) > 4) head(g, ax, ay, bx, by, (18 + s.size * 2.6) * k)
      g.restore(); continue
    }
    if (!s.pts || s.pts.length < 2) { g.restore(); continue }
    if (FXPEN(s)) {
      if (fx) {
        if (!SCRATCH.c || SCRATCH.c.width !== w || SCRATCH.c.height !== h) SCRATCH.c = canvasOf(w, h)
        const m = SCRATCH.c.getContext('2d')
        m.globalCompositeOperation = 'source-over'; m.clearRect(0, 0, w, h)
        m.lineCap = 'round'; m.lineJoin = 'round'; m.lineWidth = s.size * k * 3.2; m.strokeStyle = '#000'
        m.beginPath(); s.pts.forEach(([x, y], i) => (i ? m.lineTo(x * w, y * h) : m.moveTo(x * w, y * h))); m.stroke()
        m.globalCompositeOperation = 'source-in'; m.drawImage(fx[s.pen], 0, 0, w, h); m.globalCompositeOperation = 'source-over'
        g.drawImage(SCRATCH.c, 0, 0)
      }
      g.restore(); continue
    }
    g.lineWidth = s.size * k * (s.pen === 'marker' ? 2.4 : 1)
    g.globalCompositeOperation = s.pen === 'eraser' ? 'destination-out' : 'source-over'
    g.strokeStyle = s.pen === 'eraser' ? '#000' : s.color; g.globalAlpha = s.pen === 'marker' ? 0.45 : 1
    if (s.pen === 'neon') { g.shadowColor = s.color; g.shadowBlur = 26 * k; g.strokeStyle = '#fff' }
    g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke()
    if (s.pen === 'arrow') {
      const [x1, y1] = s.pts[Math.max(0, s.pts.length - 6)], [x2, y2] = s.pts[s.pts.length - 1]
      head(g, x1 * w, y1 * h, x2 * w, y2 * h, (20 + s.size * 3) * k)
    }
    g.restore()
  }
}
function head(g, x1, y1, x2, y2, L) {
  const a = Math.atan2(y2 - y1, x2 - x1)
  g.beginPath(); g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5))
  g.moveTo(x2, y2); g.lineTo(x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5)); g.stroke()
}
// a text as it stands on screen: its face, its style (filled box, outlined, plain), its size, its lines
function paintText(g, w, h, s, k) {
  const f = FONTS.find(([x]) => x === (s.font || 'sans')), st = s.style || 'fill', fs = (12 + (s.sz || 7) * 2) * k
  const lines = s.text.replace(/\n+$/, '').split('\n')
  g.save(); g.font = `${f[3]} ${fs}px ${f[2]}`; g.textBaseline = 'middle'
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)), lh = fs * 1.2, px = 12 * k, py = 4 * k
  const bw = tw + px * 2, bh = lh * lines.length + py * 2, x = s.x * w - bw / 2, y = s.y * h - bh / 2
  const ink = contrastOf(s.color)
  if (st === 'fill') { g.fillStyle = s.color; g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, 12 * k); else g.rect(x, y, bw, bh); g.fill() }
  lines.forEach((l, i) => {
    const ty = y + py + lh * (i + 0.5), tx = x + px + (tw - g.measureText(l).width) / 2
    if (st === 'outline') { g.lineJoin = 'round'; g.lineWidth = Math.max(1.5, (s.sz || 7) / 5) * 2 * k; g.strokeStyle = ink; g.strokeText(l, tx, ty) }
    if (st === 'plain') { g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 12 * k; g.shadowOffsetY = 2 * k }
    g.fillStyle = st === 'fill' ? ink : s.color; g.fillText(l, tx, ty)
  })
  g.restore()
}
