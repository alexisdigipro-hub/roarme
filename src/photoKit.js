/* What the photo editor and the video editor share (Alex, 21 Nov): the turned / cropped picture, the ink and words on
   their own layer, the blurred and pixelated copies for those brushes, and the steps a video replays on every frame. */
import { processed } from './photoFx.js'

export const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c }
export const contrastOf = (c) => (/^#(f|e|d)/i.test(c) ? '#111' : '#fff')
export const FXPEN = (s) => s.pen === 'blur' || s.pen === 'pixel'
export const FONTS = [
  ['sans', 'Sans', '-apple-system, system-ui, sans-serif', 800],
  ['serif', 'Serif', '"New York", Georgia, "Times New Roman", serif', 700],
  ['round', 'Rounded', 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif', 800],
  ['mono', 'Mono', 'ui-monospace, Menlo, monospace', 700],
]

// the image turned (90° steps), mirrored and straightened, scaled so the straightened picture still fills its frame
export const turned = (img, rot, flip, deg) => {
  const sw = img.width, sh = img.height, side = rot % 180 !== 0
  const w = side ? sh : sw, h = side ? sw : sh
  const c = canvasOf(w, h)
  const g = c.getContext('2d'), t = (Math.abs(deg) * Math.PI) / 180
  const fill = Math.max((w * Math.cos(t) + h * Math.sin(t)) / w, (w * Math.sin(t) + h * Math.cos(t)) / h)
  g.translate(w / 2, h / 2); g.rotate(((rot + deg) * Math.PI) / 180); if (flip) g.scale(-1, 1); g.scale(fill, fill)
  g.drawImage(img, -sw / 2, -sh / 2)
  return c
}
// a blurred and a pixelated copy of the picture, for the Blur and Pixelate brushes (by scaling: canvas filters are not on every iPhone)
export const makeFx = (src, w, h) => {
  const step = (from, sw, sh) => { const c = canvasOf(sw, sh), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(from, 0, 0, c.width, c.height); return c }
  const a = step(src, w / 6, h / 6), b = step(a, w / 24, h / 24), c2 = step(b, w / 6, h / 6), blur = step(c2, w, h)
  const cell = Math.max(6, Math.round(Math.min(w, h) / 36)), small = canvasOf(w / cell, h / cell)
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height)
  const pixel = canvasOf(w, h), pg = pixel.getContext('2d'); pg.imageSmoothingEnabled = false; pg.drawImage(small, 0, 0, w, h)
  return { blur, pixel }
}

const SCRATCH = { c: null }
// strokes, shapes and words onto a canvas of w by h; k is how many canvas pixels make one screen pixel; fx the blurred and
// pixelated copies of the picture at the same size, for those two brushes
export function paint(g, w, h, strokes, k, fx) {
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

/* A video's edits as steps, replayed on each frame in the order they were made, as the photo's ✓ bakes them one by one:
   { t: 'crop', rot, flip, deg, crop, bars, aspect }, { t: 'fx', params }, { t: 'draw', strokes, boxW }.
   fx runs through gl (videoGL.js) when there is one, else on the CPU. pool keeps the canvases from frame to frame. */
export function applySteps(frame, steps, gl, pool = {}) {
  let cur = frame
  const can = (k, w, h) => { let c = pool[k]; if (!c) c = pool[k] = document.createElement('canvas'); const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)); if (c.width !== W || c.height !== H) { c.width = W; c.height = H } return c }
  steps.forEach((s, i) => {
    if (s.t === 'crop') {
      const t = turned(cur, s.rot, s.flip, s.deg)
      let out = can(`c${i}`, t.width * s.crop.w, t.height * s.crop.h)
      const g = out.getContext('2d'); g.clearRect(0, 0, out.width, out.height)
      g.drawImage(t, t.width * s.crop.x, t.height * s.crop.y, out.width, out.height, 0, 0, out.width, out.height)
      if (s.bars && s.aspect >= 1.8) {
        const b = can(`b${i}`, out.width, (out.width * 9) / 16), bg = b.getContext('2d')
        bg.fillStyle = '#000'; bg.fillRect(0, 0, b.width, b.height); bg.drawImage(out, 0, Math.round((b.height - out.height) / 2))
        out = b
      }
      cur = out
    } else if (s.t === 'fx') {
      if (gl) { const r = gl.render(cur, s.params); const out = can(`f${i}`, r.width, r.height); out.getContext('2d').drawImage(r, 0, 0); cur = out } else cur = processed(cur, s.params)
    } else if (s.t === 'draw') {
      const w = cur.width, h = cur.height, k = w / (s.boxW || w)
      const layer = can(`l${i}`, w, h)
      paint(layer.getContext('2d'), w, h, s.strokes, k, s.strokes.some(FXPEN) ? makeFx(cur, w, h) : null)
      const out = can(`d${i}`, w, h), g = out.getContext('2d')
      g.drawImage(cur, 0, 0); g.drawImage(layer, 0, 0)
      cur = out
    }
  })
  return cur
}
