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
export function AttachSheet({ initial = [], onClose, onSend }) {
  const prefs = usePrefs()
  const [files, setFiles] = useState(initial)
  const [caption, setCaption] = useState('')
  const [compress, setCompress] = useState(prefs.compress)
  const gal = useRef(null)
  const cam = useRef(null)
  const doc = useRef(null)
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
      foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" disabled={!files.length} onClick={() => { setPrefs({ compress }); onSend(files, caption.trim(), compress) }}>Send</button></>}>
      <div className="attach-tabs">
        <button type="button" className="btn" onClick={() => gal.current?.click()}>{I.image} Gallery</button>
        <button type="button" className="btn" onClick={() => cam.current?.click()}>{I.camera} Camera</button>
        <button type="button" className="btn" onClick={() => doc.current?.click()}>{I.file} File</button>
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
      <label className="switch"><input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} /><span /> Compress photos</label>
      <input className="input" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Add a caption…" />
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
  useEffect(() => { let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
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
  useEffect(() => { let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
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
export function VideoTile({ file, auto = true, play = false }) {
  const [go, setGo] = useState(auto)
  const [url, setUrl] = useState('')
  useEffect(() => { if (!go) return undefined; let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path, go])
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{I.play}<span>Video · {fmtBytes(file?.size)}</span><small>Tap to load</small></button>
  // videos can play by themselves, silent and on a loop (Settings > Data and Storage)
  return url ? <video className="pic-img ready" src={url} controls preload="metadata" autoPlay={play} muted={play} loop={play} playsInline onClick={(e) => e.stopPropagation()} /> : <span className="pic-wait" />
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
            <button key={m.id} type="button" className="person" onClick={async () => { const u = await fileLink(m.file?.path); if (u) window.open(u, '_blank', 'noopener') }}>
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
  useEffect(() => { let alive = true; fileLink(m.file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path])
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
