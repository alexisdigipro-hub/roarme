import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/* The photo before it is sent, full screen (Alex, 21 Nov, from Telegram's editor, sample
   https://claude.ai/artifact/HzvtsMf5inTA3G2i3tYQzE version 2: "βάλ' το"). Top: close, "1 of 3", the ring that keeps or
   drops this photo. Foot: the caption, a glass capsule of Crop · Draw · Adjust · Quality (HD) and Send.
   Crop: a frame with corner and edge handles, Free / 1:1 / 4:5 / 16:9 / 9:16, a ruler to straighten (−45° to 45°), turn,
   mirror, reset. Draw: Pen, Arrow, Marker, Neon, Eraser, eight colours and any colour, a size wedge, Undo, Clear All, and
   Text written on the photo. Adjust: Enhance, Brightness, Contrast, Saturation, Warmth, Vignette as round dials with a
   ring for their value, and a ruler. ✕ throws a tool's changes away, ✓ bakes them into the photo (a new JPEG, on the
   device). HD sends the photo whole instead of lighter. Videos and GIFs show as they are, with only Quality. */
const ADJ = [
  ['enhance', 'Enhance', 0, 100, <path key="e" d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />],
  ['brightness', 'Brightness', -100, 100, <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" /></>],
  ['contrast', 'Contrast', -100, 100, <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" /></>],
  ['saturation', 'Saturation', -100, 100, <path key="s" d="M12 3.5c3 3.6 6 7 6 10.2A6 6 0 0 1 6 13.7C6 10.5 9 7.1 12 3.5z" />],
  ['warmth', 'Warmth', -100, 100, <><path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" /><path d="M12 11v5" /></>],
  ['vignette', 'Vignette', 0, 100, <><rect x="3.5" y="5" width="17" height="14" rx="3" /><circle cx="12" cy="12" r="4" /></>],
]
const ZERO = Object.fromEntries(ADJ.map(([k]) => [k, 0]))
const COLORS = ['#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#32d74b', '#64d2ff', '#0a84ff', '#bf5af2']
const PENS = ['pen', 'arrow', 'marker', 'neon', 'eraser']
const ASPECTS = [['Free', 0], ['1:1', 1], ['4:5', 0.8], ['16:9', 16 / 9], ['9:16', 9 / 16]]
const MAX = 4096 // the longest side kept while editing (HD sends what comes out)

const S = (d, w = 22) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const IC = {
  x: S(<path d="M6 6l12 12M18 6L6 18" />),
  ok: S(<path d="M5 12.5l4.5 4.5L19 7" />, 26),
  send: S(<path d="M5 12h12M12 6l6 6-6 6" />, 26),
  crop: S(<path d="M6 2.5v13.5a2 2 0 0 0 2 2h13.5M2.5 6H16a2 2 0 0 1 2 2v13.5" />, 21),
  draw: S(<><path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 0 1 3 0l.4.4a2.1 2.1 0 0 1 0 3L8.6 18.8z" /><path d="M13.5 7l3.5 3.5" /></>, 21),
  adjust: S(<><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M12 7.5a4.5 4.5 0 0 1 0 9" fill="currentColor" /></>, 21),
  turn: S(<><rect x="3.5" y="10" width="10" height="10" rx="2" /><path d="M10 4.5h4a5 5 0 0 1 5 5v1.5M16.5 9l2.5 2.5L21.5 9" /></>),
  flip: S(<><path d="M12 3v18" strokeDasharray="2 2.5" /><path d="M9 6.5L3.5 17.5H9zM15 6.5l5.5 11H15z" /></>),
  reset: S(<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5" />),
  undo: S(<><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>),
  auto: S(<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />),
}
const isPhoto = (f) => /^image\//.test(f?.type || '') && !/gif/.test(f.type)
const tick = () => { try { navigator.vibrate?.(4) } catch { /* none */ } }

// the CSS filter for the adjust sliders, the same on screen and when baked
const filterOf = (a) => {
  const e = a.enhance / 100
  return `brightness(${1 + a.brightness / 200 + e * 0.06}) contrast(${1 + a.contrast / 200 + e * 0.12}) saturate(${1 + a.saturation / 100 + e * 0.18}) sepia(${Math.max(0, a.warmth) / 250}) hue-rotate(${Math.min(0, a.warmth) / 6}deg)`
}
const vignette = (g, w, h, v) => {
  if (!v) return
  const r = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.53)
  r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, `rgba(0,0,0,${v / 105})`)
  g.fillStyle = r; g.fillRect(0, 0, w, h)
}
// the image turned (90° steps), mirrored and straightened, scaled so the straightened picture still fills its frame
const turned = (img, rot, flip, deg) => {
  const sw = img.width, sh = img.height, side = rot % 180 !== 0
  const w = side ? sh : sw, h = side ? sw : sh
  const c = document.createElement('canvas'); c.width = w; c.height = h
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
    const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k)
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c)
  }
  im.onerror = () => { URL.revokeObjectURL(u); no(new Error('image')) }
  im.src = u
})

// a ruler dragged sideways: degrees for straighten, values for adjust
function Ruler({ from, to, step, value, onChange, label }) {
  const px = 9.5 / step
  const d = useRef(null)
  const ticks = []
  for (let v = from; v <= to; v += step) ticks.push(<i key={v} className={v % (step * 5) === 0 ? 'big' : ''} data-n={label(v)} />)
  return (
    <div className="phx-ruler" onPointerDown={(e) => { d.current = { x: e.clientX, v: value }; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={(e) => {
        if (!d.current) return
        const v = Math.max(from, Math.min(to, Math.round(d.current.v - (e.clientX - d.current.x) / px)))
        if (v !== value) { onChange(v); if (v % (step * 5) === 0) tick() }
      }}
      onPointerUp={() => { d.current = null }} onPointerCancel={() => { d.current = null }}>
      <div className="phx-ticks" style={{ transform: `translateX(calc(-50% + ${-(value - (from + to) / 2) * px}px))` }}>{ticks}</div>
      <i className="phx-needle" />
    </div>
  )
}

// a bar whose chosen button wears a sliding lens
function Lensed({ className, children, dep }) {
  const ref = useRef(null)
  const [st, setSt] = useState({ w: 0, x: 0, go: false })
  useLayoutEffect(() => {
    const bar = ref.current, on = bar?.querySelector('button.on')
    if (!bar || !on) { setSt((s) => ({ ...s, w: 0 })); return undefined }
    const br = bar.getBoundingClientRect(), r = on.getBoundingClientRect()
    setSt({ w: r.width, x: r.left - br.left, go: true })
    const t = setTimeout(() => setSt((s) => ({ ...s, go: false })), 260)
    return () => clearTimeout(t)
  }, [dep])
  return <div ref={ref} className={className}><i className={`phx-lens${st.go ? ' go' : ''}`} style={{ width: st.w, transform: `translateX(${st.x}px)` }} />{children}</div>
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
  // crop
  const [rot, setRot] = useState(0)
  const [flip, setFlip] = useState(false)
  const [deg, setDeg] = useState(0)
  const [aspect, setAspect] = useState(0)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 1, h: 1 })
  const [dragging, setDragging] = useState(false)
  // adjust
  const [adj, setAdj] = useState(ZERO)
  const [dial, setDial] = useState('enhance')
  // draw
  const [strokes, setStrokes] = useState([])
  const [pen, setPen] = useState('pen')
  const [color, setColor] = useState('#ffffff')
  const [size, setSize] = useState(7)
  const [sizing, setSizing] = useState(false)
  const [drawTab, setDrawTab] = useState('draw')
  const stage = useRef(null)
  const view = useRef(null)
  const ink = useRef(null)
  const line = useRef(null)
  const drag = useRef(null)
  const file = files[idx]
  const photo = isPhoto(file)
  const kept = files.filter((_, k) => !dropped.has(k))

  // the working picture for the photo shown
  useEffect(() => {
    let alive = true
    setImg(null)
    if (photo) loadImg(file).then((c) => { if (alive) setImg(c) }).catch(() => {})
    return () => { alive = false }
  }, [file, photo])
  const [vidUrl, setVidUrl] = useState('')
  useEffect(() => {
    if (photo || !file) { setVidUrl(''); return undefined }
    const u = URL.createObjectURL(file); setVidUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, photo])

  // what is drawn on screen: the photo (the whole turned picture while cropping) fitted into the stage
  const shown = () => (mode === 'crop' && img ? turned(img, rot, flip, deg) : img)
  useLayoutEffect(() => {
    const el = stage.current, pic = shown()
    if (!el || !pic) return
    const cs = getComputedStyle(el), pad = mode === 'crop' ? 36 : 0
    const aw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - pad
    const ah = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - pad
    const k = Math.min(aw / pic.width, ah / pic.height)
    const w = Math.max(40, Math.round(pic.width * k)), h = Math.max(40, Math.round(pic.height * k))
    const c = view.current, dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = w * dpr; c.height = h * dpr; c.style.width = `${w}px`; c.style.height = `${h}px`
    const g = c.getContext('2d'); g.drawImage(pic, 0, 0, c.width, c.height)
    setBox({ w, h })
  }, [img, mode, rot, flip, deg, fit])
  useEffect(() => { const f = () => setFit((n) => n + 1); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])

  // ink on screen
  useEffect(() => {
    const c = ink.current
    if (!c || !box.w) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = box.w * dpr; c.height = box.h * dpr
    paint(c.getContext('2d'), c.width, c.height, strokes, dpr)
  }, [strokes, box])

  const reset = () => { setRot(0); setFlip(false); setDeg(0); setAspect(0); setCrop({ x: 0, y: 0, w: 1, h: 1 }); setAdj(ZERO); setStrokes([]); setDrawTab('draw') }
  const open = (m) => { reset(); setMode(m); tick() }
  const cancel = () => { reset(); setMode('') }

  // ✓: the tool's changes become the photo
  const done = async () => {
    if (!img) { setMode(''); return }
    const same = (mode === 'crop' && !rot && !flip && !deg && crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1)
      || (mode === 'adjust' && ADJ.every(([k]) => !adj[k])) || (mode === 'draw' && !strokes.length)
    if (same) { reset(); setMode(''); return }
    setBusy(true)
    let out = img
    if (mode === 'crop') {
      const t = turned(img, rot, flip, deg)
      out = document.createElement('canvas')
      out.width = Math.max(1, Math.round(t.width * crop.w)); out.height = Math.max(1, Math.round(t.height * crop.h))
      out.getContext('2d').drawImage(t, t.width * crop.x, t.height * crop.y, out.width, out.height, 0, 0, out.width, out.height)
    } else if (mode === 'adjust') {
      out = document.createElement('canvas'); out.width = img.width; out.height = img.height
      const g = out.getContext('2d'); g.filter = filterOf(adj); g.drawImage(img, 0, 0); g.filter = 'none'; vignette(g, out.width, out.height, adj.vignette)
    } else if (mode === 'draw') {
      out = document.createElement('canvas'); out.width = img.width; out.height = img.height
      const g = out.getContext('2d'); g.drawImage(img, 0, 0)
      paint(g, out.width, out.height, strokes.map((s) => (s.text !== undefined ? { ...s, paintText: true } : s)), out.width / box.w)
    }
    if (out !== img) { const nf = await toFile(out, file.name); onReplace(idx, nf); setImg(out) }
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
      const [x, y] = at(e)
      setStrokes((s) => [...s, { text: 'Text', x, y, color, edit: true, id: Date.now() }])
      return
    }
    line.current = { pen, color, size, pts: [at(e)] }
    setStrokes((s) => [...s, line.current]); e.currentTarget.setPointerCapture(e.pointerId)
  }
  const inkMove = (e) => { if (!line.current) return; line.current.pts.push(at(e)); setStrokes((s) => [...s]) }
  const inkUp = () => { line.current = null }

  const send = () => { if (busy || !kept.length) return; onSend(kept, !hd) }
  const toggleKeep = () => setDropped((d) => { const n = new Set(d); if (n.has(idx)) n.delete(idx); else n.add(idx); return n })
  const go = (k) => { if (mode || k < 0 || k >= files.length) return; setIdx(k); tick() }
  const swipe = useRef(null)

  const val = adj[dial], [, dialName, dMin, dMax] = ADJ.find(([k]) => k === dial)
  const C = 2 * Math.PI * 27
  const textBg = (c) => (/^#(f|e|d)/i.test(c) ? '#111' : '#fff')

  return createPortal(
    <div className={`phx${mode ? ` phx-m-${mode}` : ''}`}>
      {!mode && (
        <div className="phx-top">
          <button type="button" className="phx-g phx-ic" onClick={onBack} aria-label="Back">{IC.x}</button>
          {files.length > 1 ? <span className="phx-g phx-count">{idx + 1} of {files.length}</span> : <span />}
          {files.length > 1
            ? <button type="button" className={`phx-g phx-ic phx-pick${dropped.has(idx) ? '' : ' on'}`} onClick={toggleKeep} aria-label={dropped.has(idx) ? 'Keep this photo' : 'Leave this photo out'}><b>{dropped.has(idx) ? '' : kept.indexOf(file) + 1}</b></button>
            : <span />}
        </div>
      )}
      {mode === 'draw' && (
        <div className="phx-top">
          <button type="button" className="phx-g phx-ic" onClick={() => { setStrokes((s) => s.slice(0, -1)); tick() }} aria-label="Undo">{IC.undo}</button>
          <button type="button" className="phx-g phx-txt" onClick={() => { setStrokes([]); tick() }}>Clear All</button>
        </div>
      )}

      <div className="phx-stage" ref={stage}
        onPointerDown={(e) => { if (!mode && files.length > 1) swipe.current = e.clientX }}
        onPointerUp={(e) => { if (swipe.current == null) return; const dx = e.clientX - swipe.current; swipe.current = null; if (Math.abs(dx) > 50) go(idx + (dx < 0 ? 1 : -1)) }}>
        {photo ? (
          <div className="phx-pic" style={{ width: box.w || undefined, height: box.h || undefined }}>
            <canvas ref={view} style={mode === 'adjust' ? { filter: filterOf(adj) } : undefined} />
            {mode === 'adjust' && adj.vignette > 0 && <i className="phx-vig" style={{ opacity: adj.vignette / 105 }} />}
            <canvas ref={ink} className="phx-ink" style={{ pointerEvents: mode === 'draw' ? 'auto' : 'none' }} onPointerDown={inkDown} onPointerMove={inkMove} onPointerUp={inkUp} onPointerCancel={inkUp} />
            {strokes.filter((s) => s.text !== undefined).map((s) => (
              <div key={s.id} className="phx-text" contentEditable={mode === 'draw'} suppressContentEditableWarning spellCheck={false}
                style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, background: s.color, color: textBg(s.color) }}
                ref={(el) => { if (el && s.edit) { s.edit = false; el.focus(); try { document.getSelection().selectAllChildren(el) } catch { /* none */ } } }}
                onInput={(e) => { s.text = e.currentTarget.textContent }}>{s.text}</div>
            ))}
            {mode === 'crop' && (
              <div className={`phx-crop${dragging ? ' dragging' : ''}`} style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
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
            <input type="range" min="2" max="28" value={size} onChange={(e) => setSize(+e.target.value)} onPointerDown={() => setSizing(true)} onPointerUp={() => setSizing(false)} aria-label="Size" />
            <b className="phx-dot" style={{ '--d': `${size * 2}px`, '--y': `${(1 - (size - 2) / 26) * 100}%`, '--c': color }} />
          </div>
        )}
      </div>

      {!mode && (
        <div className="phx-foot">
          <label className="phx-cap"><input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" /></label>
          <div className="phx-row">
            <div className="phx-g phx-tools">
              <button type="button" disabled={!photo || !img} onClick={() => open('crop')}>{IC.crop}<small>Crop</small></button>
              <button type="button" disabled={!photo || !img} onClick={() => open('draw')}>{IC.draw}<small>Draw</small></button>
              <button type="button" disabled={!photo || !img} onClick={() => open('adjust')}>{IC.adjust}<small>Adjust</small></button>
              <button type="button" className={hd ? 'on-hd' : ''} onClick={() => { setHd((v) => !v); tick() }} aria-pressed={hd}><span className="phx-hd">HD</span><small>{hd ? 'Full Quality' : 'Quality'}</small></button>
            </div>
            <button type="button" className="phx-send" disabled={busy || !kept.length} onClick={send} aria-label={kept.length > 1 ? `Send ${kept.length}` : 'Send'}>{IC.send}{kept.length > 1 && <i className="phx-n">{kept.length}</i>}</button>
          </div>
        </div>
      )}

      {mode === 'crop' && (
        <div className="phx-foot">
          <Lensed className="phx-g phx-seg" dep={aspect}>{ASPECTS.map(([l, a]) => <button key={l} type="button" className={aspect === a ? 'on' : ''} onClick={() => pickAspect(a)}>{l}</button>)}</Lensed>
          <Ruler from={-45} to={45} step={1} value={deg} onChange={setDeg} label={(v) => `${v}°`} />
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <div className="phx-g phx-mini">
              <button type="button" onClick={() => { setRot((r) => (r + 270) % 360); setCrop({ x: 0, y: 0, w: 1, h: 1 }); setAspect(0); tick() }} aria-label="Turn">{IC.turn}</button>
              <button type="button" onClick={() => { setFlip((f) => !f); tick() }} aria-label="Mirror">{IC.flip}</button>
              <button type="button" onClick={() => { setRot(0); setFlip(false); setDeg(0); setAspect(0); setCrop({ x: 0, y: 0, w: 1, h: 1 }); tick() }} aria-label="Reset">{IC.reset}</button>
            </div>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}

      {mode === 'draw' && (
        <div className="phx-foot">
          <div className="phx-pens">
            {PENS.map((p) => <button key={p} type="button" className={pen === p ? 'on' : ''} onClick={() => { setPen(p); tick() }} aria-label={p}><i className={`phx-pen ${p}`} style={{ '--c': color }} /></button>)}
          </div>
          <div className="phx-colors">
            {COLORS.map((c) => <button key={c} type="button" className={color === c ? 'on' : ''} style={{ '--c': c }} onClick={() => { setColor(c); tick() }} aria-label={c} />)}
            <button type="button" className={`phx-wheel${COLORS.includes(color) ? '' : ' on'}`} style={COLORS.includes(color) ? undefined : { '--c': color }} aria-label="Any colour">
              <input type="color" value={COLORS.includes(color) ? '#ff375f' : color} onChange={(e) => setColor(e.target.value)} />
            </button>
          </div>
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <Lensed className="phx-g phx-seg phx-seg-w" dep={drawTab}>
              <button type="button" className={drawTab === 'draw' ? 'on' : ''} onClick={() => { setDrawTab('draw'); tick() }}>Draw</button>
              <button type="button" className={drawTab === 'text' ? 'on' : ''} onClick={() => { setDrawTab('text'); tick() }}>Text</button>
            </Lensed>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}

      {mode === 'adjust' && (
        <div className="phx-foot">
          <div className="phx-adj-name"><b>{dialName}</b><span>{val > 0 ? `+${val}` : val}</span></div>
          <div className="phx-dials">
            {ADJ.map(([k, l, a, b, ic]) => {
              const v = adj[k], part = Math.abs(v) / (a < 0 ? b : b)
              return (
                <button key={k} type="button" className={`phx-dial${dial === k ? ' on' : ''}${v < 0 ? ' neg' : ''}`} onClick={(e) => { setDial(k); tick(); e.currentTarget.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' }) }} aria-label={l}>
                  <svg className="ring" viewBox="0 0 58 58"><circle className="bg" cx="29" cy="29" r="27" /><circle className="fg" cx="29" cy="29" r="27" strokeDasharray={C} strokeDashoffset={C * (1 - part)} /></svg>
                  {S(ic)}
                </button>
              )
            })}
          </div>
          <Ruler from={-100} to={100} step={4} value={val} onChange={(v) => setAdj((o) => ({ ...o, [dial]: Math.max(dMin, Math.min(dMax, v)) }))} label={(v) => v} />
          <div className="phx-row">
            <button type="button" className="phx-g phx-ic" onClick={cancel} aria-label="Cancel">{IC.x}</button>
            <div className="phx-g phx-mini">
              <button type="button" onClick={() => { setAdj({ ...ZERO, enhance: 60, contrast: 12, saturation: 10 }); tick() }} aria-label="Auto">{IC.auto}</button>
              <button type="button" onClick={() => { setAdj(ZERO); tick() }} aria-label="Reset">{IC.reset}</button>
            </div>
            <button type="button" className="phx-done" disabled={busy} onClick={done} aria-label="Done">{IC.ok}</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

// strokes and words onto a canvas of w by h; k is how many canvas pixels make one screen pixel
function paint(g, w, h, strokes, k) {
  g.clearRect(0, 0, w, h)
  for (const s of strokes) {
    if (s.text !== undefined) {
      if (!s.paintText) continue
      const fs = 26 * k
      g.save(); g.font = `800 ${fs}px -apple-system, system-ui, sans-serif`
      const tw = g.measureText(s.text).width, px = 12 * k, py = 4 * k, bw = tw + px * 2, bh = fs * 1.25 + py * 2
      const x = s.x * w - bw / 2, y = s.y * h - bh / 2
      g.fillStyle = s.color; g.beginPath(); g.roundRect ? g.roundRect(x, y, bw, bh, 12 * k) : g.rect(x, y, bw, bh); g.fill()
      g.fillStyle = /^#(f|e|d)/i.test(s.color) ? '#111' : '#fff'; g.textBaseline = 'middle'; g.fillText(s.text, x + px, y + bh / 2)
      g.restore(); continue
    }
    if (!s.pts || s.pts.length < 2) continue
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = s.size * k * (s.pen === 'marker' ? 2.4 : 1)
    g.globalCompositeOperation = s.pen === 'eraser' ? 'destination-out' : 'source-over'
    g.strokeStyle = s.pen === 'eraser' ? '#000' : s.color; g.globalAlpha = s.pen === 'marker' ? 0.45 : 1
    if (s.pen === 'neon') { g.shadowColor = s.color; g.shadowBlur = 26 * k; g.strokeStyle = '#fff' }
    g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h))); g.stroke()
    if (s.pen === 'arrow') {
      const [x1, y1] = s.pts[Math.max(0, s.pts.length - 6)], [x2, y2] = s.pts[s.pts.length - 1]
      const a = Math.atan2((y2 - y1) * h, (x2 - x1) * w), L = (20 + s.size * 3) * k
      g.beginPath(); g.moveTo(x2 * w, y2 * h); g.lineTo(x2 * w - L * Math.cos(a - 0.5), y2 * h - L * Math.sin(a - 0.5))
      g.moveTo(x2 * w, y2 * h); g.lineTo(x2 * w - L * Math.cos(a + 0.5), y2 * h - L * Math.sin(a + 0.5)); g.stroke()
    }
    g.restore()
  }
}
