import { useEffect, useRef, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, fmtBytes, supabase, withName } from './lib.js'
import { locale } from './i18n.js'
import { I, Modal } from './ui.jsx'

/* RoarTransfer (Alex, 16 Oct): its own window, as on WeTransfer. Pick or drop files, see how big they are against
   the 3 GB, send. The window shows the upload; "Keep chatting" closes it and the upload goes on in the
   chat. When it is done, each file has a small link anyone can download it from, for 3 days. */

export const TRANSFER_MAX = 3 * 1024 ** 3
export const TRANSFER_DAYS = 3
const untilDate = (ms = Date.now() + TRANSFER_DAYS * 864e5) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
const untilTime = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

export function TransferMark({ big = false }) {
  return (
    <span className={`rt-mark${big ? ' big' : ''}`}>
      <i>{I.transfer}</i>
      <b>Roar<span>Transfer</span></b>
    </span>
  )
}

/* the small download link of a transfer: made once per file and kept for this visit */
const links = new Map()
export async function transferLink(file) {
  if (!file?.path) return ''
  if (links.has(file.path)) return links.get(file.path)
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => abc[n % abc.length]).join('')
  const expires = file.expires || new Date(Date.now() + TRANSFER_DAYS * 864e5).toISOString()
  const { error } = await supabase.from('roar_transfer_links').insert({ token, path: file.path, name: file.name || 'file', size: file.size || 0, type: file.type || '', expires_at: expires })
  if (error) throw error
  // RoarTransfer's own address since 21 Oct (Alex: roartransfer.com); older ?t= links on RoarMe keep working
  const url = `https://roartransfer.com/?t=${token}`
  links.set(file.path, url)
  return url
}

export function CopyLink({ file, className = '', round = false }) {
  const [state, setState] = useState('')
  const copy = async (e) => {
    e.stopPropagation()
    setState('busy')
    try {
      const url = await transferLink(file)
      await navigator.clipboard.writeText(url)
      setState('done')
      setTimeout(() => setState(''), 1800)
    } catch {
      setState('fail')
      setTimeout(() => setState(''), 2200)
    }
  }
  const word = state === 'done' ? 'Link copied' : state === 'fail' ? 'Could not copy' : 'Copy download link'
  if (round) return <button type="button" className={`trx-round${state === 'done' ? ' ok' : ''}`} onClick={copy} disabled={state === 'busy'} title={word} aria-label={word}>{state === 'done' ? I.check : I.link}</button>
  return (
    <button type="button" className={`rt-link ${className}`} onClick={copy} disabled={state === 'busy'}>
      {state === 'done' ? I.check : I.link}<span>{state === 'done' ? 'Link copied' : state === 'fail' ? 'Could not copy' : 'Copy download link'}</span>
    </button>
  )
}

export function TransferWindow({ title, outbox, onStart, onClose }) {
  const [files, setFiles] = useState([])
  const [phase, setPhase] = useState('pick')
  const [batch] = useState(() => crypto.randomUUID())
  const [sent, setSent] = useState([])
  const [errs, setErrs] = useState([])
  const [over, setOver] = useState(false)
  const stop = useRef(false)
  const pick = useRef(null)
  const total = files.reduce((n, f) => n + f.size, 0)
  const tooBig = total > TRANSFER_MAX
  const add = (list) => setFiles((l) => [...l, ...list.filter((f) => !l.some((x) => x.name === f.name && x.size === f.size))])

  // how far the whole transfer has got: what is sent plus what is on its way
  const tiles = outbox.filter((o) => o.batch === batch)
  const doneBytes = sent.reduce((n, m) => n + (m.size || 0), 0)
  const upBytes = Math.min(total, doneBytes + tiles.reduce((n, o) => n + (o.stage === 'up' || o.stage === 'send' ? (o.size || 0) * (o.p || 0) : 0), 0))
  const p = total ? upBytes / total : 0

  const start = () => {
    setPhase('up')
    onStart(files, '', {
      batch,
      stopped: () => stop.current,
      onFile: (meta) => setSent((l) => [...l, meta]),
      onError: (name, msg) => setErrs((l) => [...l, `${name}: ${msg}`]),
      onEnd: () => setPhase('done'),
    })
  }
  const cancel = () => { stop.current = true; tiles.forEach((o) => o.holder?.abort?.()) }

  const R = 54
  const C = 2 * Math.PI * R
  return (
    <Modal title="RoarTransfer" onClose={onClose}>
      {/* fresher (Alex, 17 Oct): the mark at the top left like the card in the chat, a glowing drop area, three small
          fact tiles (size, days, link) and one pill to send */}
      <div className={`rt is-${phase}`}>
        <div className="rt-top"><TransferMark /></div>
        {phase === 'pick' && (
          <>
            <button type="button" className={`rt-drop${over ? ' over' : ''}${files.length ? ' has' : ''}`} onClick={() => pick.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); add([...(e.dataTransfer?.files || [])]) }}>
              <i>{files.length ? I.plus : I.transfer}</i>
              <span className="rt-drop-text">
                <b>{files.length ? 'Add more' : 'Drop your files here'}</b>
                <small>{files.length ? 'or drop them here' : 'or click to choose them'}</small>
              </span>
            </button>
            <input ref={pick} type="file" multiple hidden onChange={(e) => { add([...(e.target.files || [])]); e.target.value = '' }} />
            {files.length > 0 && (
              <ul className="rt-files">
                {files.map((f, n) => (
                  <li key={`${f.name}-${n}`}>
                    <span className="rt-file-ico">{/^video\//.test(f.type) ? I.play : /^image\//.test(f.type) ? I.image : I.file}</span>
                    <span className="rt-file-text"><b>{f.name}</b><small>{fmtBytes(f.size)}</small></span>
                    <button type="button" className="rt-x" onClick={() => setFiles((l) => l.filter((_, k) => k !== n))} aria-label="Remove">{I.x}</button>
                  </li>
                ))}
              </ul>
            )}
            {files.length > 0 && (
              <div className={`rt-meter${tooBig ? ' over' : ''}`}>
                <span className="rt-bar"><i style={{ width: `${Math.min(100, (total / TRANSFER_MAX) * 100)}%` }} /></span>
                <small><b>{fmtBytes(total)}</b> of 3 GB · {files.length === 1 ? '1 file' : `${files.length} files`}</small>
              </div>
            )}
            <div className="rt-tiles">
              <span className="rt-tile"><i>{I.transfer}</i><b>3 GB</b><small>per transfer</small></span>
              <span className="rt-tile t-time"><i>{I.timer}</i><b>3 days</b><small>until {untilDate()}</small></span>
              <span className="rt-tile"><i>{I.link}</i><b>Link</b><small>for anyone</small></span>
            </div>
            {/* the send pill comes in only once there are files (Alex, 17 Oct: a dead button before that says nothing) */}
            {files.length > 0 && <button type="button" className="rt-send" disabled={tooBig} onClick={start}>{tooBig ? 'Over 3 GB' : 'Transfer'}{!tooBig && I.send}</button>}
          </>
        )}
        {phase === 'up' && (
          <>
            <span className="rt-ring">
              <svg viewBox="0 0 128 128" width="160" height="160" aria-hidden="true">
                <circle cx="64" cy="64" r={R} className="ring-track" />
                <circle cx="64" cy="64" r={R} className="rt-ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
              </svg>
              <b>{Math.round(p * 100)}%</b>
            </span>
            <p className="rt-sub">{fmtBytes(upBytes)} of {fmtBytes(total)} · {sent.length} of {files.length} sent</p>
            <p className="rt-hint">You can keep chatting: it goes on uploading in the chat.</p>
            <div className="rt-acts">
              <button type="button" className="btn" onClick={cancel}>{I.x}<span>Stop</span></button>
              <button type="button" className="btn btn-main" onClick={onClose}>{I.check}<span>Keep chatting</span></button>
            </div>
          </>
        )}
        {phase === 'done' && (
          <>
            <span className={`rt-done${sent.length ? '' : ' fail'}`}>{sent.length ? I.check : I.x}</span>
            <p className="rt-title">{sent.length ? (sent.length === 1 ? 'Sent!' : `${sent.length} files sent!`) : 'Nothing was sent'}</p>
            {sent.length > 0 && <p className="rt-sub">In {title}, and anyone with the link can download until {untilDate(new Date(sent[0].expires).getTime())} {untilTime(new Date(sent[0].expires).getTime())}.</p>}
            {errs.length > 0 && <p className="auth-err">{errs.join(' · ')}</p>}
            {sent.length > 0 && (
              <ul className="rt-files">
                {sent.map((m) => (
                  <li key={m.path}>
                    <span className="rt-file-ico">{/^video\//.test(m.type) ? I.play : /^image\//.test(m.type) ? I.image : I.file}</span>
                    <span className="rt-file-text"><b>{m.name}</b><small>{fmtBytes(m.size)}</small></span>
                    <CopyLink file={m} className="small" />
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btn-main rt-go" onClick={onClose}><span>Done</span></button>
          </>
        )}
      </div>
    </Modal>
  )
}

/* one open or one download for the sender's panel (roar_transfer_hit). keepalive: a click on Download starts the file
   at once and the browser drops an ordinary request on the way, so downloads stayed at 0 (Alex, 21 Oct) */
const countHit = (t, dl) => fetch(`${SUPABASE_URL}/rest/v1/rpc/roar_transfer_hit`, {
  method: 'POST', keepalive: true,
  headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ t, dl }),
}).catch(() => {})

/* the page a download link opens (?t=…): no account needed, the file's name, size, expiry and a Download button */
// one of Alex's stills behind the card, a new one each visit, as on RoarTransfer's own page (public/transfer/stills)
const STILLS = ['salon', 'shoes', 'tartan', 'corridor', 'sunflower', 'silhouette']
export function TransferPage({ token }) {
  const [info, setInfo] = useState(null)
  const [still] = useState(() => `${import.meta.env.BASE_URL}transfer/stills/${STILLS[Math.floor(Math.random() * STILLS.length)]}.webp`)
  const [bgOn, setBgOn] = useState(false)
  useEffect(() => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'glass'
    fetch(`${SUPABASE_URL}/functions/v1/roar-transfer-get?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { setInfo(d); if (!d?.error) countHit(token, false) })
      .catch(() => setInfo({ error: 'offline' }))
  }, [token])
  const left = info?.expires ? new Date(info.expires).getTime() - Date.now() : 0
  const isVid = /^video\//.test(info?.type || '')
  const isImg = /^image\//.test(info?.type || '')
  return (
    <div className="rt-page">
      {/* Alex, 21 Oct: the changing pictures and the same frosted glass as RoarTransfer's own page */}
      <div className={`rt-bg${bgOn ? ' on' : ''}`} aria-hidden="true"><img src={still} alt="" onLoad={() => setBgOn(true)} /></div>
      <div className="rt-card">
        <TransferMark big />
        {!info && <span className="pic-wait rt-wait" />}
        {info?.error && (
          <>
            <span className="rt-done fail">{info.error === 'offline' ? I.x : I.timer}</span>
            <p className="rt-title">{info.error === 'expired' ? 'This transfer has expired' : info.error === 'offline' ? 'Could not reach RoarTransfer' : 'This link does not work'}</p>
            <p className="rt-sub">{info.error === 'expired' ? 'Files on RoarTransfer are kept 3 days. Ask for it to be sent again.' : info.error === 'offline' ? 'Check the connection and try again.' : 'Check that the whole link was copied.'}</p>
          </>
        )}
        {info && !info.error && (
          <>
            <p className="rt-sub">Someone sent you a file with RoarMe.</p>
            {isVid && info.view && <video className="rt-preview" src={info.view} controls playsInline preload="metadata" />}
            {isImg && info.view && <img className="rt-preview" src={info.view} alt="" />}
            <ul className="rt-files">
              <li>
                <span className="rt-file-ico">{isVid ? I.play : isImg ? I.image : I.file}</span>
                <span className="rt-file-text"><b>{info.name}</b><small>{fmtBytes(info.size)}</small></span>
              </li>
            </ul>
            <div className="rt-facts"><span className={`tr-exp${left < 864e5 ? ' soon' : ''}`}>{I.timer}<span>Expires {untilDate(Date.now() + left)} {untilTime(Date.now() + left)}</span></span></div>
            <a className="btn btn-main rt-go" href={withName(info.url, info.name)} download={info.name} onClick={() => countHit(token, true)}>{I.download}<span>Download</span></a>
          </>
        )}
      </div>
    </div>
  )
}

/* Settings > RoarTransfer (Alex, 21 Oct): everything this person sent with RoarTransfer, newest first: where it went,
   how big, how long it stays, how many opened the link and downloaded it; Copy link while it lives, Stop on an emailed one.
   The data: roar_my_transfers (one row per file, from the chats and from RoarMail links). */
const dayOf = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
const leftOf = (iso) => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return ''
  const h = Math.round(ms / 36e5)
  return h < 24 ? `${Math.max(1, h)} h left` : `${Math.round(h / 24)} days left`
}
export const transferIcon = (type = '') => (/^video\//.test(type) ? I.play : /^image\//.test(type) ? I.image : /^audio\//.test(type) ? I.mic : I.file)
export const transferAlive = (t) => !t.deleted && !t.stopped && new Date(t.expires).getTime() > Date.now()

export function MyTransfers({ toast }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [show, setShow] = useState('all')
  const load = () => supabase.rpc('roar_my_transfers').then(({ data, error }) => { if (error) setErr(error.message); else setList(data || []) })
  useEffect(() => { load() }, [])
  const stop = async (t) => {
    if (!window.confirm(`Stop the link to ${t.name}? Nobody can download it any more.`)) return
    const { error } = await supabase.rpc('roar_transfer_stop', { p: t.path })
    if (error) { toast?.(error.message); return }
    toast?.('Link stopped'); load()
  }
  const all = list || []
  const live = all.filter(transferAlive)
  const shown = show === 'live' ? live : all
  const sum = (l, k) => l.reduce((a, t) => a + Number(t[k] || 0), 0)
  return (
    <div className="adm rt-panel">
      <div className="adm-stats rt-stats">
        <span><b>{list ? all.length : '…'}</b><small>Sent</small></span>
        <span><b>{list ? fmtBytes(sum(all, 'size')) : '…'}</b><small>In all</small></span>
        <span><b>{list ? live.length : '…'}</b><small>Live now</small></span>
        <span><b>{list ? sum(all, 'downloads') : '…'}</b><small>Downloads</small></span>
      </div>
      <div className="seg rt-seg">
        <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
        <button type="button" className={show === 'live' ? 'on' : ''} onClick={() => setShow('live')}>Live</button>
      </div>
      {err && <p className="adm-err">{err}</p>}
      <div className="adm-list">
        {!list && !err && <p className="muted">Loading…</p>}
        {list && !shown.length && <p className="muted">{show === 'live' ? 'Nothing live right now.' : 'You have not sent anything with RoarTransfer yet. Files over 50 MB in a chat go with it.'}</p>}
        {shown.map((t) => {
          const alive = transferAlive(t)
          return (
            <div key={t.path} className={`adm-row rt-row${alive ? '' : ' gone'}`}>
              <span className="adm-ico tr">{transferIcon(t.type)}</span>
              <span className="adm-main">
                <b title={t.name}>{t.name}</b>
                <small>{t.source === 'link' ? 'By email' : t.room_kind === 'group' ? (t.room_title || 'A group') : 'A private chat'} · {dayOf(t.created_at)}</small>
              </span>
              {alive && <span className="rt-acts"><CopyLink file={{ path: t.path, name: t.name, size: t.size, type: t.type, expires: t.expires }} round />{t.source === 'link' && <button type="button" className="trx-round" onClick={() => stop(t)} title="Stop the link" aria-label="Stop the link">{I.x}</button>}</span>}
              <span className="adm-chips">
                <i>{fmtBytes(Number(t.size || 0))}</i>
                <i className={alive ? 'tr' : 'gone'}>{t.deleted ? 'Deleted' : t.stopped ? 'Stopped' : alive ? leftOf(t.expires) : 'Expired'}</i>
                <i>{Number(t.opens || 0)} opened</i>
                <i>{Number(t.downloads || 0)} downloaded{t.last_download ? ` · last ${dayOf(t.last_download)}` : ''}</i>
              </span>
            </div>
          )
        })}
      </div>
      <p className="adm-note muted">Files stay 3 days, then they are removed; the list keeps them. Opens and downloads count the people who used a download link.</p>
    </div>
  )
}
