import { useEffect, useMemo, useState } from 'react'
import { errText, fmtBytes, nameOf, supabase } from './lib.js'
import { Avatar, I, Lens, svg } from './ui.jsx'
import { locale } from './i18n.js'

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

  useEffect(() => {
    supabase.rpc('roar_admin_users').then(({ data, error }) => { if (error) setErr(errText(error)); else setUsers(data || []) })
    supabase.rpc('roar_admin_blocked').then(({ data }) => setBlocked(new Set(data || [])))
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
    <div className="adm">
      <div className="adm-stats">
        <span><b>{users ? users.length : '…'}</b><small>Accounts</small></span>
        <span><b>{users ? totalFiles : '…'}</b><small>Files sent</small></span>
        <span><b>{users ? fmtBytes(totalBytes) : '…'}</b><small>In chats now</small></span>
      </div>
      <div className="adm-bar">
        <Lens className="seg" dep={tab}>
          <button type="button" className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>People</button>
          <button type="button" className={tab === 'files' ? 'on' : ''} onClick={() => setTab('files')}>Files</button>
        </Lens>
        <label className="search adm-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'people' ? 'Name, @username or email' : 'File, person or group'} /></label>
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
                <b>{u.username ? nameOf(u) : 'No username yet'}{u.username && <small> @{u.username}</small>}</b>
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
                {blocked.has(u.id) && <i className="gone">Blocked</i>}
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
      <p className="adm-note muted">Only you see this page. It shows who is on RoarMe and what files they sent (name, size, type, when), never what the messages or the files say.</p>
    </div>
  )
}
