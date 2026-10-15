import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { USERNAME_RE, cleanUsername, dayLabel, errText, fileLink, fmtBytes, initialsOf, lastSeenText, listTime, nameOf, onlineNow, shrinkImage, supabase, timeOf } from './lib.js'

/* ---------- small pieces ---------- */
const svg = (d, w = 20) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
const I = {
  plus: svg(<path d="M12 5v14M5 12h14" />),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, 18),
  clip: svg(<path d="M21 11.5 12.6 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />),
  send: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.2 5.7c.1.4.4.7.8.7l9.4 1-9.4 1c-.4 0-.7.3-.8.7L2.1 19.4c-.1.7.6 1.3 1.3 1z" /></svg>,
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>),
  reply: svg(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4" />, 16),
  edit: svg(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>, 16),
  trash: svg(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, 16),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>, 16),
  x: svg(<path d="M6 6l12 12M18 6 6 18" />, 18),
  person: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>, 18),
  people: svg(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 13.8c2 .9 3.5 3 3.5 6.2" /></>, 18),
  file: svg(<><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>, 22),
  bell: svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 16),
  archive: svg(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" /></>, 16),
  phone: svg(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />),
  video: svg(<><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3" /></>),
  more: svg(<><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>),
  mic: svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>),
  translate: svg(<><path d="M4 5h8M8 3v2M6 5c0 4 2.5 7 5 8M10 5c-.5 3-2.5 6-6 8" /><path d="m13 21 4-9 4 9M14.5 18h5" /></>, 16),
  link: svg(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>, 16),
  pin: svg(<path d="M9 4h6l-1 5 3 3H7l3-3zM12 12v8" />, 16),
  forward: svg(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v4" />, 16),
  select: svg(<><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>, 16),
  tick1: <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.5 3 3 7-7" /></svg>,
  ticks: <svg viewBox="0 0 20 16" width="17" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m1.5 8.5 3 3 7-7M8.5 11.5l7-7" /></svg>,
  chats: svg(<path d="M4 5h16v11H9l-5 4z" />, 22),
  calls: svg(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />, 22),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>, 22),
}

// each person's name in a group in a colour of their own, as in the hub's chat
const NAME_COLORS = ['#ff8a65', '#7cc4ff', '#81c784', '#ffb74d', '#ba68c8', '#4dd0e1', '#f06292', '#aed581']
const colorOf = (id) => NAME_COLORS[[...String(id || '')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % NAME_COLORS.length]

function Avatar({ src, name, size = 44, online = false, group = false }) {
  return (
    <span className={`av${group ? ' av-group' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {src ? <img src={src} alt="" /> : <span>{initialsOf(name)}</span>}
      {online && <i className="av-on" />}
    </span>
  )
}

function Modal({ title, onClose, children, foot, wide = false }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}

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
  const [rooms, setRooms] = useState([])
  const [people, setPeople] = useState({}) // id -> profile
  const [activeId, setActiveId] = useState('')
  const [folder, setFolder] = useState('all')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState('') // '' | newchat | newgroup | settings | info
  const [plus, setPlus] = useState(false)
  const [tab, setTab] = useState('chats') // the bar at the foot: chats | calls | settings
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
  useEffect(() => {
    const beat = () => supabase.from('roar_profiles').update({ last_seen: new Date().toISOString() }).eq('id', me.id).then(() => {})
    beat()
    const id = setInterval(beat, 60 * 1000)
    const people = setInterval(() => loadPeople(Object.keys(peopleRef.current)), 90 * 1000)
    return () => { clearInterval(id); clearInterval(people) }
  }, [me.id, loadPeople])
  const peopleRef = useRef(people)
  peopleRef.current = people

  // live: new and changed messages, rooms one is added to
  useEffect(() => {
    const ch = supabase.channel(`roar-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_messages' }, (ev) => {
        listeners.current.forEach((fn) => fn(ev))
        reloadSoon()
        const m = ev.new
        if (ev.eventType === 'INSERT' && m && m.user_id !== me.id) notify(m)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_members', filter: `user_id=eq.${me.id}` }, reloadSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'roar_rooms' }, reloadSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_reactions' }, (ev) => listeners.current.forEach((fn) => fn(ev)))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [me.id, reloadSoon])

  // a desktop notification when the window is not looking at that chat
  const notify = (m) => {
    const room = roomsRef.current.find((r) => r.room_id === m.room_id)
    if (room?.muted) return
    if (!document.hidden && activeRef.current === m.room_id) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const who = peopleRef.current[m.user_id]
    const title = room?.kind === 'group' ? `${room.title}` : nameOf(who)
    const body = (room?.kind === 'group' ? `${nameOf(who)}: ` : '') + (m.kind === 'image' ? 'Photo' : m.kind === 'file' ? 'File' : m.body)
    try {
      const n = new Notification(title, { body, icon: who?.avatar_url || './icon.svg', tag: m.room_id })
      n.onclick = () => { window.focus(); setActiveId(m.room_id); n.close() }
    } catch { /* not allowed here */ }
  }
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

  const unreadAll = rooms.filter((r) => !r.archived && !r.muted).reduce((a, r) => a + (r.unread || 0), 0)
  useEffect(() => { document.title = unreadAll ? `(${unreadAll}) RoarMe` : 'RoarMe' }, [unreadAll])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rooms.filter((r) => {
      if (t) return titleOf(r).toLowerCase().includes(t) || (otherOf(r)?.username || '').includes(t.replace(/^@/, ''))
      if (folder === 'archived') return r.archived
      if (r.archived) return false
      if (folder === 'unread') return r.unread > 0
      if (folder === 'groups') return r.kind === 'group'
      return true
    })
  }, [rooms, folder, q, titleOf])

  const active = rooms.find((r) => r.room_id === activeId) || null
  const openRoom = (id) => { setActiveId(id); setModal(''); loadRooms() }

  const preview = (r) => {
    if (!r.last_kind) return r.kind === 'group' ? 'Group created' : 'Say hi'
    if (r.last_deleted) return 'Message deleted'
    const who = r.last_user === me.id ? 'You: ' : r.kind === 'group' && people[r.last_user] ? `${nameOf(people[r.last_user]).split(' ')[0]}: ` : ''
    const what = r.last_kind === 'image' ? 'Photo' : r.last_kind === 'file' ? 'File' : r.last_body
    return who + what
  }

  const folders = [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ['archived', 'Archived']]

  return (
    <div className="app" style={{ '--side-w': `${sideW}px` }}>
      <span className="side-grip" onPointerDown={drag} onDoubleClick={() => { setSideW(370); try { localStorage.setItem('roarme-side', '370') } catch { /* private window */ } }} title="Drag to widen, double-click to reset" />
      <aside className="side">
        <div className="side-head">
          <button type="button" className="me-btn" onClick={() => setTab('settings')} title="Your profile and settings">
            <Avatar src={me.avatar_url} name={nameOf(me)} size={40} />
          </button>
          <span className="side-brand">Roar<b>Me</b></span>
          <span className="plus-wrap">
            <button type="button" className={`round${plus ? ' on' : ''}`} onClick={() => setPlus((v) => !v)} aria-label="New" title="New chat or group">{I.plus}</button>
            {plus && (
              <>
                <button type="button" className="scrim" aria-label="Close" onClick={() => setPlus(false)} />
                <div className="menu">
                  <button type="button" onClick={() => { setPlus(false); setModal('newchat') }}>{I.person}<span>New chat</span></button>
                  <button type="button" onClick={() => { setPlus(false); setModal('newgroup') }}>{I.people}<span>New group</span></button>
                </div>
              </>
            )}
          </span>
        </div>
        {tab === 'chats' && (
          <>
          <label className="search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" onKeyDown={(e) => { if (e.key === 'Escape') setQ('') }} /></label>
          <nav className="tabs">
            {folders.map(([k, l]) => {
              const n = k === 'unread' ? rooms.filter((r) => !r.archived && r.unread > 0).length : 0
              return <button key={k} type="button" className={folder === k ? 'on' : ''} onClick={() => setFolder(k)}>{l}{n > 0 && <small>{n}</small>}</button>
            })}
          </nav>
          <div className="rooms">
            {!rooms.length && (
              <div className="rooms-empty">
                <p>No chats yet.</p>
                <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>Find someone</button>
              </div>
            )}
            {rooms.length > 0 && !shown.length && <p className="muted rooms-none">Nothing here.</p>}
            {shown.map((r) => {
              const other = otherOf(r)
              return (
                <button key={r.room_id} type="button" className={`room${r.room_id === activeId ? ' on' : ''}`} onClick={() => setActiveId(r.room_id)}>
                  <Avatar src={r.kind === 'group' ? r.avatar_url : other?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} online={onlineNow(other)} />
                  <span className="room-main">
                    <span className="room-top"><strong>{titleOf(r)}</strong><small>{listTime(r.last_message_at)}</small></span>
                    <span className="room-bottom"><span className="room-prev">{preview(r)}</span>{r.muted && <span className="room-muted" title="Muted">{I.bell}</span>}{r.unread > 0 && <span className={`badge${r.muted ? ' quiet' : ''}`}>{r.unread}</span>}</span>
                  </span>
                </button>
              )
            })}
          </div>
          </>
        )}
        {tab === 'calls' && (
          <div className="side-panel">
            <span className="side-panel-ico">{I.calls}</span>
            <h3>Calls</h3>
            <p>Voice and video calls, and the list of your calls, are coming soon.</p>
          </div>
        )}
        {tab === 'settings' && <Settings me={me} setMe={setMe} inline />}
        <nav className="foot">
          <button type="button" className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}><span className="foot-ico">{I.chats}{unreadAll > 0 && <i>{unreadAll > 99 ? '99+' : unreadAll}</i>}</span><span>Chats</span></button>
          <button type="button" className={tab === 'calls' ? 'on' : ''} onClick={() => setTab('calls')}>{I.calls}<span>Calls</span></button>
          <button type="button" className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>{I.gear}<span>Settings</span></button>
        </nav>
      </aside>

      <main className="main">
        {active ? (
          <Room key={active.room_id} room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} listen={listen} onRead={reloadSoon} onInfo={() => setModal('info')} onBack={() => setActiveId('')}
            rooms={rooms} titleOf={titleOf} toast={toast} jump={jump} onJumped={clearJump} />
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
      {modal === 'info' && active && <RoomInfo room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} onClose={() => setModal('')} onChanged={loadRooms} onLeft={() => { setActiveId(''); setModal(''); loadRooms() }} loadPeople={loadPeople} />}
      {note && <div className="toast" role="status">{note}</div>}
    </div>
  )
}

/* ---------- one conversation ---------- */
const REACTIONS = ['🎥', '❤️', '👍', '🔥', '🏆', '👏', '😂']

function Room({ room, me, people, title, other, listen, onRead, onInfo, onBack, rooms, titleOf, toast, jump, onJumped }) {
  const [msgs, setMsgs] = useState([])
  const [more, setMore] = useState(true)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [view, setView] = useState(null) // a photo opened large
  const [menu, setMenu] = useState(null) // { m, x, y }
  const [picked, setPicked] = useState(null) // null, or the ids picked with Select
  const [forward, setForward] = useState(null) // the messages being forwarded
  const [reacts, setReacts] = useState([]) // { message_id, user_id, emoji }
  const [reads, setReads] = useState({}) // user id -> last_read_at
  const [flash, setFlash] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
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

  // to a message: from the pinned bar, a quote, or a copied link
  const goTo = useCallback(async (id) => {
    let el = document.getElementById(`m-${id}`)
    if (!el) {
      const { data } = await supabase.from('roar_messages').select('*').eq('room_id', room.room_id).gte('created_at', (await supabase.from('roar_messages').select('created_at').eq('id', id).maybeSingle()).data?.created_at || new Date().toISOString()).order('created_at').limit(400)
      if (data?.length) { stick.current = false; setMsgs((list) => { const have = new Set(list.map((x) => x.id)); return [...list, ...data.filter((x) => !have.has(x.id))].sort((a, b) => a.created_at.localeCompare(b.created_at)) }) }
      await new Promise((r) => setTimeout(r, 60))
      el = document.getElementById(`m-${id}`)
    }
    if (!el) { toast('That message is no longer here.'); return }
    stick.current = false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    setTimeout(() => setFlash(''), 1600)
  }, [room.room_id, toast])
  useEffect(() => { if (jump && msgs.length) { goTo(jump); onJumped() } }, [jump, msgs.length, goTo, onJumped])

  useEffect(() => { inputRef.current?.focus() }, [room.room_id, replyTo, editing])

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

  const sendFiles = async (files) => {
    setErr('')
    for (const raw of files) {
      if (raw.size > 50e6) { setErr(`${raw.name} is over 50 MB.`); continue }
      const isImg = /^image\//.test(raw.type)
      const file = isImg ? await shrinkImage(raw) : raw
      const safe = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
      const path = `${room.room_id}/${crypto.randomUUID()}-${safe}`
      setBusy(`Sending ${file.name}…`)
      const up = await supabase.storage.from('roar-files').upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (up.error) { setErr(errText(up.error)); continue }
      stick.current = true
      const { data, error } = await supabase.from('roar_messages').insert({
        room_id: room.room_id, user_id: me.id, kind: isImg ? 'image' : 'file', body: '',
        file: { path, name: file.name, size: file.size, type: file.type }, reply_to: replyTo?.id || null,
      }).select().single()
      if (error) setErr(errText(error))
      else setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
    }
    setBusy(''); setReplyTo(null)
  }

  const remove = async (list) => {
    const ids = list.filter((m) => m.user_id === me.id).map((m) => m.id)
    if (!ids.length) return
    const at = new Date().toISOString()
    const { error } = await supabase.from('roar_messages').update({ deleted_at: at, body: '' }).in('id', ids)
    if (error) setErr(errText(error))
    else setMsgs((all) => all.map((x) => (ids.includes(x.id) ? { ...x, deleted_at: at, body: '' } : x)))
  }

  const react = async (m, emoji) => {
    setMenu(null)
    const mine = reacts.find((r) => r.message_id === m.id && r.user_id === me.id)
    if (mine?.emoji === emoji) {
      setReacts((list) => list.filter((r) => !(r.message_id === m.id && r.user_id === me.id)))
      await supabase.from('roar_reactions').delete().eq('message_id', m.id).eq('user_id', me.id)
    } else {
      setReacts((list) => [...list.filter((r) => !(r.message_id === m.id && r.user_id === me.id)), { message_id: m.id, user_id: me.id, emoji }])
      const { error } = await supabase.from('roar_reactions').upsert({ message_id: m.id, room_id: room.room_id, user_id: me.id, emoji }, { onConflict: 'message_id,user_id' })
      if (error) { setErr(errText(error)); loadReacts() }
    }
  }

  const pin = async (m) => {
    setMenu(null)
    const { error } = await supabase.rpc('roar_pin', { r: room.room_id, msg: m ? m.id : null })
    if (error) setErr(errText(error))
    else { onRead(); toast(m ? 'Pinned' : 'Unpinned') }
  }

  const textOf = (m) => (m.kind === 'image' ? 'Photo' : m.kind === 'file' ? m.file?.name || 'File' : m.body)
  const copy = async (s, what = 'Copied') => { try { await navigator.clipboard.writeText(s); toast(what) } catch { toast('Copy did not work here') } }
  const linkOf = (m) => `${window.location.origin}${window.location.pathname}#m=${room.room_id}/${m.id}`

  // who has read a message of mine: everyone else whose read mark is past it
  const seenBy = (m) => Object.entries(reads).filter(([uid, at]) => uid !== me.id && at && at >= m.created_at).map(([uid]) => uid)

  const openMenu = (e, m) => {
    if (m.deleted_at || picked) return
    e.preventDefault()
    const w = 250, h = 470
    const x = Math.min(e.clientX, window.innerWidth - w - 12)
    const y = Math.max(70, Math.min(e.clientY, window.innerHeight - h - 12))
    setMenu({ m, x, y })
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === 'Escape') { setReplyTo(null); if (editing) { setEditing(null); setText('') } }
    if (e.key === 'ArrowUp' && !text) {
      const mine = [...msgs].reverse().find((m) => m.user_id === me.id && m.kind === 'text' && !m.deleted_at)
      if (mine) { e.preventDefault(); setEditing(mine); setText(mine.body) }
    }
  }

  const byId = useMemo(() => Object.fromEntries(msgs.map((m) => [m.id, m])), [msgs])
  const reactsOf = useMemo(() => {
    const out = {}
    for (const r of reacts) {
      const per = (out[r.message_id] = out[r.message_id] || {})
      const e = (per[r.emoji] = per[r.emoji] || { n: 0, mine: false })
      e.n += 1
      if (r.user_id === me.id) e.mine = true
    }
    return out
  }, [reacts, me.id])
  const sub = room.kind === 'group' ? `${(room.members || []).length} members` : [other ? `@${other.username}` : '', lastSeenText(other)].filter(Boolean).join(' · ')
  const pinned = room.pinned_message_id ? byId[room.pinned_message_id] || { id: room.pinned_message_id, body: 'Pinned message', kind: 'text' } : null
  const pickedMsgs = picked ? msgs.filter((m) => picked.includes(m.id)) : []
  const soon = (what) => toast(`${what} are coming soon`)

  return (
    <div className="room-view" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) sendFiles([...e.dataTransfer.files]) }}>
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
            <button type="button" className="round" onClick={onInfo} aria-label="Info" title="Info">{I.more}</button>
          </>
        )}
      </header>

      {pinned && !picked && (
        <div className="pinbar" role="button" tabIndex={0} onClick={() => goTo(pinned.id)}>
          <span className="pinbar-main"><b>Pinned message</b><span>{pinned.deleted_at ? 'Message deleted' : textOf(pinned)}</span></span>
          <button type="button" onClick={(e) => { e.stopPropagation(); pin(null) }} aria-label="Unpin" title="Unpin">{I.pin}</button>
        </div>
      )}

      <div className={`scroll${picked ? ' picking' : ''}`} ref={scrollRef} onScroll={onScroll}>
        {!msgs.length && <p className="empty">No messages yet. Say hi.</p>}
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
          return (
            <div key={m.id} id={`m-${m.id}`}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}${flash === m.id ? ' flash' : ''}${isPicked ? ' picked' : ''}`}
                onClick={picked ? () => setPicked((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id])) : undefined}
                onContextMenu={(e) => openMenu(e, m)}>
                {picked && <span className={`tick${isPicked ? ' on' : ''}`} />}
                {!mine && room.kind === 'group' && (first ? <Avatar src={who?.avatar_url} name={nameOf(who)} size={30} /> : <span className="av-gap" />)}
                <div className="bubble-col">
                  <div className={`bubble${m.kind === 'image' && !m.deleted_at ? ' pic' : ''}${m.deleted_at ? ' gone' : ''}`}>
                    {!mine && room.kind === 'group' && first && <b className="who" style={{ '--who': colorOf(m.user_id) }}>{nameOf(who)}</b>}
                    {quoted && <span className="quote" onClick={(e) => { e.stopPropagation(); goTo(quoted.id) }}><b>{quoted.user_id === me.id ? 'You' : nameOf(people[quoted.user_id])}</b><span>{quoted.deleted_at ? 'Message deleted' : textOf(quoted)}</span></span>}
                    {m.deleted_at ? <i>Message deleted</i>
                      : m.kind === 'image' ? <Pic file={m.file} onOpen={setView} />
                      : m.kind === 'file' ? <FileTile file={m.file} />
                      : <span className="text">{m.body}</span>}
                    <span className="meta">{m.edited_at && !m.deleted_at && 'edited · '}{timeOf(m.created_at)}{mine && !m.deleted_at && <i className={`ticks${seen ? ' seen' : ''}`}>{seen ? I.ticks : I.tick1}</i>}</span>
                  </div>
                  {rx && (
                    <span className="rx">
                      {Object.entries(rx).map(([e, v]) => <button key={e} type="button" className={v.mine ? 'on' : ''} onClick={(ev) => { ev.stopPropagation(); react(m, e) }}>{e}{v.n > 1 && <small>{v.n}</small>}</button>)}
                    </span>
                  )}
                </div>
                {!m.deleted_at && !picked && (
                  <span className="msg-acts">
                    <button type="button" onClick={() => setReplyTo(m)} title="Reply">{I.reply}</button>
                    <button type="button" onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); openMenu({ preventDefault() {}, clientX: b.left, clientY: b.bottom + 6 }, m) }} title="More">{I.more}</button>
                  </span>
                )}
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
        <div className="compose">
          {!editing && <button type="button" className="round" onClick={() => fileRef.current?.click()} aria-label="Photo or file" title="Photo or file">{I.clip}</button>}
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) sendFiles(f) }} />
          <textarea ref={inputRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
            onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); sendFiles(f) } }}
            placeholder="Write a message…" style={{ height: Math.min(160, 22 * Math.max(1, text.split('\n').length) + 22) }} />
          {text.trim() || editing
            ? <button type="button" className="round send ready" onClick={send} aria-label={editing ? 'Save' : 'Send'} title={editing ? 'Save (Enter)' : 'Send (Enter)'}>{I.send}</button>
            : <button type="button" className="round" onClick={() => soon('Voice messages')} aria-label="Voice message" title="Voice message">{I.mic}</button>}
        </div>
      </footer>

      {menu && (
        <>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="msg-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="rx-pick">{REACTIONS.map((e) => <button key={e} type="button" className={reactsOf[menu.m.id]?.[e]?.mine ? 'on' : ''} onClick={() => react(menu.m, e)}>{e}</button>)}</div>
            <div className="menu-list">
              <button type="button" onClick={() => { setReplyTo(menu.m); setMenu(null) }}>{I.reply}<span>Reply</span></button>
              {menu.m.kind === 'text' && <button type="button" onClick={() => { window.open(`https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(menu.m.body)}`, '_blank', 'noopener'); setMenu(null) }}>{I.translate}<span>Translate</span></button>}
              {menu.m.kind === 'text' && <button type="button" onClick={() => { copy(menu.m.body, 'Text copied'); setMenu(null) }}>{I.copy}<span>Copy Text</span></button>}
              <button type="button" onClick={() => { copy(linkOf(menu.m), 'Link copied'); setMenu(null) }}>{I.link}<span>Copy Message Link</span></button>
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
                  <button type="button" className="danger" onClick={() => { remove([menu.m]); setMenu(null) }}>{I.trash}<span>Delete</span></button>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {forward && <Forward msgs={forward} me={me} rooms={rooms} titleOf={titleOf} fromRoom={room.room_id} onClose={() => setForward(null)} onDone={(n) => { setForward(null); setPicked(null); toast(n > 1 ? `${n} messages forwarded` : 'Forwarded') }} />}
      {view && <div className="viewer" onClick={() => setView(null)}><img src={view} alt="" /></div>}
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
  return url ? <img className="pic-img" src={url} alt={file?.name || ''} onClick={() => onOpen(url)} /> : <span className="pic-wait" />
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
function RoomInfo({ room, me, people, title, other, onClose, onChanged, onLeft, loadPeople }) {
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
          <div className="people">{members.map((p) => <PersonRow key={p.id} p={p} onClick={() => {}} right={p.id === me.id ? <small className="muted">You</small> : null} />)}</div>
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
