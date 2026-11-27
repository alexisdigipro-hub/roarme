import { useEffect, useMemo, useRef, useState } from 'react'
import { errText, fmtBytes, nameOf, shrinkImage, supabase } from './lib.js'
import { Avatar, I, Lens, svg, useTabSwipe } from './ui.jsx'
import { locale } from './i18n.js'
import { transferAlive, transferIcon } from './transfer.jsx'
import { WALL_BUCKET, loadWalls, useWalls, wallUrl } from './walls.js'
import AUTH_DEFAULT from './assets/auth-bg.jpg'
import { setAuthBg, useAuthBg } from './authBg.js'

/* Admin (Alex, 17 Oct: "only I want to see every user in the database and what files they send"). Settings > Admin,
   shown only to Alex; the database answers only the accounts in roar_admins (supabase/admin.sql), so nobody else gets
   anything even by calling it directly. Names, sizes, types, who and when: never message text, never the files.
   Block and Delete on each account (Alex, 19 Oct; supabase/suspend.sql): Block cuts it off at once and keeps it out,
   Unblock lets it back; Delete removes it for good with its one-to-one chats and everything it sent. */

const day = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '–')
const ago = (iso) => {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  return s < 120 ? 'now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`
}
const PAGE = 100
const many = (n, word) => `${n} ${word}${Number(n) === 1 ? '' : 's'}`
// round icons on each account (Alex, 19 Oct: a tidier row)
const BLOCK_I = svg(<><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>, 17)
const UNBLOCK_I = svg(<><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>, 17)

export function Admin() {
  const [tab, setTab] = useState('people')
  // a slide left or right goes to the next tab (Alex, 19 Nov)
  const admRef = useRef(null)
  useTabSwipe(admRef, ['people', 'reports', 'errors', 'service', 'files', 'transfer', 'walls'], tab, setTab)
  const [users, setUsers] = useState(null)
  const [files, setFiles] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [blocked, setBlocked] = useState(() => new Set())
  const [working, setWorking] = useState('') // the account a Block or Delete is running on
  const [meId, setMeId] = useState('')
  const [official, setOfficial] = useState([]) // the RoarMe account: never blocked or deleted
  const [openReports, setOpenReports] = useState(0)
  const [newErrors, setNewErrors] = useState(0)

  useEffect(() => {
    supabase.rpc('roar_admin_users').then(({ data, error }) => { if (error) setErr(errText(error)); else setUsers(data || []) })
    supabase.rpc('roar_admin_blocked').then(({ data }) => setBlocked(new Set(data || [])))
    supabase.rpc('roar_admin_reports', { open_only: true }).then(({ data }) => setOpenReports((data || []).length))
    supabase.rpc('roar_admin_errors').then(({ data }) => setNewErrors((data || []).filter((e) => !e.seen).length))
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id || ''))
    supabase.from('roar_official').select('user_id').then(({ data }) => setOfficial((data || []).map((x) => x.user_id)))
    supabase.rpc('roar_admin_files', { before: null, lim: PAGE }).then(({ data, error }) => {
      if (error) setErr(errText(error)); else { setFiles(data || []); setMore((data || []).length === PAGE) }
    })
  }, [])
  const loadMore = async () => {
    if (!files?.length) return
    setBusy(true)
    const { data, error } = await supabase.rpc('roar_admin_files', { before: files[files.length - 1].created_at, lim: PAGE })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setFiles((l) => [...l, ...(data || [])]); setMore((data || []).length === PAGE)
  }

  const who = (u) => (u.username ? `@${u.username}` : u.email || 'this account')
  const block = async (u, on) => {
    if (on && !window.confirm(`Block ${who(u)}? They are cut off from RoarMe at once and cannot sign in again until you unblock them.`)) return
    setWorking(u.id); setErr('')
    const { error } = await supabase.rpc('roar_admin_block', { u: u.id, block: on })
    setWorking('')
    if (error) { setErr(errText(error)); return }
    setBlocked((b) => { const n = new Set(b); if (on) n.add(u.id); else n.delete(u.id); return n })
  }
  const remove = async (u) => {
    if (!window.confirm(`Delete ${who(u)} for good? Their account, their one-to-one chats and everything they sent are removed. This cannot be undone.`)) return
    setWorking(u.id); setErr('')
    const { error } = await supabase.rpc('roar_admin_delete', { u: u.id })
    setWorking('')
    if (error) { setErr(errText(error)); return }
    setUsers((l) => l.filter((x) => x.id !== u.id))
  }

  const s = q.trim().toLowerCase()
  const shownUsers = useMemo(() => (users || []).filter((u) => !s || [u.username, u.display_name, u.email].some((x) => (x || '').toLowerCase().includes(s))), [users, s])
  const shownFiles = useMemo(() => (files || []).filter((f) => !s || [f.name, f.username, f.display_name, f.room_title, f.type].some((x) => (x || '').toLowerCase().includes(s))), [files, s])
  const totalBytes = (users || []).reduce((a, u) => a + Number(u.bytes || 0), 0)
  const totalFiles = (users || []).reduce((a, u) => a + Number(u.files || 0), 0)

  return (
    <div className="adm" ref={admRef} data-tabs-swipe={tab === 'people' ? 'first' : 'mid'}>
      <div className="adm-stats">
        <span><b>{users ? users.length : '…'}</b><small>Accounts</small></span>
        <span><b>{users ? totalFiles : '…'}</b><small>Files sent</small></span>
        <span><b>{users ? fmtBytes(totalBytes) : '…'}</b><small>In chats now</small></span>
      </div>
      <div className="adm-bar">
        <Lens className="seg" dep={tab}>
          <button type="button" className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>People</button>
          <button type="button" className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>Reports{openReports > 0 && <i className="adm-count">{openReports}</i>}</button>
          <button type="button" className={tab === 'errors' ? 'on' : ''} onClick={() => setTab('errors')}>Errors{newErrors > 0 && <i className="adm-count">{newErrors}</i>}</button>
          <button type="button" className={tab === 'service' ? 'on' : ''} onClick={() => setTab('service')}>Service</button>
          <button type="button" className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files</button>
          <button type="button" className={tab === 'transfer' ? 'on' : ''} onClick={() => setTab('transfer')}>RoarTransfer</button>
          <button type="button" className={tab === 'walls' ? 'on' : ''} onClick={() => setTab('walls')}>Wallpapers</button>
        </Lens>
        {tab !== 'walls' && tab !== 'reports' && tab !== 'errors' && tab !== 'service' && <label className="search adm-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'people' ? 'Name, @username or email' : tab === 'transfer' ? 'File or person' : 'File, person or group'} /></label>}
      </div>
      {err && <p className="adm-err">{err}</p>}

      {tab === 'people' && (
        <div className="adm-list">
          {!users && !err && <p className="muted">Loading…</p>}
          {users && !shownUsers.length && <p className="muted">Nobody found.</p>}
          {shownUsers.map((u) => (
            <div key={u.id} className={`adm-row adm-person${blocked.has(u.id) ? ' blocked' : ''}`}>
              <Avatar src={u.avatar_url} name={u.username ? nameOf(u) : (u.email || '?')} size={44} />
              <span className="adm-main">
                <b>{u.username ? nameOf(u) : 'No username yet'}{u.username && <small> @{u.username}</small>}{blocked.has(u.id) && <em className="adm-tag">Blocked</em>}</b>
                <small>{u.email || 'no email'}</small>
              </span>
              {u.id !== meId && !official.includes(u.id) && (
                <span className="adm-acts">
                  <button type="button" className={`adm-act${blocked.has(u.id) ? ' on' : ''}`} disabled={working === u.id} onClick={() => block(u, !blocked.has(u.id))}
                    title={blocked.has(u.id) ? 'Unblock' : 'Block'} aria-label={blocked.has(u.id) ? 'Unblock' : 'Block'}>{blocked.has(u.id) ? UNBLOCK_I : BLOCK_I}</button>
                  <button type="button" className="adm-act del" disabled={working === u.id} onClick={() => remove(u)} title="Delete" aria-label="Delete">{I.trash}</button>
                </span>
              )}
              <span className="adm-chips">
                <i>Joined {day(u.joined)}</i>
                <i>Seen {ago(u.last_seen || u.last_sign_in)}</i>
                <i>{many(u.messages, 'message')}</i>
                <i>{many(u.files, 'file')} · {fmtBytes(Number(u.bytes || 0))}</i>
                <i>{many(u.chats, 'chat')}</i>
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'files' && (
        <div className="adm-list">
          {!files && !err && <p className="muted">Loading…</p>}
          {files && !shownFiles.length && <p className="muted">No files.</p>}
          {shownFiles.map((f) => (
            <div key={f.id} className={`adm-row${f.deleted ? ' gone' : ''}`}>
              <span className={`adm-ico${f.transfer ? ' tr' : ''}`}>{f.transfer ? I.transfer : f.kind === 'image' || /^image\//.test(f.type || '') ? I.image : f.kind === 'voice' ? I.mic : /^video\//.test(f.type || '') ? I.play : I.file}</span>
              <span className="adm-main">
                <b title={f.name}>{f.kind === 'voice' ? 'Voice message' : f.name || 'File'}</b>
                <small>{f.username ? `@${f.username}` : 'Someone'} · {f.room_kind === 'group' ? (f.room_title || 'a group') : 'a one-to-one chat'} · {day(f.created_at)}</small>
              </span>
              <span className="adm-chips">
                <i>{fmtBytes(Number(f.size || 0))}</i>
                {f.type && <i>{f.type.split('/')[1]?.toUpperCase() || f.type}</i>}
                {f.transfer && <i className="tr">RoarTransfer{f.expires ? ` · until ${day(f.expires)}` : ''}</i>}
                {f.deleted && <i className="gone">Deleted</i>}
              </span>
            </div>
          ))}
          {more && !s && <button type="button" className="btn adm-more" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'More'}</button>}
        </div>
      )}
      {tab === 'reports' && <AdminReports onCount={setOpenReports} blockedSet={blocked} onBlock={block} />}
      {tab === 'errors' && <AdminErrors onCount={setNewErrors} />}
      {tab === 'service' && <AdminService blockedSet={blocked} onBlock={block} />}
      {tab === 'transfer' && <AdminTransfers q={s} />}
      {tab === 'walls' && <AdminWalls />}
      <p className="adm-note muted">Only you see this page. It shows who is on RoarMe and what files they sent (name, size, type, when), never what the messages or the files say.</p>
    </div>
  )
}

/* Admin > Reports (Alex, 14 Nov, for the App Store): what people reported, newest first, each with who it is about, why,
   the message's words as they were, and what can be done at once: delete the message for everyone, block the account,
   or mark it looked at. supabase/reports.sql; only the admins get an answer. */
const REASON_WORD = { spam: 'Spam or a scam', abuse: 'Harassment or hate', violence: 'Violence or threats', sexual: 'Sexual content', illegal: 'Something illegal', other: 'Something else' }
function AdminReports({ onCount, blockedSet, onBlock }) {
  const [list, setList] = useState(null)
  const [all, setAll] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const load = () => supabase.rpc('roar_admin_reports', { open_only: !all }).then(({ data, error }) => {
    if (error) { setErr(errText(error)); return }
    setList(data || [])
    if (!all) onCount?.((data || []).length)
  })
  useEffect(() => { load() }, [all]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = async (r, on) => {
    setBusy(r.id)
    const { error } = await supabase.rpc('roar_admin_report_done', { r: r.id, done: on })
    setBusy('')
    if (error) setErr(errText(error)); else load()
  }
  const removeMsg = async (r) => {
    if (!window.confirm('Delete this message for everyone?')) return
    setBusy(r.id)
    const { error } = await supabase.rpc('roar_admin_delete_message', { m: r.message_id })
    setBusy('')
    if (error) setErr(errText(error)); else load()
  }
  const who = (u, n) => (u ? `@${u}` : n || 'Someone')
  return (
    <div className="adm-list">
      <div className="adm-rep-top">
        <Lens className="seg" dep={all ? 'all' : 'open'}>
          <button type="button" className={!all ? 'on' : ''} onClick={() => setAll(false)}>Open</button>
          <button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>All</button>
        </Lens>
      </div>
      {err && <p className="adm-err">{err}</p>}
      {!list && !err && <p className="muted">Loading…</p>}
      {list && !list.length && <p className="muted">{all ? 'No reports yet.' : 'Nothing waiting. Every report has been looked at.'}</p>}
      {(list || []).map((r) => (
        <div key={r.id} className={`adm-row adm-rep${r.handled_at ? ' gone' : ''}`}>
          <Avatar src={r.reported_avatar} name={r.reported_name || r.reported_username || '?'} size={44} />
          <span className="adm-main">
            <b data-raw="">{r.reported_name || 'Account deleted'}{r.reported_username && <small> @{r.reported_username}</small>}{r.reported && blockedSet.has(r.reported) && <em className="adm-tag">Blocked</em>}</b>
            <small>{REASON_WORD[r.reason] || r.reason} · reported by <span data-raw="">{who(r.reporter_username, r.reporter_name)}</span> · {day(r.created_at)}</small>
          </span>
          {r.message_id && <p className="adm-rep-words" data-raw="">{r.body || (r.kind === 'text' ? 'Encrypted message: its words are locked' : r.kind === 'image' ? 'Photo' : r.kind === 'voice' ? 'Voice message' : 'File')}</p>}
          {r.note && <p className="adm-rep-note" data-raw="">“{r.note}”</p>}
          <span className="adm-chips">
            <i>{r.message_id ? 'A message' : 'The person'}</i>
            {Number(r.others) > 0 && <i className="gone">{many(r.others, 'other report')} about them</i>}
            {r.message_id && r.message_gone && <i className="gone">Message deleted</i>}
            {r.handled_at && <i>Looked at {day(r.handled_at)}</i>}
          </span>
          <span className="adm-rep-acts">
            {r.message_id && !r.message_gone && <button type="button" className="pill-btn danger" disabled={busy === r.id} onClick={() => removeMsg(r)}>Delete Message</button>}
            {r.reported && !blockedSet.has(r.reported) && <button type="button" className="pill-btn danger" disabled={busy === r.id} onClick={() => onBlock({ id: r.reported, username: r.reported_username }, true)}>Block Account</button>}
            <button type="button" className="pill-btn" disabled={busy === r.id} onClick={() => done(r, !r.handled_at)}>{r.handled_at ? 'Reopen' : 'Done'}</button>
          </span>
        </div>
      ))}
    </div>
  )
}

/* Admin > Errors (Alex, 27 Nov: "when the app breaks for someone, we should know at once"): what went wrong on people's
   devices (src/errlog.js, supabase/app-errors.sql), new ones first: the message, how many times and for how many people,
   when last, on what device and build, where in the app; the code's own trail opens under it. Seen puts one aside. */
function AdminErrors({ onCount }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState('')
  const load = () => supabase.rpc('roar_admin_errors').then(({ data, error }) => {
    if (error) { setErr(errText(error)); return }
    setList(data || [])
    onCount?.((data || []).filter((e) => !e.seen).length)
  })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const seen = async (id, on) => {
    const { error } = await supabase.rpc('roar_admin_error_seen', { i: id, s: on })
    if (error) setErr(errText(error)); else load()
  }
  const fresh = (list || []).filter((e) => !e.seen).length
  return (
    <div className="adm-list">
      {fresh > 0 && <div className="adm-rep-top"><button type="button" className="pill-btn" onClick={() => seen(null, true)}>Mark All Seen</button></div>}
      {err && <p className="adm-err">{err}</p>}
      {!list && !err && <p className="muted">Loading…</p>}
      {list && !list.length && <p className="muted">No errors so far. Everything is running smoothly.</p>}
      {(list || []).map((e) => (
        <div key={e.id} className={`adm-row adm-errr${e.seen ? ' gone' : ''}`}>
          <span className="adm-main">
            <b data-raw="">{e.msg || 'Unknown error'}</b>
            <small>{many(e.hits, 'time')} · {Number(e.people) === 1 ? '1 person' : `${e.people} people`} · last {ago(e.last_at)}{e.username ? <> · <span data-raw="">@{e.username}</span></> : null}</small>
            <small data-raw="">{[e.device, e.place].filter(Boolean).join(' · ')}</small>
          </span>
          {open === e.id && <pre className="adm-err-stack" data-raw="">{e.stack || 'No trail.'}{e.build ? `\n\nbuild ${e.build} · first ${day(e.first_at)}` : ''}</pre>}
          <span className="adm-rep-acts">
            <button type="button" className="pill-btn" onClick={() => setOpen(open === e.id ? '' : e.id)}>{open === e.id ? 'Hide Details' : 'Details'}</button>
            <button type="button" className="pill-btn" onClick={() => seen(e.id, !e.seen)}>{e.seen ? 'Mark New' : 'Seen'}</button>
          </span>
        </div>
      ))}
    </div>
  )
}

/* Admin > Service and Backup (Alex, 27 Nov: "a button that does a general service when I press it ... and a button under
   it that makes a backup"). Run Service asks roar_admin_service (supabase/admin-service.sql): security, attacks, fake
   profiles, spam, health and the data, each a box with a green / yellow / red dot; an account it points at can be blocked
   from its row; Clean Up takes away what is safe to take away. Claude's weekly look at the code writes its own run
   (kind 'weekly'), shown under the boxes. Back Up Now copies every RoarMe table (roar_admin_backup); the newest ten stay,
   one is made by itself every night, and each can be downloaded as one .json file. */
const PUBLIC_OK = ['roar-avatars', 'roar-walls', 'roarref-share', 'roartransfer-brand']
const SV_DOT = { ok: 'Green', warn: 'Worth a look', bad: 'Needs you' }
function SvBox({ title, state, children }) {
  return (
    <div className={`adm-sv adm-sv-${state}`}>
      <div className="adm-sv-h"><i className="adm-sv-dot" aria-label={SV_DOT[state]} /><b>{title}</b><small>{SV_DOT[state]}</small></div>
      <div className="adm-sv-b">{children}</div>
    </div>
  )
}
const svWorst = (...xs) => (xs.includes('bad') ? 'bad' : xs.includes('warn') ? 'warn' : 'ok')
function AdminService({ blockedSet, onBlock }) {
  const [rep, setRep] = useState(null)
  const [runs, setRuns] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [backups, setBackups] = useState(null)
  const loadRuns = () => supabase.rpc('roar_admin_service_runs').then(({ data, error }) => {
    if (error) { setErr(errText(error)); return }
    setRuns(data || [])
    const last = (data || []).find((r) => r.kind === 'button')
    if (last && !rep) setRep({ ...last.report, old: true })
  })
  const loadBackups = () => supabase.rpc('roar_admin_backups').then(({ data, error }) => { if (error) setErr(errText(error)); else setBackups(data || []) })
  useEffect(() => { loadRuns(); loadBackups() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    setBusy('run'); setErr(''); setNote('')
    const { data, error } = await supabase.rpc('roar_admin_service')
    setBusy('')
    if (error) { setErr(errText(error)); return }
    setRep(data); loadRuns()
  }
  const clean = async () => {
    setBusy('clean')
    const { data, error } = await supabase.rpc('roar_admin_service_clean')
    setBusy('')
    if (error) { setErr(errText(error)); return }
    setNote(`Cleaned up: ${data.push} old notification records, ${data.errors} old errors.`)
    run()
  }
  const backup = async () => {
    setBusy('backup'); setErr('')
    const { data, error } = await supabase.rpc('roar_admin_backup')
    setBusy('')
    if (error) { setErr(errText(error)); return }
    setNote(`Backup made: ${data.tables} tables, ${data.rows.toLocaleString()} rows, ${fmtBytes(data.bytes)}.`)
    loadBackups()
  }
  const download = async (b) => {
    setBusy(`dl${b.id}`)
    const { data, error } = await supabase.rpc('roar_admin_backup_get', { i: b.id })
    setBusy('')
    if (error || !data) { setErr(error ? errText(error) : 'That backup is gone.'); return }
    const name = `roarme-backup-${new Date(b.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`
    const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' })
    try {
      if (window.matchMedia?.('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return }
    } catch { return }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  const r = rep
  const S = r?.security || {}, A = r?.attacks || {}, H = r?.health || {}, D = r?.data || {}, SP = r?.spam || {}
  const openBuckets = (S.public_buckets || []).filter((b) => !PUBLIC_OK.includes(b))
  const secState = (S.no_rls || []).length || openBuckets.length ? 'bad' : (S.loose_functions || []).length ? 'warn' : 'ok'
  const atkState = (A.fast_senders || []).length || A.signups_hour >= 20 ? 'bad' : A.signups_day > Math.max(10, (A.signups_avg_day || 0) * 5) ? 'warn' : 'ok'
  const fakeState = (r?.fake || []).some((f) => f.score >= 6) ? 'bad' : (r?.fake || []).length ? 'warn' : 'ok'
  const spamState = (SP.same_text || []).length ? 'bad' : (SP.new_links || []).length ? 'warn' : 'ok'
  const healthState = H.reports_old > 0 || (H.jobs_failed || []).length ? 'bad' : H.errors_new > 0 || H.reports_open > 0 ? 'warn' : 'ok'
  const cleanable = (D.orphan_push || 0) + (D.old_seen_errors || 0)
  const person = (x, why) => (
    <div key={x.id + why} className="adm-sv-row">
      <span><b data-raw="">{x.username ? `@${x.username}` : 'No username'}</b><small data-raw="">{why}</small></span>
      {blockedSet.has(x.id) ? <em className="adm-tag">Blocked</em> : <button type="button" className="pill-btn danger" onClick={() => onBlock({ id: x.id, username: x.username }, true)}>Block</button>}
    </div>
  )
  const weekly = (runs || []).find((x) => x.kind === 'weekly')

  return (
    <div className="adm-list adm-svc">
      <div className="adm-sv-top">
        <button type="button" className="btn btn-main adm-sv-run" disabled={!!busy} onClick={run}>{busy === 'run' ? 'Running…' : 'Run Service'}</button>
        <small>{r ? `${r.old ? 'Last run' : 'Ran'} ${ago(r.at)}` : 'Security, attacks, fake profiles, spam and health, in one go.'}</small>
      </div>
      {err && <p className="adm-err">{err}</p>}
      {note && <p className="adm-sv-note">{note}</p>}
      {r && <>
        <SvBox title="Security" state={secState}>
          <p>{(S.no_rls || []).length ? `Tables without their rules: ${S.no_rls.join(', ')}` : 'Every table is behind its rules.'}</p>
          <p>{(S.loose_functions || []).length ? `Functions to tighten: ${S.loose_functions.join(', ')}` : 'Every privileged function is locked to its place.'}</p>
          <p>{openBuckets.length ? `Open file stores that should be closed: ${openBuckets.join(', ')}` : 'Only the stores meant to be open are open (profile pictures, wallpapers).'}</p>
          <p>{S.admins} admin{S.admins === 1 ? '' : 's'}.</p>
        </SvBox>
        <SvBox title="Attacks" state={atkState}>
          <p>Sign-ups: {A.signups_hour} in the last hour, {A.signups_day} today (usually {A.signups_avg_day} a day).</p>
          {(A.fast_senders || []).length ? (A.fast_senders || []).map((x) => person(x, `${x.n} messages in the last hour`)) : <p>Nobody is sending at an unusual speed.</p>}
        </SvBox>
        <SvBox title="Fake profiles" state={fakeState}>
          {(r.fake || []).length ? r.fake.map((x) => person(x, [!x.display_name && 'no name', x.unanswered > 0 && `${x.unanswered} of ${x.dms} chats never answered`, x.blocked_by > 0 && `blocked by ${x.blocked_by}`, x.reported > 0 && `reported ${x.reported}×`, `joined ${ago(x.created_at)}`].filter(Boolean).join(' · '))) : <p>No new account looks fake.</p>}
        </SvBox>
        <SvBox title="Spam" state={spamState}>
          {(SP.same_text || []).map((x) => person(x, `the same words in ${x.rooms} chats today: “${x.body}”`))}
          {(SP.new_links || []).map((x) => person(x, `a new account, ${x.n} links today`))}
          {!(SP.same_text || []).length && !(SP.new_links || []).length && <p>No spam found today.</p>}
        </SvBox>
        <SvBox title="Health" state={healthState}>
          <p>Errors from devices: {H.errors_new} new, {H.errors_week} this week.</p>
          <p>Reports: {H.reports_open} waiting{H.reports_old ? `, ${H.reports_old} for over a day (the Terms promise 24 hours)` : ''}.</p>
          <p>{(H.jobs_failed || []).length ? `Scheduled jobs that failed today: ${H.jobs_failed.map((j) => `${j.jobname} (${j.n})`).join(', ')}` : 'Every scheduled job ran fine today.'}</p>
          <p>{H.blocked_accounts} blocked account{H.blocked_accounts === 1 ? '' : 's'}.</p>
        </SvBox>
        <SvBox title="Data" state={cleanable ? 'warn' : 'ok'}>
          <p>{D.accounts} accounts ({D.accounts_week} this week) · {D.chats} chats · {Number(D.messages).toLocaleString()} messages ({D.messages_day} today)</p>
          <p>Files {D.files_mb} MB · database {D.db_mb} MB</p>
          {cleanable > 0
            ? <div className="adm-sv-row"><span><b>{cleanable} things to clean up</b><small>{D.orphan_push} notification records of gone accounts, {D.old_seen_errors} old errors</small></span><button type="button" className="pill-btn" disabled={!!busy} onClick={clean}>{busy === 'clean' ? 'Cleaning…' : 'Clean Up'}</button></div>
            : <p>Nothing left to clean up.</p>}
        </SvBox>
      </>}
      <SvBox title="Weekly Code Check" state={weekly ? (weekly.report?.state || 'ok') : 'warn'}>
        {weekly
          ? <><p>Last check {ago(weekly.at)}.</p>{(weekly.report?.lines || []).map((l, i) => <p key={i} data-raw="">{l}</p>)}</>
          : <p>Every Sunday evening Claude checks the code: the smoke test, the stylesheets, security in the code and the libraries, and fixes what it finds. The first check has not run yet.</p>}
      </SvBox>

      <div className="adm-sv-bk">
        <div className="adm-sv-top">
          <button type="button" className="btn adm-sv-run" disabled={!!busy} onClick={backup}>{busy === 'backup' ? 'Backing up…' : 'Back Up Now'}</button>
          <small>Every RoarMe table, kept in the database (the newest 10), one made by itself every night. Supabase keeps its own daily backups too.</small>
        </div>
        {(backups || []).map((b) => (
          <div key={b.id} className="adm-sv-row">
            <span><b>{new Date(b.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b><small>{b.kind === 'auto' ? 'Nightly' : 'By hand'} · {b.tables} tables · {Number(b.rows).toLocaleString()} rows · {fmtBytes(b.bytes)}</small></span>
            <button type="button" className="pill-btn" disabled={!!busy} onClick={() => download(b)}>{busy === `dl${b.id}` ? 'Preparing…' : 'Download'}</button>
          </div>
        ))}
        {backups && !backups.length && <p className="muted">No backups yet.</p>}
      </div>
    </div>
  )
}

/* Admin > RoarTransfer (Alex, 21 Oct): the totals, the last 30 days, the kinds of files, who sends the most, and every
   transfer with who sent it, where, how big, how long it stays and how often it was opened and downloaded.
   roar_admin_transfer_stats and roar_admin_transfers answer only the accounts in roar_admins. */
function AdminTransfers({ q }) {
  const [st, setSt] = useState(null)
  const [list, setList] = useState(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [who, setWho] = useState(null) // one sender picked from the top list
  const load = (person) => {
    setList(null)
    supabase.rpc('roar_admin_transfers', { before: null, lim: PAGE, who: person?.id || null }).then(({ data, error }) => {
      if (error) setErr(errText(error)); else { setList(data || []); setMore((data || []).length === PAGE) }
    })
  }
  useEffect(() => {
    supabase.rpc('roar_admin_transfer_stats').then(({ data, error }) => { if (error) setErr(errText(error)); else setSt(data || {}) })
    load(null)
  }, [])
  const loadMore = async () => {
    if (!list?.length) return
    setBusy(true)
    const { data, error } = await supabase.rpc('roar_admin_transfers', { before: list[list.length - 1].created_at, lim: PAGE, who: who?.id || null })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setList((l) => [...l, ...(data || [])]); setMore((data || []).length === PAGE)
  }
  const pick = (u) => { const next = who?.id === u.id ? null : u; setWho(next); load(next) }
  const shown = (list || []).filter((t) => !q || [t.name, t.username, t.display_name, t.email, t.room_title, t.type].some((x) => (x || '').toLowerCase().includes(q)))
  const days = st?.days || []
  const peak = Math.max(1, ...days.map((d) => Number(d.bytes || 0)))
  const KIND = { video: 'Video', image: 'Photos', audio: 'Audio', other: 'Other' }
  return (
    <div className="adm-list">
      {err && <p className="adm-err">{err}</p>}
      <div className="adm-stats rt-stats">
        <span><b>{st ? st.transfers : '…'}</b><small>Transfers</small></span>
        <span><b>{st ? fmtBytes(Number(st.bytes || 0)) : '…'}</b><small>Sent in all</small></span>
        <span><b>{st ? st.senders : '…'}</b><small>People sending</small></span>
        <span><b>{st ? st.active : '…'}</b><small>Live now · {st ? fmtBytes(Number(st.active_bytes || 0)) : '…'}</small></span>
        <span><b>{st ? st.week : '…'}</b><small>This week · {st ? fmtBytes(Number(st.week_bytes || 0)) : '…'}</small></span>
        <span><b>{st ? `${st.opens} / ${st.downloads}` : '…'}</b><small>Opened / downloaded</small></span>
        <span><b>{st ? fmtBytes(Number(st.stored_bytes || 0)) : '…'}</b><small>On the server now · {st ? st.stored : '…'} files</small></span>
        <span><b>{st ? fmtBytes(Number(st.biggest || 0)) : '…'}</b><small>Biggest file</small></span>
        <span><b>{st ? `${st.from_chat} / ${st.from_link}` : '…'}</b><small>From chats / by email</small></span>
      </div>
      {days.length > 0 && (
        <div className="rt-chart" aria-label="The last 30 days">
          <div className="rt-bars">{days.map((d) => <i key={d.day} style={{ height: `${Math.max(3, (Number(d.bytes || 0) / peak) * 100)}%` }} title={`${day(d.day)}: ${d.n} · ${fmtBytes(Number(d.bytes || 0))}`} className={Number(d.n) ? '' : 'none'} />)}</div>
          <small>The last 30 days, by size sent</small>
        </div>
      )}
      {(st?.kinds || []).length > 0 && (
        <span className="adm-chips rt-kinds">{st.kinds.map((k) => <i key={k.kind}>{KIND[k.kind] || k.kind} · {k.n} · {fmtBytes(Number(k.bytes || 0))}</i>)}</span>
      )}
      {(st?.top || []).length > 0 && (
        <>
          <p className="rt-h">Who sends the most{who ? ' · tap again to show everyone' : ''}</p>
          <div className="rt-top">
            {st.top.map((u) => (
              <button key={u.id} type="button" className={`adm-row rt-sender${who?.id === u.id ? ' on' : ''}`} onClick={() => pick(u)}>
                <Avatar src={u.avatar_url} name={u.username ? nameOf(u) : (u.email || '?')} size={36} />
                <span className="adm-main"><b>{u.username ? nameOf(u) : (u.email || 'Someone')}</b><small>{many(u.n, 'transfer')} · {fmtBytes(Number(u.bytes || 0))} · {many(u.downloads, 'download')} · last {day(u.last)}</small></span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="rt-h">{who ? `Sent by ${who.username ? nameOf(who) : who.email}` : 'Every transfer'}</p>
      {!list && !err && <p className="muted">Loading…</p>}
      {list && !shown.length && <p className="muted">No transfers.</p>}
      {shown.map((t) => {
        const alive = transferAlive(t)
        return (
          <div key={t.path} className={`adm-row${alive ? '' : ' gone'}`}>
            <span className="adm-ico tr">{transferIcon(t.type)}</span>
            <span className="adm-main">
              <b title={t.name}>{t.name}</b>
              <small>{t.username ? `@${t.username}` : (t.email || 'Someone')} · {t.source === 'link' ? 'by email' : t.room_kind === 'group' ? (t.room_title || 'a group') : 'a private chat'} · {day(t.created_at)}</small>
            </span>
            <span className="adm-chips">
              <i>{fmtBytes(Number(t.size || 0))}</i>
              <i className={alive ? 'tr' : 'gone'}>{t.deleted ? 'Deleted' : t.stopped ? 'Stopped' : alive ? `until ${day(t.expires)}` : 'Expired'}</i>
              <i>{Number(t.opens || 0)} opened · {Number(t.downloads || 0)} downloaded</i>
            </span>
          </div>
        )
      })}
      {more && !q && <button type="button" className="btn adm-more" disabled={busy} onClick={loadMore}>{busy ? 'Loading…' : 'More'}</button>}
    </div>
  )
}

/* Admin > Wallpapers (Alex, 22 Oct: "upload more, change them, and see the ones there are now"): every wallpaper in the
   order people see it, the built-in ones too. Add Photos uploads one or more (made smaller first, up to 2560 px); on each:
   its name, up and down, Hide (people no longer see it; a chat that has it keeps it), Replace the photo, and Delete for an
   uploaded one. supabase/wallpapers.sql lets only the accounts in roar_admins change any of it. */
const BUILT_IN = ['soft', 'dots', 'grid', 'night', 'ocean', 'dusk', 'forest', 'ember']
const HIDE_I = svg(<><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>, 17)
const SWAP_I = svg(<><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></>, 17)

// the sign-in and sign-up page's background, for everyone (Alex, 26 Nov): a photo of one's own, or the built-in streaks
function AuthBgBox() {
  const now = useAuthBg()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pick = useRef(null)
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn() } catch (e) { setErr(errText(e)) } setBusy(false) }
  const put = (file) => run(async () => {
    const img = await shrinkImage(file, 2560, 0.86)
    const ext = (img.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `auth/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(WALL_BUCKET).upload(path, img, { contentType: img.type, cacheControl: '31536000' })
    if (error) throw error
    await setAuthBg(path)
  })
  const back = () => { if (window.confirm('Use the original background on the sign-in page again?')) run(() => setAuthBg(null)) }
  const look = { backgroundImage: `url("${now || AUTH_DEFAULT}")` }
  return (
    <div className="adm-abg">
      <div className="adm-abg-pic" style={look} aria-label="On a phone" />
      <div className="adm-abg-pic wide" style={look} aria-label="On a computer" />
      <div className="adm-abg-txt">
        <strong>Sign-in Background</strong>
        <small>{now ? 'Your photo, on the sign-in and sign-up page for everyone.' : 'The original streaks. Pick a photo to show it to everyone on the sign-in and sign-up page.'}</small>
        {err && <small className="adm-err">{err}</small>}
        <div className="adm-abg-acts">
          <button type="button" className="btn btn-main" disabled={busy} onClick={() => pick.current?.click()}>{busy ? 'Uploading…' : now ? 'Change Picture' : 'Choose Picture'}</button>
          {now && <button type="button" className="btn" disabled={busy} onClick={back}>Use the Original</button>}
        </div>
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) put(f) }} />
      </div>
    </div>
  )
}

function AdminWalls() {
  const walls = useWalls(true)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [names, setNames] = useState({})
  const pickRef = useRef(null)
  const swapRef = useRef(null)
  const swapKey = useRef('')

  const run = async (what, fn) => {
    setBusy(what); setErr('')
    try { await fn() } catch (e) { setErr(errText(e)) }
    await loadWalls()
    setBusy('')
  }
  const put = async (key, file) => {
    const img = await shrinkImage(file, 2560, 0.86)
    const ext = (img.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const path = `${key}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from(WALL_BUCKET).upload(path, img, { contentType: img.type, cacheControl: '31536000' })
    if (error) throw error
    return path
  }
  const add = (files) => run('add', async () => {
    let pos = walls.reduce((m, w) => Math.max(m, w.position), -1)
    for (const f of files) {
      if (!/^image\//.test(f.type)) continue
      const key = `img-${crypto.randomUUID().slice(0, 8)}`
      const path = await put(key, f)
      const name = f.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Wallpaper'
      const { error } = await supabase.from('roar_wallpapers').insert({ key, name, path, position: ++pos })
      if (error) throw error
    }
  })
  const swap = (w, file) => run(w.key, async () => {
    const path = await put(w.key, file)
    const { error } = await supabase.from('roar_wallpapers').update({ path, updated_at: new Date().toISOString() }).eq('key', w.key)
    if (error) throw error
    if (w.path) await supabase.storage.from(WALL_BUCKET).remove([w.path])
  })
  const patch = (w, fields) => run(w.key, async () => {
    const { error } = await supabase.from('roar_wallpapers').update({ ...fields, updated_at: new Date().toISOString() }).eq('key', w.key)
    if (error) throw error
  })
  const rename = (w) => {
    const name = (names[w.key] ?? w.name).trim().slice(0, 40)
    if (!name || name === w.name) { setNames((n) => ({ ...n, [w.key]: undefined })); return }
    patch(w, { name }).then(() => setNames((n) => ({ ...n, [w.key]: undefined })))
  }
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= walls.length) return
    const order = walls.map((w) => w.key)
    ;[order[i], order[j]] = [order[j], order[i]]
    run(walls[i].key, async () => {
      for (const [n, key] of order.entries()) {
        const w = walls.find((x) => x.key === key)
        if (w.position !== n) { const { error } = await supabase.from('roar_wallpapers').update({ position: n }).eq('key', key); if (error) throw error }
      }
    })
  }
  const remove = (w) => {
    if (!window.confirm(`Delete the wallpaper "${w.name}" for good? A chat that uses it goes back to plain.`)) return
    run(w.key, async () => {
      const { error } = await supabase.from('roar_wallpapers').delete().eq('key', w.key)
      if (error) throw error
      if (w.path) await supabase.storage.from(WALL_BUCKET).remove([w.path])
    })
  }

  const shown = walls.filter((w) => !w.hidden).length
  return (
    <div className="adm-list">
      <AuthBgBox />
      {err && <p className="adm-err">{err}</p>}
      <div className="adm-walls-head">
        <span className="muted">{walls.length} wallpapers · {shown} shown to people</span>
        <button type="button" className="btn btn-main adm-walls-add" disabled={busy === 'add'} onClick={() => pickRef.current?.click()}>{I.image}<span>{busy === 'add' ? 'Uploading…' : 'Add Photos'}</span></button>
        <input ref={pickRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) add(f) }} />
        <input ref={swapRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; const w = walls.find((x) => x.key === swapKey.current); if (f && w) swap(w, f) }} />
      </div>
      <div className="adm-walls">
        {walls.map((w, i) => (
          <div key={w.key} className={`adm-wall${w.hidden ? ' off' : ''}${busy === w.key ? ' busy' : ''}`}>
            <div className={`wall-tile adm-wall-pic${w.path ? ' img' : ''}`} data-bg={w.key} style={w.path ? { backgroundImage: `url("${wallUrl(w.path)}")` } : undefined}>
              <i className="wall-b">Hi!</i><i className="wall-b mine">Hello 👋</i>
              {w.hidden && <em className="adm-tag">Hidden</em>}
            </div>
            <input className="input adm-wall-name" value={names[w.key] ?? w.name} maxLength={40} aria-label="Name"
              onChange={(e) => setNames((n) => ({ ...n, [w.key]: e.target.value }))} onBlur={() => rename(w)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            <span className="adm-wall-acts">
              <button type="button" className="adm-act" disabled={!!busy || i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">{I.up}</button>
              <button type="button" className="adm-act" disabled={!!busy || i === walls.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">{I.down}</button>
              <button type="button" className={`adm-act${w.hidden ? ' on' : ''}`} disabled={!!busy} onClick={() => patch(w, { hidden: !w.hidden })} title={w.hidden ? 'Show' : 'Hide'} aria-label={w.hidden ? 'Show' : 'Hide'}>{w.hidden ? I.eye : HIDE_I}</button>
              <button type="button" className="adm-act" disabled={!!busy} onClick={() => { swapKey.current = w.key; swapRef.current?.click() }} title={w.path ? 'Replace photo' : 'Use a photo'} aria-label="Replace photo">{SWAP_I}</button>
              {!BUILT_IN.includes(w.key) && <button type="button" className="adm-act del" disabled={!!busy} onClick={() => remove(w)} title="Delete" aria-label="Delete">{I.trash}</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
