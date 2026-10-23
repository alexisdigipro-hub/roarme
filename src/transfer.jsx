import { useEffect, useRef, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, fmtBytes, supabase, withName } from './lib.js'
import { locale } from './i18n.js'
import { I, Modal } from './ui.jsx'
import { PLANS, planOf, r2Transfer } from './r2upload.js'

/* RoarTransfer (Alex, 16 Oct): its own window, as on WeTransfer. Pick or drop files, see how big they are against
   the 3 GB, send. The window shows the upload; "Keep chatting" closes it and the upload goes on in the
   chat. When it is done, each file has a small link anyone can download it from, for 3 days. */

export const TRANSFER_MAX = 3 * 1024 ** 3
export const TRANSFER_DAYS = 3
const untilDate = (ms = Date.now() + TRANSFER_DAYS * 864e5) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
// the leaf on the recommended durations (Alex, 23 Oct)
const LEAF = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z" /><path d="M5 19 13 11" /></svg>
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
  // RoarTransfer's own address since 21 Oct (Alex: roartransfer.com), as short as it can be: roartransfer.com/<token>
  // (older ?t= links keep working)
  const url = `https://roartransfer.com/${token}`
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

/* The RoarTransfer window (Alex, 22 Oct: "the same as roartransfer.com"): the files go to Cloudflare R2 through
   src/r2upload.js, 1 day up to 5 GB or 3 days up to 3 GB, and come back as ONE link for all of them, with a title,
   a message, a password and an email to you when someone downloads. The chat gets one card for the whole transfer
   (BundleCard). Closing the window while it uploads only hides it: the upload goes on and the card comes when done. */
export function TransferWindow({ title, hidden = false, onHide, onClose, onSent, onProgress }) {
  const [files, setFiles] = useState([])
  const [phase, setPhase] = useState('pick')
  const [days, setDays] = useState(1)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [pw, setPw] = useState('')
  const [notify, setNotify] = useState(true)
  const [done, setDone] = useState(0)
  const [res, setRes] = useState(null)
  const [over, setOver] = useState(false)
  const [copied, setCopied] = useState(false)
  // the admin's own tick (Alex, 22 Oct): the files are kept only in the hub's pCloud (roar-pcloud): they go up to R2
  // as always, pCloud fetches each one, and once it is whole there the link points to pCloud and R2's copy goes
  const [admin, setAdmin] = useState(false)
  const [toPc, setToPc] = useState(() => { try { return localStorage.getItem('roarme-pcloud') === '1' } catch { return false } })
  const [pc, setPc] = useState(null) // { busy } | { ok, path } | { err }
  useEffect(() => { supabase.rpc('roar_is_admin').then(({ data }) => setAdmin(data === true)) }, [])
  const pickPc = (v) => { setToPc(v); try { localStorage.setItem('roarme-pcloud', v ? '1' : '0') } catch { /* private window */ } }
  const job = useRef(null)
  const pick = useRef(null)
  const { max } = planOf(days)
  const total = files.reduce((n, f) => n + f.size, 0)
  const tooBig = total > max
  const add = (list) => setFiles((l) => [...l, ...list.filter((f) => !l.some((x) => x.name === f.name && x.size === f.size))])
  const p = total ? Math.min(1, done / total) : 0
  useEffect(() => { if (phase === 'up') onProgress?.(p) }, [p, phase]) // eslint-disable-line react-hooks/exhaustive-deps
  const until = (iso) => `${untilDate(new Date(iso).getTime())} ${untilTime(new Date(iso).getTime())}`

  const start = async () => {
    setPhase('up'); setDone(0)
    const opts = { days, title: name.trim(), message: note.trim(), password: pw, notify }
    job.current = r2Transfer({ onProgress: setDone })
    const r = await job.current.start(files, opts)
    setRes(r); setPhase('done')
    if (r.url) onSent?.({ ...r, title: opts.title, message: opts.message, locked: !!pw })
    if (admin && toPc && r.sent?.length) {
      setPc({ busy: true })
      const call = async (body) => {
        const { data, error } = await supabase.functions.invoke('roar-pcloud', { body })
        if (error || data?.error) throw new Error(data?.error || error?.message || 'pCloud did not answer')
        return data
      }
      try {
        let path = ''
        for (const m of r.sent) path = (await call({ token: m.token })).path || path
        let left = r.sent.map((m) => m.token)
        const until = Date.now() + 60 * 60e3
        while (left.length && Date.now() < until) {
          await new Promise((ok) => setTimeout(ok, 6000))
          const still = []
          for (const t of left) if (!(await call({ action: 'check', token: t, only: true })).done) still.push(t)
          left = still
          if (left.length) setPc({ busy: true, n: r.sent.length - left.length, of: r.sent.length })
        }
        if (left.length) throw new Error('pCloud is taking long. The link still works from RoarTransfer.')
        setPc({ ok: true, path })
      } catch (e) { setPc({ err: e.message }) }
    }
  }
  const cancel = () => { job.current?.stop() }
  // while it uploads, closing only hides the window
  const close = phase === 'up' ? onHide : onClose
  if (hidden) return null

  const R = 54
  const C = 2 * Math.PI * R
  return (
    <Modal title="RoarTransfer" onClose={close}>
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
                <span className="rt-bar"><i style={{ width: `${Math.min(100, (total / max) * 100)}%` }} /></span>
                <small><b>{fmtBytes(total)}</b>{` of ${max / 1024 ** 3} GB · ${files.length === 1 ? '1 file' : `${files.length} files`}`}</small>
              </div>
            )}
            {/* how long and how big, as on roartransfer.com: 1 day up to 5 GB (first, chosen, with the leaf), 3 days up to 3 GB,
                7 days up to 1 GB, and one small line why (Alex, 23 Oct) */}
            <div className="rt-plans" role="radiogroup" aria-label="How long the link lasts">
              {PLANS.map((x) => (
                <button key={x.days} type="button" role="radio" aria-checked={days === x.days} className={`rt-tile rt-plan${days === x.days ? ' on' : ''}`} onClick={() => setDays(x.days)}>
                  <i>{I.timer}</i><b>{x.days === 1 ? '1 day' : `${x.days} days`}{x.eco && <span className="rt-leaf" title="Recommended">{LEAF}</span>}</b><small>{`up to ${x.max / 1024 ** 3} GB · until ${untilDate(Date.now() + x.days * 864e5)}`}</small>
                </button>
              ))}
            </div>
            <p className="rt-eco">{LEAF}<span>The greener choice is also the bigger one: most files are picked up the same day, so a 1-day link spends less time on our servers and carries up to 5 GB.</span></p>
            {files.length > 0 && (
              <div className="rt-opts">
                <input className="rt-in" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} placeholder="Title (optional)" />
                <textarea className="rt-in" rows={2} value={note} onChange={(e) => setNote(e.target.value.slice(0, 2000))} placeholder="Message (optional)" />
                <label className="rt-in rt-pw">{I.lock}<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value.slice(0, 100))} placeholder="Password (optional)" /></label>
                <label className="rt-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /><span>Email me when it is downloaded</span></label>
                {admin && <label className="rt-check"><input type="checkbox" checked={toPc} onChange={(e) => pickPc(e.target.checked)} /><span>Keep it only in my pCloud</span></label>}
              </div>
            )}
            {files.length > 0 && <button type="button" className="rt-send" disabled={tooBig} onClick={start}>{tooBig ? `Over ${max / 1024 ** 3} GB` : 'Transfer'}{!tooBig && I.send}</button>}
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
            <p className="rt-sub">{fmtBytes(Math.min(done, total))} of {fmtBytes(total)}</p>
            <p className="rt-hint">You can keep chatting: it goes on uploading, and the link comes into the chat when it is done.</p>
            <div className="rt-acts">
              <button type="button" className="btn" onClick={cancel}>{I.x}<span>Stop</span></button>
              <button type="button" className="btn btn-main" onClick={onHide}>{I.check}<span>Keep chatting</span></button>
            </div>
          </>
        )}
        {phase === 'done' && res && (
          <>
            <span className={`rt-done${res.url ? '' : ' fail'}`}>{res.url ? I.check : I.x}</span>
            <p className="rt-title">{res.url ? 'Sent!' : 'Nothing was sent'}</p>
            {res.url && <p className="rt-sub">{`In ${title}, and anyone with the link can download until ${until(res.expires)}.`}</p>}
            {res.url && pw && <p className="rt-sub">It asks for the password.</p>}
            {res.errs.length > 0 && <p className="auth-err">{res.errs.join(' · ')}</p>}
            {pc && <p className={pc.err ? 'auth-err' : 'rt-sub'}>{pc.busy ? `Moving it to your pCloud…${pc.of ? ` ${pc.n}/${pc.of}` : ''} Keep RoarMe open.` : pc.err ? `pCloud: ${pc.err}` : `In your pCloud only: ${pc.path.replace(/^\//, '')}`}</p>}
            {res.url && (
              <button type="button" className={`rt-link${copied ? ' ok' : ''}`} onClick={async () => { try { await navigator.clipboard.writeText(res.url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* not allowed */ } }}>
                {copied ? I.check : I.link}<span>{copied ? 'Link copied' : res.url.replace('https://', '')}</span>
              </button>
            )}
            <button type="button" className="btn btn-main rt-go" onClick={onClose}><span>Done</span></button>
          </>
        )}
      </div>
    </Modal>
  )
}

/* one transfer in the chat: its title, its files, until when, Open and Copy link (the files live on roartransfer.com) */
export function BundleCard({ t }) {
  const [copied, setCopied] = useState(false)
  const files = t.files || []
  const size = files.reduce((n, f) => n + (f.size || 0), 0)
  const gone = t.expires && new Date(t.expires).getTime() < Date.now()
  const copy = async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(t.url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* not allowed */ } }
  return (
    <div className={`rt-card${gone ? ' gone' : ''}`}>
      <div className="rt-card-head"><TransferMark /><small>{`${files.length === 1 ? '1 file' : `${files.length} files`} · ${fmtBytes(size)}`}</small></div>
      {t.title && <b className="rt-card-title">{t.title}</b>}
      {t.message && <p className="rt-card-msg">{t.message}</p>}
      <ul className="rt-card-files">
        {files.slice(0, 5).map((f) => <li key={f.token || f.name}><span>{/^video\//.test(f.type) ? I.play : /^image\//.test(f.type) ? I.image : I.file}</span><b>{f.name}</b><small>{fmtBytes(f.size)}</small></li>)}
        {files.length > 5 && <li className="more"><small>{`and ${files.length - 5} more`}</small></li>}
      </ul>
      <p className="rt-card-until">{t.locked && <>{I.lock}<span>Password</span><span>·</span></>}<span>{gone ? 'Expired' : `Until ${untilDate(new Date(t.expires).getTime())} ${untilTime(new Date(t.expires).getTime())}`}</span></p>
      {!gone && (
        <div className="rt-card-acts">
          <a className="btn btn-main" href={t.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{I.download}<span>Open</span></a>
          <button type="button" className="btn" onClick={copy}>{copied ? I.check : I.link}<span>{copied ? 'Copied' : 'Copy link'}</span></button>
        </div>
      )}
    </div>
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

const PCLOUD_I = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z" /><path d="M12 15.5v-5M9.8 12.6 12 10.4l2.2 2.2" /></svg>
export function MyTransfers({ toast }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [show, setShow] = useState('all')
  const load = () => supabase.rpc('roar_my_transfers').then(({ data, error }) => { if (error) setErr(error.message); else setList(data || []) })
  useEffect(() => { load() }, [])
  // the admin can send any live one of their transfers to the hub's pCloud too (Alex, 22 Oct)
  const [admin, setAdmin] = useState(false)
  const [pcBusy, setPcBusy] = useState('')
  useEffect(() => { supabase.rpc('roar_is_admin').then(({ data }) => setAdmin(data === true)) }, [])
  const toPcloud = async (t) => {
    setPcBusy(t.path)
    const { data, error } = await supabase.functions.invoke('roar-pcloud', { body: { token: t.token } })
    setPcBusy('')
    toast?.(error || data?.error ? `pCloud: ${data?.error || error.message}` : `Going into your pCloud: ${String(data.path || '').replace(/^\//, '')}`)
  }
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
              {alive && <span className="rt-acts"><CopyLink file={{ path: t.path, name: t.name, size: t.size, type: t.type, expires: t.expires }} round />{admin && t.token && <button type="button" className="trx-round" disabled={pcBusy === t.path} onClick={() => toPcloud(t)} title="Save to my pCloud" aria-label="Save to my pCloud">{PCLOUD_I}</button>}{t.source === 'link' && <button type="button" className="trx-round" onClick={() => stop(t)} title="Stop the link" aria-label="Stop the link">{I.x}</button>}</span>}
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
