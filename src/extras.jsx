import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errText, fileLink, thumbOf, fmtBytes, shrinkImage, supabase, timeOf } from './lib.js'
import { EMOJIS, setPrefs, usePrefs } from './prefs.js'
import { ownColor, ownPhoto, photoValue, useWalls, wallUrl } from './walls.js'
import { I, Modal, useSeen } from './ui.jsx'
import { mmss, player, usePlayer } from './player.jsx'
import { locale } from './i18n.js'

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
export function MediaViewer({ items, index, onClose }) {
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
  return (
    <div className={`viewer v2${bars ? '' : ' bare'}`} style={{ '--vw-fade': fade }}>
      <div className="vw-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        {isVid
          ? <video key={it.url} src={it.url} controls autoPlay playsInline />
          : <img key={it.url} src={it.url} alt="" draggable={false} className={t.s > 1.01 ? 'zoomed' : ''}
            style={{ transform: `translate(${t.x + d.x}px, ${t.y + d.y}px) scale(${t.s * (d.y ? 1 - d.y / 1600 : 1)})`, transition: live ? 'none' : undefined }} />}
      </div>
      <div className="vw-top">
        <button type="button" className="round" onClick={onClose} aria-label="Back">{I.left}</button>
        <div className="vw-title">{(it.who || it.name) && <b>{it.who || it.name}</b>}{whenText && <small>{whenText}</small>}</div>
        <span className="vw-more">
          <button type="button" className={`round${menu ? ' on' : ''}`} onClick={() => setMenu((m) => !m)} aria-label="More">{I.more}</button>
          {menu && (
            <div className="vw-menu">
              <a href={it.url} download={it.name || true} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>{I.download}<span>Save</span></a>
              <button type="button" onClick={share}>{I.forward}<span>Share</span></button>
              <a href={it.url} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>{I.link}<span>Open in a New Tab</span></a>
            </div>
          )}
        </span>
      </div>
      <div className="vw-foot">
        <button type="button" className="round" onClick={share} aria-label="Share" title="Share">{I.forward}</button>
        {items.length > 1 ? <span className="vw-count">{i + 1} / {items.length}</span> : <span />}
        <a className="round" href={it.url} download={it.name || true} target="_blank" rel="noreferrer" aria-label="Save" title="Save">{I.download}</a>
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
  useEffect(() => { if (!seen) return undefined; let alive = true; fileLink(thumbOf(m.file)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path, seen])
  return (
    <button ref={ref} type="button" className={`as-thumb${busy ? ' busy' : ''}`} onClick={() => onPick(m)} aria-label={m.file?.name || 'Photo'}>
      {url && (vid && !m.file?.thumb ? <video src={url} muted playsInline preload="metadata" /> : <img src={url} alt="" loading="lazy" />)}
      {vid && <i className="as-thumb-play">{I.play}</i>}
    </button>
  )
}
export function AttachSheet({ initial = [], meId, onResend, onClose, onSend, onTransfer, onLocation, onArticle }) {
  const prefs = usePrefs()
  const [files, setFiles] = useState(initial)
  const [caption, setCaption] = useState('')
  const [compress, setCompress] = useState(prefs.compress)
  const [tab, setTab] = useState('gallery')
  const [recent, setRecent] = useState(null)
  const [sending, setSending] = useState('')
  const gal = useRef(null)
  const cam = useRef(null)
  const doc = useRef(null)
  const aud = useRef(null)
  const touchOnly = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
  const add = (list) => setFiles((f) => [...f, ...list])
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
        const mine = live.filter((m) => m.user_id === meId && !isAudioFile(m.file)).filter(once).slice(0, 40)
        const photos = live.filter((m) => m.user_id === meId && (m.kind === 'image' || /^(image|video)\//.test(m.file?.type || '')) && !m.file?.round).filter(once).slice(0, 30)
        setRecent({ mine: mine.filter((m) => m.kind !== 'image' && !/^(image|video)\//.test(m.file?.type || '')), audio: audio.slice(0, 40), photos })
      })
  }, [tab, recent, meId])
  const pick = async (m) => { if (!onResend || sending) return; setSending(m.id); const ok = await onResend(m); setSending(''); if (ok !== false) onClose() }
  const TABS = [
    ['gallery', 'Gallery', I.image],
    ['file', 'File', I.file],
    onLocation && ['location', 'Location', I.place],
    ['audio', 'Audio', I.play],
    onArticle && ['article', 'Article', I.article],
    onTransfer && ['transfer', 'Transfer', I.transfer],
  ].filter(Boolean)
  const go = (k) => {
    if (k === 'location') return onLocation()
    if (k === 'article') return onArticle()
    if (k === 'transfer') return onTransfer()
    setTab(k)
  }
  const title = files.length ? `${files.length} selected` : TABS.find(([k]) => k === tab)?.[1] || 'Send'
  const media = files.some((f) => /^(image|video)\//.test(f.type))
  const big = files.filter((f) => f.size > 50e6 && !(compress && /^video\//.test(f.type)))
  const list = recent ? (tab === 'audio' ? recent.audio : recent.mine) : null
  return createPortal(
    <div className="as-back" onClick={onClose}>
      <div className="as-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <i className="as-grab" aria-hidden="true" />
        <div className="as-head">
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
          <b>{title}</b>
          <span className="as-head-pad" />
        </div>
        <div className="as-body">
          {files.length > 0 ? (
            <>
              <div className="attach-grid">
                {files.map((f, n) => (
                  <span key={n} className="attach-item">
                    {/^image\//.test(f.type) ? <img src={thumb(f)} alt="" /> : /^video\//.test(f.type) ? <video src={thumb(f)} muted /> : <span className="attach-doc">{I.file}<small>{f.name}</small></span>}
                    {/^video\//.test(f.type) && <i className="attach-play">{I.play}</i>}
                    <small className="attach-size">{fmtBytes(f.size)}</small>
                    <button type="button" onClick={() => setFiles((l) => l.filter((_, k) => k !== n))} aria-label="Remove">{I.x}</button>
                  </span>
                ))}
                <button type="button" className="attach-more" onClick={() => (media ? gal : doc).current?.click()} aria-label="Add more">{I.plus}</button>
              </div>
              {media && (
                <div className="attach-quality">
                  <div className="seg">
                    <button type="button" className={compress ? 'on' : ''} onClick={() => setCompress(true)}>Standard</button>
                    <button type="button" className={!compress ? 'on' : ''} onClick={() => setCompress(false)}>HD</button>
                  </div>
                  <small className="muted">{compress ? 'Smaller and faster: photos resized, videos to 720p.' : 'Full quality, as they are.'}</small>
                </div>
              )}
              {big.length > 0 && <small className="attach-transfer">{big.length === 1 ? 'Over 50 MB: it goes by RoarTransfer, up to 3 GB, kept 3 days.' : `${big.length} files over 50 MB go by RoarTransfer, kept 3 days.`}</small>}
            </>
          ) : tab === 'gallery' ? (
            <>
              <div className="as-tiles">
                <AsTile icon={I.image} title="Photos and Videos" sub="From your library" onClick={() => gal.current?.click()} />
                {touchOnly
                  ? <AsTile icon={I.camera} title="Camera" sub="Take one now" onClick={() => cam.current?.click()} />
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
              <div className="as-tiles">
                {tab === 'audio'
                  ? <AsTile wide icon={I.play} title="Choose a Sound File" sub="MP3, WAV, M4A, FLAC and the rest" onClick={() => aud.current?.click()} />
                  : <>
                    <AsTile icon={I.file} title="Files" sub={touchOnly ? 'From this phone' : 'From this computer'} onClick={() => doc.current?.click()} />
                    <AsTile icon={I.image} title="Gallery" sub="Sent as a file, untouched" onClick={() => gal.current?.click()} />
                  </>}
              </div>
              <small className="as-label">{tab === 'audio' ? 'Sound in your chats' : 'Recently sent files'}</small>
              <div className="as-card">
                {!list && <span className="as-row as-wait">Loading…</span>}
                {list && !list.length && <span className="as-row as-wait">{tab === 'audio' ? 'No sound files in your chats yet.' : 'Nothing sent yet.'}</span>}
                {list?.map((m) => <RecentRow key={m.id} m={m} onPick={pick} />)}
              </div>
            </>
          )}
        </div>
        {files.length > 0 ? (
          <div className="as-send">
            <input className="input attach-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" />
            <button type="button" className="round send ready attach-send" onClick={() => { setPrefs({ compress }); onSend(files, caption.trim(), compress) }} aria-label="Send" title="Send">{I.send}</button>
          </div>
        ) : (
          <nav className="as-tabs">
            {TABS.map(([k, label, ico]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => go(k)}>{ico}<span>{label}</span></button>)}
          </nav>
        )}
        <input ref={gal} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
        <input ref={cam} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
        <input ref={doc} type="file" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
        <input ref={aud} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.aif,.aiff,.ogg,.opus" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
      </div>
    </div>,
    document.body,
  )
}

/* ---------- a song or any sound file (mp3, wav, m4a…): a small player in the message (Alex, 16 Oct) ---------- */
export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|aif|aiff|weba)$/i
export const isAudioFile = (f) => !!f && (/^audio\//.test(f.type || '') || AUDIO_EXT.test(f.name || ''))
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
  const toggle = (e) => { e.stopPropagation(); if (url) player.toggle({ key, url, title, from, roomId }) }
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
export function VideoTools({ wide, onWide, onCinema }) {
  return (
    <span className="vid-tools" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {onWide && <button type="button" onClick={onWide} title={wide ? 'Back to size' : 'Across the chat'} aria-label={wide ? 'Back to size' : 'Across the chat'}>{wide ? narrowIco : wideIco}</button>}
      {onCinema && <button type="button" onClick={onCinema} title="Lights off" aria-label="Lights off">{lightsIco}</button>}
    </span>
  )
}

export function VideoTile({ file, auto = true, play = false, wide, onWide, onCinema }) {
  const [go, setGo] = useState(auto)
  const [url, setUrl] = useState('')
  const ref = useRef(null)
  useEffect(() => { if (!go) return undefined; let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path, go])
  // playing by itself, a video plays only while it is on the screen: a chat with many videos no longer plays them
  // all at once out of sight (Alex, 21 Oct: RoarMe lighter)
  useEffect(() => {
    const v = ref.current
    if (!play || !v || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play?.().catch(() => {}); else v.pause() }, { threshold: 0.25 })
    io.observe(v)
    return () => io.disconnect()
  }, [play, url])
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{I.play}<span>Video · {fmtBytes(file?.size)}</span><small>Tap to load</small></button>
  // videos can play by themselves, silent and on a loop (Settings > Data and Storage)
  if (!url) return <span className="pic-wait" />
  return (
    <span className="vid-box">
      <video ref={ref} className="pic-img ready" src={url} controls preload="metadata" muted={play} loop={play} playsInline onClick={(e) => e.stopPropagation()} />
      <VideoTools wide={wide} onWide={onWide} onCinema={onCinema && (() => { const v = ref.current; const at = v?.currentTime || 0; v?.pause(); onCinema({ kind: 'file', src: url, at }) })} />
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
  return (
    <div className="cinema" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {item.kind === 'file'
        ? <video ref={ref} src={item.src} controls autoPlay playsInline onLoadedMetadata={() => { if (ref.current && item.at) ref.current.currentTime = item.at }} />
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
  useEffect(() => { if (!seen) return undefined; let alive = true; fileLink(thumbOf(m.file)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path, seen])
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
const HALO_HIDE = ['dots', 'grid'] // Pattern and Grid are not offered in Halo (Alex, 12 Nov)
// Halo's own orange as a wallpaper too (Alex, 12 Nov), before the other colours; drawn by themes-halo.css, plain elsewhere
const withOrange = (walls) => { const i = walls.findIndex((w) => HALO_WALLS[w.key]); const o = { key: 'halo-orange', name: 'Orange', path: null }; return i < 0 ? [...walls, o] : [...walls.slice(0, i), o, ...walls.slice(i)] }
export function WallTiles({ value, onPick, toast }) {
  const prefsNow = usePrefs()
  const halo = prefsNow.theme === 'halo'
  const strength = Math.min(100, Math.max(10, Number(prefsNow.wallStrength) || 100))
  const walls = useWalls()
  const color = ownColor(value)
  const photo = ownPhoto(value)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
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
        {(halo ? withOrange(walls) : walls).filter(({ key: k }) => !halo || !HALO_HIDE.includes(k)).map(({ key: k, name: l, path }) => (
          <button key={k} type="button" className={`wall-tile${value === k ? ' on' : ''}${path ? ' img' : ''}`} data-bg={k} style={path ? { backgroundImage: `url("${wallUrl(path)}")` } : undefined} onClick={() => onPick(k)}>
            <i className="wall-b">Hi!</i><i className="wall-b mine">Hello 👋</i><small>{(halo && HALO_WALLS[k]) || l}</small>
          </button>
        ))}
        {/* any colour: the tile itself opens the colour picker */}
        <label className={`wall-tile wall-own${color ? ' on' : ''}`} style={color ? { background: color } : undefined}>
          <input type="color" value={color || '#3a3a3d'} onChange={(e) => onPick(`color:${e.target.value}`)} />
          {!color && <span className="wall-own-ico">{I.brush}</span>}
          <small>Colour</small>
        </label>
        <button type="button" className={`wall-tile wall-own${photo ? ' on img' : ''}`} style={photo ? { backgroundImage: `url("${photo.url}")` } : undefined} onClick={() => fileRef.current?.click()} disabled={busy}>
          {!photo && <span className="wall-own-ico">{busy ? '…' : I.image}</span>}
          <small>{busy ? 'Uploading…' : photo ? 'Change Photo' : 'Your Photo'}</small>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {/* one strength for every wallpaper (Alex, 12 Nov): a photo of one's own keeps it in its value, the rest in prefs */}
      {(photo || (value && value !== 'soft')) && (
        <div className="wall-op">
          <span className="set-text">Wallpaper Strength<small>{`${photo ? Math.round(photo.opacity * 100) : strength}%`}</small><small>Lower lets the theme's own colour through</small></span>
          {photo
            ? <input type="range" min="10" max="100" step="5" value={Math.round(photo.opacity * 100)} onChange={(e) => onPick(photoValue(photo.url, Number(e.target.value) / 100))} />
            : <input type="range" min="10" max="100" step="5" value={strength} onChange={(e) => setPrefs({ wallStrength: Number(e.target.value) })} />}
        </div>
      )}
    </>
  )
}
