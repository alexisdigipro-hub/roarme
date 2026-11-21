/* The photo editor's pixel work (Alex, 21 Nov, "Όλα": looks, more adjustments, curves, HSL), all on the device.
   process(data, w, h, p) changes an ImageData's pixels in place from one set of values p; the same values draw the small
   preview on screen and the full photo when ✓ is pressed. */

export const ZERO = {
  enhance: 0, exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, warmth: 0, tint: 0,
  fade: 0, grain: 0, sharpen: 0, vignette: 0,
}
export const BANDS = [
  ['red', 'Red', 0, '#ff453a'], ['orange', 'Orange', 30, '#ff9f0a'], ['yellow', 'Yellow', 60, '#ffd60a'], ['green', 'Green', 120, '#32d74b'],
  ['aqua', 'Aqua', 180, '#64d2ff'], ['blue', 'Blue', 225, '#0a84ff'], ['purple', 'Purple', 275, '#bf5af2'], ['magenta', 'Magenta', 320, '#ff375f'],
]
export const noHsl = () => Object.fromEntries(BANDS.map(([k]) => [k, { h: 0, s: 0, l: 0 }]))
export const noCurves = () => ({ l: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] })

// the looks: each a set of values, scaled by its strength (0 to 100)
export const LOOKS = [
  ['none', 'Original', {}],
  ['film', 'Film', { contrast: -10, fade: 38, warmth: 16, saturation: -12, grain: 34, highlights: -15, split: { sh: [0.02, 0.06, 0.08], hl: [0.08, 0.04, -0.02], a: 0.6 } }],
  ['cine', 'Cinematic', { contrast: 18, saturation: 8, shadows: -10, highlights: -12, split: { sh: [-0.06, 0.04, 0.1], hl: [0.12, 0.05, -0.06], a: 1 }, hsl: { orange: { h: 0, s: 18, l: 4 }, blue: { h: -14, s: 10, l: -6 }, aqua: { h: 10, s: 0, l: -4 } } }],
  ['noir', 'Noir', { saturation: -100, contrast: 42, shadows: -20, vignette: 40, grain: 22 }],
  ['mono', 'Mono', { saturation: -100, contrast: 10 }],
  ['vivid', 'Vivid', { saturation: 34, contrast: 16, enhance: 30 }],
  ['warm', 'Warm', { warmth: 42, exposure: 4, saturation: 6 }],
  ['cool', 'Cool', { warmth: -38, tint: -6 }],
  ['fade', 'Fade', { fade: 62, contrast: -22, saturation: -22 }],
]
export const lookValues = (key, k = 100) => {
  const l = LOOKS.find(([x]) => x === key)
  if (!l || key === 'none') return null
  const f = k / 100, src = l[2], out = { ...ZERO }
  for (const n of Object.keys(ZERO)) out[n] = (src[n] || 0) * f
  if (src.split) out.split = { ...src.split, a: src.split.a * f }
  if (src.hsl) { out.hsl = noHsl(); for (const [b, v] of Object.entries(src.hsl)) out.hsl[b] = { h: v.h * f, s: v.s * f, l: v.l * f } }
  return out
}

// a smooth curve through the points (monotone cubic), as a table of 256
export function lutOf(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length, out = new Uint8ClampedArray(256)
  if (n < 2 || (n === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 1 && p[1][1] === 1)) { for (let i = 0; i < 256; i++) out[i] = i; return out }
  const dx = [], dy = [], m = []
  for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0] || 1e-6; dy[i] = (p[i + 1][1] - p[i][1]) / dx[i] }
  m[0] = dy[0]; m[n - 1] = dy[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (!dy[i]) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i] }
  }
  for (let v = 0; v < 256; v++) {
    const x = v / 255
    let i = 0
    while (i < n - 2 && x > p[i + 1][0]) i++
    if (x <= p[0][0]) { out[v] = p[0][1] * 255; continue }
    if (x >= p[n - 1][0]) { out[v] = p[n - 1][1] * 255; continue }
    const h = dx[i], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t
    const y = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1]
    out[v] = Math.max(0, Math.min(1, y)) * 255
  }
  return out
}
const isFlat = (c) => !c || ['l', 'r', 'g', 'b'].every((k) => c[k].length === 2 && c[k][0][0] === 0 && c[k][0][1] === 0 && c[k][1][0] === 1 && c[k][1][1] === 1)
const hslOn = (h) => h && Object.values(h).some((v) => v.h || v.s || v.l)

/* p: the ZERO values (−100 to 100, some 0 to 100), plus optional split, hsl, curves */
export function process(data, w, h, p) {
  const d = data.data
  const e = (p.enhance || 0) / 100
  const ex = 2 ** ((p.exposure || 0) / 100 + e * 0.05)
  const br = (p.brightness || 0) / 250
  const ct = 1 + (p.contrast || 0) / 100 + e * 0.12
  const sat = 1 + (p.saturation || 0) / 100 + e * 0.2
  const hl = (p.highlights || 0) / 100 * 0.35, sh = (p.shadows || 0) / 100 * 0.35
  const wm = (p.warmth || 0) / 100 * 0.09, tn = (p.tint || 0) / 100 * 0.06
  const fd = (p.fade || 0) / 100
  const vg = (p.vignette || 0) / 100, gr = (p.grain || 0) / 100 * 0.16
  const sp = p.split, hs = hslOn(p.hsl) ? BANDS.filter(([k]) => { const v = p.hsl[k]; return v && (v.h || v.s || v.l) }).map(([k, , c]) => [c, p.hsl[k].h * 0.3, p.hsl[k].s / 100, p.hsl[k].l / 100 * 0.25]) : null
  const cv = isFlat(p.curves) ? null : { l: lutOf(p.curves.l), r: lutOf(p.curves.r), g: lutOf(p.curves.g), b: lutOf(p.curves.b) }
  const cx = w / 2, cy = h / 2, rr = Math.sqrt(cx * cx + cy * cy)
  let seed = 1234567
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255
      r *= ex; g *= ex; b *= ex
      r += br; g += br; b += br
      r = (r - 0.5) * ct + 0.5; g = (g - 0.5) * ct + 0.5; b = (b - 0.5) * ct + 0.5
      let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (hl || sh) { const l = Math.max(0, Math.min(1, lum)), dl = sh * (1 - l) * (1 - l) + hl * l * l; r += dl; g += dl; b += dl }
      if (wm) { r += wm; b -= wm }
      if (tn) { g -= tn; r += tn / 2; b += tn / 2 }
      if (sp && sp.a) { const l = Math.max(0, Math.min(1, lum)); r += sp.a * ((1 - l) * sp.sh[0] + l * sp.hl[0]); g += sp.a * ((1 - l) * sp.sh[1] + l * sp.hl[1]); b += sp.a * ((1 - l) * sp.sh[2] + l * sp.hl[2]) }
      lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (sat !== 1) { r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat }
      if (hs) {
        r = r < 0 ? 0 : r > 1 ? 1 : r; g = g < 0 ? 0 : g > 1 ? 1 : g; b = b < 0 ? 0 : b > 1 ? 1 : b
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (mx + mn) / 2, D = mx - mn
        if (D > 0.002) {
          const S = D / (1 - Math.abs(2 * L - 1) || 1e-6)
          let H = mx === r ? ((g - b) / D) % 6 : mx === g ? (b - r) / D + 2 : (r - g) / D + 4
          H *= 60; if (H < 0) H += 360
          let dh = 0, ds = 0, dL = 0
          for (let q = 0; q < hs.length; q++) {
            const b = hs[q]
            let diff = H - b[0]; if (diff < 0) diff = -diff; if (diff > 180) diff = 360 - diff
            if (diff >= 38) continue
            const wgt = 1 - diff / 38
            dh += b[1] * wgt; ds += b[2] * wgt; dL += b[3] * wgt
          }
          if (dh || ds || dL) {
            const H2 = (H + dh + 360) % 360, S2 = Math.max(0, Math.min(1, S * (1 + ds))), L2 = Math.max(0, Math.min(1, L + dL * S))
            const C = (1 - Math.abs(2 * L2 - 1)) * S2, X = C * (1 - Math.abs(((H2 / 60) % 2) - 1)), m0 = L2 - C / 2
            const s6 = Math.floor(H2 / 60)
            const [a1, a2, a3] = s6 === 0 ? [C, X, 0] : s6 === 1 ? [X, C, 0] : s6 === 2 ? [0, C, X] : s6 === 3 ? [0, X, C] : s6 === 4 ? [X, 0, C] : [C, 0, X]
            r = a1 + m0; g = a2 + m0; b = a3 + m0
          }
        }
      }
      if (fd) { r = 0.1 * fd + r * (1 - 0.18 * fd); g = 0.1 * fd + g * (1 - 0.18 * fd); b = 0.1 * fd + b * (1 - 0.18 * fd) }
      if (vg) {
        const dd = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / rr
        const f = dd < 0.45 ? 1 : 1 - vg * 0.85 * Math.min(1, ((dd - 0.45) / 0.6) ** 2)
        r *= f; g *= f; b *= f
      }
      if (gr) { const n = (rnd() - 0.5) * gr; r += n; g += n; b += n }
      let R = r * 255, G = g * 255, B = b * 255
      R = R < 0 ? 0 : R > 255 ? 255 : R; G = G < 0 ? 0 : G > 255 ? 255 : G; B = B < 0 ? 0 : B > 255 ? 255 : B
      if (cv) { R = cv.l[cv.r[R | 0]]; G = cv.l[cv.g[G | 0]]; B = cv.l[cv.b[B | 0]] }
      d[i] = R; d[i + 1] = G; d[i + 2] = B
    }
  }
  if (p.sharpen > 0) sharpen(data, w, h, p.sharpen / 100)
  return data
}

function sharpen(data, w, h, amt) {
  const d = data.data, src = new Uint8ClampedArray(d), k = amt * 0.9
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = src[i + c], blur = (src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c]) / 4
        d[i + c] = v + (v - blur) * k
      }
    }
  }
}

export const isNeutral = (p) => Object.keys(ZERO).every((k) => !p[k]) && !(p.split && p.split.a) && !hslOn(p.hsl) && isFlat(p.curves)

// a canvas run through process, at its own size
export function processed(canvas, p) {
  const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0)
  if (!isNeutral(p)) { const im = g.getImageData(0, 0, c.width, c.height); process(im, c.width, c.height, p); g.putImageData(im, 0, 0) }
  return c
}
