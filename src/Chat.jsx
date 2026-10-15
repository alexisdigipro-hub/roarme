import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { USERNAME_RE, cleanUsername, dayLabel, errText, fileLink, fmtBytes, lastSeenText, listTime, nameOf, onlineNow, shrinkImage, supabase, timeOf } from './lib.js'
import { Avatar, I, Modal, colorOf, svg } from './ui.jsx'
import { REACTIONS, TEXT_SIZES, chime, isEmojiOnly, useLocal, usePrefs } from './prefs.js'
import { AttachSheet, AudioNote, ChatSettings, EmojiPicker, FoldersModal, MediaViewer, SharedMedia, VideoTile } from './extras.jsx'

/* people by @username or name */
function usePeopleSearch(meId) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  useEffect(() => {
    const t = q.trim().replace(/[^\p{L}\p{N}_ .-]/gu, '').replace(/^@/, '')
    if (t.length < 2) { setHits([]); return }
    let alive = true
    const id = setTimeout(async () => {
      const { data } = await supabase.from('roar_profiles').select('id, username, display_name, avatar_url, bio, last_seen')
        .or(`username.ilike.${t.toLowerCase()}%,display_name.ilike.%${t}%`).neq('id', meId).limit(20)
      if (alive) setHits(data || [])
    }, 220)
    return () => { alive = false; clearTimeout(id) }
  }, [q, meId])
  return [q, setQ, hits]
}

/* ---------- the app ---------- */
export default function Chat({ me, setMe }) {
  const prefs = usePrefs()
  const [rooms, setRooms] = useState([])
  const [people, setPeople] = useState({}) // id -> profile
  const [activeId, setActiveId] = useState('')
  const [folder, setFolder] = useState(() => { try { return localStorage.getItem('roarme-folder') || 'all' } catch { return 'all' } })
  const [q, setQ] = useState('')
  const [modal, setModal] = useState('') // '' | newchat | newgroup | info | folders | newfolder | pickfolder
  const [plus, setPlus] = useState(false)
  const [tab, setTab] = useState('chats') // the bar at the foot: chats | calls | settings
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState([])
  const [hits, setHits] = useState([])
  const [myFolders, setMyFolders] = useLocal('roarme-folders', [])
  const [hidden, setHidden] = useLocal('roarme-hidden', {})
  const searchRef = useRef(null)
  const [note, setNote] = useState('')
  const noteTimer = useRef(0)
  const toast = useCallback((s) => { setNote(s); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 2200) }, [])
  // a copied message link (#m=<chat>/<message>) opens that chat at that message
  const [jump, setJump] = useState('')
  useEffect(() => {
    const go = () => {
      const m = window.location.hash.match(/^#m=([0-9a-f-]{36})\/([0-9a-f-]{36})$/)
      if (!m) return
      setTab('chats'); setActiveId(m[1]); setJump(m[2])
      history.replaceState(null, '', window.location.pathname)
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  const clearJump = useCallback(() => setJump(''), [])
  useEffect(() => { try { localStorage.setItem('roarme-folder', folder) } catch { /* private window */ } }, [folder])
  // ⌘K / Ctrl+K: the search
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setTab('chats'); requestAnimationFrame(() => searchRef.current?.focus()) } }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [])
  // the chats column: 370px at its narrowest, dragged wider by its right edge, remembered (Alex, 15 Oct)
  const [sideW, setSideW] = useState(() => { try { return Math.max(370, Number(localStorage.getItem('roarme-side')) || 370) } catch { return 370 } })
  const drag = (e) => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = sideW
    const max = () => Math.max(370, Math.min(720, window.innerWidth - 480))
    let w = w0
    const move = (ev) => { w = Math.round(Math.min(max(), Math.max(370, w0 + ev.clientX - x0))); setSideW(w) }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      try { localStorage.setItem('roarme-side', String(w)) } catch { /* private window */ }
    }
    document.body.classList.add('resizing')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  const listeners = useRef(new Set())
  const roomsRef = useRef(rooms)
  roomsRef.current = rooms
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const loadPeople = useCallback(async (ids) => {
    const want = [...new Set(ids)].filter(Boolean)
    if (!want.length) return
    const { data } = await supabase.from('roar_profiles').select('id, username, display_name, avatar_url, bio, last_seen').in('id', want)
    if (data) setPeople((p) => ({ ...p, ...Object.fromEntries(data.map((x) => [x.id, x])) }))
  }, [])

  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase.rpc('roar_my_rooms')
    if (error) return
    const list = data || []
    // the pinned message of each chat
    if (list.length) {
      const { data: pins } = await supabase.from('roar_rooms').select('id, pinned_message_id').in('id', list.map((r) => r.room_id))
      const pin = Object.fromEntries((pins || []).map((x) => [x.id, x.pinned_message_id]))
      list.forEach((r) => { r.pinned_message_id = pin[r.room_id] || null })
    }
    setRooms(list)
    loadPeople(list.flatMap((r) => r.members || []))
  }, [loadPeople])

  // a burst of messages reloads the list once
  const reloadTimer = useRef(0)
  const reloadSoon = useCallback(() => { clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(loadRooms, 250) }, [loadRooms])

  useEffect(() => { loadRooms() }, [loadRooms])

  // online: a heartbeat on one's own profile
  const peopleRef = useRef(people)
  peopleRef.current = people
  useEffect(() => {
    const beat = () => supabase.from('roar_profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {})
    beat()
    const id = setInterval(beat, 60 * 1000)
    const ppl = setInterval(() => loadPeople(Object.keys(peopleRef.current)), 90 * 1000)
    return () => { clearInterval(id); clearInterval(ppl) }
  }, [me.id, loadPeople])

  // a sound and a desktop notification when the window is not looking at that chat
  const notifyRef = useRef(null)
  notifyRef.current = (m) => {
    const room = roomsRef.current.find((r) => r.room_id === m.room_id)
    if (room?.muted) return
    if (!document.hidden && activeRef.current === m.room_id) return
    if (prefsRef.current.sound) chime()
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const who = peopleRef.current[m.user_id]
    const title = room?.kind === 'group' ? `${room.title}` : nameOf(who)
    const body = (room?.kind === 'group' ? `${nameOf(who)}: ` : '') + (m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? 'File' : m.body)
    try {
      const n = new Notification(title, { body, icon: who?.avatar_url || './icon.svg', tag: m.room_id })
      n.onclick = () => { window.focus(); setTab('chats'); setActiveId(m.room_id); n.close() }
    } catch { /* not allowed here */ }
  }

  // live: new and changed messages, reactions, rooms one is added to
  useEffect(() => {
    const ch = supabase.channel(`roar-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_messages' }, (ev) => {
        listeners.current.forEach((fn) => fn(ev))
        reloadSoon()
        const m = ev.new
        if (ev.eventType === 'INSERT' && m && m.user_id !== me.id) notifyRef.current(m)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_members', filter: `user_id=eq.${me.id}` }, reloadSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'roar_rooms' }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_reactions' }, (ev) => listeners.current.forEach((fn) => fn(ev)))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me.id, reloadSoon])

  useEffect(() => {
    const ask = () => { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission() }
    document.addEventListener('click', ask, { once: true })
    return () => document.removeEventListener('click', ask)
  }, [])

  const listen = useCallback((fn) => { listeners.current.add(fn); return () => listeners.current.delete(fn) }, [])

  const titleOf = useCallback((r) => {
    if (!r) return ''
    if (r.kind === 'group') return r.title
    const other = (r.members || []).find((id) => id !== me.id)
    return nameOf(people[other])
  }, [people, me.id])
  const otherOf = (r) => (r?.kind === 'direct' ? people[(r.members || []).find((id) => id !== me.id)] : null)

  // a chat deleted from one's list stays away until something new is written in it
  const visible = rooms.filter((r) => !hidden[r.room_id] || r.last_message_at > hidden[r.room_id])
  const unreadAll = visible.filter((r) => !r.archived && !r.muted).reduce((a, r) => a + (r.unread || 0), 0)
  useEffect(() => { document.title = unreadAll ? `(${unreadAll}) RoarMe` : 'RoarMe' }, [unreadAll])

  const BUILTIN = [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ['archived', 'Archived']]
  const allFolders = [...BUILTIN.map(([id, name]) => ({ id, name })), ...myFolders.map((f) => ({ ...f, custom: true }))]
  const inFolder = (r, f) => {
    if (f === 'archived') return r.archived
    if (r.archived) return false
    if (f === 'unread') return r.unread > 0
    if (f === 'groups') return r.kind === 'group'
    const mine = myFolders.find((x) => x.id === f)
    if (mine) return mine.rooms.includes(r.room_id)
    return true
  }
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return visible.filter((r) => (t ? titleOf(r).toLowerCase().includes(t) || (otherOf(r)?.username || '').includes(t.replace(/^@/, '')) : inFolder(r, folder)))
  }, [visible, folder, q, titleOf, myFolders])

  // messages that match the search, in every chat one is in (the database only gives one's own chats)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setHits([]); return }
    let alive = true
    const id = setTimeout(async () => {
      const { data } = await supabase.from('roar_messages').select('id, room_id, user_id, body, created_at').ilike('body', `%${t.replace(/[%_]/g, '')}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(60)
      if (alive) setHits(data || [])
    }, 260)
    return () => { alive = false; clearTimeout(id) }
  }, [q])
  const mark = (s) => {
    const t = q.trim()
    const i = s.toLowerCase().indexOf(t.toLowerCase())
    if (i < 0) return s
    const a = Math.max(0, i - 24)
    return <>{a > 0 && '…'}{s.slice(a, i)}<mark>{s.slice(i, i + t.length)}</mark>{s.slice(i + t.length, i + t.length + 60)}</>
  }

  const active = rooms.find((r) => r.room_id === activeId) || null
  const openRoom = (id) => { setTab('chats'); setActiveId(id); setModal(''); loadRooms() }

  const preview = (r) => {
    if (!r.last_kind) return r.kind === 'group' ? 'Group created' : 'Say hi'
    if (r.last_deleted) return 'Message deleted'
    const who = r.last_user === me.id ? 'You: ' : r.kind === 'group' && people[r.last_user] ? `${nameOf(people[r.last_user]).split(' ')[0]}: ` : ''
    const what = r.last_kind === 'image' ? 'Photo' : r.last_kind === 'voice' ? 'Voice message' : r.last_kind === 'file' ? 'File' : r.last_body
    return who + what
  }
  const folderUnread = (f) => visible.filter((r) => inFolder(r, f.id) && !r.muted).reduce((a, r) => a + (r.unread || 0), 0)
  const tagsOf = (r) => myFolders.filter((f) => f.rooms.includes(r.room_id)).map((f) => f.name)

  // Edit: pick chats, then Read / Archive / Folder / Delete for all of them
  const endPick = () => { setPicking(false); setPicked([]) }
  const pickedRooms = rooms.filter((r) => picked.includes(r.room_id))
  const setMine = (ids, patch) => supabase.from('roar_members').update(patch).in('room_id', ids).eq('user_id', me.id)
  const bulkRead = async () => { await setMine(picked, { last_read_at: new Date().toISOString() }); endPick(); loadRooms() }
  const allArchived = pickedRooms.length > 0 && pickedRooms.every((r) => r.archived)
  const bulkArchive = async () => { await setMine(picked, { archived: !allArchived }); toast(allArchived ? 'Unarchived' : 'Archived'); endPick(); loadRooms() }
  const bulkDelete = () => {
    if (!window.confirm(`Delete ${picked.length === 1 ? 'this chat' : `${picked.length} chats`} from your list? A new message brings it back.`)) return
    const at = new Date().toISOString()
    setHidden((h) => ({ ...h, ...Object.fromEntries(picked.map((id) => [id, at])) }))
    if (picked.includes(activeId)) setActiveId('')
    endPick()
  }
  const addToFolder = (fid) => { setMyFolders((list) => list.map((f) => (f.id === fid ? { ...f, rooms: [...new Set([...f.rooms, ...picked])] } : f))); setModal(''); toast('Added to the folder'); endPick() }

  const calls = useMemo(() => {
    const ids = [...new Set(rooms.filter((r) => r.kind === 'direct').flatMap((r) => r.members || []))].filter((id) => id !== me.id)
    return ids.map((id) => people[id]).filter(Boolean).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  }, [rooms, people, me.id])

  return (
    <div className="app" style={{ '--side-w': `${sideW}px` }}>
      <span className="side-grip" onPointerDown={drag} onDoubleClick={() => { setSideW(370); try { localStorage.setItem('roarme-side', '370') } catch { /* private window */ } }} title="Drag to widen, double-click to reset" />
      <aside className="side">
        <div className="side-head">
          <button type="button" className="pill-btn" onClick={() => { setPlus(false); if (picking) endPick(); else { setTab('chats'); setPicking(true) } }}>{picking ? 'Done' : 'Edit'}</button>
          <span className="side-brand">{picking ? (picked.length ? `${picked.length} selected` : 'Select chats') : <>Roar<b>Me</b></>}</span>
          {picking ? (
            <button type="button" className="pill-btn" onClick={() => setPicked(picked.length === shown.length && shown.length ? [] : shown.map((r) => r.room_id))}>{picked.length === shown.length && shown.length ? 'None' : 'All'}</button>
          ) : (
            <span className="plus-wrap">
              <button type="button" className={`round${plus ? ' on' : ''}`} onClick={() => setPlus((v) => !v)} aria-label="New" title="New chat, group or folder">{I.plus}</button>
              {plus && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setPlus(false)} />
                  <div className="menu">
                    <button type="button" onClick={() => { setPlus(false); setModal('newchat') }}>{I.person}<span>New chat</span></button>
                    <button type="button" onClick={() => { setPlus(false); setModal('newgroup') }}>{I.people}<span>New group</span></button>
                    <button type="button" onClick={() => { setPlus(false); setModal('newfolder') }}>{I.folder}<span>New folder</span></button>
                    {myFolders.length > 0 && <button type="button" onClick={() => { setPlus(false); setModal('folders') }}>{I.edit}<span>Edit folders</span></button>}
                  </div>
                </>
              )}
            </span>
          )}
        </div>
        {tab === 'chats' && (
          <>
            <label className="search">{I.search}<input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (⌘K)" onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }} /></label>
            {!q.trim() && (
              <nav className="tabs">
                {allFolders.map((f) => {
                  const n = folderUnread(f)
                  return <button key={f.id} type="button" className={folder === f.id ? 'on' : ''} onClick={() => setFolder(f.id)}>{f.name}{n > 0 && f.id !== 'archived' && <small>{n}</small>}</button>
                })}
              </nav>
            )}
            <div className="rooms">
              {!rooms.length && (
                <div className="rooms-empty">
                  <p>No chats yet.</p>
                  <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>Find someone</button>
                </div>
              )}
              {rooms.length > 0 && !shown.length && !hits.length && <p className="muted rooms-none">{q.trim() ? 'Nothing found.' : myFolders.some((f) => f.id === folder) ? 'This folder is empty. Add chats to it under Edit folders.' : 'Nothing here.'}</p>}
              {shown.map((r) => {
                const other = otherOf(r)
                const isPicked = picked.includes(r.room_id)
                return (
                  <button key={r.room_id} type="button" className={`room${r.room_id === activeId && !picking ? ' on' : ''}${isPicked ? ' picked' : ''}`} onClick={() => (picking ? setPicked((l) => (isPicked ? l.filter((x) => x !== r.room_id) : [...l, r.room_id])) : setActiveId(r.room_id))}>
                    {picking && <span className={`tick${isPicked ? ' on' : ''}`} />}
                    <Avatar src={r.kind === 'group' ? r.avatar_url : other?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} online={onlineNow(other)} />
                    <span className="room-main">
                      <span className="room-top"><strong>{titleOf(r)}</strong><small>{listTime(r.last_message_at)}</small></span>
                      <span className="room-bottom"><span className="room-prev">{preview(r)}</span>{r.muted && <span className="room-muted" title="Muted">{I.bell}</span>}{r.unread > 0 && <span className={`badge${r.muted ? ' quiet' : ''}`}>{r.unread}</span>}</span>
                      {prefs.folderTags && tagsOf(r).length > 0 && <span className="room-tags">{tagsOf(r).map((t) => <span key={t}>{t}</span>)}</span>}
                    </span>
                  </button>
                )
              })}
              {hits.length > 0 && (
                <>
                  <div className="hits-head">Messages</div>
                  {hits.map((h) => {
                    const r = rooms.find((x) => x.room_id === h.room_id)
                    if (!r) return null
                    return (
                      <button key={h.id} type="button" className="room hit" onClick={() => { setActiveId(h.room_id); setJump(h.id) }}>
                        <Avatar src={r.kind === 'group' ? r.avatar_url : otherOf(r)?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} />
                        <span className="room-main">
                          <span className="room-top"><strong>{titleOf(r)}</strong><small>{listTime(h.created_at)}</small></span>
                          <span className="room-bottom"><span className="room-prev">{h.user_id === me.id ? 'You: ' : r.kind === 'group' ? `${nameOf(people[h.user_id]).split(' ')[0]}: ` : ''}{mark(h.body)}</span></span>
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
          </>
        )}
        {tab === 'calls' && (
          <div className="side-scroll">
            <div className="soon-note">{I.calls}<span>Voice and video calls are coming soon. The list of your calls will be here.</span></div>
            <div className="hits-head">Recent</div>
            <p className="muted rooms-none">No calls yet.</p>
            <div className="hits-head">Everyone</div>
            {calls.map((p) => (
              <div key={p.id} className="person call-row">
                <Avatar src={p.avatar_url} name={nameOf(p)} size={40} online={onlineNow(p)} />
                <span className="person-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
                <button type="button" className="round" onClick={() => toast('Voice calls are coming soon')} aria-label="Voice call">{I.phone}</button>
                <button type="button" className="round" onClick={() => toast('Video calls are coming soon')} aria-label="Video call">{I.video}</button>
              </div>
            ))}
          </div>
        )}
        {tab === 'settings' && (
          <div className="side-scroll">
            <Settings me={me} setMe={setMe} inline />
            <h3 className="side-h">Chat settings</h3>
            <ChatSettings />
          </div>
        )}
        {picking ? (
          <nav className="foot bulk">
            <button type="button" disabled={!picked.length} onClick={bulkRead}>{I.read}<span>Read</span></button>
            <button type="button" disabled={!picked.length} onClick={bulkArchive}>{I.archive}<span>{allArchived ? 'Unarchive' : 'Archive'}</span></button>
            <button type="button" disabled={!picked.length} onClick={() => setModal('pickfolder')}>{I.folder}<span>Folder</span></button>
            <button type="button" className="danger" disabled={!picked.length} onClick={bulkDelete}>{I.trash}<span>Delete</span></button>
          </nav>
        ) : (
          <nav className="foot">
            <button type="button" className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}><span className="foot-ico">{I.chats}{unreadAll > 0 && <i>{unreadAll > 99 ? '99+' : unreadAll}</i>}</span><span>Chats</span></button>
            <button type="button" className={tab === 'calls' ? 'on' : ''} onClick={() => setTab('calls')}>{I.calls}<span>Calls</span></button>
            <button type="button" className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>{I.gear}<span>Settings</span></button>
          </nav>
        )}
      </aside>

      <main className="main">
        {active ? (
          <Room key={active.room_id} room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} listen={listen} onRead={reloadSoon} onInfo={() => setModal('info')} onBack={() => setActiveId('')}
            rooms={rooms} titleOf={titleOf} toast={toast} jump={jump} onJumped={clearJump} prefs={prefs} />
        ) : (
          <div className="pick">
            <img src="./icon.svg" alt="" />
            <h2>Roar<b>Me</b></h2>
            <p>Pick a chat, or start a new one.</p>
            <div className="pick-acts">
              <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>{I.person} New chat</button>
              <button type="button" className="btn" onClick={() => setModal('newgroup')}>{I.people} New group</button>
            </div>
          </div>
        )}
      </main>

      {modal === 'newchat' && <NewChat me={me} onClose={() => setModal('')} onOpen={openRoom} />}
      {modal === 'newgroup' && <NewGroup me={me} onClose={() => setModal('')} onOpen={openRoom} />}
      {modal === 'info' && active && <RoomInfo room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} toast={toast} onClose={() => setModal('')} onChanged={loadRooms} onLeft={() => { setActiveId(''); setModal(''); loadRooms() }} loadPeople={loadPeople} />}
      {(modal === 'folders' || modal === 'newfolder') && <FoldersModal folders={myFolders} rooms={visible} titleOf={titleOf} startNew={modal === 'newfolder'} onClose={() => setModal('')} onSave={(list) => { setMyFolders(list); setModal(''); if (!list.some((f) => f.id === folder) && !BUILTIN.some(([id]) => id === folder)) setFolder('all') }} />}
      {modal === 'pickfolder' && (
        <Modal title="Add to a folder" onClose={() => setModal('')}>
          {myFolders.length ? (
            <div className="people">{myFolders.map((f) => <button key={f.id} type="button" className="person" onClick={() => addToFolder(f.id)}><span className="file-ico">{I.folder}</span><span className="person-text"><b>{f.name}</b><small>{f.rooms.length} chats</small></span></button>)}</div>
          ) : (
            <><p className="muted">You have no folders yet.</p><button type="button" className="btn btn-main" onClick={() => setModal('newfolder')}>Make a folder</button></>
          )}
        </Modal>
      )}
      {note && <div className="toast" role="status">{note}</div>}
    </div>
  )
}

/* ---------- one conversation ---------- */
function Room({ room, me, people, title, other, listen, onRead, onInfo, onBack, rooms, titleOf, toast, jump, onJumped, prefs }) {
  const [msgs, setMsgs] = useState([])
  const [more, setMore] = useState(true)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [viewer, setViewer] = useState(null) // { items, index }
  const [menu, setMenu] = useState(null) // { m, x, y }
  const [headMenu, setHeadMenu] = useState(false)
  const [picked, setPicked] = useState(null) // null, or the ids picked with Select
  const [forward, setForward] = useState(null) // the messages being forwarded
  const [replies, setReplies] = useState(null) // the message whose replies are listed
  const [reacts, setReacts] = useState([]) // { message_id, user_id, emoji }
  const [reads, setReads] = useState({}) // user id -> last_read_at
  const [flash, setFlash] = useState('')
  const [find, setFind] = useState(null) // null, or the words looked for in this chat
  const [findAt, setFindAt] = useState(0)
  const [emoji, setEmoji] = useState(false)
  const [attach, setAttach] = useState(null) // files waiting in the send window
  const [media, setMedia] = useState(false)
  const [rec, setRec] = useState(null) // { started }
  const [recSecs, setRecSecs] = useState(0)
  const recRef = useRef(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const stick = useRef(true)
  const PAGE = 60

  const load = useCallback(async (before) => {
    let req = supabase.from('roar_messages').select('*').eq('room_id', room.room_id).order('created_at', { ascending: false }).limit(PAGE)
    if (before) req = req.lt('created_at', before)
    const { data } = await req
    const got = (data || []).reverse()
    setMore(got.length === PAGE)
    return got
  }, [room.room_id])

  useEffect(() => { stick.current = true; load().then(setMsgs) }, [load])

  // reactions and how far each person has read
  const loadReacts = useCallback(() => supabase.from('roar_reactions').select('message_id, user_id, emoji').eq('room_id', room.room_id).then(({ data }) => setReacts(data || [])), [room.room_id])
  const loadReads = useCallback(() => supabase.from('roar_members').select('user_id, last_read_at').eq('room_id', room.room_id).then(({ data }) => setReads(Object.fromEntries((data || []).map((x) => [x.user_id, x.last_read_at])))), [room.room_id])
  useEffect(() => {
    loadReacts(); loadReads()
    const id = setInterval(loadReads, 15000)
    return () => clearInterval(id)
  }, [loadReacts, loadReads])

  // live messages and reactions for this room
  useEffect(() => listen((ev) => {
    if (ev.table === 'roar_reactions') {
      const r = ev.new?.room_id ? ev.new : ev.old
      if (r?.room_id === room.room_id) loadReacts()
      return
    }
    const m = ev.new
    if (!m || m.room_id !== room.room_id) return
    if (ev.eventType === 'INSERT') { setMsgs((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); setTimeout(loadReads, 1500) }
    if (ev.eventType === 'UPDATE') setMsgs((list) => list.map((x) => (x.id === m.id ? m : x)))
  }), [listen, room.room_id, loadReacts, loadReads])

  // read: when the newest message is on screen and the window is in front
  const lastId = msgs[msgs.length - 1]?.id
  useEffect(() => {
    if (!lastId) return
    const mark = () => {
      if (document.hidden) return
      supabase.from('roar_members').update({ last_read_at: new Date().toISOString() }).eq('room_id', room.room_id).eq('user_id', me.id).then(onRead)
    }
    mark()
    document.addEventListener('visibilitychange', mark)
    return () => document.removeEventListener('visibilitychange', mark)
  }, [lastId, room.room_id, me.id, onRead])

  // keep to the bottom unless one has scrolled up to read
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs])
  const onScroll = async (e) => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (menu) setMenu(null)
    if (el.scrollTop < 60 && more && msgs.length) {
      const h = el.scrollHeight
      const older = await load(msgs[0].created_at)
      if (older.length) {
        setMsgs((list) => [...older, ...list])
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h + el.scrollTop })
      }
    }
  }

  // to a message: from the pinned bar, a quote, a search hit or a copied link
  const goTo = useCallback(async (id) => {
    let el = document.getElementById(`m-${id}`)
    if (!el) {
      const at = (await supabase.from('roar_messages').select('created_at').eq('id', id).maybeSingle()).data?.created_at
      if (at) {
        const { data } = await supabase.from('roar_messages').select('*').eq('room_id', room.room_id).gte('created_at', at).order('created_at').limit(400)
        if (data?.length) { stick.current = false; setMsgs((list) => { const have = new Set(list.map((x) => x.id)); return [...list, ...data.filter((x) => !have.has(x.id))].sort((a, b) => a.created_at.localeCompare(b.created_at)) }) }
        await new Promise((r) => setTimeout(r, 80))
        el = document.getElementById(`m-${id}`)
      }
    }
    if (!el) { toast('That message is no longer here.'); return }
    stick.current = false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    setTimeout(() => setFlash(''), 1600)
  }, [room.room_id, toast])
  useEffect(() => { if (jump && msgs.length) { goTo(jump); onJumped() } }, [jump, msgs.length, goTo, onJumped])

  useEffect(() => { if (find === null) inputRef.current?.focus() }, [room.room_id, replyTo, editing, find])

  // the people of this chat, for @mentions
  const members = useMemo(() => (room.members || []).filter((id) => id !== me.id).map((id) => people[id]).filter(Boolean), [room.members, people, me.id])
  const mentionQ = useMemo(() => {
    const before = text.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}_.]{0,24})$/u)
    return m ? m[1].toLowerCase() : null
  }, [text, caret])
  const mentionHits = mentionQ === null || room.kind !== 'group' ? [] : members.filter((p) => nameOf(p).toLowerCase().includes(mentionQ) || p.username.includes(mentionQ)).slice(0, 6)
  const pickMention = (p) => {
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}_.]{0,24})$/u, `@${p.username} `)
    const next = before + text.slice(caret)
    setText(next)
    requestAnimationFrame(() => { const el = inputRef.current; if (el) { el.focus(); el.selectionStart = el.selectionEnd = before.length; setCaret(before.length) } })
  }
  const addEmoji = (e) => {
    const el = inputRef.current
    const at = el ? el.selectionStart : text.length
    const next = text.slice(0, at) + e + text.slice(at)
    setText(next)
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = at + e.length; setCaret(at + e.length) } })
  }

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setErr('')
    if (editing) {
      const { error } = await supabase.from('roar_messages').update({ body, edited_at: new Date().toISOString() }).eq('id', editing.id)
      if (error) { setErr(errText(error)); return }
      setMsgs((list) => list.map((x) => (x.id === editing.id ? { ...x, body, edited_at: new Date().toISOString() } : x)))
      setEditing(null); setText('')
      return
    }
    setText('')
    stick.current = true
    const { data, error } = await supabase.from('roar_messages').insert({ room_id: room.room_id, user_id: me.id, body, reply_to: replyTo?.id || null }).select().single()
    setReplyTo(null)
    if (error) { setErr(errText(error)); setText(body); return }
    setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
  }

  const upload = async (file, kind, extra = {}) => {
    const safe = (file.name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
    const path = `${room.room_id}/${crypto.randomUUID()}-${safe}`
    const up = await supabase.storage.from('roar-files').upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (up.error) throw up.error
    return { path, name: file.name, size: file.size, type: file.type, ...extra }
  }

  const sendFiles = async (files, caption = '', compress = true) => {
    setAttach(null); setErr('')
    let n = 0
    for (const raw of files) {
      n += 1
      if (raw.size > 50e6) { setErr(`${raw.name} is over 50 MB.`); continue }
      const isImg = /^image\/(jpeg|png|webp)$/.test(raw.type)
      setBusy(files.length > 1 ? `Sending ${n} of ${files.length}…` : `Sending ${raw.name}…`)
      try {
        const file = isImg && compress ? await shrinkImage(raw, prefs.largePhotos ? 2560 : 1600, prefs.largePhotos ? 0.88 : 0.82) : raw
        const meta = await upload(file)
        stick.current = true
        const last = n === files.length
        const { data, error } = await supabase.from('roar_messages').insert({
          room_id: room.room_id, user_id: me.id, kind: /^image\//.test(file.type) && !/gif|svg/.test(file.type) ? 'image' : 'file', body: last ? caption : '',
          file: meta, reply_to: replyTo?.id || null,
        }).select().single()
        if (error) throw error
        setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
      } catch (e) {
        setErr(errText(e))
      }
    }
    setBusy(''); setReplyTo(null)
  }

  // voice messages: record, then send or throw away
  const canVoice = typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia
  useEffect(() => {
    if (!rec) return
    const id = setInterval(() => setRecSecs(Math.round((Date.now() - rec.started) / 1000)), 250)
    return () => clearInterval(id)
  }, [rec])
  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || ''
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      recRef.current = { mr, stream, chunks, type: mr.mimeType || type || 'audio/webm' }
      mr.start(250)
      setRecSecs(0)
      setRec({ started: Date.now() })
    } catch {
      setErr('The microphone is not allowed. Allow it in the browser to send voice messages.')
    }
  }
  const stopVoice = (keep) => {
    const r = recRef.current
    const started = rec?.started || Date.now()
    setRec(null)
    if (!r) return
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach((t) => t.stop())
      recRef.current = null
      if (!keep) return
      const dur = Math.max(1, Math.round((Date.now() - started) / 1000))
      const ext = /mp4/.test(r.type) ? 'm4a' : 'webm'
      const file = new File(r.chunks, `voice-${Date.now()}.${ext}`, { type: r.type.split(';')[0] })
      setBusy('Sending the voice message…')
      try {
        const meta = await upload(file, 'voice', { dur })
        stick.current = true
        const { data, error } = await supabase.from('roar_messages').insert({ room_id: room.room_id, user_id: me.id, kind: 'voice', body: '', file: meta, reply_to: replyTo?.id || null }).select().single()
        if (error) throw error
        setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
        setReplyTo(null)
      } catch (e) {
        setErr(errText(e))
      }
      setBusy('')
    }
    r.mr.stop()
  }

  const remove = async (list) => {
    const ids = list.filter((m) => m.user_id === me.id).map((m) => m.id)
    if (!ids.length) return
    const at = new Date().toISOString()
    const { error } = await supabase.from('roar_messages').update({ deleted_at: at, body: '' }).in('id', ids)
    if (error) setErr(errText(error))
    else setMsgs((all) => all.map((x) => (ids.includes(x.id) ? { ...x, deleted_at: at, body: '' } : x)))
  }

  const react = async (m, emojiChar) => {
    setMenu(null)
    const mine = reacts.find((r) => r.message_id === m.id && r.user_id === me.id)
    if (mine?.emoji === emojiChar) {
      setReacts((list) => list.filter((r) => !(r.message_id === m.id && r.user_id === me.id)))
      await supabase.from('roar_reactions').delete().eq('message_id', m.id).eq('user_id', me.id)
    } else {
      setReacts((list) => [...list.filter((r) => !(r.message_id === m.id && r.user_id === me.id)), { message_id: m.id, user_id: me.id, emoji: emojiChar }])
      const { error } = await supabase.from('roar_reactions').upsert({ message_id: m.id, room_id: room.room_id, user_id: me.id, emoji: emojiChar }, { onConflict: 'message_id,user_id' })
      if (error) { setErr(errText(error)); loadReacts() }
    }
  }

  const pin = async (m) => {
    setMenu(null)
    const { error } = await supabase.rpc('roar_pin', { r: room.room_id, msg: m ? m.id : null })
    if (error) setErr(errText(error))
    else { onRead(); toast(m ? 'Pinned' : 'Unpinned') }
  }

  const textOf = (m) => (m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? m.file?.name || 'File' : m.body)
  const copy = async (s, what = 'Copied') => { try { await navigator.clipboard.writeText(s); toast(what) } catch { toast('Copy did not work here') } }
  const linkOf = (m) => `${window.location.origin}${window.location.pathname}#m=${room.room_id}/${m.id}`
  const translate = (s) => window.open(`https://translate.google.com/?sl=auto&tl=${/[Ͱ-Ͽ]/.test(s) ? 'en' : 'el'}&op=translate&text=${encodeURIComponent(s)}`, '_blank', 'noopener')

  // who has read a message of mine: everyone else whose read mark is past it
  const seenBy = (m) => Object.entries(reads).filter(([uid, at]) => uid !== me.id && at && at >= m.created_at).map(([uid]) => uid)

  const openMenu = (e, m) => {
    if (m.deleted_at || picked) return
    e.preventDefault()
    const w = 250, h = 500
    const x = Math.min(e.clientX, window.innerWidth - w - 12)
    const y = Math.max(70, Math.min(e.clientY, window.innerHeight - h - 12))
    setMenu({ m, x, y })
  }
  // a click on a message opens its menu, as in the THEMADLIONS chat (a double click is the quick reaction);
  // a click on a photo, a link or a button inside it does its own thing
  const tapTimer = useRef(0)
  const onTap = (e, m) => {
    if (e.target.closest('a, button, img, video, audio, input, textarea, .quote, .rx') || window.getSelection()?.toString()) return
    const at = { preventDefault() {}, clientX: e.clientX, clientY: e.clientY }
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => openMenu(at, m), 230)
  }
  const onDouble = (m) => {
    if (m.deleted_at || picked) return
    if (prefs.doubleTap === 'reply') setReplyTo(m)
    else react(m, prefs.quick)
  }

  const onKey = (e) => {
    if (mentionHits.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(mentionHits[0]); return }
    const sendKey = prefs.enterSends ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.metaKey || e.ctrlKey)
    if (sendKey) { e.preventDefault(); send(); return }
    if (e.key === 'Escape') { setReplyTo(null); setEmoji(false); if (editing) { setEditing(null); setText('') } }
    if (e.key === 'ArrowUp' && !text) {
      const mine = [...msgs].reverse().find((m) => m.user_id === me.id && m.kind === 'text' && !m.deleted_at)
      if (mine) { e.preventDefault(); setEditing(mine); setText(mine.body) }
    }
  }

  // looking for words in this chat
  const found = useMemo(() => {
    const t = (find || '').trim().toLowerCase()
    if (!t) return []
    return msgs.filter((m) => !m.deleted_at && m.body && m.body.toLowerCase().includes(t)).map((m) => m.id)
  }, [find, msgs])
  useEffect(() => { if (found.length) { const id = found[found.length - 1 - Math.min(findAt, found.length - 1)]; if (id) goTo(id) } }, [found, findAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(msgs.map((m) => [m.id, m])), [msgs])
  const replyCount = useMemo(() => { const n = {}; msgs.forEach((m) => { if (m.reply_to && !m.deleted_at) n[m.reply_to] = (n[m.reply_to] || 0) + 1 }); return n }, [msgs])
  const reactsOf = useMemo(() => {
    const out = {}
    for (const r of reacts) {
      const per = (out[r.message_id] = out[r.message_id] || {})
      const e = (per[r.emoji] = per[r.emoji] || { n: 0, mine: false, who: [] })
      e.n += 1
      e.who.push(r.user_id)
      if (r.user_id === me.id) e.mine = true
    }
    return out
  }, [reacts, me.id])
  const photos = useMemo(() => msgs.filter((m) => m.kind === 'image' && !m.deleted_at), [msgs])
  const openPhoto = async (m) => {
    const items = await Promise.all(photos.map(async (x) => ({ url: await fileLink(x.file?.path), type: x.file?.type, name: x.file?.name })))
    setViewer({ items, index: Math.max(0, photos.findIndex((x) => x.id === m.id)) })
  }
  // @username in a message, lit up
  const withMentions = (s) => {
    const parts = String(s).split(/(@[a-z0-9_]{3,24})/g)
    return parts.map((p, i) => (i % 2 ? <span key={i} className="mention">{p}</span> : p))
  }

  const sub = room.kind === 'group' ? `${(room.members || []).length} members` : [other ? `@${other.username}` : '', lastSeenText(other)].filter(Boolean).join(' · ')
  const pinned = room.pinned_message_id ? byId[room.pinned_message_id] || { id: room.pinned_message_id, body: 'Pinned message', kind: 'text' } : null
  const pickedMsgs = picked ? msgs.filter((m) => picked.includes(m.id)) : []
  const soon = (what) => toast(`${what} are coming soon`)
  const mute = async () => {
    setHeadMenu(false)
    const { error } = await supabase.from('roar_members').update({ muted: !room.muted }).eq('room_id', room.room_id).eq('user_id', me.id)
    if (error) setErr(errText(error)); else { onRead(); toast(room.muted ? 'Sounds on' : 'Muted') }
  }

  return (
    <div className={`room-view${prefs.compact ? ' compact' : ''}`} data-bg={prefs.background} style={{ '--fs': `${TEXT_SIZES[prefs.textSize] || 15.5}px` }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) setAttach([...e.dataTransfer.files]) }}>
      <header className="room-head">
        <button type="button" className="round back" onClick={onBack} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
        {picked ? (
          <div className="head-card head-pick">
            <button type="button" className="link" onClick={() => setPicked(null)}>Cancel</button>
            <strong>{picked.length} selected</strong>
            <span className="head-pick-acts">
              <button type="button" className="round" disabled={!picked.length} onClick={() => copy(pickedMsgs.map(textOf).join('\n'), 'Copied')} title="Copy">{I.copy}</button>
              <button type="button" className="round" disabled={!picked.length} onClick={() => setForward(pickedMsgs)} title="Forward">{I.forward}</button>
              <button type="button" className="round danger" disabled={!pickedMsgs.some((m) => m.user_id === me.id)} onClick={() => { remove(pickedMsgs); setPicked(null) }} title="Delete yours">{I.trash}</button>
            </span>
          </div>
        ) : (
          <>
            <button type="button" className="head-card" onClick={onInfo} title="Info">
              <Avatar src={room.kind === 'group' ? room.avatar_url : other?.avatar_url} name={title} size={40} group={room.kind === 'group'} online={onlineNow(other)} />
              <span className="head-text"><strong>{title}</strong><small>{sub}</small></span>
            </button>
            <button type="button" className="round" onClick={() => soon('Voice calls')} aria-label="Voice call" title="Voice call">{I.phone}</button>
            <button type="button" className="round" onClick={() => soon('Video calls')} aria-label="Video call" title="Video call">{I.video}</button>
            <button type="button" className="round" onClick={() => { setFind(''); setFindAt(0) }} aria-label="Search in this chat" title="Search in this chat">{I.search}</button>
            <span className="plus-wrap">
              <button type="button" className={`round${headMenu ? ' on' : ''}`} onClick={() => setHeadMenu((v) => !v)} aria-label="More" title="More">{I.more}</button>
              {headMenu && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setHeadMenu(false)} />
                  <div className="menu">
                    <button type="button" onClick={() => { setHeadMenu(false); onInfo() }}>{room.kind === 'group' ? I.people : I.person}<span>{room.kind === 'group' ? 'Group info' : 'Profile'}</span></button>
                    <button type="button" onClick={() => { setHeadMenu(false); setFind(''); setFindAt(0) }}>{I.search}<span>Search</span></button>
                    <button type="button" onClick={() => { setHeadMenu(false); setMedia(true) }}>{I.image}<span>Photos, videos & files</span></button>
                    {pinned && <button type="button" onClick={() => { setHeadMenu(false); goTo(pinned.id) }}>{I.pin}<span>Pinned message</span></button>}
                    <button type="button" onClick={mute}>{I.bell}<span>{room.muted ? 'Unmute sounds' : 'Mute sounds'}</span></button>
                  </div>
                </>
              )}
            </span>
          </>
        )}
      </header>

      {find !== null && (
        <div className="findbar">
          {I.search}
          <input autoFocus value={find} onChange={(e) => { setFind(e.target.value); setFindAt(0) }} placeholder="Search in this chat"
            onKeyDown={(e) => { if (e.key === 'Escape') setFind(null); if (e.key === 'Enter') setFindAt((n) => (found.length ? (n + 1) % found.length : 0)) }} />
          <small>{find.trim() ? (found.length ? `${Math.min(findAt, found.length - 1) + 1} of ${found.length}` : 'None') : ''}</small>
          <button type="button" onClick={() => setFindAt((n) => (found.length ? (n + 1) % found.length : 0))} disabled={!found.length} aria-label="Older">{I.up}</button>
          <button type="button" onClick={() => setFindAt((n) => (found.length ? (n - 1 + found.length) % found.length : 0))} disabled={!found.length} aria-label="Newer">{I.down}</button>
          <button type="button" onClick={() => setFind(null)} aria-label="Close">{I.x}</button>
        </div>
      )}

      {pinned && !picked && (
        <div className="pinbar" role="button" tabIndex={0} onClick={() => goTo(pinned.id)}>
          <span className="pinbar-main"><b>Pinned message</b><span>{pinned.deleted_at ? 'Message deleted' : textOf(pinned)}</span></span>
          <button type="button" onClick={(e) => { e.stopPropagation(); pin(null) }} aria-label="Unpin" title="Unpin">{I.pin}</button>
        </div>
      )}

      <div className={`scroll${picked ? ' picking' : ''}`} ref={scrollRef} onScroll={onScroll}>
        {!msgs.length && <p className="empty">{room.kind === 'group' ? 'No messages yet.' : `No messages with ${title} yet. Say hi.`}</p>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const mine = m.user_id === me.id
          const first = newDay || !prev || prev.user_id !== m.user_id || new Date(m.created_at) - new Date(prev.created_at) > 5 * 60 * 1000
          const who = people[m.user_id]
          const quoted = m.reply_to ? byId[m.reply_to] : null
          const rx = reactsOf[m.id]
          const seen = mine && seenBy(m).length > 0
          const isPicked = picked?.includes(m.id)
          const big = prefs.bigEmoji && m.kind === 'text' && !m.deleted_at && !quoted && isEmojiOnly(m.body)
          const isVideo = m.kind === 'file' && /^video\//.test(m.file?.type || '')
          const hit = find && found.includes(m.id)
          return (
            <div key={m.id} id={`m-${m.id}`}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}${flash === m.id ? ' flash' : ''}${isPicked ? ' picked' : ''}${hit ? ' hit' : ''}`}
                onClick={picked ? () => setPicked((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id])) : (e) => onTap(e, m)}
                onDoubleClick={() => { clearTimeout(tapTimer.current); onDouble(m) }}
                onContextMenu={(e) => openMenu(e, m)}>
                {picked && <span className={`tick${isPicked ? ' on' : ''}`} />}
                {!mine && room.kind === 'group' && prefs.faces && (first ? <Avatar src={who?.avatar_url} name={nameOf(who)} size={30} /> : <span className="av-gap" />)}
                <div className="bubble-col">
                  <div className={`bubble${(m.kind === 'image' || isVideo) && !m.deleted_at ? ' pic' : ''}${m.deleted_at ? ' gone' : ''}${big ? ' big-emoji' : ''}`}>
                    {!mine && room.kind === 'group' && first && !big && <b className="who" style={{ '--who': colorOf(m.user_id) }}>{nameOf(who)}</b>}
                    {quoted && <span className="quote" onClick={(e) => { e.stopPropagation(); goTo(quoted.id) }}><b>{quoted.user_id === me.id ? 'You' : nameOf(people[quoted.user_id])}</b><span>{quoted.deleted_at ? 'Message deleted' : textOf(quoted)}</span></span>}
                    {m.deleted_at ? <i>Message deleted</i>
                      : m.kind === 'image' ? <Pic file={m.file} onOpen={() => openPhoto(m)} />
                      : m.kind === 'voice' ? <AudioNote file={m.file} />
                      : isVideo ? <VideoTile file={m.file} />
                      : m.kind === 'file' ? <FileTile file={m.file} />
                      : null}
                    {!m.deleted_at && m.body && <span className="text">{withMentions(m.body)}</span>}
                    <span className="meta">{m.edited_at && !m.deleted_at && 'edited · '}{timeOf(m.created_at)}{mine && !m.deleted_at && <i className={`ticks${seen ? ' seen' : ''}`} title={seen ? `Seen by ${seenBy(m).map((u) => nameOf(people[u])).join(', ')}` : 'Sent'}>{seen ? I.ticks : I.tick1}</i>}</span>
                  </div>
                  {(rx || replyCount[m.id]) && (
                    <span className="rx">
                      {rx && Object.entries(rx).map(([e, v]) => <button key={e} type="button" className={v.mine ? 'on' : ''} title={v.who.map((u) => (u === me.id ? 'You' : nameOf(people[u]))).join(', ')} onClick={(ev) => { ev.stopPropagation(); react(m, e) }}>{e}{v.n > 1 && <small>{v.n}</small>}</button>)}
                      {replyCount[m.id] > 0 && <button type="button" className="rx-replies" onClick={(ev) => { ev.stopPropagation(); setReplies(m) }}>{I.reply}<small>{replyCount[m.id]}</small></button>}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <footer className="compose-wrap">
        {(replyTo || editing) && (
          <div className="bar">
            <span>{editing ? 'Editing your message' : <>Replying to <b>{replyTo.user_id === me.id ? 'yourself' : nameOf(people[replyTo.user_id])}</b>: {textOf(replyTo).slice(0, 90)}</>}</span>
            <button type="button" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText('') } }} aria-label="Cancel">{I.x}</button>
          </div>
        )}
        {(busy || err) && <div className={`bar${err ? ' bar-err' : ''}`}><span>{err || busy}</span>{err && <button type="button" onClick={() => setErr('')} aria-label="Close">{I.x}</button>}</div>}
        {mentionHits.length > 0 && (
          <div className="mention-pick">
            {mentionHits.map((p) => <button key={p.id} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(p) }}><Avatar src={p.avatar_url} name={nameOf(p)} size={28} /><b>{nameOf(p)}</b><small>@{p.username}</small></button>)}
          </div>
        )}
        {rec ? (
          <div className="compose rec">
            <span className="rec-dot" />
            <b>{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</b>
            <span className="muted rec-text">Recording…</span>
            <button type="button" className="round danger" onClick={() => stopVoice(false)} aria-label="Throw away" title="Throw away">{I.trash}</button>
            <button type="button" className="round send ready" onClick={() => stopVoice(true)} aria-label="Send" title="Send">{I.send}</button>
          </div>
        ) : (
          <div className="compose">
            {!editing && <button type="button" className="round" onClick={() => setAttach([])} aria-label="Photo, video or file" title="Photo, video or file">{I.clip}</button>}
            <span className="compose-box">
              <textarea ref={inputRef} rows={1} value={text} spellCheck={prefs.spell} autoCorrect={prefs.spell ? 'on' : 'off'}
                onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart) }} onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)} onClick={(e) => setCaret(e.currentTarget.selectionStart)} onKeyDown={onKey}
                onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); setAttach(f) } }}
                placeholder="Write a message…" style={{ height: Math.min(160, 22 * Math.max(1, text.split('\n').length) + 22) }} />
              <button type="button" className="emoji-btn" onClick={() => setEmoji((v) => !v)} aria-label="Emoji" title="Emoji">{I.smile}</button>
              {emoji && <EmojiPicker onPick={addEmoji} onClose={() => setEmoji(false)} />}
            </span>
            {text.trim() || editing
              ? <button type="button" className="round send ready" onClick={send} aria-label={editing ? 'Save' : 'Send'} title={editing ? 'Save (Enter)' : 'Send (Enter)'}>{editing ? I.check : I.send}</button>
              : <button type="button" className="round" onClick={() => (canVoice ? startVoice() : setErr('This browser cannot record voice messages.'))} aria-label="Voice message" title="Voice message">{I.mic}</button>}
          </div>
        )}
      </footer>

      {menu && (
        <>
          <button type="button" className="scrim blur" aria-label="Close" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="msg-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="rx-pick">{REACTIONS.map((e) => <button key={e} type="button" className={reactsOf[menu.m.id]?.[e]?.mine ? 'on' : ''} onClick={() => react(menu.m, e)}>{e}</button>)}</div>
            <div className="menu-list">
              <button type="button" onClick={() => { setReplyTo(menu.m); setMenu(null) }}>{I.reply}<span>Reply</span></button>
              {menu.m.body && <button type="button" onClick={() => { translate(menu.m.body); setMenu(null) }}>{I.translate}<span>Translate</span></button>}
              {menu.m.body && <button type="button" onClick={() => { copy(menu.m.body, 'Text copied'); setMenu(null) }}>{I.copy}<span>Copy Text</span></button>}
              <button type="button" onClick={() => { copy(linkOf(menu.m), 'Link copied'); setMenu(null) }}>{I.link}<span>Copy Message Link</span></button>
              {(menu.m.kind === 'image' || /^video\//.test(menu.m.file?.type || '')) && <button type="button" onClick={async () => { const m = menu.m; setMenu(null); if (m.kind === 'image') openPhoto(m); else { const u = await fileLink(m.file?.path); if (u) setViewer({ items: [{ url: u, type: m.file?.type, name: m.file?.name }], index: 0 }) } }}>{I.download}<span>Save {menu.m.kind === 'image' ? 'Image' : 'Video'}</span></button>}
              {replyCount[menu.m.id] > 0 && <button type="button" onClick={() => { setReplies(menu.m); setMenu(null) }}>{I.reply}<span>View {replyCount[menu.m.id]} {replyCount[menu.m.id] === 1 ? 'Reply' : 'Replies'}</span></button>}
              <hr />
              {menu.m.user_id === me.id && menu.m.kind === 'text' && <button type="button" onClick={() => { setEditing(menu.m); setText(menu.m.body); setMenu(null) }}>{I.edit}<span>Edit</span></button>}
              <button type="button" onClick={() => pin(room.pinned_message_id === menu.m.id ? null : menu.m)}>{I.pin}<span>{room.pinned_message_id === menu.m.id ? 'Unpin' : 'Pin'}</span></button>
              <button type="button" onClick={() => { setForward([menu.m]); setMenu(null) }}>{I.forward}<span>Forward</span></button>
              <button type="button" onClick={() => { setPicked([menu.m.id]); setMenu(null) }}>{I.select}<span>Select</span></button>
              {menu.m.user_id === me.id && (
                <>
                  <hr />
                  <div className="menu-seen">
                    <i className="ticks seen">{I.ticks}</i>
                    <span>{room.kind === 'direct' ? (seenBy(menu.m).length ? 'Seen' : 'Not seen yet') : `${seenBy(menu.m).length} Seen`}</span>
                    <span className="menu-faces">{seenBy(menu.m).slice(0, 3).map((u) => <Avatar key={u} src={people[u]?.avatar_url} name={nameOf(people[u])} size={22} />)}</span>
                  </div>
                  <hr />
                  <button type="button" className="danger" onClick={() => { if (window.confirm('Delete this message for everyone?')) remove([menu.m]); setMenu(null) }}>{I.trash}<span>Delete</span></button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {replies && (
        <Modal title="Replies" onClose={() => setReplies(null)}>
          <div className="people">
            {msgs.filter((x) => x.reply_to === replies.id && !x.deleted_at).map((x) => (
              <button key={x.id} type="button" className="person" onClick={() => { setReplies(null); goTo(x.id) }}>
                <Avatar src={people[x.user_id]?.avatar_url} name={nameOf(people[x.user_id])} size={36} />
                <span className="person-text"><b>{x.user_id === me.id ? 'You' : nameOf(people[x.user_id])}</b><small>{textOf(x)}</small></span>
                <small className="muted">{timeOf(x.created_at)}</small>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {attach && <AttachSheet initial={attach} onClose={() => setAttach(null)} onSend={sendFiles} />}
      {media && <SharedMedia roomId={room.room_id} onClose={() => setMedia(false)} onOpen={async (list, index) => { setMedia(false); const items = await Promise.all(list.map(async (x) => ({ url: await fileLink(x.file?.path), type: x.file?.type, name: x.file?.name }))); setViewer({ items, index }) }} />}
      {forward && <Forward msgs={forward} me={me} rooms={rooms} titleOf={titleOf} fromRoom={room.room_id} onClose={() => setForward(null)} onDone={(n) => { setForward(null); setPicked(null); toast(n > 1 ? `${n} messages forwarded` : 'Forwarded') }} />}
      {viewer && <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}

/* Forward: pick a chat, the messages go there as copies (a photo or file is copied into that chat) */
function Forward({ msgs, me, rooms, titleOf, fromRoom, onClose, onDone }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = rooms.filter((r) => !q.trim() || titleOf(r).toLowerCase().includes(q.trim().toLowerCase()))
  const send = async (r) => {
    setBusy(true); setErr('')
    let n = 0
    for (const m of msgs.filter((x) => !x.deleted_at)) {
      let file = m.file || null
      if (file?.path) {
        const to = `${r.room_id}/${crypto.randomUUID()}-${file.path.split('/').pop().replace(/^[0-9a-f-]{36}-/, '')}`
        const { error } = await supabase.storage.from('roar-files').copy(file.path, to)
        if (error) { setErr(errText(error)); continue }
        file = { ...file, path: to }
      }
      const { error } = await supabase.from('roar_messages').insert({ room_id: r.room_id, user_id: me.id, kind: m.kind === 'system' ? 'text' : m.kind, body: m.body, file })
      if (error) setErr(errText(error)); else n += 1
    }
    setBusy(false)
    if (n) onDone(n)
  }
  return (
    <Modal title="Forward to…" onClose={onClose}>
      <label className="search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" /></label>
      {err && <p className="auth-err">{err}</p>}
      <div className="people">
        {list.map((r) => (
          <button key={r.room_id} type="button" className="person" disabled={busy} onClick={() => send(r)}>
            <Avatar src={r.avatar_url} name={titleOf(r)} size={40} group={r.kind === 'group'} />
            <span className="person-text"><b>{titleOf(r)}</b><small>{r.room_id === fromRoom ? 'This chat' : r.kind === 'group' ? `${(r.members || []).length} members` : 'Chat'}</small></span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function Pic({ file, onOpen }) {
  const [url, setUrl] = useState('')
  useEffect(() => { let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path])
  return url ? <img className="pic-img" src={url} alt={file?.name || ''} onClick={(e) => { e.stopPropagation(); onOpen(url) }} /> : <span className="pic-wait" />
}

function FileTile({ file }) {
  const open = async () => { const u = await fileLink(file?.path); if (u) window.open(u, '_blank', 'noopener') }
  return (
    <button type="button" className="file" onClick={open} title="Open">
      <span className="file-ico">{I.file}</span>
      <span className="file-text"><b>{file?.name}</b><small>{fmtBytes(file?.size)}</small></span>
    </button>
  )
}

/* ---------- new chat, new group ---------- */
function PersonRow({ p, right, onClick }) {
  return (
    <button type="button" className="person" onClick={onClick}>
      <Avatar src={p.avatar_url} name={nameOf(p)} size={40} online={onlineNow(p)} />
      <span className="person-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
      {right}
    </button>
  )
}

function NewChat({ me, onClose, onOpen }) {
  const [q, setQ, hits] = usePeopleSearch(me.id)
  const [err, setErr] = useState('')
  const open = async (p) => {
    const { data, error } = await supabase.rpc('roar_open_direct', { other: p.id })
    if (error) setErr(errText(error))
    else onOpen(data)
  }
  return (
    <Modal title="New chat" onClose={onClose}>
      <label className="search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find people by @username or name" /></label>
      {err && <p className="auth-err">{err}</p>}
      <div className="people">
        {q.trim().length >= 2 && !hits.length && <p className="muted">No one found.</p>}
        {hits.map((p) => <PersonRow key={p.id} p={p} onClick={() => open(p)} />)}
      </div>
    </Modal>
  )
}

function NewGroup({ me, onClose, onOpen }) {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState([])
  const [q, setQ, hits] = usePeopleSearch(me.id)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const toggle = (p) => setPicked((list) => (list.some((x) => x.id === p.id) ? list.filter((x) => x.id !== p.id) : [...list, p]))
  const create = async () => {
    if (!title.trim()) { setErr('Give the group a name.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('roar_create_group', { group_title: title.trim(), people: picked.map((p) => p.id) })
    setBusy(false)
    if (error) setErr(errText(error))
    else onOpen(data)
  }
  return (
    <Modal title="New group" onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" onClick={create} disabled={busy}>{busy ? '…' : 'Create group'}</button></>}>
      <label className="field"><span>Group name</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekend shoot" /></label>
      {picked.length > 0 && <div className="chips">{picked.map((p) => <button key={p.id} type="button" className="chip" onClick={() => toggle(p)}>{nameOf(p)} {I.x}</button>)}</div>}
      <label className="search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by @username or name" /></label>
      {err && <p className="auth-err">{err}</p>}
      <div className="people">
        {hits.map((p) => <PersonRow key={p.id} p={p} onClick={() => toggle(p)} right={<span className={`tick${picked.some((x) => x.id === p.id) ? ' on' : ''}`} />} />)}
      </div>
    </Modal>
  )
}

/* ---------- about a chat: members, mute, archive, leave ---------- */
function RoomInfo({ room, me, people, title, other, toast, onClose, onChanged, onLeft, loadPeople }) {
  const admin = room.role === 'admin'
  const [name, setName] = useState(room.title)
  const [adding, setAdding] = useState(false)
  const [q, setQ, hits] = usePeopleSearch(me.id)
  const [err, setErr] = useState('')
  const setMine = async (patch) => {
    const { error } = await supabase.from('roar_members').update(patch).eq('room_id', room.room_id).eq('user_id', me.id)
    if (error) setErr(errText(error)); else onChanged()
  }
  const rename = async () => {
    if (!name.trim() || name.trim() === room.title) return
    const { error } = await supabase.from('roar_rooms').update({ title: name.trim() }).eq('id', room.room_id)
    if (error) setErr(errText(error)); else onChanged()
  }
  const add = async (p) => {
    const { error } = await supabase.rpc('roar_add_members', { r: room.room_id, people: [p.id] })
    if (error) setErr(errText(error)); else { loadPeople([p.id]); onChanged() }
  }
  const leave = async () => {
    if (!window.confirm(`Leave ${title}?`)) return
    const { error } = await supabase.rpc('roar_leave', { r: room.room_id })
    if (error) setErr(errText(error)); else onLeft()
  }
  const members = (room.members || []).map((id) => people[id] || { id, username: '…' })
  return (
    <Modal title={room.kind === 'group' ? 'Group' : 'Profile'} onClose={onClose}>
      <div className="info-top">
        <Avatar src={room.kind === 'group' ? room.avatar_url : other?.avatar_url} name={title} size={84} group={room.kind === 'group'} />
        {room.kind === 'group' && admin
          ? <input className="input info-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          : <h3>{title}</h3>}
        {room.kind === 'direct' && other && <p className="muted">@{other.username} · {lastSeenText(other)}</p>}
        {room.kind === 'direct' && other?.bio && <p className="info-bio">{other.bio}</p>}
      </div>
      <div className="info-acts">
        <button type="button" className={`btn${room.muted ? ' btn-on' : ''}`} onClick={() => setMine({ muted: !room.muted })}>{I.bell} {room.muted ? 'Unmute' : 'Mute'}</button>
        <button type="button" className={`btn${room.archived ? ' btn-on' : ''}`} onClick={() => setMine({ archived: !room.archived })}>{I.archive} {room.archived ? 'Unarchive' : 'Archive'}</button>
        {room.kind === 'group' && <button type="button" className="btn btn-danger" onClick={leave}>Leave group</button>}
      </div>
      {err && <p className="auth-err">{err}</p>}
      {room.kind === 'group' && (
        <>
          <div className="info-sub"><span>{members.length} members</span>{admin && <button type="button" className="link" onClick={() => setAdding((v) => !v)}>{adding ? 'Done' : 'Add people'}</button>}</div>
          {adding && (
            <>
              <label className="search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="@username or name" /></label>
              <div className="people">{hits.filter((p) => !(room.members || []).includes(p.id)).map((p) => <PersonRow key={p.id} p={p} onClick={() => add(p)} right={<span className="tick" />} />)}</div>
            </>
          )}
          <div className="people">{members.map((p) => <PersonRow key={p.id} p={p} onClick={() => {}} right={p.id === me.id ? <small className="muted">You</small> : admin ? <span role="button" tabIndex={0} className="link soon" onClick={(e) => { e.stopPropagation(); toast('Removing people is coming soon') }}>Remove</span> : null} />)}</div>
          {admin && <button type="button" className="btn btn-danger" onClick={() => toast('Deleting a group is coming soon')}>Delete group</button>}
        </>
      )}
    </Modal>
  )
}

/* ---------- you: picture, name, username, about ---------- */
function Settings({ me, setMe, onClose, inline = false }) {
  const [name, setName] = useState(me.display_name)
  const [username, setUsername] = useState(me.username)
  const [bio, setBio] = useState(me.bio)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const picRef = useRef(null)

  const save = async (patch) => {
    setErr(''); setSaved(false)
    const { data, error } = await supabase.from('roar_profiles').update(patch).eq('id', me.id).select().single()
    if (error) { setErr(errText(error)); return false }
    setMe(data); setSaved(true)
    return true
  }
  const saveAll = async () => {
    if (!USERNAME_RE.test(username)) { setErr('Username: 3 to 24 characters, small letters, numbers and _.'); return }
    setBusy(true)
    await save({ display_name: name.trim(), username, bio: bio.trim() })
    setBusy(false)
  }
  const pickPic = async (raw) => {
    if (!raw) return
    const file = await shrinkImage(raw, 512, 0.88)
    const path = `${me.id}/avatar-${Date.now()}.jpg`
    const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })
    if (up.error) { setErr(errText(up.error)); return }
    const { data } = supabase.storage.from('roar-avatars').getPublicUrl(path)
    save({ avatar_url: data.publicUrl })
  }
  const fields = (
    <>
      <div className="info-top">
        <button type="button" className="pic-pick" onClick={() => picRef.current?.click()} title="Change your picture"><Avatar src={me.avatar_url} name={nameOf(me)} size={96} /><span>Change</span></button>
        <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { pickPic(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on your messages" /></label>
      <label className="field"><span>Username</span><div className="input-at"><i>@</i><input className="input" value={username} onChange={(e) => setUsername(cleanUsername(e.target.value))} /></div></label>
      <label className="field"><span>About</span><textarea className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you" /></label>
      {err && <p className="auth-err">{err}</p>}
    </>
  )
  const acts = <><button type="button" className="btn btn-danger" onClick={() => supabase.auth.signOut()}>Sign out</button><button type="button" className="btn btn-main" onClick={saveAll} disabled={busy}>{busy ? '…' : saved ? 'Saved' : 'Save'}</button></>
  if (inline) {
    return (
      <div className="side-settings">
        <h3>Your profile</h3>
        {fields}
        <div className="side-settings-acts">{acts}</div>
      </div>
    )
  }
  return <Modal title="Your profile" onClose={onClose} foot={acts}>{fields}</Modal>
}
