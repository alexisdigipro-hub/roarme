import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { lang, locale } from './i18n.js'
import { formatText, plainText, toggleMark } from './format.jsx'
import { I, Modal } from './ui.jsx'

/* Location and Article, from the send window (Alex, 17 Oct, after Telegram).

   Location: a map you move under a pin, a search box, your own position if the computer or phone shares it. It goes
   into the chat as a text message whose `file.location` holds { lat, lng, z, name, addr } (the body is the place's
   name, so list previews and search read it), shown as a small map; a tap opens it big, with Google and Apple Maps.
   The map is OpenStreetMap's own tiles, the names come from OpenStreetMap's Nominatim; both only see the spot on the
   map, never who is looking.

   Article: a long post with a title, headings, lists, checklists, quotes and dividers, written in the same marks as a
   message (**bold**, _italic_ …) plus a few line marks (# heading, - list, 1. list, - [ ] check, > quote, ---). The
   body holds the title on its first line and then the text; `file.article` only marks it as an article. */

/* ---------- the map ---------- */
const TILE = 256
const worldOf = (lat, lng, z) => {
  const n = TILE * 2 ** z
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return { x: ((lng + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n }
}
const latLngOf = (x, y, z) => {
  const n = TILE * 2 ** z
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / n))
  const lng = ((((x / n) * 360 - 180) % 360) + 540) % 360 - 180
  return { lat: Math.max(-85, Math.min(85, lat)), lng }
}
// OpenStreetMap's own tiles: no key needed (CARTO's now ask a key from other sites and draw "API KEY REQUIRED")
const tileUrl = (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
const MIN_Z = 2
const MAX_Z = 19
const clampZ = (z) => Math.max(MIN_Z, Math.min(MAX_Z, z))

function Tile({ src, left, top }) {
  const [on, setOn] = useState(false)
  return <img className={`map-tile${on ? ' on' : ''}`} src={src} alt="" draggable={false} onLoad={() => setOn(true)} style={{ left, top }} />
}

/* the map at a centre and zoom; moving it calls onMove(centre, zoom, settled) */
export function MapView({ at, zoom, onMove, interactive = true, marks = [], onDragging }) {
  const box = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const put = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    put()
    const ro = new window.ResizeObserver(put)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const c = worldOf(at.lat, at.lng, zoom)
  const { w, h } = size
  const max = 2 ** zoom
  const tiles = []
  if (w && h) {
    for (let ty = Math.floor((c.y - h / 2) / TILE); ty <= Math.floor((c.y + h / 2) / TILE); ty++) {
      if (ty < 0 || ty >= max) continue
      for (let tx = Math.floor((c.x - w / 2) / TILE); tx <= Math.floor((c.x + w / 2) / TILE); tx++) {
        const wx = ((tx % max) + max) % max
        tiles.push(<Tile key={`${zoom}/${tx}/${ty}`} src={tileUrl(wx, ty, zoom)} left={Math.round(tx * TILE - (c.x - w / 2))} top={Math.round(ty * TILE - (c.y - h / 2))} />)
      }
    }
  }

  // dragging with a mouse or a finger, a second finger pinches, the wheel and a double click zoom
  const drag = useRef(null)
  const wheel = useRef(0)
  const zoomBy = (d) => onMove(at, clampZ(zoom + d), true)
  const down = (e) => {
    if (!interactive) return
    const d = drag.current || { pts: new Map() }
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    d.c = worldOf(at.lat, at.lng, zoom); d.z = zoom
    d.start = new Map(d.pts); d.moved = false
    drag.current = d
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d || !d.pts.has(e.pointerId)) return
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const ids = [...d.pts.keys()]
    if (ids.length >= 2) {
      const [a, b] = ids
      const dist = (m) => Math.hypot(m.get(a).x - m.get(b).x, m.get(a).y - m.get(b).y)
      const r = dist(d.pts) / Math.max(1, dist(d.start))
      if (r > 1.6 || r < 0.62) { const z = clampZ(d.z + (r > 1 ? 1 : -1)); d.start = new Map(d.pts); d.z = z; d.c = worldOf(at.lat, at.lng, z); onMove(at, z, true) }
      return
    }
    const s = d.start.get(e.pointerId)
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    if (!d.moved) { d.moved = true; onDragging?.(true) }
    onMove(latLngOf(d.c.x - dx, d.c.y - dy, d.z), d.z, false)
  }
  const up = (e) => {
    const d = drag.current
    if (!d) return
    d.pts.delete(e.pointerId)
    if (d.pts.size) { d.start = new Map(d.pts); d.c = worldOf(at.lat, at.lng, zoom); return }
    drag.current = null
    if (d.moved) { onDragging?.(false); onMove(at, zoom, true) }
  }
  const onWheel = (e) => {
    if (!interactive) return
    wheel.current += e.deltaY
    if (Math.abs(wheel.current) > 60) { zoomBy(wheel.current < 0 ? 1 : -1); wheel.current = 0 }
  }
  // the wheel must not scroll the window behind the map
  useEffect(() => {
    const el = box.current
    if (!el || !interactive) return undefined
    const stop = (e) => e.preventDefault()
    el.addEventListener('wheel', stop, { passive: false })
    return () => el.removeEventListener('wheel', stop)
  }, [interactive])

  return (
    <span ref={box} className={`map${interactive ? ' live' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={onWheel} onDoubleClick={interactive ? () => zoomBy(1) : undefined}>
      {tiles}
      {marks.map((m) => {
        const p = worldOf(m.lat, m.lng, zoom)
        return <span key={m.key} className="map-mark" style={{ left: p.x - c.x + w / 2, top: p.y - c.y + h / 2 }}>{m.node}</span>
      })}
      <a className="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>© OpenStreetMap</a>
    </span>
  )
}

/* ---------- place names ---------- */
const nominatim = async (path, params) => {
  const u = new URL(`https://nominatim.openstreetmap.org/${path}`)
  Object.entries({ format: 'jsonv2', addressdetails: 1, 'accept-language': lang() === 'el' ? 'el,en' : 'en,el', ...params }).forEach(([k, v]) => u.searchParams.set(k, v))
  const r = await fetch(u)
  if (!r.ok) throw new Error('No place names right now')
  return r.json()
}
const describe = (d) => {
  const a = d?.address || {}
  const street = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ')
  const town = a.city || a.town || a.village || a.municipality || a.county
  const name = d?.name || street || a.neighbourhood || a.suburb || town || a.state || a.country || ''
  const addr = [street !== name ? street : '', a.suburb !== name ? a.suburb : '', town !== name ? town : '', a.country !== name ? a.country : '']
    .filter(Boolean).slice(0, 3).join(', ')
  return { name, addr }
}
const coords = (p) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`

const LAST = 'roarme-last-place'
const HOME = { lat: 37.9755, lng: 23.7348 } // Athens, before anything else is known
const lastPlace = () => { try { const v = JSON.parse(localStorage.getItem(LAST) || 'null'); return v && Number.isFinite(v.lat) && Number.isFinite(v.lng) ? v : null } catch { return null } }

const Pin = ({ lifted = false, small = false }) => <i className={`map-pin${lifted ? ' up' : ''}${small ? ' small' : ''}`}>{I.place}</i>
const Me = () => <i className="map-me" />

export function LocationPicker({ onSend, onClose }) {
  const first = useRef(lastPlace())
  const [at, setAt] = useState(first.current ? { lat: first.current.lat, lng: first.current.lng } : HOME)
  const [z, setZ] = useState(first.current?.z || 12)
  const [place, setPlace] = useState({ name: '', addr: '' })
  const [looking, setLooking] = useState(false)
  const [lifted, setLifted] = useState(false)
  const [mine, setMine] = useState(null)
  const [note, setNote] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const timer = useRef(0)

  // the name of the spot under the pin, a moment after the map stops
  const look = useCallback((p) => {
    clearTimeout(timer.current)
    const n = ++seq.current
    setLooking(true)
    timer.current = setTimeout(async () => {
      try {
        const d = await nominatim('reverse', { lat: p.lat, lon: p.lng, zoom: 18 })
        if (n === seq.current) setPlace(describe(d))
      } catch { if (n === seq.current) setPlace({ name: '', addr: '' }) }
      if (n === seq.current) setLooking(false)
    }, 650)
  }, [])
  const locate = useCallback((quiet) => {
    if (!navigator.geolocation) { if (!quiet) setNote('Your location is not shared here: move the map or search a place.'); return }
    if (!quiet) setNote('Finding you…')
    navigator.geolocation.getCurrentPosition((pos) => {
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setMine(p); setAt(p); setZ(16); setNote(''); look(p)
    }, () => { setNote(quiet ? '' : 'Your location is not shared here: move the map or search a place.') }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 })
  }, [look])
  useEffect(() => { look(at); locate(true); return () => clearTimeout(timer.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = (p, nz, settled) => { setAt(p); setZ(nz); if (settled) look(p) }
  const search = async (e) => {
    e.preventDefault()
    const s = q.trim()
    if (!s) { setFound(null); return }
    setFound('busy')
    try {
      const list = await nominatim('search', { q: s, limit: 6 })
      setFound(list.map((d) => ({ ...describe(d), lat: Number(d.lat), lng: Number(d.lon) })))
    } catch { setFound([]) }
  }
  const pick = (r) => { const p = { lat: r.lat, lng: r.lng }; setAt(p); setZ(16); setPlace({ name: r.name, addr: r.addr }); setFound(null); setQ(''); seq.current++; setLooking(false) }
  const isMine = mine && Math.abs(mine.lat - at.lat) < 2e-5 && Math.abs(mine.lng - at.lng) < 2e-5
  const send = async () => {
    setBusy(true)
    const loc = { lat: +at.lat.toFixed(6), lng: +at.lng.toFixed(6), z, name: place.name || (isMine ? 'My location' : 'Location'), addr: place.addr || coords(at) }
    try { localStorage.setItem(LAST, JSON.stringify({ lat: loc.lat, lng: loc.lng, z })) } catch { /* private window */ }
    await onSend(loc)
    setBusy(false)
  }
  return (
    <Modal title="Location" onClose={onClose}>
      <div className="loc">
        <div className="loc-map">
          <MapView at={at} zoom={z} onMove={onMove} onDragging={setLifted} marks={mine ? [{ key: 'me', ...mine, node: <Me /> }] : []} />
          <Pin lifted={lifted} />
          <div className="loc-top">
            <button type="button" className="loc-round" onClick={onClose} aria-label="Close">{I.x}</button>
            <form className="loc-search" onSubmit={search}>
              {I.search}
              <input value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setFound(null) }} placeholder="Search a place" enterKeyHint="search" />
            </form>
          </div>
          {found && (
            <div className="loc-found">
              {found === 'busy' ? <p>Searching…</p> : !found.length ? <p>Nothing found.</p>
                : found.map((r, n) => <button key={n} type="button" onClick={() => pick(r)}>{I.place}<span><b>{r.name}</b><small>{r.addr}</small></span></button>)}
            </div>
          )}
          <div className="loc-ctrl">
            <button type="button" className={`loc-round${isMine ? ' on' : ''}`} onClick={() => (mine ? onMove(mine, Math.max(z, 16), true) : locate(false))} aria-label="My location" title="My location">{I.locate}</button>
            <span className="loc-zoom">
              <button type="button" onClick={() => onMove(at, clampZ(z + 1), true)} aria-label="Zoom in">{I.plus}</button>
              <button type="button" onClick={() => onMove(at, clampZ(z - 1), true)} aria-label="Zoom out">{I.minus}</button>
            </span>
          </div>
          {note && <span className="loc-note">{note}</span>}
        </div>
        <button type="button" className="loc-send" disabled={busy} onClick={send}>
          <i>{busy ? I.send : I.place}</i>
          <span><b>{isMine ? 'Send My Location' : 'Send This Location'}</b><small>{looking ? 'Finding the address…' : [place.name, place.addr].filter(Boolean).join(' · ') || coords(at)}</small></span>
        </button>
      </div>
    </Modal>
  )
}

const mapsLinks = (l) => ({
  google: `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`,
  apple: `https://maps.apple.com/?ll=${l.lat},${l.lng}&q=${encodeURIComponent(l.name || 'Location')}`,
})

/* the place in the chat: a small map with the pin, the name under it */
export function LocationCard({ loc, onOpen }) {
  return (
    <span className="locc" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen() }} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <span className="locc-map"><MapView at={loc} zoom={Math.min(loc.z || 15, 16)} interactive={false} /><Pin small /></span>
      <span className="locc-text"><b>{loc.name || 'Location'}</b><small>{loc.addr || coords(loc)}</small></span>
    </span>
  )
}

/* the place big, to look around, and on to a maps app */
export function LocationView({ loc, onClose }) {
  const [at, setAt] = useState({ lat: loc.lat, lng: loc.lng })
  const [z, setZ] = useState(Math.max(loc.z || 15, 15))
  const links = mapsLinks(loc)
  return (
    <Modal title={loc.name || 'Location'} onClose={onClose}>
      <div className="loc view">
        <div className="loc-map">
          <MapView at={at} zoom={z} onMove={(p, nz) => { setAt(p); setZ(nz) }} marks={[{ key: 'p', lat: loc.lat, lng: loc.lng, node: <Pin /> }]} />
          <div className="loc-top"><button type="button" className="loc-round" onClick={onClose} aria-label="Close">{I.x}</button></div>
          <div className="loc-ctrl">
            <button type="button" className="loc-round" onClick={() => { setAt({ lat: loc.lat, lng: loc.lng }); setZ(Math.max(loc.z || 15, 15)) }} aria-label="Back to the place" title="Back to the place">{I.place}</button>
            <span className="loc-zoom">
              <button type="button" onClick={() => setZ((v) => clampZ(v + 1))} aria-label="Zoom in">{I.plus}</button>
              <button type="button" onClick={() => setZ((v) => clampZ(v - 1))} aria-label="Zoom out">{I.minus}</button>
            </span>
          </div>
        </div>
        <div className="loc-info">
          <span><b>{loc.name || 'Location'}</b><small>{loc.addr || coords(loc)}</small></span>
          <span className="loc-apps">
            <a className="trx-get" href={links.google} target="_blank" rel="noopener noreferrer">{I.place}<span>Google Maps</span></a>
            <a className="trx-get soft" href={links.apple} target="_blank" rel="noopener noreferrer">{I.place}<span>Apple Maps</span></a>
          </span>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- Article ---------- */
const DRAFT = 'roarme-article-draft'
const LINE_MARK = /^(#{1,2} |- \[[ xX]\] |[-•] |\d+\. |> ?)/

/* the text in blocks: headings, lists, checklists, quotes, dividers and paragraphs, each line with the message marks */
export function ArticleBody({ text, plain = (s) => s }) {
  const out = []
  let list = null
  let para = []
  let quote = []
  const f = (s, k) => formatText(s, plain, k)
  const flush = () => {
    if (para.length) { out.push(<p key={`p${out.length}`}>{f(para.join('\n'), `p${out.length}`)}</p>); para = [] }
    if (quote.length) { out.push(<blockquote key={`q${out.length}`}>{f(quote.join('\n'), `q${out.length}`)}</blockquote>); quote = [] }
    if (list) {
      const Tag = list.kind === 'ol' ? 'ol' : 'ul'
      out.push(<Tag key={`l${out.length}`} className={list.kind === 'check' ? 'art-checks' : undefined} start={list.kind === 'ol' ? list.start : undefined}>
        {list.items.map((it, n) => <li key={n} className={it.done ? 'done' : undefined}>{list.kind === 'check' && <i>{it.done ? I.check : null}</i>}<span>{f(it.text, `l${out.length}-${n}`)}</span></li>)}
      </Tag>)
      list = null
    }
  }
  const item = (kind, t, extra = {}) => {
    if (para.length || quote.length || (list && list.kind !== kind)) flush()
    if (!list) list = { kind, items: [], ...extra }
    list.items.push({ text: t, ...extra })
  }
  String(text || '').split('\n').forEach((line) => {
    let m
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push(<hr key={`h${out.length}`} />) }
    else if ((m = /^(#{1,2}) (.+)$/.exec(line))) { flush(); const H = m[1].length === 1 ? 'h3' : 'h4'; out.push(<H key={`t${out.length}`}>{f(m[2], `t${out.length}`)}</H>) }
    else if ((m = /^- \[([ xX])\] ?(.*)$/.exec(line))) item('check', m[2], { done: m[1] !== ' ' })
    else if ((m = /^[-•] (.*)$/.exec(line))) item('ul', m[1])
    else if ((m = /^(\d+)\. (.*)$/.exec(line))) item('ol', m[2], list?.kind === 'ol' ? {} : { start: Number(m[1]) })
    else if ((m = /^> ?(.*)$/.exec(line))) { if (para.length || list) flush(); quote.push(m[1]) }
    else if (!line.trim()) flush()
    else { if (quote.length || list) flush(); para.push(line) }
  })
  flush()
  return <div className="art-body">{out}</div>
}

/* the title is the body's first line, the text follows an empty line (so editing an article changes only its body) */
export const articleOf = (body) => {
  const s = String(body || '')
  const n = s.indexOf('\n')
  return n < 0 ? { title: s.trim(), text: '' } : { title: s.slice(0, n).trim(), text: s.slice(n + 1).replace(/^\n+/, '') }
}
const minutesOf = (s) => Math.max(1, Math.round(String(s || '').split(/\s+/).filter(Boolean).length / 200))
const excerpt = (s) => plainText(String(s || '').split('\n').map((l) => l.replace(LINE_MARK, '')).filter((l) => l.trim() && !/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(l)).join(' ')).slice(0, 220)

export function ArticleEditor({ initial = null, onSend, onClose }) {
  const saved = useRef((() => { if (initial) return initial; try { return JSON.parse(localStorage.getItem(DRAFT) || 'null') || {} } catch { return {} } })())
  const [title, setTitle] = useState(saved.current.title || '')
  const [text, setText] = useState(saved.current.text || '')
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const ta = useRef(null)
  // an unsent article stays as a draft on this device (not while editing one that was sent)
  useEffect(() => {
    if (initial) return
    try { if (title || text) localStorage.setItem(DRAFT, JSON.stringify({ title, text })); else localStorage.removeItem(DRAFT) } catch { /* private window */ }
  }, [title, text, initial])
  const place = (next, a, b) => { setText(next); requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(a, b) } }) }
  const mark = (m) => { const el = ta.current; if (!el) return; const r = toggleMark(el, text, m); place(r.next, r.caretA, r.caretB) }
  // put a line mark on every chosen line, or take it off when they all have it
  const lineMark = (kind) => {
    const el = ta.current
    if (!el) return
    const a = el.selectionStart
    const b = el.selectionEnd
    const s0 = text.lastIndexOf('\n', a - 1) + 1
    let e0 = text.indexOf('\n', b)
    if (e0 < 0) e0 = text.length
    const lines = text.slice(s0, e0).split('\n')
    const has = { h: /^## /, ul: /^[-•] (?!\[)/, ol: /^\d+\. /, check: /^- \[[ xX]\] /, quote: /^> / }[kind]
    const lead = (n) => ({ h: '## ', ul: '- ', ol: `${n + 1}. `, check: '- [ ] ', quote: '> ' }[kind])
    const all = lines.every((l) => has.test(l))
    const out = lines.map((l, n) => (all ? l.replace(LINE_MARK, '') : lead(n) + l.replace(LINE_MARK, ''))).join('\n')
    place(text.slice(0, s0) + out + text.slice(e0), s0 + out.length, s0 + out.length)
  }
  const divider = () => {
    const el = ta.current
    if (!el) return
    const a = el.selectionStart
    const before = text.slice(0, a)
    const ins = `${before && !before.endsWith('\n') ? '\n' : ''}---\n`
    place(before + ins + text.slice(el.selectionEnd), a + ins.length, a + ins.length)
  }
  // Enter carries a list on; Enter on an empty item ends it
  const onKey = (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && /^[biu]$/i.test(e.key)) { e.preventDefault(); mark({ b: '**', i: '_', u: '__' }[e.key.toLowerCase()]); return }
    if (mod && e.key === 'Enter') { e.preventDefault(); send(); return }
    if (e.key !== 'Enter' || e.shiftKey) return
    const el = e.currentTarget
    const a = el.selectionStart
    if (a !== el.selectionEnd) return
    const s0 = text.lastIndexOf('\n', a - 1) + 1
    const line = text.slice(s0, a)
    const m = /^(- \[[ xX]\] |[-•] |(\d+)\. |> )/.exec(line)
    if (!m) return
    e.preventDefault()
    if (line === m[1]) { place(text.slice(0, s0) + text.slice(a), s0, s0); return }
    const next = m[2] ? `${Number(m[2]) + 1}. ` : m[1].startsWith('- [') ? '- [ ] ' : m[1]
    place(`${text.slice(0, a)}\n${next}${text.slice(a)}`, a + 1 + next.length, a + 1 + next.length)
  }
  const ready = !!(title.trim() && text.trim())
  const send = async () => {
    if (!ready || busy) return
    setBusy(true)
    const ok = await onSend({ title: title.trim().slice(0, 140), text: text.trim() })
    setBusy(false)
    if (ok !== false && !initial) { try { localStorage.removeItem(DRAFT) } catch { /* private window */ } }
  }
  const TOOLS = [
    ['h', 'Heading', I.heading, () => lineMark('h')],
    ['b', 'Bold', <b key="b">B</b>, () => mark('**')],
    ['i', 'Italic', <i key="i">I</i>, () => mark('_')],
    ['u', 'Underline', <u key="u">U</u>, () => mark('__')],
    ['s', 'Strikethrough', <s key="s">S</s>, () => mark('~~')],
    ['ul', 'List', I.bullets, () => lineMark('ul')],
    ['ol', 'Numbered list', I.numbers, () => lineMark('ol')],
    ['check', 'Checklist', I.checklist, () => lineMark('check')],
    ['quote', 'Quote', I.quote, () => lineMark('quote')],
    ['hr', 'Divider', I.divider, divider],
  ]
  return (
    <Modal title={initial ? 'Edit article' : 'Article'} onClose={onClose}>
      <div className="art">
        <div className="art-bar">
          <button type="button" className="art-round" onClick={onClose} aria-label="Close">{I.x}</button>
          <span className="art-tools">
            {TOOLS.map(([k, label, face, run]) => (
              <button key={k} type="button" title={label} aria-label={label} disabled={preview} onMouseDown={(e) => e.preventDefault()} onClick={run}>{face}</button>
            ))}
          </span>
          <button type="button" className={`art-round${preview ? ' on' : ''}`} onClick={() => setPreview((v) => !v)} aria-label="Preview" title="Preview">{I.eye}</button>
          <button type="button" className="art-send" disabled={!ready || busy} onClick={send} aria-label={initial ? 'Save' : 'Send'} title={initial ? 'Save' : 'Send'}>{initial ? I.check : I.send}</button>
        </div>
        {preview ? (
          <div className="art-sheet art-read">
            {title.trim() && <h2>{title.trim()}</h2>}
            {text.trim() ? <ArticleBody text={text} /> : <p className="muted">Nothing written yet.</p>}
          </div>
        ) : (
          <div className="art-sheet">
            <input className="art-title" value={title} onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' ').slice(0, 140))} placeholder="Title" autoFocus={!initial}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ta.current?.focus() } }} />
            <textarea ref={ta} className="art-text" value={text} onChange={(e) => setText(e.target.value.slice(0, 19000))} onKeyDown={onKey} placeholder="Type something…" />
          </div>
        )}
        <small className="art-count">{text.trim() ? `${minutesOf(text)} min read` : 'Headings, lists, checklists, quotes: the buttons above, or # , - , 1. , > at the start of a line.'}</small>
      </div>
    </Modal>
  )
}

/* the article in the chat: its mark, the title as the headline, the first lines, Read */
export function ArticleCard({ title, text, onOpen }) {
  return (
    <span className="trx artc" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen() }} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <span className="trx-head"><span className="rt-mark"><i>{I.article}</i><b><span>Article</span></b></span></span>
      <span className="artc-hero">
        {title && <b>{title}</b>}
        {excerpt(text) && <span>{excerpt(text)}</span>}
      </span>
      <span className="trx-acts">
        <span className="trx-get">{I.article}<span>Read</span></span>
        <span className="artc-min">{minutesOf(text)} min</span>
      </span>
    </span>
  )
}

export function ArticleReader({ title, text, who, at, plain, onClose }) {
  return (
    <Modal title="Article" onClose={onClose} wide>
      <div className="art-read">
        {title && <h2>{title}</h2>}
        <p className="art-meta">{who}{at ? ` · ${new Date(at).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}` : ''} · {minutesOf(text)} min read</p>
        <ArticleBody text={text} plain={plain} />
      </div>
    </Modal>
  )
}
