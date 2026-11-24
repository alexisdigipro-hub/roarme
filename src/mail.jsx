// RoarMail inside RoarMe (Alex, 24 Nov). A switch only Alex sees (Settings, inThemeLab), kept on this device; on, the gold
// ROARMAIL folder joins the folder bar. Its inside in three steps, as RoarMail on the Mac (sample
// https://claude.ai/artifact/SodwiHjKHvXDTjZmKjTTAU, "Μ' αρέσει, ξεκίνα"): 1 the accounts (All Inboxes, then each account
// with its picture and address), 2 an account's folders (Inbox, Drafts, Sent, Junk, Trash, Archive, then its own), 3 the
// folder's mails, and a mail opens over them. The accounts and folders come from the Roar Account (roarmail_sync, which
// RoarMail on the computer keeps); the mail itself is read through RoarMe's Edge Function roarmail-cloud, for the
// accounts sent there with RoarMail's Send to RoarMe (their passwords locked in Supabase Vault).
import { useEffect, useMemo, useRef, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, supabase } from './lib.js'
import { Avatar, I } from './ui.jsx'
import { onPhone } from './push.js'

const KEY = 'roarme-mail-on'
// only on a phone (Alex, 24 Nov: "the mail in our chat is only for the phone; on the desktop there is the app itself")
export const mailHere = () => onPhone()
export const mailSwitchNow = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export const mailSwitchSet = (v) => {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent('roarme-mail-switch', { detail: !!v }))
}

const s = (d, f) => <svg viewBox="0 0 24 24" width="20" height="20" fill={f ? 'currentColor' : 'none'} stroke={f ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
export const MAIL_I = {
  mail: s(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" /></>),
  inbox: s(<><path d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 13h5l1 2h4l1-2h5" /></>),
  drafts: s(<><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4" /></>),
  sent: s(<><path d="M21 3L3 10.5l7 3 3 7z" /><path d="M10 13.5L21 3" /></>),
  spam: s(<><circle cx="12" cy="12" r="9" /><path d="M6 6l12 12" /></>),
  trash: s(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />),
  archive: s(<><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v10h14V9M10 13h4" /></>),
  flagged: s(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />),
  folder: s(<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />),
  back: s(<path d="M15 5l-7 7 7 7" />),
  chev: s(<path d="M9 5l7 7-7 7" />),
  search: s(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>),
  unread: s(<circle cx="12" cy="12" r="5" />, 1),
  star: s(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />),
  starF: s(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />, 1),
  clip: s(<path d="M20 11l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />),
  markUnread: s(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" /><circle cx="19" cy="6" r="3" fill="currentColor" stroke="none" /></>),
  img: s(<><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></>),
}
const FILTERS = [['search', 'Search'], ['unread', 'Unread'], ['star', 'Starred'], ['clip', 'With attachments']]
// the folders every account has, in RoarMail's order; for All Inboxes the same, across the accounts
const ROLES = [['inbox', 'Inbox'], ['drafts', 'Drafts'], ['sent', 'Sent'], ['spam', 'Junk'], ['trash', 'Trash'], ['archive', 'Archive']]
const ROLE_I = { inbox: 'inbox', drafts: 'drafts', sent: 'sent', spam: 'spam', trash: 'trash', archive: 'archive', flagged: 'flagged' }

// the gold word, as PROJECTS: ROAR bold in gold, MAIL thin in the words' colour
export const MailWord = () => <span className="tab-gold"><b>ROAR</b><i>MAIL</i></span>

/** RoarMail's setup from the Roar Account: the accounts (with their pictures) and their folders */
async function loadSetup() {
  const { data, error } = await supabase.from('roarmail_sync').select('data').maybeSingle()
  if (error) throw error
  const T = data?.data?.tables || {}
  const accounts = (T.accounts || []).filter((a) => a.enabled !== 0 && a.enabled !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((a) => ({ id: String(a.id), email: a.email, name: a.description || a.display_name || a.email.split('@')[0], color: a.color || '#3aa7e8', avatar: /^data:image\/|^https:\/\//.test(a.avatar || '') ? a.avatar : '' }))
  const folders = (T.folders || []).filter((f) => !f.hidden).map((f) => ({ account: String(f.account_id), path: f.path, name: f.name || f.path.split(f.delimiter || '/').pop(), role: f.role || '' }))
  return { accounts, folders }
}

async function cloud(body) {
  const { data, error } = await supabase.functions.invoke('roarmail-cloud', { body })
  if (error) {
    let msg = error.message
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error } catch { /* as is */ }
    throw new Error(msg)
  }
  return data
}

const when = (d) => {
  const t = new Date(d); if (Number.isNaN(t.getTime())) return ''
  const now = new Date()
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (t.toDateString() === y.toDateString()) return 'Yesterday'
  return t.toLocaleDateString([], t.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}
const nameOf = (p) => p ? (p.name || p.address || '') : ''
const sizeOf = (n) => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`

function AccPic({ a, size = 50 }) {
  if (a.id === 'all') return <span className="av av-init rmx-all" style={{ width: size, height: size, '--ia': '#5cc0f2', '--ib': '#3aa7e8' }}>{MAIL_I.inbox}</span>
  return <Avatar src={a.avatar} name={a.name} size={size} />
}

function Crumb({ title, sub, pic, onBack }) {
  return (
    <div className="rmx-crumb">
      <button type="button" className="round" onClick={onBack} aria-label="Back" data-back="">{MAIL_I.back}</button>
      {pic}
      <span className="rmx-cw"><b>{title}</b>{sub && <small>{sub}</small>}</span>
    </div>
  )
}

const listCache = new Map()

// a slide right goes one step back, a slide left one step on (Alex, 24 Nov: "swipe right and left in all the mail"); the
// page follows the finger a little and springs back if let go early; fields, the mail's own frame and files are left alone
function useSlide(onRight, onLeft) {
  const g = useRef(null)
  const el = useRef(null)
  const put = (x, ease) => { const n = el.current; if (!n) return; n.style.transition = ease ? 'transform .26s cubic-bezier(.22,1,.36,1)' : 'none'; n.style.transform = x ? `translate3d(${x}px,0,0)` : '' }
  return {
    ref: el,
    onTouchStart: (e) => { put(0); if (e.touches.length !== 1 || e.target.closest('input, textarea, .rmx-files')) { g.current = null; return } g.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: '', t: Date.now() } },
    onTouchMove: (e) => {
      const s = g.current; if (!s) return
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y
      if (!s.lock) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y' }
      if (s.lock !== 'x') return
      const can = dx > 0 ? onRight : onLeft
      s.dx = dx
      put(can ? dx * 0.55 : dx * 0.12)
    },
    onTouchEnd: () => {
      const s = g.current; g.current = null
      if (!s || s.lock !== 'x') return
      const fast = Math.abs(s.dx || 0) > 30 && Date.now() - s.t < 260
      const go = Math.abs(s.dx || 0) > 80 || fast
      put(0, true)
      if (!go) return
      if (s.dx > 0 && onRight) onRight(); else if (s.dx < 0 && onLeft) onLeft()
    },
    // the iPhone cancels a touch once it decides the page is being scrolled: the page goes back to its place, never
    // left shifted to one side (Alex, 24 Nov: "most pages spill out sideways")
    onTouchCancel: () => { g.current = null; put(0, true) },
  }
}

export function MailView() {
  const [setup, setSetup] = useState(null)       // null loading · { accounts, folders } · { error }
  const [on, setOn] = useState(null)             // the accounts RoarMe can read: Map id -> { status, error }
  const [counts, setCounts] = useState({})       // account id -> unread in its Inbox
  const [step, setStep] = useState({ s: 'accs' }) // accs · folders { acc } · list { acc, role|path, name } · read
  const [fwd, setFwd] = useState(null) // the step a slide right left, so a slide left can go on to it again
  const back = (to) => { setFwd(step); setStep(to) }
  const foldSlide = useSlide(() => back({ s: 'accs' }), fwd && fwd.s === 'list' && fwd.acc === step.acc ? () => setStep(fwd) : null)
  useEffect(() => {
    let gone = false
    loadSetup().then((x) => { if (!gone) setSetup(x) }, (e) => { if (!gone) setSetup({ error: e.message || 'Could not read RoarMail' }) })
    cloud({ action: 'state' }).then((j) => { if (!gone) setOn(new Map((j.accounts || []).map((a) => [a.account_id, a]))) }, () => { if (!gone) setOn(new Map()) })
    return () => { gone = true }
  }, [])
  const accounts = setup?.accounts || []
  const inboxOf = (id) => setup?.folders.find((f) => f.account === id && f.role === 'inbox')?.path || 'INBOX'
  // unread in each Inbox, once the accounts in RoarMe are known
  useEffect(() => {
    if (!setup?.accounts || !on || !on.size) return
    const items = setup.accounts.filter((a) => on.has(a.id)).map((a) => ({ account: a.id, path: inboxOf(a.id) }))
    if (!items.length) return
    cloud({ action: 'counts', items }).then((j) => {
      const c = {}; for (const it of items) c[it.account] = j.counts?.[`${it.account}|${it.path}`]?.unseen || 0
      setCounts(c)
    }, () => {})
  }, [setup, on])
  // unread in every folder of the account opened (Alex, 24 Nov: "the numbers of the unread on the folders"); for All
  // Inboxes every account's folder of each kind. Asked 30 at a time, kept for the visit.
  const [fcounts, setFcounts] = useState({})
  useEffect(() => {
    if (step.s !== 'folders' || !setup?.folders || !on || !on.size) return
    const items = setup.folders.filter((f) => on.has(f.account) && (step.acc === 'all' ? ROLES.some(([r]) => r === f.role) : f.account === step.acc))
      .map((f) => ({ account: f.account, path: f.path }))
    if (!items.length) return
    let gone = false
    for (let i = 0; i < items.length; i += 30) {
      cloud({ action: 'counts', items: items.slice(i, i + 30) }).then((j) => { if (!gone) setFcounts((c) => ({ ...c, ...Object.fromEntries(Object.entries(j.counts || {}).map(([k, v]) => [k, v.unseen || 0])) })) }, () => {})
    }
    return () => { gone = true }
  }, [step.s, step.acc, setup, on])

  if (setup === null) return <div className="rmx-wait"><span className="rmx-wait-ico">{MAIL_I.mail}</span><p>Looking for your RoarMail accounts…</p></div>
  if (setup.error || !accounts.length) {
    return (
      <div className="rmx-wait"><span className="rmx-wait-ico">{MAIL_I.mail}</span>
        <p>No RoarMail accounts yet.</p>
        <small>Add your accounts in RoarMail on your computer, signed in with this Roar Account, and they show here.</small>
      </div>
    )
  }
  const all = { id: 'all', name: 'All Inboxes', email: `${accounts.length} accounts` }
  const accOf = (id) => id === 'all' ? all : accounts.find((a) => a.id === id)
  const total = Object.values(counts).reduce((x, n) => x + n, 0)

  if (step.s === 'accs') {
    return (
      <div className="rmx rmx-accl">
        {[all, ...accounts].map((a) => {
          const n = a.id === 'all' ? total : counts[a.id] || 0
          const off = a.id !== 'all' && on && !on.has(a.id)
          return (
            <button key={a.id} type="button" className="room rmx-accrow" onClick={() => { if (fwd?.acc !== a.id) setFwd(null); setStep({ s: 'folders', acc: a.id }) }}>
              <AccPic a={a} />
              <span className="room-main">
                <span className="room-top"><strong>{a.name}</strong></span>
                <span className="room-bottom"><span className="room-prev">{off ? `${a.email} · not in RoarMe yet` : a.email}</span>{n > 0 && <span className="badge">{n}</span>}</span>
              </span>
              <i className="rmx-chev">{MAIL_I.chev}</i>
            </button>
          )
        })}
      </div>
    )
  }

  const acc = accOf(step.acc) || all
  if (step.s === 'folders') {
    const mine = acc.id === 'all' ? [] : setup.folders.filter((f) => f.account === acc.id)
    const roleRows = ROLES.map(([role, label]) => {
      if (acc.id === 'all') return { key: role, role, name: `All ${label === 'Inbox' ? 'Inboxes' : label}`, icon: ROLE_I[role] }
      const f = mine.find((x) => x.role === role)
      return f ? { key: f.path, path: f.path, role, name: label, icon: ROLE_I[role] } : null
    }).filter(Boolean)
    const own = mine.filter((f) => !f.role || !ROLES.some(([r]) => r === f.role)).filter((f) => f.role !== 'flagged')
      .sort((a, b) => a.path.localeCompare(b.path))
    const off = acc.id !== 'all' && on && !on.has(acc.id)
    // a folder's unread: its own count, or for All Inboxes the sum over the accounts' folders of that kind
    const unreadOf = (r) => r.path ? fcounts[`${acc.id}|${r.path}`] || 0
      : setup.folders.filter((f) => f.role === r.role).reduce((n, f) => n + (fcounts[`${f.account}|${f.path}`] || 0), 0)
    const open = (r) => { setFwd(null); setStep({ s: 'list', acc: acc.id, role: r.role, path: r.path, name: r.name }) }
    return (
      <div className="rmx rmx-fl" {...foldSlide}>
        <Crumb title={acc.name} sub={acc.email} pic={<AccPic a={acc} size={34} />} onBack={() => back({ s: 'accs' })} />
        {off && <p className="rmx-note">To read this account here, open RoarMail on your computer: Settings › Roar Account › My mail in RoarMe › Send to RoarMe.</p>}
        <div className="rmx-box">
          {roleRows.map((r) => (
            <button key={r.key} type="button" className="rmx-fr" onClick={() => open(r)}>
              {MAIL_I[r.icon]}<span>{r.name}</span>
              {unreadOf(r) > 0 && <span className="badge">{unreadOf(r)}</span>}
              <i className="rmx-chev">{MAIL_I.chev}</i>
            </button>
          ))}
        </div>
        {own.length > 0 && <>
          <div className="rmx-ft">Folders</div>
          <div className="rmx-box">
            {own.map((f) => (
              <button key={f.path} type="button" className="rmx-fr" onClick={() => open({ path: f.path, name: f.name })}>
                {MAIL_I.folder}<span>{f.name}</span>{unreadOf(f) > 0 && <span className="badge">{unreadOf(f)}</span>}<i className="rmx-chev">{MAIL_I.chev}</i>
              </button>
            ))}
          </div>
        </>}
      </div>
    )
  }

  // which folders of which accounts this list reads: one folder, or for All Inboxes every account's folder of that role
  const targets = acc.id === 'all'
    ? accounts.filter((a) => on?.has(a.id)).map((a) => ({ account: a.id, path: setup.folders.find((f) => f.account === a.id && f.role === step.role)?.path })).filter((x) => x.path)
    : [{ account: acc.id, path: step.path }]
  return <MailList key={`${step.acc}|${step.path || step.role}${step.unseen ? '|u' : ''}`} acc={acc} step={step} targets={targets} accounts={accounts} folders={setup.folders}
    offline={acc.id !== 'all' && on && !on.has(acc.id)} onBack={() => back(step.unseen ? { s: 'accs' } : { s: 'folders', acc: step.acc })} />
}

function MailList({ acc, step, targets, accounts, folders, offline, onBack }) {
  const ck = `${acc.id}|${step.path || step.role}${step.unseen ? '|u' : ''}`
  const [rows, setRows] = useState(() => listCache.get(ck)?.rows || null)
  const [more, setMore] = useState(() => listCache.get(ck)?.more ?? true)
  const [page, setPage] = useState(() => listCache.get(ck)?.page || 0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const lastOpen = useRef(null)
  const load = async (p = 0) => {
    if (!targets.length) { setRows([]); setMore(false); return }
    setBusy(true); setErr('')
    try {
      const j = await cloud({ action: 'list', items: targets, limit: 30, page: p, unseen: !!step.unseen })
      const errs = Object.values(j.errors || {}).filter((e) => e !== 'missing')
      if (errs.length && !(j.items || []).length) setErr(errs[0])
      const got = j.items || []
      setRows((r) => {
        const next = p === 0 ? got : [...(r || []), ...got.filter((x) => !(r || []).some((y) => y.account === x.account && y.path === x.path && y.uid === x.uid))]
        const hasMore = Object.entries(j.totals || {}).some(([, t]) => t > 30 * (p + 1))
        listCache.set(ck, { rows: next, more: hasMore, page: p })
        setMore(hasMore)
        return next
      })
      setPage(p)
    } catch (e) { setErr(e.message || 'Could not read the mail') }
    setBusy(false)
  }
  useEffect(() => { if (!offline) load(0) }, [])
  const colourOf = (id) => accounts.find((a) => a.id === id)?.color
  const shown = useMemo(() => (rows || []).filter((m) => {
    if (filter === 'unread' && m.seen) return false
    if (filter === 'star' && !m.flagged) return false
    if (filter === 'clip' && !m.files) return false
    const k = q.trim().toLowerCase()
    if (k && !`${nameOf(m.from)} ${m.from?.address} ${m.subject} ${m.snippet}`.toLowerCase().includes(k)) return false
    return true
  }), [rows, filter, q])
  const patch = (m, p) => setRows((r) => { const next = (r || []).map((x) => x === m || (x.account === m.account && x.path === m.path && x.uid === m.uid) ? { ...x, ...p } : x); listCache.set(ck, { rows: next, more, page }); return next })
  const drop = (m) => setRows((r) => { const next = (r || []).filter((x) => !(x.account === m.account && x.path === m.path && x.uid === m.uid)); listCache.set(ck, { rows: next, more, page }); return next })
  const same = (a, b) => a && b && a.account === b.account && a.path === b.path && a.uid === b.uid
  const openMail = (m) => { lastOpen.current = m; setOpen(m); if (!m.seen) patch(m, { seen: true }) }
  const nextOf = (m) => { const i = shown.findIndex((x) => same(x, m)); return i >= 0 ? shown[i + 1] : null }
  const listSlide = useSlide(onBack, lastOpen.current && !open ? () => setOpen(lastOpen.current) : null)

  if (open) {
    const nx = nextOf(open)
    return <MailRead key={`${open.account}|${open.path}|${open.uid}`} m={open} accounts={accounts} folders={folders} onBack={() => setOpen(null)} onNext={nx ? () => openMail(nx) : null}
      onSeen={(v) => patch(open, { seen: v })} onFlag={(v) => { patch(open, { flagged: v }); setOpen({ ...open, flagged: v }) }} onGone={() => { drop(open); setOpen(null) }} />
  }
  return (
    <div className="rmx rmx-ml" {...listSlide}>
      {/* back, the folder and its filters in one slim capsule of liquid glass (Alex, 24 Nov, B of
          https://claude.ai/artifact/BWSMApRMEgeGjPpgRXjeut) */}
      <div className="rmx-head">
        <Crumb title={step.name} sub={step.unseen ? 'Every account' : acc.id === 'all' ? 'All accounts' : acc.email} onBack={onBack} />
        <div className="rmx-fbar">
          <span className="rmx-filters">
            {FILTERS.map(([k, label]) => <button key={k} type="button" className={`round${filter === k ? ' on' : ''}`} aria-label={label} title={label} onClick={() => { setFilter((f) => (f === k ? '' : k)); if (k !== 'search') setQ('') }}>{MAIL_I[k]}</button>)}
          </span>
        </div>
      </div>
      {filter === 'search' && <label className="search rmx-search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these mails" /></label>}
      {offline ? <p className="rmx-note">To read this account here, open RoarMail on your computer: Settings › Roar Account › My mail in RoarMe › Send to RoarMe.</p>
        : rows === null ? <p className="muted rooms-none">{busy ? 'Getting your mail…' : ''}</p>
        : err && !rows.length ? <p className="rmx-note">{err}</p>
        : !shown.length ? <p className="muted rooms-none">{targets.length ? 'Nothing here.' : 'No account is in RoarMe yet. Send one from RoarMail on your computer.'}</p>
        : shown.map((m) => (
          <button key={`${m.account}|${m.path}|${m.uid}`} type="button" className={`room rmx-row${m.seen ? '' : ' rmx-un'}`} onClick={() => openMail(m)}>
            <Avatar name={nameOf(m.from) || '?'} size={50} />
            <span className="room-main">
              <span className="room-top"><strong>{nameOf(m.from) || '(no sender)'}</strong><small>{m.files > 0 && <i className="rmx-mi">{MAIL_I.clip}</i>}{m.flagged && <i className="rmx-mi rmx-star">{MAIL_I.starF}</i>}{when(m.date)}</small></span>
              <span className="rmx-sub">{m.subject || '(no subject)'}</span>
              <span className="room-bottom"><span className="room-prev rmx-sn">{m.snippet}</span>{!m.seen && <span className="badge dot" />}</span>
            </span>
            {acc.id === 'all' && <i className="rmx-abar" style={{ background: colourOf(m.account) }} />}
          </button>
        ))}
      {!offline && rows && rows.length > 0 && more && !filter && <div className="rmx-more"><button type="button" className="pill-btn" disabled={busy} onClick={() => load(page + 1)}>{busy ? 'Loading…' : 'Older Mail'}</button></div>}
    </div>
  )
}

// a mail's own page: what it says drawn in a sealed frame (no scripts, no forms, nothing from outside until Show Images)
function MailRead({ m, accounts, folders, onBack, onNext, onSeen, onFlag, onGone }) {
  const [mail, setMail] = useState(null)
  const [err, setErr] = useState('')
  const [pics, setPics] = useState(false)
  const [busy, setBusy] = useState('')
  const frame = useRef(null)
  const readSlide = useSlide(onBack, onNext)
  const acc = accounts.find((a) => a.id === m.account)
  useEffect(() => {
    let gone = false
    cloud({ action: 'get', account: m.account, path: m.path, uid: m.uid }).then((j) => { if (!gone) setMail(j) }, (e) => { if (!gone) setErr(e.message || 'Could not open this mail') })
    return () => { gone = true }
  }, [])
  const doc = useMemo(() => {
    if (!mail) return ''
    const body = mail.html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${(mail.text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`
    const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${pics ? ' https: http:' : ''}`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">
<style>html,body{margin:0;padding:0;background:#fff;color:#1d1d24;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}body{padding:${mail.html ? '0' : '14px 16px 18px'}}img{max-width:100%;height:auto}table{max-width:100%!important}a{color:#1a7fd0}</style></head><body>${body}</body></html>`
  }, [mail, pics])
  // the frame as tall as what is in it
  const fit = () => {
    const f = frame.current
    try {
      const h = f.contentDocument.documentElement.scrollHeight; f.style.height = `${Math.max(120, h)}px`
      // the mail's own frame keeps a finger to itself, so its touches are handed to the page's slide (by screen place)
      const r = () => f.getBoundingClientRect()
      const as = (e) => ({ touches: [...e.touches].map((t) => ({ clientX: t.clientX + r().left, clientY: t.clientY + r().top })), target: f })
      const d = f.contentDocument
      d.addEventListener('touchstart', (e) => readSlide.onTouchStart(as(e)), { passive: true })
      d.addEventListener('touchmove', (e) => readSlide.onTouchMove(as(e)), { passive: true })
      d.addEventListener('touchend', () => readSlide.onTouchEnd(), { passive: true })
      d.addEventListener('touchcancel', () => readSlide.onTouchCancel(), { passive: true })
    } catch { /* sealed */ }
  }
  const folderOf = (role) => folders.find((f) => f.account === m.account && f.role === role)?.path
  const act = async (what) => {
    setBusy(what)
    try {
      if (what === 'unread') { await cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: 'seen', on: false }); onSeen(false); onBack() }
      else if (what === 'star') { await cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: 'flagged', on: !m.flagged }); onFlag(!m.flagged) }
      else if (what === 'archive') { const to = folderOf('archive'); if (!to) throw new Error('This account has no Archive folder.'); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to }); onGone() }
      else if (what === 'delete') { await cloud({ action: 'delete', account: m.account, path: m.path, uid: m.uid, trash: folderOf('trash') || '' }); onGone() }
    } catch (e) { setErr(e.message || 'Not done') }
    setBusy('')
  }
  const getFile = async (f) => {
    setBusy(`f${f.i}`)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${SUPABASE_URL}/functions/v1/roarmail-cloud`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'file', account: m.account, path: m.path, uid: m.uid, i: f.i }) })
      if (!r.ok) throw new Error('Could not get the file')
      const blob = await r.blob()
      const file = new File([blob], f.name, { type: f.mime })
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }).catch(() => {}) }
      else { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 6e4) }
    } catch (e) { setErr(e.message || 'Could not get the file') }
    setBusy('')
  }
  const from = mail?.from || m.from
  return (
    <div className="rmx rmx-rd" {...readSlide}>
      <Crumb title={m.subject || '(no subject)'} sub={acc?.email} onBack={onBack} />
      <article className="rmx-mail">
        <div className="rmx-mh">
          <Avatar name={nameOf(from) || '?'} size={42} />
          <span className="rmx-mw"><b>{nameOf(from)}</b><small>{from?.address}</small>{mail?.to?.length > 0 && <small>To: {mail.to.map(nameOf).join(', ')}</small>}</span>
          <em>{when(mail?.date || m.date)}</em>
        </div>
        {!mail && !err && <p className="muted">Opening…</p>}
        {mail && mail.html && !pics && /<img[^>]+src=["']?https?:/i.test(mail.html) && (
          <button type="button" className="pill-btn rmx-pics" onClick={() => setPics(true)}>{MAIL_I.img}Show Images</button>
        )}
        {mail && <iframe ref={frame} className="rmx-frame" title="Mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={fit} />}
        {mail?.files?.length > 0 && (
          <div className="rmx-files">
            {mail.files.map((f) => (
              <button key={f.i} type="button" className="rmx-att" onClick={() => getFile(f)} disabled={busy === `f${f.i}`}>
                <span className="rmx-ext">{(f.name.split('.').pop() || '').slice(0, 4).toUpperCase()}</span>
                <span className="rmx-aw"><b>{f.name}</b><small>{busy === `f${f.i}` ? 'Getting it…' : sizeOf(f.size)}</small></span>
                <i className="rmx-dl">{I.download}</i>
              </button>
            ))}
          </div>
        )}
        {err && <p className="rmx-note">{err}</p>}
      </article>
      <div className="rmx-acts">
        <button type="button" className="round" disabled={!!busy} onClick={() => act('unread')} aria-label="Mark as Unread" title="Mark as Unread">{MAIL_I.markUnread}</button>
        <button type="button" className={`round${m.flagged ? ' rmx-on' : ''}`} disabled={!!busy} onClick={() => act('star')} aria-label="Star" title="Star">{m.flagged ? MAIL_I.starF : MAIL_I.star}</button>
        <button type="button" className="round" disabled={!!busy} onClick={() => act('archive')} aria-label="Archive" title="Archive">{MAIL_I.archive}</button>
        <button type="button" className="round rmx-del" disabled={!!busy} onClick={() => act('delete')} aria-label="Delete" title="Delete">{MAIL_I.trash}</button>
      </div>
    </div>
  )
}

// Settings > RoarMail, only for Alex while it is being built
export function MailPage() {
  const [on, setOn] = useState(mailSwitchNow)
  useEffect(() => { const f = (e) => setOn(!!e.detail); window.addEventListener('roarme-mail-switch', f); return () => window.removeEventListener('roarme-mail-switch', f) }, [])
  return (
    <div className="hb-page">
      <label className="set-box hb-on hb-switch">
        <span className="hb-t"><b><MailWord /></b><small>{on ? 'The ROARMAIL folder is in your folder bar.' : 'Turn on to see your mail in a ROARMAIL folder.'}</small></span>
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); mailSwitchSet(e.target.checked) }} /><span /></span>
      </label>
      <p className="hb-hint">Only you see this while it is being built. To read an account here, send it from RoarMail on your computer: Settings › Roar Account › My mail in RoarMe.</p>
    </div>
  )
}
