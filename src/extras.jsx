import { Suspense, lazy, useEffect, useRef, useState, Component } from 'react'
import { openCamera } from './camera.js'
import { createPortal } from 'react-dom'
import { errText, fileLink, fold, foldHas, lastSeenText, thumbOf, fmtBytes, shrinkImage, supabase, timeOf, picLink } from './lib.js'
import { EMOJIS, haloish, setPrefs, usePrefs } from './prefs.js'
import { ownColor, ownPhoto, photoValue, useWalls, wallUrl } from './walls.js'
import { ColorPick } from './themeEditor.jsx'
import { Avatar, I, Modal, Slide, useLens, useSeen, useSwipeClose, useTabSwipe } from './ui.jsx'
import { AUDIO_EXT, isAudioFile, mmss, player, usePlayer } from './player.jsx'
import { locale } from './i18n.js'
// the photo editor and the map load only when they are opened (lighter start, 15 Nov)
const PollEditor = lazy(() => import('./poll.jsx').then((m) => ({ default: m.PollEditor })))
const PhotoEdit = lazy(() => import('./photoEdit.jsx').then((m) => ({ default: m.PhotoEdit })))
const PhotoSend = lazy(() => import('./photoSend.jsx').then((m) => ({ default: m.PhotoSend })))
// if the full-screen editor ever fails, the sheet's own list of picked photos comes back instead of a white page
class PsGuard extends Component {
  constructor(p) { super(p); this.state = { bad: false } }
  static getDerivedStateFromError() { return { bad: true } }
  componentDidCatch() { this.props.onFail() }
  render() { return this.state.bad ? null : this.props.children }
}
const LocationPicker = lazy(() => import('./share.jsx').then((m) => ({ default: m.LocationPicker })))

/* ---------- emoji grid ---------- */
export function EmojiPicker({ onPick, onClose }) {
  // a press anywhere outside it closes it (Alex, 16 Oct), also on the messages, which sit above the scrim
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('.emoji-btn')) onClose() }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }, [onClose])
  return (
    <>
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
      <div ref={ref} className="emoji-pick">{EMOJIS.map((e) => <button key={e} type="button" onClick={() => onPick(e)}>{e}</button>)}</div>
    </>
  )
}

/* ---------- a photo or video full screen (Alex, 12 Nov: "as the iPhone's Photos"): the whole screen, black; on top
   back, who sent it and when, ⋯ (Save, Share, Open); at the foot Share, the count, Save. Pinch or double tap to zoom,
   drag to move it when zoomed; slide sideways for the next, down to close; a tap hides and shows the bars. ---------- */
const SHOW_I = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A2.5 2.5 0 0 1 4 13.5z" /><path d="M9 10h6M12.5 7.5 15 10l-2.5 2.5" /></svg>
export function MediaViewer({ items, index, onClose, onDelete, onShow, onReply }) {
  const [i, setI] = useState(index)
  const [bars, setBars] = useState(true)
  const [menu, setMenu] = useState(false)
  const [t, setT] = useState({ s: 1, x: 0, y: 0 }) // zoom and pan
  const [d, setD] = useState({ x: 0, y: 0 }) // a slide while not zoomed
  const [live, setLive] = useState(false) // a finger is moving it: no easing
  const pts = useRef(new Map())
  const g = useRef(null)
  const tap = useRef({ at: 0, timer: 0 })
  const it = items[i]
  const isVid = /^video\//.test(it?.type || '')
  const go = (n) => { if (n < 0 || n >= items.length) return; setI(n); setT({ s: 1, x: 0, y: 0 }); setD({ x: 0, y: 0 }) }
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(i - 1)
      if (e.key === 'ArrowRight') go(i + 1)
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [i, items.length, onClose]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(tap.current.timer), [])
  // a video full screen as Telegram's (Alex, 21 Nov): a tap shows or hides the bars, the big play / pause in the middle,
  // the line with both times in a glass capsule, and at the foot PiP and the speed between Share and the bin
  const vref = useRef(null)
  const [vt, setVt] = useState(0)
  const [vd, setVd] = useState(0)
  const [vOn, setVOn] = useState(false)
  const [rate, setRate] = useState(1)
  const vdrag = useRef(false)
  if (!it) return null
  const clampS = (s) => Math.min(5, Math.max(1, s))
  const mid = () => { const [a, b] = [...pts.current.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) } }
  const down = (e) => {
    if (isVid) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setLive(true)
    if (pts.current.size === 2) { const m = mid(); g.current = { mode: 'pinch', d0: m.d || 1, s0: t.s, x0: t.x, y0: t.y, mx: m.x, my: m.y }; setD({ x: 0, y: 0 }) }
    else if (pts.current.size === 1) g.current = { mode: t.s > 1.01 ? 'pan' : 'slide', sx: e.clientX, sy: e.clientY, x0: t.x, y0: t.y, moved: false, axis: '' }
  }
  const move = (e) => {
    if (!pts.current.has(e.pointerId) || !g.current) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const G = g.current
    if (G.mode === 'pinch' && pts.current.size === 2) {
      const m = mid(); const s = clampS(G.s0 * (m.d / G.d0)); const k = s / G.s0
      setT({ s, x: G.x0 * k + (m.x - G.mx), y: G.y0 * k + (m.y - G.my) })
      return
    }
    const dx = e.clientX - G.sx, dy = e.clientY - G.sy
    if (Math.hypot(dx, dy) > 6) G.moved = true
    if (G.mode === 'pan') setT((v) => ({ ...v, x: G.x0 + dx, y: G.y0 + dy }))
    else if (G.mode === 'slide' && G.moved) {
      if (!G.axis) G.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      setD(G.axis === 'x' ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) })
    }
  }
  const up = (e) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.delete(e.pointerId)
    const G = g.current
    if (pts.current.size > 0) { if (G?.mode === 'pinch') { const [p] = [...pts.current.values()]; g.current = { mode: 'pan', sx: p.x, sy: p.y, x0: t.x, y0: t.y, moved: true } } return }
    g.current = null
    setLive(false)
    if (!G) return
    if (G.mode === 'pinch') { if (t.s < 1.05) setT({ s: 1, x: 0, y: 0 }); return }
    if (G.mode === 'slide' && G.moved) {
      if (d.y > 110) { onClose(); return }
      if (d.x < -70 && i < items.length - 1) go(i + 1)
      else if (d.x > 70 && i > 0) go(i - 1)
      setD({ x: 0, y: 0 })
      return
    }
    if (G.moved) return
    // a tap: a second one soon after zooms in or out where it fell, a single one hides or shows the bars
    const now = Date.now()
    if (now - tap.current.at < 300) {
      clearTimeout(tap.current.timer); tap.current.at = 0
      if (t.s > 1.01) setT({ s: 1, x: 0, y: 0 })
      else { const r = e.currentTarget.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; setT({ s: 2.5, x: (cx - e.clientX) * 1.5, y: (cy - e.clientY) * 1.5 }) }
    } else {
      tap.current.at = now
      tap.current.timer = setTimeout(() => { setBars((b) => !b); setMenu(false) }, 300)
    }
  }
  const wheel = (e) => { if (isVid) return; const s = clampS(t.s * (1 - e.deltaY * 0.0025)); setT(s <= 1 ? { s: 1, x: 0, y: 0 } : { ...t, s }) }
  const when = it.at ? new Date(it.at) : null
  const whenText = when ? `${when.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' })} · ${when.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` : ''
  const share = async () => {
    setMenu(false)
    try {
      const blob = await (await fetch(it.url)).blob()
      const file = new File([blob], it.name || (isVid ? 'video.mp4' : 'photo.jpg'), { type: blob.type || it.type })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
    } catch { /* fall back to the link */ }
    try { if (navigator.share) { await navigator.share({ url: it.url }); return } } catch { return }
    window.open(it.url, '_blank', 'noopener')
  }
  const fade = Math.max(0.25, 1 - d.y / 420)
  // save: on a phone through its share sheet (Save Image / Save to Files), on a computer as a download with its name
  const saveIt = async () => {
    try {
      const blob = await (await fetch(it.url)).blob()
      const f = new File([blob], it.name || (/^video\//.test(it.type || '') ? 'video.mp4' : 'photo.jpg'), { type: it.type || blob.type })
      if (navigator.canShare?.({ files: [f] }) && window.matchMedia?.('(pointer: coarse)').matches) { await navigator.share({ files: [f] }); return }
      const u = URL.createObjectURL(f)
      const a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
    } catch (e) { if (e?.name !== 'AbortError') window.open(it.url, '_blank', 'noopener') }
  }
  return (
    <div className={`viewer v2${bars ? '' : ' bare'}`} style={{ '--vw-fade': fade }}>
      <div className="vw-stage" onClick={isVid ? () => setBars((b) => !b) : undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        {isVid
          ? <video ref={vref} key={it.url} className="vw-video" src={it.url} autoPlay playsInline
            onLoadedMetadata={(e) => { const v = e.currentTarget; setVd(Number.isFinite(v.duration) ? v.duration : 0); setVt(0); v.playbackRate = rate }}
            onTimeUpdate={(e) => setVt(e.currentTarget.currentTime)} onPlay={() => setVOn(true)} onPause={() => setVOn(false)} onEnded={() => { setVOn(false); setBars(true) }} />
          : <img key={it.url} src={it.url} alt="" draggable={false} className={t.s > 1.01 ? 'zoomed' : ''}
            style={{ transform: `translate(${t.x + d.x}px, ${t.y + d.y}px) scale(${t.s * (d.y ? 1 - d.y / 1600 : 1)})`, transition: live ? 'none' : undefined }} />}
      </div>
      {isVid && (
        <>
          <button type="button" className="vw-pp" onClick={() => { const v = vref.current; if (v) { if (v.paused) v.play().catch(() => {}); else v.pause() } }} aria-label={vOn ? 'Pause' : 'Play'}>{vOn ? I.pause : I.play}</button>
          <div className="vw-seek">
            <small>{mmssOf(vt)}</small>
            <span className="vw-line" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(vd)} aria-valuenow={Math.round(vt)}
              onPointerDown={(e) => { vdrag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); const r = e.currentTarget.getBoundingClientRect(), v = vref.current; if (v && vd) v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * vd }}
              onPointerMove={(e) => { if (!vdrag.current) return; const r = e.currentTarget.getBoundingClientRect(), v = vref.current; if (v && vd) v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * vd }}
              onPointerUp={() => { vdrag.current = false }} onPointerCancel={() => { vdrag.current = false }}>
              <i style={{ width: `${vd ? Math.min(100, (vt / vd) * 100) : 0}%` }} />
            </span>
            <small>{mmssOf(vd)}</small>
          </div>
        </>
      )}
      <div className="vw-top">
        <button type="button" className="round" onClick={onClose} aria-label="Back">{I.left}</button>
        <div className="vw-title">{(it.who || it.name) && <b>{it.who || it.name}</b>}{whenText && <small>{whenText}</small>}</div>
        <span className="vw-more">
          <button type="button" className={`round${menu ? ' on' : ''}`} onClick={() => setMenu((m) => !m)} aria-label="More">{I.more}</button>
          {menu && (
            <div className="vw-menu">
              {/* as Telegram's (Alex, 15 Nov): Show in Chat, Save, Reply, Delete; nothing that shows the file's address */}
              {onShow && it.m && <button type="button" onClick={() => { setMenu(false); onShow(it.m) }}>{SHOW_I}<span>Show in Chat</span></button>}
              <button type="button" onClick={() => { setMenu(false); saveIt() }}>{I.download}<span>{/^video\//.test(it.type || '') ? 'Save Video' : 'Save Image'}</span></button>
              {onReply && it.m && <button type="button" onClick={() => { setMenu(false); onReply(it.m) }}>{I.reply}<span>Reply</span></button>}
              {onDelete && it.m && <button type="button" className="danger" onClick={() => { setMenu(false); onDelete(it) }}>{I.trash}<span>Delete</span></button>}
            </div>
          )}
        </span>
      </div>
      <div className="vw-foot">
        <button type="button" className="round" onClick={share} aria-label="Share" title="Share">{I.forward}</button>
        {isVid
          ? (
            <span className="vw-vtools">
              <button type="button" onClick={() => { const v = vref.current; if (!v) return; try { if (v.webkitSetPresentationMode) v.webkitSetPresentationMode('picture-in-picture'); else v.requestPictureInPicture?.() } catch { /* none */ } }} aria-label="Picture in Picture" title="Picture in Picture">{PIP_I}</button>
              <button type="button" className="vw-rate" onClick={() => { const r = { 1: 1.5, 1.5: 2, 2: 0.5, 0.5: 1 }[rate] || 1; setRate(r); if (vref.current) vref.current.playbackRate = r }} aria-label={`Speed ${rate}x`} title="Speed">{rate}x</button>
            </span>
          )
          : items.length > 1 ? <span className="vw-count">{i + 1} / {items.length}</span> : <span />}
        {/* the bin where Save was (Alex, 12 Nov); Save is in ⋯. Where nothing can be deleted (the profile's grid), Save stays */}
        {onDelete && it.m
          ? <button type="button" className="round vw-bin" onClick={() => onDelete(it)} aria-label="Delete" title="Delete">{I.trash}</button>
          : <a className="round" href={it.url} download={it.name || true} target="_blank" rel="noreferrer" aria-label="Save" title="Save">{I.download}</a>}
      </div>
      {i > 0 && <button type="button" className="round vw-prev" onClick={() => go(i - 1)} aria-label="Previous">{I.left}</button>}
      {i < items.length - 1 && <button type="button" className="round vw-next" onClick={() => go(i + 1)} aria-label="Next">{I.right}</button>}
    </div>
  )
}

/* ---------- the attach sheet (Alex, 12 Nov, after Telegram's): a sheet from the foot with a bar of tabs at its foot (Gallery,
   File, Location, Audio, Article, Transfer). Gallery and File open the phone's own pickers (a web app cannot list the
   phone's photos itself); File and Audio also list what was sent before, to send again with a tap. Once files are picked
   they show as tiles with the quality, a caption and Send in place of the tabs. ---------- */
const extOf = (name = '') => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] || '').toLowerCase()
const EXT_TINT = { pdf: '#ff3b30', doc: '#2f7cf6', docx: '#2f7cf6', xls: '#34c759', xlsx: '#34c759', csv: '#34c759', ppt: '#ff9500', pptx: '#ff9500', zip: '#8e8e93', mov: '#5856d6', mp4: '#5856d6', png: '#af52de', jpg: '#af52de', jpeg: '#af52de', heic: '#af52de', mp3: '#ff2d55', wav: '#ff2d55', m4a: '#ff2d55', drp: '#00a1e4' }
const whenSent = (at) => { const d = new Date(at); return `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` }
function RecentRow({ m, onPick }) {
  const f = m.file || {}
  const ext = extOf(f.name) || (m.kind === 'image' ? 'jpg' : '')
  return (
    <button type="button" className="as-row as-recent" onClick={() => onPick(m)}>
      <i className="as-ext" style={{ '--tint': EXT_TINT[ext] || '#8e8e93' }}>{isAudioFile(f) ? I.play : ext ? <b>{ext.slice(0, 4)}</b> : I.file}</i>
      <span className="as-text"><b>{f.name || (m.kind === 'image' ? 'Photo' : 'File')}</b><small>{fmtBytes(f.size)} · {whenSent(m.created_at)}</small></span>
    </button>
  )
}
// a big choice in the sheet: its sign in a coloured circle, a title and a line under it
const AsTile = ({ icon, title, sub, onClick, wide = false }) => (
  <button type="button" className={`as-tile${wide ? ' wide' : ''}`} onClick={onClick}><i>{icon}</i><b>{title}</b><small>{sub}</small></button>
)
// a photo or video sent before, as a little square
function AsThumb({ m, busy, onPick }) {
  const [ref, seen] = useSeen()
  const [url, setUrl] = useState('')
  const vid = /^video\//.test(m.file?.type || '')
  useEffect(() => { if (!seen) return undefined; let alive = true; picLink(thumbOf(m.file)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path, seen])
  return (
    <button ref={ref} type="button" className={`as-thumb${busy ? ' busy' : ''}`} onClick={() => onPick(m)} aria-label={m.file?.name || 'Photo'}>
      {url && (vid && !m.file?.thumb ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" loading="lazy" />)}
      {vid && <i className="as-thumb-play">{I.play}</i>}
    </button>
  )
}
// Transfer and Contact stand inside the sheet as tabs too (Alex, 15 Nov, as Telegram's; Article was taken out of the
// app the same night): transferSlot (a ref callback: RoarTransfer's window stands in it), onContact(person) with contacts
// the sheet's tabs in the same hand as the chat's own foot menu (Alex, 15 Nov: "make them beautiful, like our chat"):
// filled shapes, the holes cut out (even-odd), 22px
const asSolid = (d) => <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" fillRule="evenodd" clipRule="evenodd" aria-hidden="true"><path d={d} /></svg>
const AS_I = {
  gallery: asSolid('M6.5 3.5h11a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3zM15.6 7a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM5.5 17.2l3.9-4.6a1.2 1.2 0 0 1 1.8 0l2.4 2.7 1.3-1.4a1.2 1.2 0 0 1 1.8 0l2.8 3.1V17.5a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1z'),
  file: asSolid('M7 2.5h6.4c.5 0 1 .2 1.4.6l4.6 4.6c.4.4.6.9.6 1.4V19a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 19V5A2.5 2.5 0 0 1 7 2.5zM13.5 4v3.6c0 .6.5 1.1 1.1 1.1h3.6zM8 13h8v1.6H8zM8 16.4h5.5V18H8z'),
  location: asSolid('M12 2.2a7.6 7.6 0 0 1 7.6 7.6c0 5.3-6.1 11.2-6.9 11.9a1 1 0 0 1-1.4 0c-.8-.7-6.9-6.6-6.9-11.9A7.6 7.6 0 0 1 12 2.2zM12 6.9a2.9 2.9 0 1 0 0 5.8 2.9 2.9 0 0 0 0-5.8z'),
  audio: asSolid('M19.5 3.2v12.3a3.2 3.2 0 1 1-1.8-2.9V7.4l-8.4 1.9v8.3a3.2 3.2 0 1 1-1.8-2.9V6.3c0-.6.4-1.1 1-1.2l9.8-2.3c.6-.1 1.2.3 1.2.9z'),
  contact: asSolid('M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM3 21a9 9 0 0 1 18 0z'),
  poll: asSolid('M6 3.5h12A2.5 2.5 0 0 1 20.5 6v12a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5zM7.6 11.2a1.1 1.1 0 0 0-1.1 1.1v4.2a1.1 1.1 0 0 0 2.2 0v-4.2a1.1 1.1 0 0 0-1.1-1.1zM12 6.8a1.1 1.1 0 0 0-1.1 1.1v8.6a1.1 1.1 0 0 0 2.2 0V7.9A1.1 1.1 0 0 0 12 6.8zM16.4 13.4a1.1 1.1 0 0 0-1.1 1.1v2a1.1 1.1 0 0 0 2.2 0v-2a1.1 1.1 0 0 0-1.1-1.1z'),
  camera: asSolid('M9.2 4h5.6c.5 0 1 .3 1.3.7l1 1.6H19a2.5 2.5 0 0 1 2.5 2.5v8.7A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V8.8A2.5 2.5 0 0 1 5 6.3h1.9l1-1.6c.3-.4.8-.7 1.3-.7zM12 8.6a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6zm0 2a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6z'),
  transfer: asSolid('M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zM11.2 7.2l-4 4a1.1 1.1 0 0 0 1.6 1.6l2.1-2.1V16a1.1 1.1 0 0 0 2.2 0v-5.3l2.1 2.1a1.1 1.1 0 0 0 1.6-1.6l-4-4a1.1 1.1 0 0 0-1.6 0z'),
}

/* ---------- the phone's own photo library inside the sheet (Alex, 15 Nov, as Telegram's: the paperclip opens the
   photos at once, the camera first; picked ones go lighter). Only inside the iPhone app, through the native plugin
   @capacitor-community/media (mobile/package.json), reached over Capacitor's bridge since the site does not carry
   @capacitor/core. A web page cannot read the photo library, so the web keeps the tiles that open the system picker. */
const mediaCall = () => {
  const C = typeof window !== 'undefined' && window.Capacitor
  if (!C?.isNativePlatform?.() || !C.nativePromise) return null
  return (m, o = {}) => C.nativePromise('Media', m, o)
}
const LIB_STEP = 60
const mmssOf = (s) => `${Math.floor((s || 0) / 60)}:${String(Math.round(s || 0) % 60).padStart(2, '0')}`
const EXT_TYPE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', webp: 'image/webp', mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v' }
// the whole photo or video, as a File the sheet can send (a HEIC photo becomes a JPEG on the way)
async function libFile(asset, n) {
  const call = mediaCall()
  const C = window.Capacitor
  const r = await call('getMediaByIdentifier', { identifier: asset.identifier })
  const src = C.convertFileSrc ? C.convertFileSrc(r.path) : r.path
  const blob = await (await fetch(src)).blob()
  const ext = (/\.([a-z0-9]+)(?:\?|$)/i.exec(r.path)?.[1] || (asset.duration ? 'mov' : 'jpg')).toLowerCase()
  const type = EXT_TYPE[ext] || blob.type || (asset.duration ? 'video/quicktime' : 'image/jpeg')
  let file = new File([blob], `${asset.duration ? 'VID' : 'IMG'}_${Date.now()}_${n}.${ext}`, { type })
  if (/^image\/hei[cf]$/.test(type)) file = await shrinkImage(file, 2048, 0.85)
  return file
}
function LibraryGrid({ picked, onPick, onOpen, onCamera, onFail }) {
  const [items, setItems] = useState(null)
  const [want, setWant] = useState(LIB_STEP)
  const end = useRef(null)
  useEffect(() => {
    const call = mediaCall()
    if (!call) { onFail(); return undefined }
    let alive = true
    call('getMedias', { quantity: want, thumbnailWidth: 300, thumbnailHeight: 300, thumbnailQuality: 65, types: 'all' })
      .then((r) => { if (alive) setItems(r?.medias || []) })
      .catch(() => { if (alive) onFail() })
    return () => { alive = false }
  }, [want]) // eslint-disable-line react-hooks/exhaustive-deps
  // more as the end comes into sight
  useEffect(() => {
    const el = end.current
    if (!el || !items || items.length < want || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setWant((w) => w + LIB_STEP) }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [items, want])
  return (
    <div className="lib-grid">
      <button type="button" className="lib-cell lib-cam" onClick={onCamera} aria-label="Camera">{I.camera}<span>Camera</span></button>
      {(items || []).map((a) => {
        const n = picked.findIndex((p) => p.identifier === a.identifier)
        return (
          <button key={a.identifier} type="button" className={`lib-cell${n >= 0 ? ' on' : ''}`} onClick={() => (onOpen ? onOpen(a) : onPick(a))} aria-label={a.duration ? 'Video' : 'Photo'}>
            <img src={`data:image/jpeg;base64,${a.data}`} alt="" loading="lazy" decoding="async" draggable={false} />
            {a.duration ? <small className="lib-dur">{mmssOf(a.duration)}</small> : null}
            <i className="lib-ring" role="button" aria-label={n >= 0 ? 'Unselect' : 'Select'} onClick={(e) => { e.stopPropagation(); onPick(a) }}>{n >= 0 ? n + 1 : ''}</i>
          </button>
        )
      })}
      {!items && Array.from({ length: 11 }, (_, k) => <span key={k} className="lib-cell lib-ghost" />)}
      <span ref={end} className="lib-end" />
    </div>
  )
}

// a file sent before, as Telegram's list: its picture (or its kind), the name, the size and when
function RecentFile({ m, onPick }) {
  const f = m.file || {}
  const [ref, seen] = useSeen()
  const [url, setUrl] = useState('')
  const ext = extOf(f.name) || ''
  useEffect(() => { if (!seen || !f.thumb) return undefined; let alive = true; picLink(thumbOf(f)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [seen, f.thumb])
  return (
    <button ref={ref} type="button" className="as-row as-recent" onClick={() => onPick(m)}>
      {url ? <i className="as-ext as-rthumb"><img src={url} alt="" loading="lazy" /></i>
        : <i className="as-ext" style={{ '--tint': EXT_TINT[ext] || '#8e8e93' }}>{ext ? <b>{ext.slice(0, 4)}</b> : I.file}</i>}
      <span className="as-text"><b>{f.name || 'File'}</b><small>{fmtBytes(f.size)} · {whenSent(m.created_at)}</small></span>
    </button>
  )
}
// the File tab's three ways in, as Telegram's: line signs and words in the accent
const FT_I = {
  gallery: <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="15.5" cy="9.5" r="1.6" /><path d="M4 17l4.6-4.6a1.4 1.4 0 0 1 2 0L16 17.8M13.5 15.3l1.6-1.6a1.4 1.4 0 0 1 2 0L20 16.6" /></svg>,
  files: <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.6 9.1 4.7 4.7 0 0 0 7 18.5z" /></svg>,
  scan: <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16" /><path d="M9 7.5h4l2.5 2.5v6.5H9z" /><path d="M13 7.5V10h2.5" /></svg>,
}

function ContactPick({ contacts, who, setWho, searching, onContact }) {
  const box = useRef(null)
  const name = (p) => p.display_name || `@${p.username}`
  const q = who.trim()
  const list = (contacts || []).filter((p) => !q || foldHas(`${p.display_name || ''} ${p.username || ''}`, q))
  const groups = []
  list.forEach((p) => {
    const l = (fold(name(p).replace(/^@/, '')).charAt(0) || '#').toUpperCase()
    const g = groups[groups.length - 1]
    if (g && g.l === l) g.list.push(p); else groups.push({ l, list: [p] })
  })
  const jump = (l) => box.current?.querySelector(`[data-letter="${CSS.escape(l)}"]`)?.scrollIntoView({ block: 'start' })
  return (
    <div className="cp" ref={box}>
      {searching && <label className="search as-search">{I.search}<input autoFocus value={who} onChange={(e) => setWho(e.target.value)} placeholder="Search contacts" /></label>}
      {!q && groups.length > 1 && <div className="cp-index"><div>{groups.map((g) => <button key={g.l} type="button" onClick={() => jump(g.l)}>{g.l}</button>)}</div></div>}
      {!list.length && <p className="as-empty"><span>{q ? 'No one by that name.' : 'No contacts yet.'}</span></p>}
      {groups.map((g) => (
        <div key={g.l} className="cp-group">
          <small className="cp-letter" data-letter={g.l}>{g.l}</small>
          <div className="as-card cp-card">
            {g.list.map((p) => (
              <button key={p.id} type="button" className="cp-row" onClick={() => onContact(p)}>
                <Avatar src={p.avatar_url} name={name(p)} size={40} />
                <span className="cp-text"><span className="cp-name">{name(p)}</span><small>{lastSeenText(p) || `@${p.username}`}</small></span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function AttachSheet({ initial = [], meId, onResend, onClose, onSend, onTransfer, onLocation, onLive, onPoll, transferSlot, contacts, onContact }) {
  const [files, setFiles] = useState(initial)
  const [caption, setCaption] = useState('')
  // the Gallery tab (and the camera) sends photos and videos made lighter; the File tab sends anything exactly as it is,
  // shown in the chat as a file to download (Alex, 15 Nov). asFile is set by where the first ones were picked
  const [pickedRaw, setAsFile] = useState(false)
  const [tab, setTab] = useState('gallery')
  const [recent, setRecent] = useState(null)
  const [sending, setSending] = useState('')
  const [edit, setEdit] = useState(-1) // the photo being touched up before it is sent
  const [lib, setLib] = useState(() => !!mediaCall()) // the photo library inside the sheet (iPhone app)
  const [libPicked, setLibPicked] = useState([])
  const [libBusy, setLibBusy] = useState(false)
  const [fileQ, setFileQ] = useState(null) // the File tab's search, null while closed
  const [pollOut, setPollOut] = useState(null) // the poll editor's finished poll, null while it is not complete
  const [pollBusy, setPollBusy] = useState(false)
  const sendPoll = async () => { if (!pollOut || pollBusy) return; setPollBusy(true); const ok = await onPoll(pollOut()); setPollBusy(false); if (ok !== false) onClose() }
  const pickLib = (a) => setLibPicked((l) => (l.some((x) => x.identifier === a.identifier) ? l.filter((x) => x.identifier !== a.identifier) : [...l, a]))
  const sendLib = async () => {
    if (libBusy || !libPicked.length) return
    setLibBusy(true)
    try {
      const got = []
      for (let k = 0; k < libPicked.length; k++) got.push(await libFile(libPicked[k], k)) // eslint-disable-line no-await-in-loop
      onSend(got, caption.trim(), true, false)
    } catch { setLibBusy(false); setLib(false) }
  }
  // a tap on a photo of the library opens it full screen with the ones picked (Alex, 21 Nov: the editor as Telegram's)
  const [psStart, setPsStart] = useState(0)
  const [psOff, setPsOff] = useState(false)
  const openLib = async (a) => {
    if (libBusy) return
    const list = libPicked.some((x) => x.identifier === a.identifier) ? libPicked : [...libPicked, a]
    setLibBusy(true)
    try {
      const got = []
      for (let k = 0; k < list.length; k++) got.push(await libFile(list[k], k))
      setAsFile(false); setPsStart(list.findIndex((x) => x.identifier === a.identifier)); setFiles(got)
    } catch { setLib(false) }
    setLibBusy(false)
  }
  // the sheet is pulled down by its top to close, and a slide left or right goes from Gallery to File to Audio
  const sheetRef = useRef(null)
  const bodyRef = useRef(null)
  useSwipeClose(sheetRef, onClose, 'y', edit)
  const [who, setWho] = useState('')
  const [whoOpen, setWhoOpen] = useState(false)
  // the tab bar is the chat's own menu at the foot: its glass, icon over word, the lens in GLASS TRAVEL (Alex, 15 Nov)
  const tabsLens = useLens(`${tab}|${files.length > 0}`)
  useTabSwipe(bodyRef, ['gallery', 'file', onTransfer && 'transfer', onLocation && 'location', onPoll && 'poll', 'audio', onContact && 'contact'].filter(Boolean), tab, setTab, `${edit}|${files.length > 0}`)
  const gal = useRef(null)
  const cam = useRef(null)
  // RoarMe's own camera in the iPhone app (camera.js), else the system's through the file input
  const camera = async (asScan = false) => {
    const r = await openCamera(asScan ? { only: 'photo' } : {})
    if (r === undefined) { (asScan ? scan : cam).current?.click(); return }
    if (r === 'gallery') { if (lib) setTab('gallery'); else gal.current?.click(); return }
    if (r) add([r], asScan)
  }
  const doc = useRef(null)
  const galRaw = useRef(null)
  const scan = useRef(null) // Scan Document: the camera, the picture sent as a file, untouched
  const aud = useRef(null)
  const touchOnly = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
  const add = (list, raw) => { if (!files.length) setAsFile(!!raw); setFiles((f) => [...f, ...list]) }
  const urls = useRef(new Map())
  const thumb = (f) => {
    if (!/^(image|video)\//.test(f.type)) return ''
    if (!urls.current.has(f)) urls.current.set(f, URL.createObjectURL(f))
    return urls.current.get(f)
  }
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k) }, [onClose])
  // what was sent before, in the chats one is in (the database gives only those): one's own files, and every sound file
  useEffect(() => {
    if (recent) return
    supabase.from('roar_messages').select('id, room_id, user_id, kind, body, file, created_at').in('kind', ['file', 'image']).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => {
        const live = (data || []).filter((m) => m.file?.path && !(m.file?.expires && new Date(m.file.expires) < new Date()))
        const seen = new Set()
        const once = (m) => { const k = `${m.file.name}|${m.file.size}`; if (seen.has(k)) return false; seen.add(k); return true }
        const audio = live.filter((m) => isAudioFile(m.file)).filter(once)
        seen.clear()
        // files sent as files (Alex, 15 Nov: "the recents do not show"): anything from the File tab, raw photos and
        // videos too, but not the Gallery's photos and videos, which wait in the Gallery tab
        const asFileMsg = (m) => m.kind === 'file' && !m.file?.round && !isAudioFile(m.file) && (m.file?.asFile || !/^(image|video)\//.test(m.file?.type || ''))
        const mine = live.filter((m) => m.user_id === meId && asFileMsg(m)).filter(once).slice(0, 40)
        const photos = live.filter((m) => m.user_id === meId && (m.kind === 'image' || /^(image|video)\//.test(m.file?.type || '')) && !m.file?.round).filter(once).slice(0, 30)
        setRecent({ mine, audio: audio.slice(0, 40), photos })
      })
  }, [tab, recent, meId])
  const pick = async (m) => { if (!onResend || sending) return; setSending(m.id); const ok = await onResend(m); setSending(''); if (ok !== false) onClose() }
  const TABS = [
    // Gallery and File are one tab with Photos | Files at its top, and the Camera in File's place, opening the camera at
    // once (Alex, 21 Nov)
    ['gallery', 'Gallery', AS_I.gallery],
    ['camera', 'Camera', AS_I.camera],
    // RoarTransfer third (Alex, 20 Nov)
    onTransfer && ['transfer', 'Transfer', AS_I.transfer],
    onLocation && ['location', 'Location', AS_I.location],
    onPoll && ['poll', 'Poll', AS_I.poll],
    ['audio', 'Audio', AS_I.audio],
    onContact && ['contact', 'Contact', AS_I.contact],
  ].filter(Boolean)
  const go = (k) => { if (k === 'camera') { camera(); return } setTab(k) }
  // RoarTransfer opens in the sheet's body when its tab is chosen
  useEffect(() => { if (tab === 'transfer' && !files.length) onTransfer?.() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const title = files.length ? `${files.length} selected` : tab === 'poll' ? 'New Poll' : (tab === 'file' ? 'Gallery' : TABS.find(([k]) => k === tab)?.[1]) || 'Send'
  const asFile = pickedRaw || (tab === 'file' && files.length > 0) // anything picked while on the File tab goes raw
  const big = files.filter((f) => f.size > 50e6 && !(!asFile && /^video\//.test(f.type)))
  const list = recent ? (tab === 'audio' ? recent.audio : recent.mine) : null
  // photos and videos from the Gallery (or the library) go through the full-screen editor before they are sent
  if (!psOff && files.length > 0 && !asFile && files.every((f) => /^(image|video)\//.test(f.type || ''))) {
    return <PsGuard onFail={() => setPsOff(true)}><Suspense fallback={null}><PhotoSend files={files} start={psStart} caption={caption} setCaption={setCaption}
      onBack={() => { setFiles([]); setPsStart(0) }}
      onReplace={(i, nf) => setFiles((l) => l.map((x, k) => (k === i ? nf : x)))}
      onSend={(kept, compress) => onSend(kept, caption.trim(), compress, false)} /></Suspense></PsGuard>
  }
  if (edit >= 0 && files[edit]) return <Suspense fallback={null}><PhotoEdit file={files[edit]} onClose={() => setEdit(-1)} onDone={(nf) => { setFiles((l) => l.map((x, k) => (k === edit ? nf : x))); setEdit(-1) }} /></Suspense>
  return createPortal(
    <div className="as-back" onClick={onClose}>
      <div ref={sheetRef} className={`as-sheet${tab === 'location' && !files.length ? ' as-loc' : ''}${(tab === 'transfer' || tab === 'poll' || (tab === 'gallery' && lib)) && !files.length ? ' as-tall' : ''}${tab === 'gallery' && lib && !files.length ? ' as-lib' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <i className="as-grab" data-grab="" aria-hidden="true" />
        <div className={`as-head${tab === 'poll' && !files.length ? ' pl-head' : ''}`} data-grab="">
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
          <b>{title}</b>
          {tab === 'poll' && !files.length
            ? <button type="button" className={`pill-btn pl-send${pollOut ? ' on' : ''}`} disabled={!pollOut || pollBusy} onClick={sendPoll}>Send</button>
            : tab === 'contact' && !files.length
            ? <button type="button" className="round" onClick={() => { setWhoOpen((v) => !v); setWho('') }} aria-label="Search contacts">{whoOpen ? I.x : I.search}</button>
            : tab === 'file' && !files.length
            ? <button type="button" className="round" onClick={() => setFileQ((q) => (q === null ? '' : null))} aria-label="Search files">{fileQ === null ? I.search : I.x}</button>
            : <span className="as-head-pad" />}
        </div>
        <div className="as-body" ref={bodyRef}>
          {!files.length && (tab === 'gallery' || tab === 'file') && (
            // what is picked goes as a photo (lighter, through the editor) or as a file (exactly as it is)
            <div className={`as-seg${tab === 'file' ? ' r' : ''}`} role="tablist">
              <i className="as-seg-lens" aria-hidden="true" />
              <button type="button" role="tab" aria-selected={tab === 'gallery'} className={tab === 'gallery' ? 'on' : ''} onClick={() => setTab('gallery')}>Photos</button>
              <button type="button" role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>Files</button>
            </div>
          )}
          {files.length > 0 ? (
            <>
              <div className="attach-grid">
                {files.map((f, n) => (
                  <span key={n} className="attach-item">
                    {/^image\//.test(f.type) ? <img src={thumb(f)} alt="" onClick={() => !asFile && !/gif/.test(f.type) && setEdit(n)} /> : /^video\//.test(f.type) ? <video src={thumb(f)} muted /> : <span className="attach-doc">{I.file}<small>{f.name}</small></span>}
                    {/^video\//.test(f.type) && <i className="attach-play">{I.play}</i>}
                    <small className="attach-size">{fmtBytes(f.size)}</small>
                    {/^image\//.test(f.type) && !/gif/.test(f.type) && !asFile && <i className="attach-edit" onClick={() => setEdit(n)} role="button" aria-label="Edit Photo">{I.edit}</i>}
                    <button type="button" onClick={() => setFiles((l) => l.filter((_, k) => k !== n))} aria-label="Remove">{I.x}</button>
                  </span>
                ))}
                <button type="button" className="attach-more" onClick={() => (asFile ? doc : gal).current?.click()} aria-label="Add more">{I.plus}</button>
              </div>
              {asFile && <small className="muted attach-raw">Sent as files, exactly as they are.</small>}
              {big.length > 0 && <small className="attach-transfer">{big.length === 1 ? 'Over 50 MB: it goes by RoarTransfer, up to 3 GB, kept 3 days.' : `${big.length} files over 50 MB go by RoarTransfer, kept 3 days.`}</small>}
            </>
          ) : tab === 'transfer' && onTransfer ? (
            <div className="as-transfer" ref={transferSlot} />
          ) : tab === 'contact' && onContact ? (
            // as Telegram's (Alex, 15 Nov: "thin, small letters, not chunky"): people under their letter, each group a
            // card of slim rows (picture, name, last seen), the letters down the right side to jump; a tap sends
            <ContactPick contacts={contacts} who={who} setWho={setWho} searching={whoOpen} onContact={onContact} />
          ) : tab === 'location' && onLocation ? (
            // Location is a tab of the sheet like the others (Alex, 14 Nov: it popped a window of its own and the sheet was gone)
            <Suspense fallback={<div className="loc loc-inline" />}><LocationPicker inline onSend={onLocation} onLive={onLive} onClose={onClose} /></Suspense>
          ) : tab === 'poll' && onPoll ? (
            <Suspense fallback={null}><PollEditor onReady={(fn) => setPollOut(() => fn)} /></Suspense>
          ) : tab === 'gallery' && lib ? (
            <LibraryGrid picked={libPicked} onPick={pickLib} onOpen={openLib} onCamera={() => camera()} onFail={() => setLib(false)} />
          ) : tab === 'gallery' ? (
            <>
              <div className="as-tiles">
                <AsTile icon={I.image} title="Photos and Videos" sub="From your library" onClick={() => gal.current?.click()} />
                {touchOnly
                  ? <AsTile icon={I.camera} title="Camera" sub="Take one now" onClick={() => camera()} />
                  : <AsTile icon={I.file} title="Files" sub="From this computer" onClick={() => doc.current?.click()} />}
              </div>
              {recent?.photos?.length > 0 && (
                <>
                  <small className="as-label">Sent lately · tap to send again</small>
                  <div className="as-grid">{recent.photos.map((m) => <AsThumb key={m.id} m={m} busy={sending === m.id} onPick={pick} />)}</div>
                </>
              )}
              {recent && !recent.photos.length && <p className="as-empty">{I.image}<span>The photos and videos you send will wait here, to send again with a tap.</span></p>}
            </>
          ) : (
            <>
              {tab === 'audio' ? (
                <div className="as-tiles"><AsTile wide icon={I.play} title="Choose a Sound File" sub="MP3, WAV, M4A, FLAC and the rest" onClick={() => aud.current?.click()} /></div>
              ) : fileQ !== null ? (
                <label className="search as-search">{I.search}<input autoFocus value={fileQ} onChange={(e) => setFileQ(e.target.value)} placeholder="Search sent files" /></label>
              ) : (
                // as Telegram's (Alex, 15 Nov): three ways in, each sent exactly as it is
                <div className="as-card as-ways">
                  <button type="button" className="as-row as-way" onClick={() => galRaw.current?.click()}>{FT_I.gallery}<span>Select from Gallery</span></button>
                  <button type="button" className="as-row as-way" onClick={() => doc.current?.click()}>{FT_I.files}<span>Select from Files</span></button>
                  {touchOnly && <button type="button" className="as-row as-way" onClick={() => camera(true)}>{FT_I.scan}<span>Scan Document</span></button>}
                </div>
              )}
              <small className="as-label">{tab === 'audio' ? 'Sound in your chats' : 'Recently sent files'}</small>
              <div className="as-card">
                {!list && <span className="as-row as-wait">Loading…</span>}
                {list && !list.length && <span className="as-row as-wait">{tab === 'audio' ? 'No sound files in your chats yet.' : 'Files you send from here will wait here, to send again with a tap.'}</span>}
                {tab === 'audio'
                  ? list?.map((m) => <RecentRow key={m.id} m={m} onPick={pick} />)
                  : list?.filter((m) => !fileQ || foldHas(m.file?.name || "", fileQ)).map((m) => <RecentFile key={m.id} m={m} onPick={pick} />)}
              </div>
            </>
          )}
        </div>
        {!files.length && tab === 'gallery' && lib && libPicked.length > 0 ? (
          <div className="as-send">
            <input className="input attach-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" />
            <button type="button" className={`round send ready attach-send${libBusy ? ' busy' : ''}`} disabled={libBusy} onClick={sendLib} aria-label={`Send ${libPicked.length}`} title="Send">{I.send}<b className="lib-count">{libPicked.length}</b></button>
          </div>
        ) : files.length > 0 ? (
          <div className="as-send">
            <input className="input attach-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" />
            <button type="button" className="round send ready attach-send" onClick={() => onSend(files, caption.trim(), !asFile, asFile)} aria-label="Send" title="Send">{I.send}</button>
          </div>
        ) : (
          <nav ref={tabsLens} className="as-tabs lens" data-travel="">
            {TABS.map(([k, label, ico]) => <button key={k} type="button" className={tab === k || (k === 'gallery' && tab === 'file') ? 'on' : ''} onClick={() => go(k)}>{ico}<span>{label}</span></button>)}
          </nav>
        )}
        <input ref={gal} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
        <input ref={cam} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
        <input ref={doc} type="file" multiple hidden onChange={(e) => { add([...(e.target.files || [])], tab === 'file' || asFile); e.target.value = '' }} />
        <input ref={scan} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add([...(e.target.files || [])], true); e.target.value = '' }} />
        <input ref={galRaw} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add([...(e.target.files || [])], true); e.target.value = '' }} />
        <input ref={aud} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.aif,.aiff,.ogg,.opus" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
      </div>
    </div>,
    document.body,
  )
}

/* ---------- a song or any sound file (mp3, wav, m4a…): a small player in the message (Alex, 16 Oct) ---------- */
export { AUDIO_EXT, isAudioFile }
/* a song in a chat plays in the app's one player (player.jsx), so it goes on when you change chat */
export function MusicTile({ file, from = '', roomId = '' }) {
  const [url, setUrl] = useState('')
  const p = usePlayer()
  useEffect(() => { let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  const key = file?.path || file?.name || ''
  const mine = p.key === key
  const playing = mine && p.playing
  const at = mine ? p.at : 0
  const dur = mine ? p.dur : 0
  const bad = mine && p.bad
  const title = (file?.name || 'Audio').replace(AUDIO_EXT, '')
  const ext = ((file?.name || '').match(AUDIO_EXT) || [])[1]?.toUpperCase() || 'AUDIO'
  const toggle = (e) => { e.stopPropagation(); if (url) player.toggle({ key, url, title, from, roomId, file }) }
  const seek = (e) => {
    e.stopPropagation()
    if (!mine || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    player.seek((e.clientX - r.left) / r.width)
  }
  return (
    <span className="music" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`music-btn${playing ? ' on' : ''}`} disabled={!url} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? I.pause : I.play}</button>
      <span className="music-main">
        <span className="music-top"><b title={file?.name}>{title}</b><small>{bad ? 'Cannot play here' : `${ext} · ${fmtBytes(file?.size)}`}</small></span>
        <span className="music-bar" onClick={seek}><i style={{ width: `${dur ? Math.min(100, (at / dur) * 100) : 0}%` }} /></span>
        <span className="music-time"><small>{mmss(at)}</small><small>{dur ? mmss(dur) : '–:––'}</small></span>
      </span>
      {url && <a className="music-dl" href={url} download={file?.name} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Download">{I.download}</a>}
    </span>
  )
}

/* ---------- a voice message ---------- */
/* The voice message's waveform (Alex, 8 Nov: "minimal and beautiful"): 40 levels, from the recording itself when it is
   sent (file.peaks), else worked out once from the sound and kept on the device. If the sound cannot be read here,
   a calm shape of its own, the same every time for the same file. */
export const PEAKS = 40
export async function peaksOf(data, n = PEAKS) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext
  if (!Ctx) return null
  const ac = new Ctx(1, 1, 44100)
  const buf = await new Promise((ok, bad) => { const p = ac.decodeAudioData(data, ok, bad); if (p?.then) p.then(ok, bad) })
  const ch = buf.getChannelData(0)
  const step = Math.max(1, Math.floor(ch.length / n))
  const out = []
  for (let i = 0; i < n; i++) {
    let sum = 0, cnt = 0
    for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j += 16) { sum += ch[j] * ch[j]; cnt++ }
    out.push(cnt ? Math.sqrt(sum / cnt) : 0)
  }
  const top = Math.max(...out, 1e-4)
  return out.map((v) => Math.round(Math.max(0.1, Math.sqrt(v / top)) * 100) / 100)
}
const PEAKS_KEY = 'roarme-peaks'
const peakCache = (() => { try { return JSON.parse(localStorage.getItem(PEAKS_KEY) || '{}') } catch { return {} } })()
const keepPeaks = (k, v) => {
  peakCache[k] = v
  try {
    const keys = Object.keys(peakCache)
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((x) => delete peakCache[x])
    localStorage.setItem(PEAKS_KEY, JSON.stringify(peakCache))
  } catch { /* full or private */ }
}
const calmPeaks = (seed = '') => {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return Array.from({ length: PEAKS }, (_, i) => { h = Math.imul(h ^ i, 16777619); const r = ((h >>> 0) % 1000) / 1000; return Math.round((0.25 + 0.55 * Math.abs(Math.sin(i / 3.2)) * (0.6 + 0.4 * r)) * 100) / 100 })
}
function usePeaks(file, url) {
  const key = file?.path || ''
  const [peaks, setPeaks] = useState(() => (Array.isArray(file?.peaks) && file.peaks.length ? file.peaks : peakCache[key] || null))
  useEffect(() => {
    if (peaks || !url) return undefined
    let alive = true
    fetch(url).then((r) => r.arrayBuffer()).then((b) => peaksOf(b)).then((p) => {
      const v = p || calmPeaks(key)
      if (p) keepPeaks(key, v)
      if (alive) setPeaks(v)
    }).catch(() => { if (alive) setPeaks(calmPeaks(key)) })
    return () => { alive = false }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return peaks || calmPeaks(key)
}

export function AudioNote({ file }) {
  const [url, setUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const a = useRef(null)
  useEffect(() => { let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  // one sound at a time: a song or another voice message starting pauses this one
  useEffect(() => {
    const stop = (e) => { if (e.detail !== a.current && a.current && !a.current.paused) a.current.pause() }
    window.addEventListener('roarme-play', stop)
    return () => window.removeEventListener('roarme-play', stop)
  }, [])
  const dur = file?.dur || a.current?.duration || 0
  const peaks = usePeaks(file, url)
  return (
    <span className="voice">
      <button type="button" className="voice-btn" disabled={!url} onClick={(e) => { e.stopPropagation(); const el = a.current; if (!el) return; if (el.paused) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: el })); el.play() } else el.pause() }}>{playing ? I.pause : I.play}</button>
      <span className="voice-wave" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(at)} onClick={(e) => { e.stopPropagation(); const el = a.current; if (!el || !dur) return; const r = e.currentTarget.getBoundingClientRect(); el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur }}>
        {peaks.map((v, i) => <i key={i} className={dur && (i + 0.5) / peaks.length <= at / dur ? 'on' : ''} style={{ height: `${Math.round(v * 100)}%` }} />)}
      </span>
      <small>{mmss(playing || at ? at : dur)}</small>
      {url && <audio ref={a} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0) }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} />}
    </span>
  )
}

/* ---------- a video in a bubble ---------- */
/* Every video, sent or linked, has two buttons on it (Alex, 16 Oct): ⇔ widens it across the whole chat, and
   lights off puts it alone on black over the whole screen. */
const wideIco = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" /></svg>
const narrowIco = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12h7M21 12h-7M7 8l4 4-4 4M17 8l-4 4 4 4" /></svg>
const lightsIco = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
/* RoarMe's own small video player (Alex, 21 Nov: "take all the icons off, leave only play / pause and the bar at the
   foot, and the right double tap"): a tap plays or pauses, the play sign shows in the middle while paused, a thin line
   at the foot with the time moves through it, a double tap opens it full screen (onDouble). No phone controls, so a
   long press reaches the message's menu. */
export function MiniPlayer({ src, poster, autoPlay = false, muted = false, loop = false, at = 0, onDouble, className = '', vref }) {
  const own = useRef(null)
  const ref = vref || own
  const [on, setOn] = useState(false)
  const [t, setT] = useState(0)
  const [d, setD] = useState(0)
  const [show, setShow] = useState(true)
  const tap = useRef(null)
  const hide = useRef(null)
  const drag = useRef(false)
  const peek = () => { setShow(true); clearTimeout(hide.current); hide.current = setTimeout(() => setShow(false), 1800) }
  useEffect(() => () => { clearTimeout(tap.current); clearTimeout(hide.current) }, [])
  const toggle = () => { const v = ref.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause() }
  const click = (e) => {
    e.stopPropagation()
    if (tap.current) { clearTimeout(tap.current); tap.current = null; onDouble?.(ref.current?.currentTime || 0); return }
    tap.current = setTimeout(() => { tap.current = null; toggle(); peek() }, onDouble ? 240 : 0)
  }
  const seekAt = (e) => { const v = ref.current, r = e.currentTarget.getBoundingClientRect(); if (v && d) { v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d; setT(v.currentTime) } }
  const mm = (x) => `${Math.floor((x || 0) / 60)}:${String(Math.floor((x || 0) % 60)).padStart(2, '0')}`
  return (
    <span className={`mini-vid${on ? ' on' : ''}${show || !on ? ' show' : ''} ${className}`} onClick={click} onDoubleClick={(e) => e.stopPropagation()}>
      <video ref={ref} className="pic-img ready" src={src} poster={poster || undefined} autoPlay={autoPlay} muted={muted} loop={loop} playsInline preload={autoPlay ? 'auto' : 'metadata'}
        onLoadedMetadata={(e) => { setD(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0); if (at) e.currentTarget.currentTime = at }}
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onPlay={() => { setOn(true); peek() }} onPause={() => { setOn(false); setShow(true) }} onEnded={() => setShow(true)} />
      <i className="mini-pp" aria-hidden="true">{on ? I.pause : I.play}</i>
      <span className="mini-foot" onClick={(e) => e.stopPropagation()}>
        <small>{mm(t)}</small>
        <span className="mini-bar" role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)}
          onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); seekAt(e); peek() }}
          onPointerMove={(e) => { if (drag.current) seekAt(e) }} onPointerUp={() => { drag.current = false }} onPointerCancel={() => { drag.current = false }}>
          <i style={{ width: `${d ? Math.min(100, (t / d) * 100) : 0}%` }} />
        </span>
        <small>{d ? `-${mm(d - t)}` : ''}</small>
      </span>
    </span>
  )
}

const PIP_I = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><rect x="12" y="12" width="7" height="5" rx="1.4" fill="currentColor" stroke="none" /></svg>
const MUTED_I = <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z" /><path d="M15 9.5l5 5M20 9.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></svg>
export function VideoTools({ wide, onWide, onCinema }) {
  return (
    <span className="vid-tools" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {onWide && <button type="button" onClick={onWide} title={wide ? 'Back to size' : 'Across the chat'} aria-label={wide ? 'Back to size' : 'Across the chat'}>{wide ? narrowIco : wideIco}</button>}
      {onCinema && <button type="button" onClick={onCinema} title="Lights off" aria-label="Lights off">{lightsIco}</button>}
    </span>
  )
}

export function VideoTile({ file, auto = true, play = false, wide, onWide, onCinema, onOpen }) {
  const [go, setGo] = useState(auto)
  const [url, setUrl] = useState('')
  const ref = useRef(null)
  const [left, setLeft] = useState(0) // seconds left, on the chip of a video that plays by itself
  useEffect(() => { if (!go) return undefined; let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path, go])
  // playing by itself, a video plays only while it is on the screen: a chat with many videos no longer plays them
  // all at once out of sight (Alex, 21 Oct: RoarMe lighter)
  useEffect(() => {
    const v = ref.current
    if (!(play || onOpen) || !v || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play?.().catch(() => {}); else v.pause() }, { threshold: 0.25 })
    io.observe(v)
    return () => io.disconnect()
  }, [play, url])
  // nothing heavy in the chat (Alex, 15 Nov): a video with a still frame shows only that small picture and a play sign;
  // the video itself is fetched when it is tapped (unless videos are set to play by themselves)
  const [poster, setPoster] = useState('')
  const [tapped, setTapped] = useState(false)
  useEffect(() => { if (!file?.thumb) return undefined; let alive = true; picLink(thumbOf(file)).then((u) => { if (alive) setPoster(u) }); return () => { alive = false } }, [file?.thumb])
  // a video with no still of its own: a quiet frame of it (half a second in, past a black start) under the same play sign,
  // with no player controls, so a long press opens the message's menu as on anything else (Alex, 21 Nov)
  /* As Telegram's (Alex, 21 Nov): in the chat a video plays by itself while in sight, muted and round again, no taller
     than 4:5, with only a small chip of the time left and a muted sign; a tap opens it full screen, whole, with its sound
     (the viewer, onOpen); a long press opens the message's menu. With Auto-Download off it waits for a tap as before. */
  if (onOpen && go) {
    return (
      <span className="vid-box vid-auto" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onOpen() }} onDoubleClick={(e) => e.stopPropagation()}>
        {url
          ? <video ref={(el) => { ref.current = el; if (el) { el.muted = true; el.defaultMuted = true; el.setAttribute('muted', '') } }} className="pic-img ready" src={url} poster={poster || undefined}
            muted loop playsInline autoPlay preload="auto" tabIndex={-1}
            onTimeUpdate={(e) => { const v = e.currentTarget; if (Number.isFinite(v.duration)) setLeft(Math.max(0, v.duration - v.currentTime)) }}
            onLoadedMetadata={(e) => { const v = e.currentTarget; if (Number.isFinite(v.duration)) setLeft(v.duration) }} />
          : poster ? <img className="pic-img ready" src={poster} alt="" draggable={false} /> : <span className="pic-wait" />}
        <span className="vid-chip">{`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`}<i>{MUTED_I}</i></span>
      </span>
    )
  }
  if (!file?.thumb && go && !play && !tapped) {
    return (
      <span className="vid-box vid-poster" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setGo(true); setTapped(true) }}>
        {url ? <video className="pic-img ready vid-still" src={url} muted playsInline preload="metadata" tabIndex={-1} onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = Math.min(0.5, (e.currentTarget.duration || 1) / 2) } catch { /* none */ } }} /> : <span className="pic-wait" />}
        <i className="vid-play">{I.play}</i>
        <small className="vid-size">{fmtBytes(file?.size)}</small>
      </span>
    )
  }
  if (file?.thumb && !play && !tapped) {
    return (
      <span className="vid-box vid-poster" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(); else { setGo(true); setTapped(true) } }}>
        {poster ? <img className="pic-img ready" src={poster} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="pic-wait" />}
        <i className="vid-play">{I.play}</i>
        <small className="vid-size">{fmtBytes(file?.size)}</small>
      </span>
    )
  }
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{I.play}<span>Video · {fmtBytes(file?.size)}</span><small>Tap to load</small></button>
  // videos can play by themselves, silent and on a loop (Settings > Data and Storage)
  if (!url) return poster ? <span className="vid-box vid-poster"><img className="pic-img ready" src={poster} alt="" draggable={false} /><i className="vid-play spin" /></span> : <span className="pic-wait" />
  return (
    <span className="vid-box">
      <MiniPlayer vref={ref} src={poster || play ? url : `${url}#t=0.1`} poster={poster} autoPlay={tapped || play} muted={play} loop={play}
        onDouble={onCinema && ((at) => { document.querySelectorAll('.vid-box video').forEach((v) => v.pause()); onCinema({ kind: 'file', src: url, at }) })} />
    </span>
  )
}

/* a round video message (Alex, 12 Nov, from Telegram): it plays silent and on a loop while in sight; a tap plays it from
   the start with its sound, a ring going round, and another tap pauses */
export function NoteTile({ file }) {
  const [url, setUrl] = useState('')
  const [sound, setSound] = useState(false)
  const [p, setP] = useState(0)
  const ref = useRef(null)
  useEffect(() => { let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  useEffect(() => {
    const v = ref.current
    if (!v || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play?.().catch(() => {}); else v.pause() }, { threshold: 0.4 })
    io.observe(v)
    return () => io.disconnect()
  }, [url])
  const tap = (e) => {
    e.stopPropagation()
    if (Date.now() - (window.roarHeldAt || 0) < 800) return // the finger lifting from a long press, which opened the menu
    const v = ref.current
    if (!v) return
    if (!sound) { v.muted = false; v.loop = false; v.currentTime = 0; v.play().catch(() => {}); setSound(true); setP(0) }
    else if (v.paused) v.play().catch(() => {})
    else v.pause()
  }
  const ended = () => { const v = ref.current; setSound(false); setP(0); if (v) { v.muted = true; v.loop = true; v.play().catch(() => {}) } }
  const R = 49
  const C = 2 * Math.PI * R
  const d = file?.dur || 0
  return (
    <span className={`note${sound ? ' on' : ''}`} onClick={tap} role="button" aria-label="Video message">
      {url ? <video ref={ref} src={url} muted loop playsInline autoPlay preload="metadata" onEnded={ended}
        onTimeUpdate={(e) => { if (sound) { const v = e.currentTarget; setP(v.currentTime / (v.duration && isFinite(v.duration) ? v.duration : d || 1)) } }} /> : <span className="pic-wait" />}
      {sound && <svg className="note-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - p)} /></svg>}
      <small className="note-dur">{!sound && <svg className="note-mute" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6" /></svg>}{Math.floor(d / 60)}:{String(d % 60).padStart(2, '0')}</small>
    </span>
  )
}

/* a YouTube or Vimeo link in a message plays right there, from its picture */
export function videoLinkOf(text) {
  const m = (text || '').match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?\S*?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})|https?:\/\/(?:www\.)?vimeo\.com\/(?:video\/)?(\d+)/)
  if (!m) return null
  return m[1]
    ? { kind: 'YouTube', thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`, src: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0&playsinline=1` }
    : { kind: 'Vimeo', thumb: '', src: `https://player.vimeo.com/video/${m[2]}?autoplay=1` }
}
export function LinkVideo({ link, wide, onWide, onCinema }) {
  const [on, setOn] = useState(false)
  return (
    <span className="vid-box link-vid" onClick={(e) => e.stopPropagation()}>
      {on
        ? <iframe src={link.src} title={link.kind} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
        : <button type="button" className="vid-poster" style={link.thumb ? { backgroundImage: `url(${link.thumb})` } : undefined} onClick={() => setOn(true)} aria-label={`Play on ${link.kind}`}><i>{I.play}</i><small>{link.kind}</small></button>}
      <VideoTools wide={wide} onWide={onWide} onCinema={onCinema && (() => { setOn(false); onCinema({ kind: 'embed', src: link.src }) })} />
    </span>
  )
}

/* lights off: the video alone on black over the whole screen; Esc, the × or a click on the black closes it */
export function Cinema({ item, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  // a slide down or to the right closes it, as every window (Alex, 21 Nov: "swipe down or right does not get me out");
  // a touch near the foot is left to the video's own line
  const touch = useRef(null)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const tStart = (e) => { const p = e.touches[0]; touch.current = p.clientY > window.innerHeight - 120 ? null : { x: p.clientX, y: p.clientY } }
  const tMove = (e) => {
    if (!touch.current) return
    const p = e.touches[0], dx = p.clientX - touch.current.x, dy = p.clientY - touch.current.y
    if (dy > 0 && dy > Math.abs(dx)) setOff({ x: 0, y: dy }); else if (dx > 0 && dx > Math.abs(dy)) setOff({ x: dx, y: 0 }); else setOff({ x: 0, y: 0 })
  }
  const tEnd = () => { if (!touch.current) return; touch.current = null; if (off.y > 110 || off.x > 110) onClose(); else setOff({ x: 0, y: 0 }) }
  const far = Math.max(off.x, off.y)
  return (
    <div className="cinema" style={far ? { background: `rgba(0,0,0,${Math.max(0.3, 1 - far / 400)})` } : undefined} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onTouchStart={tStart} onTouchMove={tMove} onTouchEnd={tEnd} onTouchCancel={tEnd}>
      {item.kind === 'file'
        ? <span className="cinema-vid" style={far ? { transform: `translate(${off.x}px, ${off.y}px) scale(${Math.max(0.8, 1 - far / 1200)})`, transition: 'none' } : undefined}><MiniPlayer src={item.src} autoPlay at={item.at} onDouble={onClose} /></span>
        : <iframe src={item.src} title="Video" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />}
      <button type="button" className="cinema-x" onClick={onClose} aria-label="Lights on" title="Lights on (Esc)">{I.x}</button>
    </div>
  )
}

/* ---------- your own folders (kept on this device) ---------- */
export function FoldersModal({ folders, rooms, titleOf, startNew, onSave, onClose }) {
  const [list, setList] = useState(() => (startNew ? [...folders, { id: crypto.randomUUID(), name: '', rooms: [] }] : folders.map((f) => ({ ...f }))))
  const set = (id, patch) => setList((l) => l.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  return (
    <Modal title="Your folders" onClose={onClose} foot={<><button type="button" className="btn" onClick={() => setList((l) => [...l, { id: crypto.randomUUID(), name: '', rooms: [] }])}>{I.plus} Add folder</button><button type="button" className="btn btn-main" onClick={() => onSave(list.filter((f) => f.name.trim()).map((f) => ({ ...f, name: f.name.trim() })))}>Save</button></>}>
      {!list.length && <p className="muted">No folders yet. Add one, give it a name and pick its chats.</p>}
      {list.map((f) => (
        <div key={f.id} className="folder-edit">
          <div className="folder-edit-head">
            <input className="input" value={f.name} onChange={(e) => set(f.id, { name: e.target.value })} placeholder="Folder name" autoFocus={!f.name} />
            <button type="button" className="round danger" onClick={() => setList((l) => l.filter((x) => x.id !== f.id))} aria-label="Remove folder" title="Remove folder">{I.trash}</button>
          </div>
          <div className="chips">
            {rooms.map((r) => {
              const on = f.rooms.includes(r.room_id)
              return <button key={r.room_id} type="button" className={`chip${on ? ' on' : ' off'}`} onClick={() => set(f.id, { rooms: on ? f.rooms.filter((x) => x !== r.room_id) : [...f.rooms, r.room_id] })}>{titleOf(r)}</button>
            })}
          </div>
        </div>
      ))}
    </Modal>
  )
}

/* ---------- photos, videos and files of one chat ---------- */
export function SharedMedia({ roomId, onOpen, onClose }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('roar_messages').select('id, kind, file, created_at').eq('room_id', roomId).in('kind', ['image', 'file', 'voice']).is('deleted_at', null).order('created_at', { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setErr(errText(error)); setList(data || []) })
  }, [roomId])
  const media = (list || []).filter((m) => m.kind === 'image' || /^video\//.test(m.file?.type || ''))
  const docs = (list || []).filter((m) => !media.includes(m))
  return (
    <Modal title="Photos, videos & files" onClose={onClose} wide>
      {err && <p className="auth-err">{err}</p>}
      {list && !list.length && <p className="muted">Nothing shared in this chat yet.</p>}
      {media.length > 0 && <div className="media-grid">{media.map((m, n) => <MediaThumb key={m.id} m={m} onClick={() => onOpen(media, n)} />)}</div>}
      {docs.length > 0 && (
        <div className="people">
          {docs.map((m) => (
            <button key={m.id} type="button" className="person" onClick={async () => { const u = await fileLink(m.file); if (u) window.open(u, '_blank', 'noopener') }}>
              <span className="file-ico">{I.file}</span>
              <span className="person-text"><b>{m.kind === 'voice' ? 'Voice message' : m.file?.name}</b><small>{fmtBytes(m.file?.size)} · {new Date(m.created_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} {timeOf(m.created_at)}</small></span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
function MediaThumb({ m, onClick }) {
  const [ref, seen] = useSeen()
  const [url, setUrl] = useState('')
  useEffect(() => { if (!seen) return undefined; let alive = true; picLink(thumbOf(m.file)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path, seen])
  return (
    <button ref={ref} type="button" className="media-thumb" onClick={onClick}>
      {url && (/^video\//.test(m.file?.type || '') ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" loading="lazy" decoding="async" />)}
      {/^video\//.test(m.file?.type || '') && <i className="attach-play">{I.play}</i>}
    </button>
  )
}

/* the chat wallpapers as small tiles to pick from */
/* in Halo the built-in washes wear its own palette (Alex, 12 Nov): Night, Ocean, Dusk, Forest and Ember are drawn in
   Navy, Blue, Lilac, Pink and Rose by themes-halo.css and named so here */
const HALO_WALLS = { night: 'Navy', ocean: 'Blue', dusk: 'Lilac', forest: 'Pink', ember: 'Rose' }
// Pattern and Grid are not offered in Halo (Alex, 12 Nov); nor, since 18 Nov ("take the similar colours out"), the
// blends that look like another one: Blue and Lilac (as Navy), Rose, Twilight and Candy (as Pink). Whoever wears one of
// them keeps it and still sees its tile.
const HALO_HIDE = ['dots', 'grid', 'ocean', 'dusk', 'ember', 'halo-twilight', 'halo-candy']
// Halo's own orange as a wallpaper too (Alex, 12 Nov), before the other colours; drawn by themes-halo.css, plain elsewhere
// three more blends of the palette (Alex, 12 Nov) go after its colours
const HALO_MORE = [{ key: 'halo-sunset', name: 'Sunset', path: null }, { key: 'halo-twilight', name: 'Twilight', path: null }, { key: 'halo-candy', name: 'Candy', path: null }, { key: 'halo-sky', name: 'Sky', path: null }]
// plain white, right after Plain (Alex, 18 Nov); black by Night, where white would blind
const WHITE = { key: 'white', name: 'White', path: null }
const withOrange = (walls) => {
  if (!walls.some((w) => w.key === 'white')) { const s = walls.findIndex((w) => w.key === 'soft'); walls = [...walls.slice(0, s + 1), WHITE, ...walls.slice(s + 1)] }
  const i = walls.findIndex((w) => HALO_WALLS[w.key])
  const o = { key: 'halo-orange', name: 'Orange', path: null }
  if (i < 0) return [...walls, o, ...HALO_MORE]
  let j = i
  while (j < walls.length && HALO_WALLS[walls[j].key]) j += 1
  return [...walls.slice(0, i), o, ...walls.slice(i, j), ...HALO_MORE, ...walls.slice(j)]
}
// strength / onStrength: the App background keeps a strength of its own (prefs.appWallStrength; Alex, 13 Nov)
export function WallTiles({ value, onPick, toast, strength: own, onStrength }) {
  const prefsNow = usePrefs()
  const halo = haloish(prefsNow.theme)
  const strength = Math.min(100, Math.max(10, Number(own ?? prefsNow.wallStrength) || 100))
  const walls = useWalls()
  const color = ownColor(value)
  const photo = ownPhoto(value)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  // one's own photo (Alex, 8 Nov): made lighter, kept in one's own folder of roar-avatars, chosen at once at full strength
  const upload = async (f) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast?.('Pick a JPEG, PNG or WebP photo'); return }
    setBusy(true)
    try {
      const file = await shrinkImage(f, 2400, 0.86)
      const { data: { user } } = await supabase.auth.getUser()
      const path = `${user.id}/wall-${Date.now()}.${file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'}`
      const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: file.type })
      if (up.error) throw up.error
      onPick(photoValue(supabase.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl, photo?.opacity ?? 1))
    } catch (e) { toast?.(errText(e)) }
    setBusy(false)
  }
  return (
    <>
      <div className="walls">
        {(halo ? withOrange(walls) : walls).filter(({ key: k }) => !halo || k === value || !HALO_HIDE.includes(k)).map(({ key: k, name: l, path }) => (
          <button key={k} type="button" className={`wall-tile${value === k ? ' on' : ''}${path ? ' img' : ''}`} data-bg={k} style={path ? { backgroundImage: `url("${wallUrl(path)}")` } : undefined} onClick={() => onPick(k)}>
            <i className="wall-b">Hi!</i><i className="wall-b mine">Hello 👋</i><small>{(halo && HALO_WALLS[k]) || l}</small>
          </button>
        ))}
        {/* any colour: the tile itself opens the colour picker */}
        <button type="button" className={`wall-tile wall-own${color ? ' on' : ''}`} style={color ? { background: color } : undefined} onClick={() => setPicking(true)}>
          {!color && <span className="wall-own-ico">{I.brush}</span>}
          <small>Colour</small>
        </button>
        <button type="button" className={`wall-tile wall-own${photo ? ' on img' : ''}`} style={photo ? { backgroundImage: `url("${photo.url}")` } : undefined} onClick={() => fileRef.current?.click()} disabled={busy}>
          {!photo && <span className="wall-own-ico">{busy ? '…' : I.image}</span>}
          <small>{busy ? 'Uploading…' : photo ? 'Change Photo' : 'Your Photo'}</small>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {picking && <ColorPick title="Wallpaper Colour" value={color ? color.toUpperCase() : '#BFE6FA'} onSet={(h) => onPick(`color:${h.toLowerCase()}`)} onClose={() => setPicking(false)} />}
      {/* one strength for every wallpaper (Alex, 12 Nov): a photo of one's own keeps it in its value, the rest in prefs */}
      {(photo || (value && value !== 'soft')) && (
        <div className="wall-op">
          <span className="set-text">Wallpaper Strength<small>{`${photo ? Math.round(photo.opacity * 100) : strength}%`}</small><small>Lower lets the theme's own colour through</small></span>
          {photo
            ? <Slide min={10} max={100} step={1} value={Math.round(photo.opacity * 100)} onChange={(n) => onPick(photoValue(photo.url, n / 100))} aria-label="Wallpaper Strength" />
            : <Slide min={10} max={100} step={1} value={strength} onChange={(n) => (onStrength ? onStrength(n) : setPrefs({ wallStrength: n }))} aria-label="Wallpaper Strength" />}
        </div>
      )}
    </>
  )
}
