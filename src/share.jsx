import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lang, locale } from './i18n.js'
import { I, Modal } from './ui.jsx'
import { liveOn, stopLive, useLive } from './live.js'

/* Location, from the send window (Alex, 17 Oct, after Telegram; Article was taken out of the app on 15 Nov).

   Location: a map you move under a pin, a search box, your own position if the computer or phone shares it. It goes
   into the chat as a text message whose `file.location` holds { lat, lng, z, name, addr } (the body is the place's
   name, so list previews and search read it), shown as a small map; a tap opens it big, with Google and Apple Maps.
   The map is OpenStreetMap's own tiles, the names come from OpenStreetMap's Nominatim; both only see the spot on the
   map, never who is looking. */

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

export function LocationPicker({ onSend, onClose, inline = false, onLive }) {
  const [liveAsk, setLiveAsk] = useState(false)
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
  const [acc, setAcc] = useState(0) // how close the phone's own fix is, in metres
  const [findOpen, setFindOpen] = useState(false) // inline: the search opens from its round button
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
      setMine(p); setAcc(pos.coords.accuracy || 0); setAt(p); setZ(16); setNote(''); look(p)
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
  // live: always the phone's own place, never the pin's
  const goLive = (hours) => {
    setLiveAsk(false)
    if (!navigator.geolocation) { setNote('Your location is not shared here.'); return }
    setBusy(true); setNote('Finding you…')
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setNote('')
      await onLive({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6), acc: pos.coords.accuracy || null, hours })
      setBusy(false)
    }, () => { setBusy(false); setNote('Allow RoarMe to use your location to share it live.') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 })
  }
  // inline: the same map as a tab of the attach sheet, no window and no close of its own (Alex, 14 Nov)
  const body = (
      <div className={`loc${inline ? ' loc-inline' : ''}`}>
        <div className="loc-map">
          <MapView at={at} zoom={z} onMove={onMove} onDragging={setLifted} marks={mine ? [{ key: 'me', ...mine, node: <Me /> }] : []} />
          <Pin lifted={lifted} />
          {/* inline, as Telegram's (Alex, 14 Nov): the sheet's own X and title lie over the map, the search is a round
              button at the right that opens the field under them */}
          {inline && <button type="button" className={`loc-round loc-find${findOpen ? ' on' : ''}`} onClick={() => { setFindOpen((v) => !v); setFound(null); setQ('') }} aria-label="Search a place">{findOpen ? I.x : I.search}</button>}
          {(!inline || findOpen) && (
          <div className="loc-top">
            {!inline && <button type="button" className="loc-round" onClick={onClose} aria-label="Close">{I.x}</button>}
            <form className="loc-search" onSubmit={search}>
              {I.search}
              <input autoFocus={inline} value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setFound(null) }} placeholder="Search a place" enterKeyHint="search" />
            </form>
          </div>
          )}
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
        {/* two buttons side by side, the same size (Alex, 15 Nov): Send Location sends the pin's place; Live Location
            asks for how long, then shares the phone's own place as it moves */}
        <div className="loc-foot">
          <small className="loc-where">{isMine && acc ? `Your location · accurate to ${Math.max(1, Math.round(acc))} metres` : looking ? 'Finding the address…' : [place.name, place.addr].filter(Boolean).join(' · ') || coords(at)}</small>
          <div className="loc-acts">
            <button type="button" className="loc-btn go" disabled={busy} onClick={send}>{I.place}<span>Send Location</span></button>
            {onLive && <button type="button" className="loc-btn live" disabled={busy} onClick={() => setLiveAsk(true)}>{LIVE_I}<span>Live Location</span></button>}
          </div>
          {/* over everything, in the middle of the screen (Alex, 15 Nov: inside the sheet it hid under the tab bar) */}
          {liveAsk && createPortal(
            <div className="loc-live-back" onClick={() => setLiveAsk(false)}>
              <div className="menu loc-live-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                <p>Choose for how long people in this chat will see your location as it changes. It moves while RoarMe is open on this phone.</p>
                <hr />
                {LIVE_FOR.map(([h, label]) => <button key={label} type="button" disabled={busy} onClick={() => goLive(h)}><span>{label}</span></button>)}
              </div>
            </div>,
            document.body,
          )}
        </div>
      </div>
  )
  return inline ? body : <Modal title="Location" onClose={onClose}>{body}</Modal>
}

const mapsLinks = (l) => ({
  google: `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`,
  apple: `https://maps.apple.com/?ll=${l.lat},${l.lng}&q=${encodeURIComponent(l.name || 'Location')}`,
})

const LIVE_I = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" /></svg>
const LIVE_FOR = [[0.25, 'For 15 minutes'], [1, 'For 1 hour'], [8, 'For 8 hours'], [null, 'Until I turn it off']]
const agoText = (at) => { const s = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000); return s < 60 ? 'updated just now' : s < 3600 ? `updated ${Math.floor(s / 60)} min ago` : `updated ${Math.floor(s / 3600)} h ago` }

/* a live location in the chat (Alex, 15 Nov): the map follows the sender while it lasts; its sender can stop it */
export function LiveCard({ id, first, mine, onOpen }) {
  const row = useLive(id)
  const on = liveOn(row)
  const loc = row ? { lat: row.lat, lng: row.lng } : first
  const until = row?.until ? new Date(row.until).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : ''
  const sub = !row ? 'Live location' : on ? `${agoText(row.updated_at)} · ${until ? `until ${until}` : mine ? 'until you stop it' : 'until stopped'}` : 'Ended'
  return (
    <span className={`locc live-c${on ? ' on' : ''}`} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen({ ...loc, z: 16, name: 'Live Location', addr: sub }) }}>
      <span className="locc-map"><MapView at={loc} zoom={16} interactive={false} /><Pin small />{on && <i className="live-ping" />}</span>
      <span className="locc-text"><b>Live Location</b><small>{sub}</small></span>
      {mine && on && <button type="button" className="live-stop" onClick={(e) => { e.stopPropagation(); stopLive(id) }}>Stop Sharing</button>}
    </span>
  )
}

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
