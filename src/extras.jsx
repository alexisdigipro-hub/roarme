import { useEffect, useRef, useState } from 'react'
import { errText, fileLink, fmtBytes, supabase, timeOf } from './lib.js'
import { DEFAULTS, EMOJIS, REACTIONS, TEXT_SIZES, chime, setPrefs, usePrefs } from './prefs.js'
import { I, Modal } from './ui.jsx'

/* ---------- emoji grid ---------- */
export function EmojiPicker({ onPick, onClose }) {
  return (
    <>
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
      <div className="emoji-pick">{EMOJIS.map((e) => <button key={e} type="button" onClick={() => onPick(e)}>{e}</button>)}</div>
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
export function VideoTile({ file }) {
  const [url, setUrl] = useState('')
  useEffect(() => { let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  return url ? <video className="pic-img" src={url} controls preload="metadata" onClick={(e) => e.stopPropagation()} /> : <span className="pic-wait" />
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
              <span className="person-text"><b>{m.kind === 'voice' ? 'Voice message' : m.file?.name}</b><small>{fmtBytes(m.file?.size)} · {new Date(m.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {timeOf(m.created_at)}</small></span>
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

/* ---------- chat settings, as in the THEMADLIONS chat ---------- */
const Switch = ({ on, set, children, hint }) => (
  <label className="set-row">
    <span className="set-text">{children}{hint && <small>{hint}</small>}</span>
    <span className="switch"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} /><span /></span>
  </label>
)
export function ChatSettings() {
  const p = usePrefs()
  return (
    <div className="chat-settings">
      <h4>Appearance</h4>
      <div className="set-box">
        <div className="set-row set-col">
          <span className="set-text">Mode</span>
          <span className="seg">{[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => <button key={k} type="button" className={p.mode === k ? 'on' : ''} onClick={() => setPrefs({ mode: k })}>{l}</button>)}</span>
        </div>
        <div className="set-row"><span className="set-text">Chat colours<small>Glass. More colours are coming soon.</small></span><span className="theme-dot" /></div>
        <div className="set-row set-col">
          <span className="set-text">Background</span>
          <span className="seg">{[['soft', 'Plain'], ['dots', 'Pattern']].map(([k, l]) => <button key={k} type="button" className={p.background === k ? 'on' : ''} onClick={() => setPrefs({ background: k })}>{l}</button>)}</span>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Text size<small>{TEXT_SIZES[p.textSize]} px</small></span>
          <input type="range" min="0" max={TEXT_SIZES.length - 1} step="1" value={p.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
        </div>
        <Switch on={p.bigEmoji} set={(v) => setPrefs({ bigEmoji: v })}>Large emoji</Switch>
        <Switch on={p.compact} set={(v) => setPrefs({ compact: v })}>Compact spacing</Switch>
      </div>
      <h4>General</h4>
      <div className="set-box">
        <Switch on={p.enterSends} set={(v) => setPrefs({ enterSends: v })} hint={p.enterSends ? 'Shift+Enter for a new line' : 'Cmd/Ctrl+Enter sends'}>Enter sends the message</Switch>
        <Switch on={p.spell} set={(v) => setPrefs({ spell: v })}>Check spelling while typing</Switch>
        <Switch on={p.faces} set={(v) => setPrefs({ faces: v })}>Faces next to messages in groups</Switch>
        <Switch on={p.largePhotos} set={(v) => setPrefs({ largePhotos: v })} hint="2560 px instead of 1600 px">Send large photos</Switch>
      </div>
      <h4>Reactions</h4>
      <div className="set-box">
        <div className="set-row set-col"><span className="set-text">Quick reaction</span><span className="seg seg-emoji">{REACTIONS.map((e) => <button key={e} type="button" className={p.quick === e ? 'on' : ''} onClick={() => setPrefs({ quick: e })}>{e}</button>)}</span></div>
        <div className="set-row set-col"><span className="set-text">Double click on a message</span><span className="seg">{[['react', 'Quick reaction'], ['reply', 'Reply']].map(([k, l]) => <button key={k} type="button" className={p.doubleTap === k ? 'on' : ''} onClick={() => setPrefs({ doubleTap: k })}>{l}</button>)}</span></div>
      </div>
      <h4>Notifications and sounds</h4>
      <div className="set-box">
        <div className="set-row is-off"><span className="set-text">Notifications with the app closed<small>Coming soon</small></span><span className="switch"><input type="checkbox" disabled /><span /></span></div>
        <div className="set-row">
          <span className="set-text">Sound when a message arrives</span>
          <button type="button" className="link" onClick={chime}>Play</button>
          <span className="switch"><input type="checkbox" checked={p.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} /><span /></span>
        </div>
      </div>
      <h4>Chat folders</h4>
      <div className="set-box"><Switch on={p.folderTags} set={(v) => setPrefs({ folderTags: v })} hint="Your folders under each chat in the list">Show folder tags</Switch></div>
      <h4>Keyboard shortcuts</h4>
      <div className="set-box keys">
        {[['⌘K / Ctrl+K', 'Search chats'], ['Enter', p.enterSends ? 'Send' : 'New line'], ['Shift+Enter', 'New line'], ['↑', 'Edit your last message'], ['Esc', 'Cancel, close'], ['Right click', 'Message menu'], ['Double click', p.doubleTap === 'reply' ? 'Reply' : 'Quick reaction']].map(([k, v]) => <div key={k} className="set-row"><span className="set-text">{v}</span><kbd>{k}</kbd></div>)}
      </div>
      <button type="button" className="btn set-reset" onClick={() => setPrefs(null)} disabled={JSON.stringify(p) === JSON.stringify(DEFAULTS)}>Back to standard</button>
    </div>
  )
}
