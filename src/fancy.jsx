import { useRef, useState } from 'react'

/* Bold, italic, underline and strike in a name (folder names and group names; Alex, 15 Nov). A name is plain text
   everywhere it goes (the folder bar, the chat list, a notification), so the marks are letters of Unicode's own:
   bold and italic are the mathematical sans-serif letters (Greek too), underline and strike are combining lines
   under or through each letter. lib.js fold() reads them back as plain letters, so searching still finds them. */

const RANGES = {
  // [from, to, start of the styled letters]
  b: [[0x41, 0x5a, 0x1d5d4], [0x61, 0x7a, 0x1d5ee], [0x30, 0x39, 0x1d7ec], [0x391, 0x3a9, 0x1d756], [0x3b1, 0x3c9, 0x1d770]],
  i: [[0x41, 0x5a, 0x1d608], [0x61, 0x7a, 0x1d622], [0x391, 0x3a9, 0x1d6e2], [0x3b1, 0x3c9, 0x1d6fc]],
}
const LINE = { u: '̲', s: '̶' }

// a styled letter back to its plain letter and its style
const BACK = new Map()
Object.entries(RANGES).forEach(([k, rs]) => rs.forEach(([a, z, s]) => { for (let c = a; c <= z; c++) BACK.set(s + c - a, [c, k]) }))

// the text as letters, each with its own marks: [{ ch, b, i, u, s }]; an accent stays with its letter
function read(text) {
  const out = []
  for (const g of String(text || '').normalize('NFD')) {
    const cp = g.codePointAt(0)
    if (g === LINE.u || g === LINE.s) { if (out.length) out[out.length - 1][g === LINE.u ? 'u' : 's'] = true; continue }
    if (/[̀-ͯ]/.test(g) && out.length) { out[out.length - 1].acc = (out[out.length - 1].acc || '') + g; continue }
    const back = BACK.get(cp)
    out.push(back ? { ch: String.fromCodePoint(back[0]), [back[1]]: true } : { ch: g })
  }
  return out
}

function write(letters) {
  return letters.map((l) => {
    const cp = l.ch.codePointAt(0)
    const style = l.b ? 'b' : l.i ? 'i' : ''
    const r = style && RANGES[style].find(([a, z]) => cp >= a && cp <= z)
    const ch = r ? String.fromCodePoint(r[2] + cp - r[0]) : l.ch
    const lines = /\s/.test(l.ch) ? '' : (l.u ? LINE.u : '') + (l.s ? LINE.s : '')
    return ch + (l.acc || '') + lines
  }).join('').normalize('NFC')
}

// where letter n of read() starts in the string
const offsets = (text) => {
  const at = []
  let i = 0
  const s = String(text || '')
  for (const g of s) {
    if (!/[\u0300-\u036f]/.test(g)) at.push(i)
    i += g.length
  }
  at.push(s.length)
  return at
}

/* turns one mark on or off for the letters a..b (string positions), or for the whole name when nothing is chosen */
export function markName(text, a, b, k) {
  const at = offsets(text)
  const letters = read(text)
  let from = at.findIndex((x) => x >= a)
  let to = at.findIndex((x) => x >= b)
  if (from < 0) from = letters.length
  if (to < 0) to = letters.length
  if (from >= to) { from = 0; to = letters.length }
  const part = letters.slice(from, to).filter((l) => !/\s/.test(l.ch))
  const on = !part.length || !part.every((l) => l[k])
  letters.slice(from, to).forEach((l) => {
    l[k] = on
    if (on && k === 'b') l.i = false
    if (on && k === 'i') l.b = false
  })
  const next = write(letters)
  const nat = offsets(next)
  return { text: next, a: nat[from] ?? next.length, b: nat[to] ?? next.length }
}

export const nameHas = (text, k) => { const l = read(text).filter((x) => !/\s/.test(x.ch)); return l.length > 0 && l.every((x) => x[k]) }

const MARKS = [['b', 'Bold', <b key="b">B</b>], ['i', 'Italic', <i key="i">I</i>], ['u', 'Underline', <u key="u">U</u>], ['s', 'Strikethrough', <s key="s">S</s>]]

/* the field's helper: spread inputProps on the <input>, show bar under it. The bar shows while the field is in use;
   a mark goes on the chosen letters, or on the whole name when none are chosen. */
export function useNameMarks(value, setValue) {
  const ref = useRef(null)
  const sel = useRef([0, 0])
  const [focus, setFocus] = useState(false)
  const keep = (e) => { const t = e.currentTarget; sel.current = [t.selectionStart ?? 0, t.selectionEnd ?? 0] }
  const act = (k) => {
    const [a, b] = sel.current
    const r = markName(value, Math.min(a, b), Math.max(a, b), k)
    setValue(r.text)
    requestAnimationFrame(() => { const el = ref.current; if (!el) return; el.focus(); if (a !== b) el.setSelectionRange(r.a, r.b); sel.current = a !== b ? [r.a, r.b] : [r.text.length, r.text.length] })
  }
  // one press is one mark (Alex, 15 Nov, on the iPhone: the touch and the click that follows it both toggled it, so it
  // went on and off at once): the press only keeps the focus and the chosen letters, the click does the mark; the bar
  // hides a moment after the field lets go, unless one of its buttons is being pressed
  const pressing = useRef(false)
  const hideT = useRef(0)
  const press = (e) => { e.preventDefault(); pressing.current = true; clearTimeout(hideT.current) }
  const inputProps = {
    ref,
    onSelect: keep,
    onKeyUp: keep,
    autoCorrect: 'off',
    autoComplete: 'off',
    spellCheck: false,
    onFocus: () => { clearTimeout(hideT.current); setFocus(true) },
    onBlur: () => { clearTimeout(hideT.current); hideT.current = setTimeout(() => { if (!pressing.current) setFocus(false) }, 250) },
  }
  const [a, b] = sel.current
  const chosen = a !== b ? String(value || '').slice(Math.min(a, b), Math.max(a, b)) : value
  const bar = focus ? (
    <span className="name-marks" role="toolbar" aria-label="Format the name">
      {MARKS.map(([k, label, face]) => (
        <button key={k} type="button" tabIndex={-1} className={`round${nameHas(chosen, k) ? ' on' : ''}`} aria-label={label} title={label}
          onPointerDown={press} onMouseDown={(e) => e.preventDefault()} onClick={() => { pressing.current = false; act(k) }}>{face}</button>
      ))}
    </span>
  ) : null
  return { inputProps, bar, ref }
}
