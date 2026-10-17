/* A small QR code maker (byte mode, error correction level M, versions 1 to 10), so the invite QR is drawn in the app
   and the link never goes to an outside service. After the public QR specification (ISO/IEC 18004); the layout of
   the steps follows Project Nayuki's reference code. Returns a square array of booleans (true = dark). */

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26] // level M, by version
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const ALIGN = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

const rawModules = (v) => {
  let n = (16 * v + 128) * v + 64
  if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36 }
  return n
}
const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * BLOCKS[v]

// Reed-Solomon over GF(256), polynomial 0x11D
const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x } return z & 0xff }
function divisor(deg) {
  const r = new Array(deg).fill(0); r[deg - 1] = 1
  let root = 1
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1] }
    root = mul(root, 0x02)
  }
  return r
}
function remainder(data, div) {
  const r = div.map(() => 0)
  for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f) }) }
  return r
}

export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text))
  let v = 1
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++
  if (v > 10) throw new Error('Too long for a QR code')
  // the data bits: mode, length, bytes, terminator, padding
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8))
  const cap = dataCodewords(v) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  // split into blocks, add error correction, interleave
  const nb = BLOCKS[v]; const ecl = ECC_PER_BLOCK[v]; const raw = Math.floor(rawModules(v) / 8)
  const shortLen = Math.floor(raw / nb); const nShort = nb - (raw % nb)
  const div = divisor(ecl)
  const blocks = []
  for (let i = 0, k = 0; i < nb; i++) {
    const len = shortLen - ecl + (i < nShort ? 0 : 1)
    const dat = data.slice(k, k + len); k += len
    const ecc = remainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const words = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecl || j >= nShort) words.push(b[i]) })

  const size = v * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, d) => { m[y][x] = d; fn[y][x] = true }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const al = ALIGN[v]
  al.forEach((ay, i) => al.forEach((ax, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const format = (mask) => {
    const d = (0 << 3) | mask // level M is 00
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
    const b = ((d << 10) | r) ^ 0x5412
    const bit = (i) => ((b >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  format(0)
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const b = (v << 12) | r
    for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) !== 0; const a = size - 11 + (i % 3); const c = Math.floor(i / 3); set(a, c, d); set(c, a, d) }
  }
  // the codewords, in the zigzag
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j; const up = ((right + 1) & 2) === 0; const y = up ? size - 1 - vert : vert
      if (!fn[y][x] && i < words.length * 8) { m[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++ }
    }
  }
  // masks: pick the one with the lowest penalty
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0]
  const apply = (k) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[k](x, y)) m[y][x] = !m[y][x] }
  const penalty = () => {
    let p = 0; let dark = 0
    const runs = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1
        for (let b = 1; b <= size; b++) {
          if (b < size && get(a, b) === get(a, b - 1)) run++
          else { if (run >= 5) p += run - 2; run = 1 }
        }
        for (let b = 0; b + 6 < size; b++) {
          const s = [0, 1, 2, 3, 4, 5, 6].map((k) => get(a, b + k))
          if (s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6]) {
            const before = b >= 4 && [1, 2, 3, 4].every((k) => !get(a, b - k))
            const after = b + 10 < size && [7, 8, 9, 10].every((k) => !get(a, b + k))
            if (before || after) p += 40
          }
        }
      }
    }
    runs((a, b) => m[a][b]); runs((a, b) => m[b][a])
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
    m.forEach((row) => row.forEach((d) => { if (d) dark++ }))
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
    return p
  }
  let best = 0; let bestP = Infinity
  for (let k = 0; k < 8; k++) { apply(k); format(k); const p = penalty(); if (p < bestP) { bestP = p; best = k } apply(k) }
  apply(best); format(best)
  return m
}

/* the code as an SVG path, one square per dark module, inside a quiet border of 4 */
export function qrPath(text) {
  const m = qrMatrix(text)
  let d = ''
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return { d, size: m.length + 8 }
}
