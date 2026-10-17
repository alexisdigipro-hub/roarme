import { useEffect, useRef, useState } from 'react'
import { errText, fileLink, fmtBytes, supabase, timeOf } from './lib.js'
import { EMOJIS, WALLS, setPrefs, usePrefs } from './prefs.js'
import { I, Modal } from './ui.jsx'
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

/* ---------- a photo or video full screen: arrows, zoom, save ---------- */
export function MediaViewer({ items, index, onClose }) {
  const [i, setI] = useState(index)
  const [zoom, setZoom] = useState(false)
  const it = items[i]
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') { setZoom(false); setI((n) => Math.max(0, n - 1)) }
      if (e.key === 'ArrowRight') { setZoom(false); setI((n) => Math.min(items.length - 1, n + 1)) }
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [items.length, onClose])
  if (!it) return null
  return (
    <div className="viewer" onClick={onClose}>
      <div className="viewer-top" onClick={(e) => e.stopPropagation()}>
        <span>{items.length > 1 ? `${i + 1} / ${items.length}` : it.name || ''}</span>
        <a className="round" href={it.url} download={it.name || true} target="_blank" rel="noreferrer" title="Save">{I.download}</a>
        <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
      </div>
      {i > 0 && <button type="button" className="round viewer-prev" onClick={(e) => { e.stopPropagation(); setZoom(false); setI(i - 1) }} aria-label="Previous">{I.left}</button>}
      {/^video\//.test(it.type || '')
        ? <video src={it.url} controls autoPlay onClick={(e) => e.stopPropagation()} />
        : <img src={it.url} alt="" className={zoom ? 'zoom' : ''} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); setZoom((z) => !z) }} />}
      {i < items.length - 1 && <button type="button" className="round viewer-next" onClick={(e) => { e.stopPropagation(); setZoom(false); setI(i + 1) }} aria-label="Next">{I.right}</button>}
    </div>
  )
}

/* ---------- photos, videos and files before they are sent: gallery, camera, file, caption ---------- */
export function AttachSheet({ initial = [], onClose, onSend, onTransfer, onLocation, onArticle }) {
  const prefs = usePrefs()
  const [files, setFiles] = useState(initial)
  const [caption, setCaption] = useState('')
  const [compress, setCompress] = useState(prefs.compress)
  const gal = useRef(null)
  const cam = useRef(null)
  const doc = useRef(null)
  const touchOnly = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches
  const add = (list) => setFiles((f) => [...f, ...list])
  const urls = useRef(new Map())
  const thumb = (f) => {
    if (!/^(image|video)\//.test(f.type)) return ''
    if (!urls.current.has(f)) urls.current.set(f, URL.createObjectURL(f))
    return urls.current.get(f)
  }
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  return (
    <Modal title={files.length ? `${files.length} selected` : 'Send'} onClose={onClose}
      foot={files.length > 0 && <button type="button" className="btn btn-main attach-send" onClick={() => { setPrefs({ compress }); onSend(files, caption.trim(), compress) }}>{I.send}<span>Send</span></button>}>
      {/* a fresher send window (Alex, 16 Oct): soft tiles with a tinted icon each, RoarTransfer among them; once files
          are picked the tiles shrink to a row of small pills and the caption and Send come in */}
      <div className={`attach-pick${files.length ? ' small' : ''}`}>
        <button type="button" className="attach-tile" style={{ '--tint': '#4da3ff' }} onClick={() => gal.current?.click()}><i>{I.image}</i><b>Gallery</b><small>Photos and videos</small></button>
        {/* on a computer the camera button only opened the same file picker as Gallery (Alex, 16 Oct): phones only */}
        {touchOnly && <button type="button" className="attach-tile" style={{ '--tint': '#34c759' }} onClick={() => cam.current?.click()}><i>{I.camera}</i><b>Camera</b><small>Take one now</small></button>}
        <button type="button" className="attach-tile" style={{ '--tint': '#ff9f0a' }} onClick={() => doc.current?.click()}><i>{I.file}</i><b>File</b><small>Any document</small></button>
        <button type="button" className="attach-tile" style={{ '--tint': 'var(--accent)' }} onClick={onTransfer}><i>{I.transfer}</i><b>RoarTransfer</b><small>Up to 3 GB, kept 3 days</small></button>
        {onLocation && <button type="button" className="attach-tile" style={{ '--tint': '#34c759' }} onClick={onLocation}><i>{I.place}</i><b>Location</b><small>A place on the map</small></button>}
        {onArticle && <button type="button" className="attach-tile" style={{ '--tint': '#af52de' }} onClick={onArticle}><i>{I.article}</i><b>Article</b><small>A long post with a title</small></button>}
      </div>
      <input ref={gal} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
      <input ref={cam} type="file" accept="image/*,video/*" capture="environment" hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
      <input ref={doc} type="file" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
      {files.length > 0 && (
        <div className="attach-grid">
          {files.map((f, n) => (
            <span key={n} className="attach-item">
              {/^image\//.test(f.type) ? <img src={thumb(f)} alt="" /> : /^video\//.test(f.type) ? <video src={thumb(f)} muted /> : <span className="attach-doc">{I.file}<small>{f.name}</small></span>}
              {/^video\//.test(f.type) && <i className="attach-play">{I.play}</i>}
              <small className="attach-size">{fmtBytes(f.size)}</small>
              <button type="button" onClick={() => setFiles((l) => l.filter((_, k) => k !== n))} aria-label="Remove">{I.x}</button>
            </span>
          ))}
        </div>
      )}
      {/* the quality, as on WhatsApp (Alex, 16 Oct): Standard shrinks photos and videos (videos to 720p); HD sends
          them as they are. Anything over 50 MB goes by RoarTransfer: up to 3 GB, kept 3 days */}
      {files.some((f) => /^(image|video)\//.test(f.type)) && (() => {
        const big = files.filter((f) => f.size > 50e6 && !(compress && /^video\//.test(f.type)))
        return (
          <div className="attach-quality">
            <div className="seg">
              <button type="button" className={compress ? 'on' : ''} onClick={() => setCompress(true)}>Standard</button>
              <button type="button" className={!compress ? 'on' : ''} onClick={() => setCompress(false)}>HD</button>
            </div>
            <small className="muted">{compress ? 'Smaller and faster: photos resized, videos to 720p.' : 'Full quality, as they are.'}</small>
            {big.length > 0 && <small className="attach-transfer">{big.length === 1 ? 'Over 50 MB: it goes by RoarTransfer, kept 3 days.' : `${big.length} files over 50 MB go by RoarTransfer, kept 3 days.`}</small>}
          </div>
        )
      })()}
      {!files.some((f) => /^(image|video)\//.test(f.type)) && files.some((f) => f.size > 50e6) && <small className="attach-transfer">Over 50 MB goes by RoarTransfer: up to 3 GB, kept 3 days.</small>}
      {files.length > 0 && <input className="input attach-caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" autoFocus />}
    </Modal>
  )
}

/* ---------- a song or any sound file (mp3, wav, m4a…): a small player in the message (Alex, 16 Oct) ---------- */
export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|aif|aiff|weba)$/i
export const isAudioFile = (f) => !!f && (/^audio\//.test(f.type || '') || AUDIO_EXT.test(f.name || ''))
export function MusicTile({ file }) {
  const [url, setUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [dur, setDur] = useState(0)
  const [bad, setBad] = useState(false)
  const a = useRef(null)
  useEffect(() => { let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  // one sound at a time across the app
  useEffect(() => {
    const stop = (e) => { if (e.detail !== a.current && a.current && !a.current.paused) a.current.pause() }
    window.addEventListener('roarme-play', stop)
    return () => window.removeEventListener('roarme-play', stop)
  }, [])
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const title = (file?.name || 'Audio').replace(AUDIO_EXT, '')
  const ext = ((file?.name || '').match(AUDIO_EXT) || [])[1]?.toUpperCase() || 'AUDIO'
  const toggle = (e) => {
    e.stopPropagation()
    const el = a.current
    if (!el) return
    if (el.paused) { window.dispatchEvent(new CustomEvent('roarme-play', { detail: el })); el.play().catch(() => setBad(true)) } else el.pause()
  }
  const seek = (e) => {
    e.stopPropagation()
    const el = a.current
    if (!el || !dur) return
    const r = e.currentTarget.getBoundingClientRect()
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur
  }
  return (
    <span className="music" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`music-btn${playing ? ' on' : ''}`} disabled={!url || bad} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? I.pause : I.play}</button>
      <span className="music-main">
        <span className="music-top"><b title={file?.name}>{title}</b><small>{bad ? 'Cannot play here' : `${ext} · ${fmtBytes(file?.size)}`}</small></span>
        <span className="music-bar" onClick={seek}><i style={{ width: `${dur ? Math.min(100, (at / dur) * 100) : 0}%` }} /></span>
        <span className="music-time"><small>{mmss(at)}</small><small>{dur ? mmss(dur) : '–:––'}</small></span>
      </span>
      {url && <a className="music-dl" href={url} download={file?.name} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Download">{I.download}</a>}
      {url && <audio ref={a} src={url} preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setAt(0) }} onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)} onError={() => setBad(true)} />}
    </span>
  )
}

/* ---------- a voice message ---------- */
export function AudioNote({ file }) {
  const [url, setUrl] = useState('')
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const a = useRef(null)
  useEffect(() => { let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  const dur = file?.dur || a.current?.duration || 0
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <span className="voice">
      <button type="button" className="voice-btn" disabled={!url} onClick={(e) => { e.stopPropagation(); const el = a.current; if (!el) return; if (el.paused) el.play(); else el.pause() }}>{playing ? I.pause : I.play}</button>
      <span className="voice-bar" onClick={(e) => { e.stopPropagation(); const el = a.current; if (!el || !dur) return; const r = e.currentTarget.getBoundingClientRect(); el.currentTime = ((e.clientX - r.left) / r.width) * dur }}>
        <i style={{ width: `${dur ? Math.min(100, (at / dur) * 100) : 0}%` }} />
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
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{I.play}<span>Video · {fmtBytes(file?.size)}</span><small>Tap to load</small></button>
  // videos can play by themselves, silent and on a loop (Settings > Data and Storage)
  if (!url) return <span className="pic-wait" />
  return (
    <span className="vid-box">
      <video ref={ref} className="pic-img ready" src={url} controls preload="metadata" autoPlay={play} muted={play} loop={play} playsInline onClick={(e) => e.stopPropagation()} />
      <VideoTools wide={wide} onWide={onWide} onCinema={onCinema && (() => { const v = ref.current; const at = v?.currentTime || 0; v?.pause(); onCinema({ kind: 'file', src: url, at }) })} />
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
  const [url, setUrl] = useState('')
  useEffect(() => { let alive = true; fileLink(m.file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path])
  return (
    <button type="button" className="media-thumb" onClick={onClick}>
      {url && (/^video\//.test(m.file?.type || '') ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" />)}
      {/^video\//.test(m.file?.type || '') && <i className="attach-play">{I.play}</i>}
    </button>
  )
}

/* the chat wallpapers as small tiles to pick from */
export function WallTiles({ value, onPick }) {
  return (
    <div className="walls">
      {WALLS.map(([k, l]) => (
        <button key={k} type="button" className={`wall-tile${value === k ? ' on' : ''}`} data-bg={k} onClick={() => onPick(k)}>
          <i className="wall-b">Hi!</i><i className="wall-b mine">Hello 👋</i><small>{l}</small>
        </button>
      ))}
    </div>
  )
}
