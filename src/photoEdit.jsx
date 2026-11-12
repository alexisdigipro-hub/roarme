import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { I, Slide } from './ui.jsx'

/* A photo is touched up before it is sent (Alex, 12 Nov, after Telegram's): turn it, crop it to a shape, draw on it, set
   its light, contrast and colour. All of it happens on this device: the picture is drawn on a canvas and what is sent is
   the canvas, as a JPEG. What is drawn is kept as lines until the picture is turned or cropped, when it is laid into it. */
const MAX = 2560
const SHAPES = [['', 'Original'], ['1:1', 'Square'], ['4:5', '4:5'], ['16:9', '16:9']]
const INKS = ['#ffffff', '#111111', '#f47318', '#ff3b30', '#34c759', '#2f7cf6']
const ico = (d) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const TURN = ico(<><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4.5h-4.5" /></>)
const CROP = ico(<><path d="M7 3v14h14" /><path d="M3 7h14v14" /></>)
const PEN = ico(<><path d="M4 20l4-1L19 8l-3-3L5 16z" /><path d="M14 7l3 3" /></>)
const TUNE = ico(<><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>)
const UNDO = ico(<><path d="M9 7 4 12l5 5" /><path d="M4 12h10a6 6 0 0 1 0 12" transform="translate(0 -6)" /></>)

export function PhotoEdit({ file, onDone, onClose }) {
  const view = useRef(null)
  const base = useRef(null) // the picture itself, at full size
  const lines = useRef([]) // what is drawn and not yet laid in: { ink, pts: [[x, y], …] } in 0..1
  const [tool, setTool] = useState('')
  const [ink, setInk] = useState(INKS[2])
  const [adj, setAdj] = useState({ b: 100, c: 100, s: 100 })
  const [n, setN] = useState(0) // redraw
  const [busy, setBusy] = useState(false)
  const paint = () => {
    const cv = view.current
    const b = base.current
    if (!cv || !b) return
    const k = Math.min(1, 1400 / Math.max(b.width, b.height))
    cv.width = Math.round(b.width * k); cv.height = Math.round(b.height * k)
    const g = cv.getContext('2d')
    g.drawImage(b, 0, 0, cv.width, cv.height)
    stroke(g, cv.width, cv.height)
  }
  const stroke = (g, w, h) => {
    g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = Math.max(2, Math.max(w, h) * 0.011)
    lines.current.forEach((l) => {
      g.strokeStyle = l.ink
      g.beginPath()
      l.pts.forEach(([x, y], i) => (i ? g.lineTo(x * w, y * h) : g.moveTo(x * w, y * h)))
      if (l.pts.length === 1) g.lineTo(l.pts[0][0] * w + 0.1, l.pts[0][1] * h)
      g.stroke()
    })
  }
  useEffect(() => {
    let alive = true
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight))
      const c = document.createElement('canvas')
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      base.current = c
      URL.revokeObjectURL(url)
      setN((x) => x + 1)
    }
    img.src = url
    return () => { alive = false }
  }, [file])
  useEffect(paint, [n])
  // what is drawn is laid into the picture before it is turned or cropped
  const flatten = () => { const b = base.current; if (b && lines.current.length) { stroke(b.getContext('2d'), b.width, b.height); lines.current = [] } }
  const turn = () => {
    const b = base.current
    if (!b) return
    flatten()
    const c = document.createElement('canvas')
    c.width = b.height; c.height = b.width
    const g = c.getContext('2d')
    g.translate(c.width, 0); g.rotate(Math.PI / 2); g.drawImage(b, 0, 0)
    base.current = c
    setN((x) => x + 1)
  }
  const crop = (shape) => {
    const b = base.current
    if (!b || !shape) return
    flatten()
    const [a, d] = shape.split(':').map(Number)
    let r = a / d
    if (b.height > b.width && r > 1) r = 1 / r // an upright picture gets the upright form of a wide shape
    let w = b.width, h = Math.round(b.width / r)
    if (h > b.height) { h = b.height; w = Math.round(b.height * r) }
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    c.getContext('2d').drawImage(b, Math.round((b.width - w) / 2), Math.round((b.height - h) / 2), w, h, 0, 0, w, h)
    base.current = c
    setN((x) => x + 1)
  }
  const at = (e) => { const r = view.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] }
  const down = (e) => { if (tool !== 'draw') return; e.currentTarget.setPointerCapture?.(e.pointerId); lines.current.push({ ink, pts: [at(e)] }); paint() }
  const move = (e) => { if (tool !== 'draw' || !(e.buttons || e.pointerType === 'touch')) return; const l = lines.current[lines.current.length - 1]; if (!l) return; l.pts.push(at(e)); paint() }
  const undo = () => { lines.current.pop(); paint() }
  const done = async () => {
    const b = base.current
    if (!b || busy) return
    setBusy(true)
    flatten()
    const g = b.getContext('2d')
    if (adj.b !== 100 || adj.c !== 100 || adj.s !== 100) {
      const d = g.getImageData(0, 0, b.width, b.height)
      const p = d.data
      const br = adj.b / 100, co = adj.c / 100, sa = adj.s / 100
      for (let i = 0; i < p.length; i += 4) {
        let r = p[i] * br, gg = p[i + 1] * br, bl = p[i + 2] * br
        r = (r - 128) * co + 128; gg = (gg - 128) * co + 128; bl = (bl - 128) * co + 128
        const y = 0.2126 * r + 0.7152 * gg + 0.0722 * bl
        p[i] = y + (r - y) * sa; p[i + 1] = y + (gg - y) * sa; p[i + 2] = y + (bl - y) * sa
      }
      g.putImageData(d, 0, 0)
    }
    b.toBlob((blob) => {
      setBusy(false)
      if (!blob) return
      onDone(new File([blob], `${(file.name || 'photo').replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.92)
  }
  return createPortal(
    <div className="pe">
      <div className="pe-top">
        <button type="button" className="round" onClick={onClose} aria-label="Cancel">{I.x}</button>
        <b>Edit Photo</b>
        <button type="button" className="round send ready" onClick={done} disabled={busy} aria-label="Done">{I.check}</button>
      </div>
      <div className="pe-stage">
        <canvas ref={view} className={tool === 'draw' ? 'drawing' : ''} style={{ filter: `brightness(${adj.b}%) contrast(${adj.c}%) saturate(${adj.s}%)` }}
          onPointerDown={down} onPointerMove={move} />
      </div>
      {tool === 'crop' && <div className="pe-opts">{SHAPES.slice(1).map(([k, l]) => <button key={k} type="button" className="pill-btn" onClick={() => crop(k)}>{l}</button>)}</div>}
      {tool === 'draw' && (
        <div className="pe-opts">
          {INKS.map((c) => <button key={c} type="button" className={`pe-ink${ink === c ? ' on' : ''}`} style={{ '--c': c }} onClick={() => setInk(c)} aria-label="Colour" />)}
          <button type="button" className="round" onClick={undo} aria-label="Undo">{UNDO}</button>
        </div>
      )}
      {tool === 'adjust' && (
        <div className="pe-opts pe-adj">
          {[['b', 'Light'], ['c', 'Contrast'], ['s', 'Colour']].map(([k, l]) => (
            <label key={k}><small>{l}</small><Slide min={50} max={150} step={1} value={adj[k]} onChange={(v) => setAdj((a) => ({ ...a, [k]: v }))} aria-label={l} /></label>
          ))}
        </div>
      )}
      <div className="pe-tools">
        <button type="button" onClick={turn}>{TURN}<small>Turn</small></button>
        <button type="button" className={tool === 'crop' ? 'on' : ''} onClick={() => setTool((t) => (t === 'crop' ? '' : 'crop'))}>{CROP}<small>Crop</small></button>
        <button type="button" className={tool === 'draw' ? 'on' : ''} onClick={() => setTool((t) => (t === 'draw' ? '' : 'draw'))}>{PEN}<small>Draw</small></button>
        <button type="button" className={tool === 'adjust' ? 'on' : ''} onClick={() => setTool((t) => (t === 'adjust' ? '' : 'adjust'))}>{TUNE}<small>Adjust</small></button>
      </div>
    </div>,
    document.body,
  )
}
