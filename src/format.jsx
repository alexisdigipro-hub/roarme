/* Text formatting in messages, as in Telegram (Alex, 16 Oct):
   **bold**  _italic_ or *italic*  ~~strike~~  `code`  ```a block of code```  ||spoiler||
   The marks are written in the message itself, so every device shows the same thing. */

const RULES = [
  [/```\n?([\s\S]+?)```/, (m, k) => <pre key={k} className="fmt-pre">{m[1]}</pre>, false],
  [/`([^`\n]+)`/, (m, k) => <code key={k} className="fmt-code">{m[1]}</code>, false],
  [/\*\*([^*\n][^*]*?)\*\*/, (m, k, f) => <b key={k}>{f(m[1])}</b>, true],
  [/~~([^~\n]+?)~~/, (m, k, f) => <s key={k}>{f(m[1])}</s>, true],
  [/\|\|([^|\n]+?)\|\|/, (m, k, f) => <span key={k} className="fmt-spoiler" role="button" tabIndex={0} title="Show" onClick={(e) => { e.stopPropagation(); e.currentTarget.classList.add('shown') }}>{f(m[1])}</span>, true],
  [/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/, (m, k, f) => <i key={k}>{f(m[1])}</i>, true],
  [/(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])/u, (m, k, f) => <i key={k}>{f(m[1])}</i>, true],
]

/* the message as React pieces; plain(s) handles what is left (links, @mentions) */
export function formatText(text, plain = (s) => s, key = 'f') {
  const s = String(text || '')
  let best = null
  RULES.forEach(([re, make, inner]) => {
    const m = re.exec(s)
    if (m && (!best || m.index < best.m.index)) best = { m, make, inner }
  })
  if (!best) return [plain(s)]
  const { m, make } = best
  const before = s.slice(0, m.index)
  const after = s.slice(m.index + m[0].length)
  const inside = (t) => formatText(t, plain, `${key}i`)
  return [
    before ? plain(before) : null,
    make(m, `${key}-${m.index}`, inside),
    ...(after ? formatText(after, plain, `${key}n`) : []),
  ].filter((x) => x !== null)
}

/* the same text without the marks (list previews, copying without formatting) */
export function plainText(text) {
  return String(text || '')
    .replace(/```\n?([\s\S]+?)```/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n][^*]*?)\*\*/g, '$1')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/\|\|([^|\n]+?)\|\|/g, '$1')
    .replace(/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g, '$1')
    .replace(/(?<![\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])/gu, '$1')
}

/* wrap what is selected in a textarea with a mark (Cmd/Ctrl + B, I, Shift+X, E, Shift+P) */
export function wrapSelection(el, text, mark) {
  const a = el.selectionStart
  const b = el.selectionEnd
  const picked = text.slice(a, b) || ''
  const next = text.slice(0, a) + mark + picked + mark + text.slice(b)
  const caretA = a + mark.length
  const caretB = caretA + picked.length
  return { next, caretA, caretB }
}
