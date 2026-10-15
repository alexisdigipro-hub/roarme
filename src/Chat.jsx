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
    setRooms(data || [])
    loadPeople((data || []).flatMap((r) => r.members || []))
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
          <button type="button" className="me-btn" onClick={() => setModal('settings')} title="Your profile and settings">
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
      </aside>

      <main className="main">
        {active ? (
          <Room key={active.room_id} room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} listen={listen} onRead={reloadSoon} onInfo={() => setModal('info')} onBack={() => setActiveId('')} />
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
      {modal === 'settings' && <Settings me={me} setMe={setMe} onClose={() => setModal('')} />}
      {modal === 'info' && active && <RoomInfo room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} onClose={() => setModal('')} onChanged={loadRooms} onLeft={() => { setActiveId(''); setModal(''); loadRooms() }} loadPeople={loadPeople} />}
    </div>
  )
}

/* ---------- one conversation ---------- */
function Room({ room, me, people, title, other, listen, onRead, onInfo, onBack }) {
  const [msgs, setMsgs] = useState([])
  const [more, setMore] = useState(true)
  const [text, setText] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [view, setView] = useState(null) // a photo opened large
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

  // live messages for this room
  useEffect(() => listen((ev) => {
    const m = ev.new
    if (!m || m.room_id !== room.room_id) return
    if (ev.eventType === 'INSERT') setMsgs((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
    if (ev.eventType === 'UPDATE') setMsgs((list) => list.map((x) => (x.id === m.id ? m : x)))
  }), [listen, room.room_id])

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
    if (el.scrollTop < 60 && more && msgs.length) {
      const h = el.scrollHeight
      const older = await load(msgs[0].created_at)
      if (older.length) {
        setMsgs((list) => [...older, ...list])
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h + el.scrollTop })
      }
    }
  }

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

  const remove = async (m) => {
    const { error } = await supabase.from('roar_messages').update({ deleted_at: new Date().toISOString(), body: '' }).eq('id', m.id)
    if (error) setErr(errText(error))
    else setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: '' } : x)))
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
  const sub = room.kind === 'group' ? `${(room.members || []).length} members` : [other ? `@${other.username}` : '', lastSeenText(other)].filter(Boolean).join(' · ')

  return (
    <div className="room-view" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) sendFiles([...e.dataTransfer.files]) }}>
      <header className="room-head">
        <button type="button" className="round back" onClick={onBack} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
        <button type="button" className="head-card" onClick={onInfo} title="Info">
          <Avatar src={room.kind === 'group' ? room.avatar_url : other?.avatar_url} name={title} size={40} group={room.kind === 'group'} online={onlineNow(other)} />
          <span className="head-text"><strong>{title}</strong><small>{sub}</small></span>
        </button>
        <button type="button" className="round" onClick={onInfo} aria-label="Info" title="Info">{I.info}</button>
      </header>

      <div className="scroll" ref={scrollRef} onScroll={onScroll}>
        {!msgs.length && <p className="empty">No messages yet. Say hi.</p>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const mine = m.user_id === me.id
          const first = newDay || !prev || prev.user_id !== m.user_id || new Date(m.created_at) - new Date(prev.created_at) > 5 * 60 * 1000
          const who = people[m.user_id]
          const quoted = m.reply_to ? byId[m.reply_to] : null
          return (
            <div key={m.id}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}`}>
                {!mine && room.kind === 'group' && (first ? <Avatar src={who?.avatar_url} name={nameOf(who)} size={30} /> : <span className="av-gap" />)}
                <div className={`bubble${m.kind === 'image' && !m.deleted_at ? ' pic' : ''}${m.deleted_at ? ' gone' : ''}`}>
                  {!mine && room.kind === 'group' && first && <b className="who" style={{ '--who': colorOf(m.user_id) }}>{nameOf(who)}</b>}
                  {quoted && <span className="quote"><b>{quoted.user_id === me.id ? 'You' : nameOf(people[quoted.user_id])}</b><span>{quoted.deleted_at ? 'Message deleted' : quoted.kind === 'image' ? 'Photo' : quoted.kind === 'file' ? quoted.file?.name : quoted.body}</span></span>}
                  {m.deleted_at ? <i>Message deleted</i>
                    : m.kind === 'image' ? <Pic file={m.file} onOpen={setView} />
                    : m.kind === 'file' ? <FileTile file={m.file} />
                    : <span className="text">{m.body}</span>}
                  <span className="meta">{m.edited_at && !m.deleted_at && 'edited · '}{timeOf(m.created_at)}</span>
                </div>
                {!m.deleted_at && (
                  <span className="msg-acts">
                    <button type="button" onClick={() => setReplyTo(m)} title="Reply">{I.reply}</button>
                    {m.kind === 'text' && <button type="button" onClick={() => navigator.clipboard?.writeText(m.body)} title="Copy">{I.copy}</button>}
                    {mine && m.kind === 'text' && <button type="button" onClick={() => { setEditing(m); setText(m.body) }} title="Edit">{I.edit}</button>}
                    {mine && <button type="button" className="danger" onClick={() => remove(m)} title="Delete">{I.trash}</button>}
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
            <span>{editing ? 'Editing your message' : <>Replying to <b>{replyTo.user_id === me.id ? 'yourself' : nameOf(people[replyTo.user_id])}</b>: {(replyTo.body || replyTo.file?.name || '').slice(0, 90)}</>}</span>
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
          <button type="button" className={`round send${text.trim() ? ' ready' : ''}`} onClick={send} disabled={!text.trim()} aria-label={editing ? 'Save' : 'Send'} title={editing ? 'Save (Enter)' : 'Send (Enter)'}>{I.send}</button>
        </div>
      </footer>

      {view && <div className="viewer" onClick={() => setView(null)}><img src={view} alt="" /></div>}
    </div>
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
function Settings({ me, setMe, onClose }) {
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
  return (
    <Modal title="Your profile" onClose={onClose} foot={<><button type="button" className="btn btn-danger" onClick={() => supabase.auth.signOut()}>Sign out</button><button type="button" className="btn btn-main" onClick={saveAll} disabled={busy}>{busy ? '…' : saved ? 'Saved' : 'Save'}</button></>}>
      <div className="info-top">
        <button type="button" className="pic-pick" onClick={() => picRef.current?.click()} title="Change your picture"><Avatar src={me.avatar_url} name={nameOf(me)} size={96} /><span>Change</span></button>
        <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { pickPic(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on your messages" /></label>
      <label className="field"><span>Username</span><div className="input-at"><i>@</i><input className="input" value={username} onChange={(e) => setUsername(cleanUsername(e.target.value))} /></div></label>
      <label className="field"><span>About</span><textarea className="input" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about you" /></label>
      {err && <p className="auth-err">{err}</p>}
    </Modal>
  )
}
