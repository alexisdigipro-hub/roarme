import { useEffect, useRef, useState } from 'react'
import { SUPABASE_URL, fmtBytes, supabase } from './lib.js'
import { locale } from './i18n.js'
import { I, Modal, Wordmark } from './ui.jsx'

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
  const url = `${window.location.origin}${window.location.pathname}?t=${token}`
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

/* the page a download link opens (?t=…): no account needed, the file's name, size, expiry and a Download button */
export function TransferPage({ token }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'glass'
    fetch(`${SUPABASE_URL}/functions/v1/roar-transfer-get?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ error: 'offline' }))
  }, [token])
  const left = info?.expires ? new Date(info.expires).getTime() - Date.now() : 0
  const isVid = /^video\//.test(info?.type || '')
  const isImg = /^image\//.test(info?.type || '')
  return (
    <div className="rt-page">
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
            {/* one download counted for the sender's panel (Alex, 21 Oct; roar-transfer-get &dl=1) */}
            <a className="btn btn-main rt-go" href={info.url} download={info.name}
              onClick={() => { fetch(`${SUPABASE_URL}/functions/v1/roar-transfer-get?t=${encodeURIComponent(token)}&dl=1`, { keepalive: true }).catch(() => {}) }}>{I.download}<span>Download</span></a>
          </>
        )}
        <a className="rt-foot" href={`${window.location.origin}${window.location.pathname}`}><Wordmark by /></a>
      </div>
    </div>
  )
}
