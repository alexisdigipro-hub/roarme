import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { USERNAME_RE, cleanUsername, uploadWithProgress, dayLabel, errText, fileLink, fmtBytes, lastSeenText, listTime, nameOf, onlineNow, shrinkImage, supabase, timeOf } from './lib.js'
import { Avatar, CropModal, I, Modal, OnTop, Paw, Wordmark, burst, colorOf, setNameColor, svg, useLens } from './ui.jsx'
import { REACTIONS, TEXT_SIZES, chime, isEmojiOnly, setPrefs, swapEmoji, useLocal, usePrefs } from './prefs.js'
import Profile from './Profile.jsx'
import { formatText, plainText, wrapSelection } from './format.jsx'
import { RecentCalls, useCalls } from './calls.jsx'
import { tr } from './i18n.js'
import { SettingsMenu, SettingsPage } from './SettingsPages.jsx'
import { AttachSheet, AudioNote, MusicTile, isAudioFile, EmojiPicker, MediaViewer, SharedMedia, VideoTile, WallTiles } from './extras.jsx'

// the moving bars while a voice message records (Alex, 16 Oct): not the real sound, a lively stand-in
const REC_WAVE = Array.from({ length: 140 }, (_, i) => (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45))).toFixed(2))

/* people by @username or name */
function usePeopleSearch(meId) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  useEffect(() => {
    const t = q.trim().replace(/[^\p{L}\p{N}_ .-]/gu, '').replace(/^@/, '')
    if (t.length < 2) { setHits([]); return }
    let alive = true
    const id = setTimeout(async () => {
      const { data } = await supabase.from('roar_people').select('id, username, display_name, avatar_url, bio, last_seen, name_color')
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
  const [blocks, setBlocks] = useState(() => new Set()) // the people I blocked
  const loadBlocks = useCallback(async () => {
    const { data } = await supabase.from('roar_blocks').select('blocked')
    setBlocks(new Set((data || []).map((b) => b.blocked)))
  }, [])
  useEffect(() => { loadBlocks() }, [loadBlocks])
  const unblock = async (id) => { await supabase.from('roar_blocks').delete().eq('blocked', id); loadBlocks(); toast('Unblocked') }
  const [activeId, setActiveId] = useState('')
  const [folder, setFolder] = useState(() => { try { return localStorage.getItem('roarme-folder') || 'all' } catch { return 'all' } })
  const [q, setQ] = useState('')
  const [modal, setModal] = useState('') // '' | newchat | newgroup | info | folders | newfolder | pickfolder
  const [plus, setPlus] = useState(false)
  const [tab, setTab] = useState('chats') // the bar at the foot: contacts | calls | chats | settings
  const [cq, setCq] = useState('') // search in Contacts
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState([])
  const [hits, setHits] = useState([])
  const [myFolders, setMyFolders] = useLocal('roarme-folders', [])
  const [hidden, setHidden] = useLocal('roarme-hidden', {})
  // per device: chats pinned to the top, history cleared, chats marked unread, a mute that ends, drafts
  const [pins, setPins] = useLocal('roarme-pins', [])
  const [cleared, setCleared] = useLocal('roarme-cleared', {})
  const [marked, setMarked] = useLocal('roarme-marked', [])
  const [muteUntil, setMuteUntil] = useLocal('roarme-mute-until', {})
  const [drafts] = useLocal('roarme-drafts', {})
  const [roomMenu, setRoomMenu] = useState(null) // { r, x, y, sub }
  const [peek, setPeek] = useState(null) // a chat looked at without opening it
  const [folderMenu, setFolderMenu] = useState(null) // right click on a folder tab: {f, x, y}
  const [folderChats, setFolderChats] = useState('') // the folder whose chats are being picked
  const [setPage, setSetPage] = useState('')
  const [folderSeed, setFolderSeed] = useState([]) // chats a new folder starts with
  // a folder is edited on a page of its own in Settings, like Telegram's (Alex, 16 Oct)
  const openFolders = () => { setModal(''); setTab('settings'); setSetPage('folders') }
  const editFolder = (id, seed = []) => { setModal(''); setFolderSeed(seed); setTab('settings'); setSetPage(`folder:${id}`) }
  const tabsLens = useLens(`${tab}|${folder}|${prefs.folderTabs}|${myFolders.length}|${!q.trim()}`)
  const footLens = useLens(`${tab}|${prefs.callsTab}|${picking}`) // the Settings page open on the right
  const [groupWith, setGroupWith] = useState(null) // Create Group from a chat starts with that person in it
  const searchRef = useRef(null)
  const [note, setNote] = useState('')
  const noteTimer = useRef(0)
  const toast = useCallback((s) => { setNote(s); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 2200) }, [])
  // a copied message link (#m=<chat>/<message>) opens that chat at that message
  const [jump, setJump] = useState('')
  useEffect(() => {
    const go = () => {
      const c = window.location.hash.match(/^#c=([0-9a-f-]{36})$/)
      if (c) { setTab('chats'); setActiveId(c[1]); history.replaceState(null, '', window.location.pathname); return }
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
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setTab('chats'); requestAnimationFrame(() => searchRef.current?.focus()) }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); setTab('settings'); setSetPage('keys') }
    }
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
    const [{ data }, { data: mine }] = await Promise.all([
      supabase.from('roar_people').select('id, username, display_name, avatar_url, bio, last_seen, name_color').in('id', want),
      supabase.from('roar_contacts').select('person, photo_url').in('person', want),
    ])
    const myPhoto = Object.fromEntries((mine || []).map((c) => [c.person, c.photo_url]))
    if (data) {
      data.forEach((x) => {
        setNameColor(x.id, x.name_color)
        x.own_photo = !!x.avatar_url
        x.my_photo = myPhoto[x.id] || ''
        if (!x.avatar_url && x.my_photo) x.avatar_url = x.my_photo
      })
      setPeople((p) => ({ ...p, ...Object.fromEntries(data.map((x) => [x.id, x])) }))
    }
  }, [])

  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase.rpc('roar_my_rooms')
    if (error) return
    const list = data || []
    // the pinned message of each chat
    if (list.length) {
      const { data: pins } = await supabase.from('roar_rooms').select('id, pinned_message_id, auto_delete_hours').in('id', list.map((r) => r.room_id))
      const pin = Object.fromEntries((pins || []).map((x) => [x.id, x]))
      list.forEach((r) => { r.pinned_message_id = pin[r.room_id]?.pinned_message_id || null; r.auto_delete_hours = pin[r.room_id]?.auto_delete_hours || null })
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
    const body = !prefsRef.current.notifyPreview ? 'New message' : (room?.kind === 'group' ? `${nameOf(who)}: ` : '') + (m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? 'File' : plainText(m.body))
    try {
      const n = new Notification(title, { body: tr(body), icon: who?.avatar_url || './icon.svg', tag: m.room_id })
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
  useEffect(() => {
    document.title = unreadAll ? `(${unreadAll}) ROAR` : 'ROAR'
    window.roarDesktop?.setBadge(prefs.badge === false ? 0 : unreadAll) // the count on the app's icon (Mac/Windows app)
  }, [unreadAll, prefs.badge])

  const BUILTIN = [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ['archived', 'Archived']]
  // in the order dragged in Settings > Folders (Alex, 16 Oct); a folder not placed yet goes at the end
  const fOrder = prefs.folderOrder || []
  const fRank = (id) => { const i = fOrder.indexOf(id); return i < 0 ? 1e3 : i }
  const allFolders = [...BUILTIN.map(([id, name]) => ({ id, name })), ...myFolders.map((f) => ({ ...f, custom: true }))]
    .map((f, i) => ({ f, i })).sort((a, b) => fRank(a.f.id) - fRank(b.f.id) || a.i - b.i).map(({ f }) => f)
  const inFolder = (r, f) => {
    if (f === 'archived') return r.archived
    if (r.archived) return false
    if (f === 'unread') return r.unread > 0
    if (f === 'groups') return r.kind === 'group'
    const mine = myFolders.find((x) => x.id === f)
    if (mine) {
      if ((mine.exclude || []).includes(r.room_id)) return false
      if (mine.rooms.includes(r.room_id)) return true
      const t = mine.types || {}
      return (!!t.private && r.kind !== 'group') || (!!t.groups && r.kind === 'group')
    }
    return true
  }
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = visible.filter((r) => (t ? titleOf(r).toLowerCase().includes(t) || (otherOf(r)?.username || '').includes(t.replace(/^@/, '')) : inFolder(r, folder)))
    // pinned chats first, in the order they were pinned
    return [...list.filter((r) => pins.includes(r.room_id)).sort((a, b) => pins.indexOf(a.room_id) - pins.indexOf(b.room_id)), ...list.filter((r) => !pins.includes(r.room_id))]
  }, [visible, folder, q, titleOf, myFolders, pins])

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
  useEffect(() => { if (activeId && marked.includes(activeId)) setMarked((l) => l.filter((x) => x !== activeId)) }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // a mute for a while ends by itself
  useEffect(() => {
    const check = () => {
      const now = Date.now()
      const done = Object.entries(muteUntil).filter(([, t]) => t && t < now).map(([id]) => id)
      if (!done.length) return
      supabase.from('roar_members').update({ muted: false }).in('room_id', done).eq('user_id', me.id).then(() => loadRooms())
      setMuteUntil((m) => { const n = { ...m }; done.forEach((id) => delete n[id]); return n })
    }
    check()
    const id = setInterval(check, 30000)
    return () => clearInterval(id)
  }, [muteUntil, me.id, loadRooms]) // eslint-disable-line react-hooks/exhaustive-deps

  // the menu of a chat in the list (right click), as in Telegram
  const openRoomMenu = (e, r) => {
    e.preventDefault()
    const w = 230, h = 380
    const x = Math.min(e.clientX, window.innerWidth - w - 12)
    // the side menus open to the left when there is no room on the right
    setRoomMenu({ r, x, y: Math.max(12, Math.min(e.clientY, window.innerHeight - h - 12)), sub: '', flip: x + w + 200 > window.innerWidth })
  }
  const roomAct = async (what, arg, from) => {
    const r = from || roomMenu?.r
    setRoomMenu(null)
    if (!r) return
    const mine = (patch) => supabase.from('roar_members').update(patch).eq('room_id', r.room_id).eq('user_id', me.id)
    if (what === 'window') window.open(`${window.location.origin}${window.location.pathname}#c=${r.room_id}`, `roarme-${r.room_id}`, 'popup,width=900,height=780')
    if (what === 'pin') { const on = pins.includes(r.room_id); setPins((l) => (on ? l.filter((x) => x !== r.room_id) : [...l, r.room_id])); toast(on ? 'Unpinned' : 'Pinned to the top') }
    if (what === 'mute') {
      if (r.muted) { await mine({ muted: false }); setMuteUntil((m) => { const n = { ...m }; delete n[r.room_id]; return n }); toast('Sounds on') }
      else { await mine({ muted: true }); setMuteUntil((m) => ({ ...m, [r.room_id]: arg ? Date.now() + arg * 3600e3 : 0 })); toast(arg ? `Muted for ${arg >= 24 ? `${arg / 24} day${arg > 24 ? 's' : ''}` : `${arg} hour${arg > 1 ? 's' : ''}`}` : 'Muted') }
      loadRooms()
    }
    if (what === 'unread') {
      if (r.unread > 0 || marked.includes(r.room_id)) { await mine({ last_read_at: new Date().toISOString() }); setMarked((l) => l.filter((x) => x !== r.room_id)); toast('Marked as read') }
      else { await mine({ last_read_at: new Date(new Date(r.last_message_at).getTime() - 1000).toISOString() }); setMarked((l) => [...new Set([...l, r.room_id])]); if (activeId === r.room_id) setActiveId(''); toast('Marked as unread') }
      loadRooms()
    }
    if (what === 'preview') setPeek(r)
    if (what === 'archive') { await mine({ archived: !r.archived }); toast(r.archived ? 'Unarchived' : 'Archived'); loadRooms() }
    if (what === 'folder') { setMyFolders((list) => list.map((f) => (f.id === arg ? { ...f, rooms: f.rooms.includes(r.room_id) ? f.rooms.filter((x) => x !== r.room_id) : [...f.rooms, r.room_id] } : f))) }
    if (what === 'newfolder') editFolder('new', [r.room_id])
    if (what === 'clear') {
      if (!window.confirm(`Clear the history of ${titleOf(r)}? It goes for you only, on this computer.`)) return
      setCleared((c) => ({ ...c, [r.room_id]: new Date().toISOString() })); toast('History cleared')
    }
    if (what === 'delete') {
      if (r.kind === 'group') {
        if (!window.confirm(`Delete ${titleOf(r)} and leave the group?`)) return
        const { error } = await supabase.rpc('roar_leave', { r: r.room_id })
        if (error) { toast(errText(error)); return }
      } else {
        if (!window.confirm(`Delete the chat with ${titleOf(r)} from your list? A new message brings it back.`)) return
        const at = new Date().toISOString()
        setHidden((h) => ({ ...h, [r.room_id]: at })); setCleared((c) => ({ ...c, [r.room_id]: at }))
      }
      if (activeId === r.room_id) setActiveId('')
      setPins((l) => l.filter((x) => x !== r.room_id))
      loadRooms()
    }
  }

  const preview = (r) => {
    if (drafts[r.room_id] && r.room_id !== activeId) return <><span className="draft">Draft:</span> {drafts[r.room_id]}</>
    if (cleared[r.room_id] && r.last_message_at <= cleared[r.room_id]) return ''
    if (!r.last_kind) return r.kind === 'group' ? 'Group created' : 'Say hi'
    if (r.last_deleted) return ''
    const who = r.last_user === me.id ? 'You: ' : r.kind === 'group' && people[r.last_user] ? `${nameOf(people[r.last_user]).split(' ')[0]}: ` : ''
    const what = r.last_kind === 'image' ? 'Photo' : r.last_kind === 'voice' ? 'Voice message' : r.last_kind === 'file' ? 'File' : plainText(r.last_body)
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

  // Contacts: everyone you share a chat with, the most recently seen first (Alex, 16 Oct, as in Telegram)
  const contacts = useMemo(() => {
    const ids = [...new Set(rooms.flatMap((r) => r.members || []))].filter((id) => id !== me.id)
    const seen = (p) => (onlineNow(p) ? Infinity : p.last_seen ? new Date(p.last_seen).getTime() : 0)
    return ids.map((id) => people[id]).filter(Boolean).sort((a, b) => seen(b) - seen(a) || nameOf(a).localeCompare(nameOf(b)))
  }, [rooms, people, me.id])
  const chatWith = async (p) => {
    const r = rooms.find((x) => x.kind === 'direct' && (x.members || []).includes(p.id))
    if (r) { setTab('chats'); setActiveId(r.room_id); return }
    const { data, error } = await supabase.rpc('roar_open_direct', { other: p.id })
    if (error) toast(errText(error)); else openRoom(data)
  }
  // voice and video calls (round 3): one call at a time, two people
  const { startCall, screen: callScreen } = useCalls({ me, people: peopleRef, loadPeople, toast })
  const directWith = (p) => rooms.find((r) => r.kind === 'direct' && (r.members || []).includes(p.id))?.room_id || null
  const callRoom = (r, video) => {
    if (!r || r.kind !== 'direct') { toast('Group calls come later; for now calls are between two people'); return }
    startCall(otherOf(r), r.room_id, video)
  }
  const calls = useMemo(() => {
    const ids = [...new Set(rooms.filter((r) => r.kind === 'direct').flatMap((r) => r.members || []))].filter((id) => id !== me.id)
    return ids.map((id) => people[id]).filter(Boolean).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  }, [rooms, people, me.id])

  return (
    <div className="app" style={{ '--side-w': `${sideW}px` }}>
      <span className="side-grip" onPointerDown={drag} onDoubleClick={() => { setSideW(370); try { localStorage.setItem('roarme-side', '370') } catch { /* private window */ } }} title="Drag to widen, double-click to reset" />
      <aside className="side">
        <div className="side-col">
        <div className="side-head">
          <button type="button" className="pill-btn" onClick={() => { setPlus(false); if (picking) endPick(); else { setTab('chats'); setPicking(true) } }}>{picking ? 'Done' : 'Edit'}</button>
          <span className="side-brand">{picking ? (picked.length ? `${picked.length} selected` : 'Select chats') : <Wordmark />}</span>
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
                    <button type="button" onClick={() => { setPlus(false); editFolder('new') }}>{I.folder}<span>New folder</span></button>
                    {myFolders.length > 0 && <button type="button" onClick={() => { setPlus(false); openFolders() }}>{I.edit}<span>Edit folders</span></button>}
                  </div>
                </>
              )}
            </span>
          )}
        </div>
        {tab === 'chats' && (
          <>
            <label className="search">{I.search}<input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (⌘K)" onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }} /></label>
            <div className={`rooms-area${prefs.folderTabs === 'bottom' && !q.trim() ? ' bottom' : ''}`}>
            {!q.trim() && (
              <nav ref={tabsLens} className="tabs lens">
                {allFolders.map((f) => {
                  const n = folderUnread(f)
                  return <button key={f.id} type="button" title={f.name} className={folder === f.id ? 'on' : ''} onClick={() => setFolder(f.id)} onContextMenu={(e) => { e.preventDefault(); setFolderMenu({ f, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) }) }}><span className="tab-ico">{f.id === 'all' ? I.chats : f.id === 'unread' ? I.unread : f.id === 'groups' ? I.people : f.id === 'archived' ? I.archive : I.folder}</span><span className="tab-name">{f.name}</span>{n > 0 && f.id !== 'archived' && <small>{n}</small>}</button>
                })}
              </nav>
            )}
            <div className="rooms stagger" key={folder}>
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
                  <button key={r.room_id} type="button" className={`room${r.room_id === activeId && !picking ? ' on' : ''}${isPicked ? ' picked' : ''}${roomMenu?.r.room_id === r.room_id ? ' menu-on' : ''}`} onClick={() => (picking ? setPicked((l) => (isPicked ? l.filter((x) => x !== r.room_id) : [...l, r.room_id])) : setActiveId(r.room_id))} onContextMenu={(e) => !picking && openRoomMenu(e, r)}>
                    {picking && <span className={`tick${isPicked ? ' on' : ''}`} />}
                    <Avatar src={r.kind === 'group' ? r.avatar_url : other?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} online={onlineNow(other)} />
                    <span className="room-main">
                      <span className="room-top"><strong>{titleOf(r)}</strong><small>{listTime(r.last_message_at)}</small></span>
                      <span className="room-bottom"><span className="room-prev">{preview(r)}</span>{r.muted && <span className="room-muted" title="Muted">{I.bell}</span>}{r.unread > 0 ? <span key={r.unread} className={`badge${r.muted ? ' quiet' : ''}${prefs.peekBadge ? ' peekable' : ''}`} onClick={prefs.peekBadge ? (e) => { e.stopPropagation(); setPeek(r) } : undefined} title={prefs.peekBadge ? 'Preview' : undefined}>{r.unread}</span> : marked.includes(r.room_id) ? <span className={`badge dot${r.muted ? ' quiet' : ''}`} /> : pins.includes(r.room_id) ? <span className="room-pin" title="Pinned">{I.pin}</span> : null}</span>
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
            </div>
          </>
        )}
        {tab === 'contacts' && (
          <div className="side-scroll contacts">
            <div className="contacts-top">
              <label className="search">{I.search}<input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Search" /></label>
              <button type="button" className="round" onClick={() => setModal('newchat')} title="Find people" aria-label="Find people">{I.addPerson}</button>
            </div>
            {contacts.filter((p) => !cq.trim() || `${nameOf(p)} ${p.username}`.toLowerCase().includes(cq.trim().toLowerCase().replace(/^@/, ''))).map((p) => (
              <div key={p.id} className="room contact" role="button" tabIndex={0} onClick={() => chatWith(p)} onKeyDown={(e) => { if (e.key === 'Enter') chatWith(p) }}>
                <Avatar src={p.avatar_url} name={nameOf(p)} online={onlineNow(p)} />
                <span className="room-main">
                  <span className="room-top"><strong>{nameOf(p)}</strong></span>
                  <span className="room-bottom"><span className={`room-prev${onlineNow(p) ? ' is-online' : ''}`}>{lastSeenText(p)}</span></span>
                </span>
                {/* call, video call, message: small icons on the right (Alex, 16 Oct) */}
                <span className="contact-acts">
                  <button type="button" onClick={(e) => { e.stopPropagation(); startCall(p, directWith(p), false) }} title="Call" aria-label="Call">{I.phone}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); startCall(p, directWith(p), true) }} title="Video call" aria-label="Video call">{I.video}</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); chatWith(p) }} title="Message" aria-label="Message">{I.chats}</button>
                </span>
              </div>
            ))}
            {!contacts.length && <div className="calls-empty"><span className="side-panel-ico">{I.person}</span><b>No contacts yet</b><p>People you chat with show up here.</p><button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>Find people</button></div>}
          </div>
        )}
        {tab === 'calls' && prefs.callsTab && (
          <div className="side-scroll calls">
            <button type="button" className="new-call" onClick={() => setModal('newcall')}><span className="new-call-ico">{svg(<><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /><path d="M18 3v6M15 6h6" /></>, 20)}</span><span>Create New Call</span></button>
            <div className="hits-head">Recent Calls</div>
            <RecentCalls me={me} people={people} loadPeople={loadPeople} onCall={(p, roomId, video) => startCall(p, roomId || directWith(p), video)}
              empty={<div className="calls-empty"><span className="side-panel-ico">{I.calls}</span><b>No calls yet</b><p>Call someone from Create New Call, or from the phone and camera buttons in a chat.</p></div>} />
          </div>
        )}
        {tab === 'settings' && <SettingsMenu me={me} page={setPage || 'general'} onPage={setSetPage} />}
        </div>
        {picking ? (
          <nav className="foot bulk">
            <button type="button" disabled={!picked.length} onClick={bulkRead}>{I.read}<span>Read</span></button>
            <button type="button" disabled={!picked.length} onClick={bulkArchive}>{I.archive}<span>{allArchived ? 'Unarchive' : 'Archive'}</span></button>
            <button type="button" disabled={!picked.length} onClick={() => setModal('pickfolder')}>{I.folder}<span>Folder</span></button>
            <button type="button" className="danger" disabled={!picked.length} onClick={bulkDelete}>{I.trash}<span>Delete</span></button>
          </nav>
        ) : (
          <nav ref={footLens} className="foot lens">
            <button type="button" className={tab === 'contacts' ? 'on' : ''} onClick={() => setTab('contacts')}>{I.person}<span>Contacts</span></button>
            <button type="button" className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}><span className="foot-ico">{I.chats}{unreadAll > 0 && <i>{unreadAll > 99 ? '99+' : unreadAll}</i>}</span><span>Chats</span></button>
            {prefs.callsTab && <button type="button" className={tab === 'calls' ? 'on' : ''} onClick={() => setTab('calls')}>{I.calls}<span>Calls</span></button>}
            <button type="button" className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>{I.gear}<span>Settings</span></button>
          </nav>
        )}
      </aside>

      <main className="main">
        {tab === 'settings' ? (
          <SettingsPage page={setPage || 'general'} chosen={!!setPage} onPage={setSetPage} onBack={() => setSetPage('')} toast={toast} me={me} setMe={setMe}
            profile={<Settings me={me} setMe={setMe} inline />} folders={allFolders} onFolders={(m) => (m === 'newfolder' ? editFolder('new') : m.startsWith('folder:') ? editFolder(m.slice(7)) : openFolders())}
            folderKit={{ folders: myFolders, setFolders: setMyFolders, rooms: visible, titleOf, seed: folderSeed, face: (r, size = 36) => <Avatar src={r.kind === 'group' ? r.avatar_url : otherOf(r)?.avatar_url} name={titleOf(r)} size={size} group={r.kind === 'group'} />, onDeleted: (id) => { if (folder === id) setFolder('all') } }}
            onFolderMenu={(f, e) => setFolderMenu({ f, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) })} />
        ) : active ? (
          <Room key={active.room_id} room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} listen={listen} onRead={reloadSoon} onInfo={() => setModal('info')} onBack={() => setActiveId('')}
            rooms={rooms} titleOf={titleOf} toast={toast} jump={jump} onJumped={clearJump} prefs={prefs} clearedAt={cleared[active.room_id]}
            onAct={(what, arg) => roomAct(what, arg, active)} onNewGroup={(p) => { setGroupWith(p); setModal('newgroup') }}
            blocked={active.kind === 'direct' && blocks.has(otherOf(active)?.id)} onUnblock={() => unblock(otherOf(active)?.id)} onCall={(v) => callRoom(active, v)} />
        ) : (
          <div className="pick">
            <span className="pick-paw"><Paw size={64} /></span>
            <h2>ROAR</h2>
            <p>Pick a chat, or start a new one.</p>
            <div className="pick-acts">
              <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>{I.person} New chat</button>
              <button type="button" className="btn" onClick={() => setModal('newgroup')}>{I.people} New group</button>
            </div>
          </div>
        )}
      </main>

      {modal === 'newchat' && <NewChat me={me} onClose={() => setModal('')} onOpen={openRoom} />}
      {modal === 'newcall' && (
        <Modal title="New call" onClose={() => setModal('')}>
          <p className="muted">Pick who to call. Calls go straight from your computer to theirs.</p>
          <div className="people">
            {calls.map((p) => (
              <div key={p.id} className="person call-row">
                <Avatar src={p.avatar_url} name={nameOf(p)} size={40} online={onlineNow(p)} />
                <span className="person-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
                <button type="button" className="round" onClick={() => { setModal(''); startCall(p, directWith(p), false) }} aria-label="Voice call">{I.phone}</button>
                <button type="button" className="round" onClick={() => { setModal(''); startCall(p, directWith(p), true) }} aria-label="Video call">{I.video}</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'newgroup' && <NewGroup me={me} start={groupWith} onClose={() => { setModal(''); setGroupWith(null) }} onOpen={(id) => { setGroupWith(null); openRoom(id) }} />}
      {modal === 'info' && active && <Profile room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} rooms={rooms} titleOf={titleOf} toast={toast}
        onClose={() => setModal('')} onMessage={() => setModal('')} onOpenRoom={(id) => { setModal(''); setActiveId(id) }}
        onChanged={loadRooms} onLeft={() => { setActiveId(''); setModal(''); loadRooms() }} loadPeople={loadPeople}
        blocked={active.kind === 'direct' && blocks.has(otherOf(active)?.id)} onBlocks={loadBlocks} onCall={active.kind === 'direct' ? (v) => { setModal(''); callRoom(active, v) } : null} />}
      {modal === 'pickfolder' && (
        <Modal title="Add to a folder" onClose={() => setModal('')}>
          {myFolders.length ? (
            <div className="people">{myFolders.map((f) => <button key={f.id} type="button" className="person" onClick={() => addToFolder(f.id)}><span className="file-ico">{I.folder}</span><span className="person-text"><b>{f.name}</b><small>{f.rooms.length} chats</small></span></button>)}</div>
          ) : (
            <><p className="muted">You have no folders yet.</p><button type="button" className="btn btn-main" onClick={() => editFolder('new')}>Make a folder</button></>
          )}
        </Modal>
      )}
      {roomMenu && (
        <OnTop>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setRoomMenu(null)} onContextMenu={(e) => { e.preventDefault(); setRoomMenu(null) }} />
          <div className={`room-menu menu-list${roomMenu.flip ? ' flip' : ''}`} style={{ left: roomMenu.x, top: roomMenu.y }}>
            <button type="button" onClick={() => roomAct('window')}>{I.popout}<span>Open In Window</span></button>
            <button type="button" onClick={() => roomAct('pin')}>{I.pin}<span>{pins.includes(roomMenu.r.room_id) ? 'Unpin' : 'Pin'}</span></button>
            {roomMenu.r.muted
              ? <button type="button" onClick={() => roomAct('mute')}>{I.bell}<span>Unmute</span></button>
              : (
                <div className={`has-sub${roomMenu.sub === 'mute' ? ' open' : ''}`} onMouseEnter={() => setRoomMenu((m) => ({ ...m, sub: 'mute' }))}>
                  <button type="button" onClick={() => setRoomMenu((m) => ({ ...m, sub: m.sub === 'mute' ? '' : 'mute' }))}>{I.bellOff}<span>Mute</span><i className="sub-arrow">{I.right}</i></button>
                  {roomMenu.sub === 'mute' && (
                    <div className="sub-menu menu-list">
                      <button type="button" onClick={() => roomAct('mute', 1)}><span>For 1 hour</span></button>
                      <button type="button" onClick={() => roomAct('mute', 8)}><span>For 8 hours</span></button>
                      <button type="button" onClick={() => roomAct('mute', 24)}><span>For 1 day</span></button>
                      <button type="button" onClick={() => roomAct('mute', 168)}><span>For 7 days</span></button>
                      <button type="button" onClick={() => roomAct('mute', 0)}><span>Forever</span></button>
                    </div>
                  )}
                </div>
              )}
            <button type="button" onClick={() => roomAct('unread')} onMouseEnter={() => setRoomMenu((m) => ({ ...m, sub: '' }))}>{I.unread}<span>{roomMenu.r.unread > 0 || marked.includes(roomMenu.r.room_id) ? 'Mark As Read' : 'Mark As Unread'}</span></button>
            <button type="button" onClick={() => roomAct('preview')}>{I.eye}<span>Preview</span></button>
            <hr />
            <button type="button" onClick={() => roomAct('archive')}>{I.archive}<span>{roomMenu.r.archived ? 'Unarchive' : 'Archive'}</span></button>
            <div className={`has-sub${roomMenu.sub === 'folder' ? ' open' : ''}`} onMouseEnter={() => setRoomMenu((m) => ({ ...m, sub: 'folder' }))}>
              <button type="button" onClick={() => setRoomMenu((m) => ({ ...m, sub: m.sub === 'folder' ? '' : 'folder' }))}>{I.folder}<span>Add to folder…</span><i className="sub-arrow">{I.right}</i></button>
              {roomMenu.sub === 'folder' && (
                <div className="sub-menu menu-list">
                  {myFolders.map((f) => <button key={f.id} type="button" onClick={() => roomAct('folder', f.id)}><span>{f.name}</span>{f.rooms.includes(roomMenu.r.room_id) && <i className="sub-check">{I.check}</i>}</button>)}
                  {myFolders.length > 0 && <hr />}
                  <button type="button" onClick={() => roomAct('newfolder')}>{I.plus}<span>New folder</span></button>
                </div>
              )}
            </div>
            <hr />
            <button type="button" onClick={() => roomAct('clear')} onMouseEnter={() => setRoomMenu((m) => ({ ...m, sub: '' }))}>{I.clear}<span>Clear History</span></button>
            <button type="button" className="danger" onClick={() => roomAct('delete')}>{I.trash}<span>{roomMenu.r.kind === 'group' ? 'Delete and Leave' : 'Delete Chat'}</span></button>
          </div>
        </OnTop>
      )}
      {folderMenu && (
        <OnTop>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setFolderMenu(null)} onContextMenu={(e) => { e.preventDefault(); setFolderMenu(null) }} />
          <div className="room-menu folder-menu menu-list" style={{ left: folderMenu.x, top: folderMenu.y }}>
            {folderMenu.f.custom ? (
              <>
                <button type="button" onClick={() => { const f = folderMenu.f; setFolderMenu(null); editFolder(f.id) }}>{I.edit}<span>Edit Folder</span></button>
                <button type="button" onClick={() => { setFolderChats(folderMenu.f.id); setFolderMenu(null) }}>{I.plus}<span>Add Chats</span></button>
                <hr />
                <button type="button" className="danger" onClick={() => {
                  const f = folderMenu.f
                  setFolderMenu(null)
                  if (!window.confirm(`Delete the folder ${f.name}? The chats in it stay.`)) return
                  setMyFolders((list) => list.filter((x) => x.id !== f.id))
                  if (folder === f.id) setFolder('all')
                  toast('Folder deleted')
                }}>{I.trash}<span>Delete</span></button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setFolderMenu(null); openFolders() }}>{I.edit}<span>Edit Folders</span></button>
                <button type="button" onClick={() => { setFolderMenu(null); editFolder('new') }}>{I.plus}<span>New Folder</span></button>
              </>
            )}
          </div>
        </OnTop>
      )}
      {folderChats && (() => {
        const f = myFolders.find((x) => x.id === folderChats)
        if (!f) return null
        const flip = (id) => setMyFolders((list) => list.map((x) => (x.id === f.id ? { ...x, rooms: x.rooms.includes(id) ? x.rooms.filter((y) => y !== id) : [...x.rooms, id] } : x)))
        return (
          <Modal title={`Chats in ${f.name}`} onClose={() => setFolderChats('')} foot={<button type="button" className="btn btn-main" onClick={() => setFolderChats('')}>Done</button>}>
            <div className="people">
              {visible.map((r) => (
                <button key={r.room_id} type="button" className="person" onClick={() => flip(r.room_id)}>
                  <Avatar src={r.kind === 'group' ? r.avatar_url : otherOf(r)?.avatar_url} name={titleOf(r)} size={40} group={r.kind === 'group'} />
                  <span className="person-text"><b>{titleOf(r)}</b><small>{r.kind === 'group' ? 'Group' : 'Private chat'}</small></span>
                  <span className={`tick${f.rooms.includes(r.room_id) ? ' on' : ''}`} />
                </button>
              ))}
            </div>
          </Modal>
        )
      })()}
      {peek && <Peek room={peek} me={me} people={people} title={titleOf(peek)} clearedAt={cleared[peek.room_id]} onClose={() => setPeek(null)} onOpen={() => { setActiveId(peek.room_id); setPeek(null) }} />}
      {callScreen}
      {note && <div className="toast" role="status">{note}</div>}
    </div>
  )
}

/* Preview: a chat's last messages, looked at without opening it (so nothing is marked read) */
function Peek({ room, me, people, title, clearedAt, onClose, onOpen }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    supabase.from('roar_messages').select('id, user_id, kind, body, file, created_at').eq('room_id', room.room_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setList((data || []).filter((m) => !clearedAt || m.created_at > clearedAt).reverse()))
  }, [room.room_id, clearedAt])
  return (
    <Modal title={title} onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Close</button><button type="button" className="btn btn-main" onClick={onOpen}>Open chat</button></>}>
      <div className="peek">
        {list === null && <p className="muted">Loading…</p>}
        {list && !list.length && <p className="muted">No messages.</p>}
        {(list || []).map((m) => (
          <div key={m.id} className={`peek-msg${m.user_id === me.id ? ' mine' : ''}`}>
            {room.kind === 'group' && m.user_id !== me.id && <b style={{ color: colorOf(m.user_id) }}>{nameOf(people[m.user_id])}</b>}
            <span>{m.kind === 'image' ? '📷 Photo' : m.kind === 'voice' ? '🎤 Voice message' : m.kind === 'file' ? `📎 ${m.file?.name || 'File'}` : m.body}</span>
            <small>{timeOf(m.created_at)}</small>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/* ---------- one conversation ---------- */
function Room({ room, me, people, title, other, listen, onRead, onInfo, onBack, rooms, titleOf, toast, jump, onJumped, prefs, clearedAt, onAct, onNewGroup, blocked, onUnblock, onCall }) {
  const [msgs, setMsgs] = useState([])
  const [more, setMore] = useState(true)
  // an unsent message waits for you, per chat (shown in the list as Draft:)
  const [, setDrafts] = useLocal('roarme-drafts', {})
  const [text, setText] = useState(() => { try { return (JSON.parse(localStorage.getItem('roarme-drafts')) || {})[room.room_id] || '' } catch { return '' } })
  useEffect(() => {
    const id = setTimeout(() => setDrafts((d) => {
      const has = !!text.trim()
      if (!has && !(room.room_id in d)) return d
      const n = { ...d }
      if (has) n[room.room_id] = text; else delete n[room.room_id]
      return n
    }), 400)
    return () => clearTimeout(id)
  }, [text, room.room_id]) // eslint-disable-line react-hooks/exhaustive-deps
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
  const [headSub, setHeadSub] = useState('') // Mute › or Auto-Delete › open in the ⋯ menu
  const [walls, setWalls] = useLocal('roarme-walls', {}) // a wallpaper of its own, per chat
  const wall = walls[room.room_id] || prefs.background
  const [wallPick, setWallPick] = useState(false)
  const [rec, setRec] = useState(null) // { started }
  const [outbox, setOutbox] = useState([]) // { id, name, preview, p, stage, holder }
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
  }, [msgs, outbox.length])
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
    const body = prefs.autoEmoji ? swapEmoji(text.trim()) : text.trim()
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

  // what is on its way up: one tile each, with a ring that fills (Alex, 16 Oct)
  const setOut = (id, patch) => setOutbox((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const dropOut = (id) => setOutbox((l) => { const x = l.find((y) => y.id === id); if (x?.preview) URL.revokeObjectURL(x.preview); return l.filter((y) => y.id !== id) })
  const upload = async (file, kind, extra = {}, outId = null) => {
    const safe = (file.name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
    const path = `${room.room_id}/${crypto.randomUUID()}-${safe}`
    // a sound file the computer did not name (some .wav, .aiff, .flac) gets its type from its ending, so it plays
    const ext = ((file.name || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase()
    const type = file.type || (ext && isAudioFile({ name: file.name }) ? `audio/${{ mp3: 'mpeg', m4a: 'mp4', aif: 'aiff', oga: 'ogg' }[ext] || ext}` : '')
    const holder = {}
    if (outId) setOut(outId, { holder, stage: 'up' })
    await uploadWithProgress('roar-files', path, file, type, (p) => { if (outId) setOut(outId, { p }) }, holder)
    if (outId) setOut(outId, { stage: 'send', p: 1 })
    return { path, name: file.name, size: file.size, type, ...extra }
  }

  const sendFiles = async (files, caption = '', compress = true) => {
    setAttach(null); setErr('')
    const reply = replyTo
    setReplyTo(null)
    stick.current = true
    const ok = files.filter((f) => { if (f.size > 50e6) { setErr(`${f.name} is over 50 MB.`); return false } return true })
    const tiles = ok.map((f) => ({ id: crypto.randomUUID(), name: f.name, size: f.size, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : '', p: 0, stage: 'prep' }))
    setOutbox((l) => [...l, ...tiles])
    let n = 0
    for (const raw of ok) {
      const tile = tiles[n]
      n += 1
      const isImg = /^image\/(jpeg|png|webp)$/.test(raw.type)
      try {
        const file = isImg && compress ? await shrinkImage(raw, prefs.largePhotos ? 2560 : 1600, prefs.largePhotos ? 0.88 : 0.82) : raw
        const meta = await upload(file, null, {}, tile.id)
        stick.current = true
        const last = n === ok.length
        const { data, error } = await supabase.from('roar_messages').insert({
          room_id: room.room_id, user_id: me.id, kind: /^image\//.test(file.type) && !/gif|svg/.test(file.type) ? 'image' : 'file', body: last ? caption : '',
          file: meta, reply_to: reply?.id || null,
        }).select().single()
        if (error) throw error
        stick.current = true
        setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
      } catch (e) {
        if (!e?.cancelled) setErr(`${raw.name}: ${errText(e)}`)
      }
      dropOut(tile.id)
    }
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
      const tile = { id: crypto.randomUUID(), name: 'Voice message', size: file.size, preview: '', p: 0, stage: 'prep', voice: true }
      setOutbox((l) => [...l, tile])
      stick.current = true
      try {
        const meta = await upload(file, 'voice', { dur }, tile.id)
        stick.current = true
        const { data, error } = await supabase.from('roar_messages').insert({ room_id: room.room_id, user_id: me.id, kind: 'voice', body: '', file: meta, reply_to: replyTo?.id || null }).select().single()
        if (error) throw error
        setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
        setReplyTo(null)
      } catch (e) {
        if (!e?.cancelled) setErr(errText(e))
      }
      dropOut(tile.id)
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

  const textOf = (m) => (m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? `${isAudioFile(m.file) ? '🎵 ' : ''}${m.file?.name || 'File'}` : m.body)
  const copy = async (s, what = 'Copied') => { try { await navigator.clipboard.writeText(s); toast(what) } catch { toast('Copy did not work here') } }
  const linkOf = (m) => `${window.location.origin}${window.location.pathname}#m=${room.room_id}/${m.id}`
  const translate = (s) => window.open(`https://translate.google.com/?sl=auto&tl=${prefs.translateTo && prefs.translateTo !== 'auto' ? prefs.translateTo : /[Ͱ-Ͽ]/.test(s) ? 'en' : 'el'}&op=translate&text=${encodeURIComponent(s)}`, '_blank', 'noopener')

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
  // The menu opens only on a message itself (Alex, 16 Oct): a right click on it with a mouse, a tap on it on a
  // touch screen; a click on the empty space beside it does nothing. A double click is the quick reaction;
  // a photo, a link or a button inside it does its own thing.
  const tapTimer = useRef(0)
  const mouse = typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
  const onBubble = (e) => !!e.target.closest?.('.bubble')
  const onTap = (e, m) => {
    if (mouse || !onBubble(e)) return
    if (e.target.closest('a, button, img, video, audio, input, textarea, .quote, .rx') || window.getSelection()?.toString()) return
    const at = { preventDefault() {}, clientX: e.clientX, clientY: e.clientY }
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => openMenu(at, m), 230)
  }
  const autoDl = room.kind === 'group' ? prefs.dlGroups !== false : prefs.dlPrivate !== false
  const bornAt = useRef(Date.now()) // messages newer than the opening of the chat fly in
  const onDouble = (m, e) => {
    if (m.deleted_at || picked) return
    const how = prefs.doubleTap
    if (how === 'edit' && m.user_id === me.id && m.kind === 'text') { setReplyTo(null); setEditing(m); setText(m.body) }
    else if (how === 'forward') setForward([m])
    else if (how === 'reply' || how === 'edit') setReplyTo(m)
    else { react(m, prefs.quick); if (!reactsOf[m.id]?.[prefs.quick]?.mine) burst(prefs.quick, e?.clientX, e?.clientY) }
  }

  const onKey = (e) => {
    // Cmd/Ctrl + B bold, I italic, E code, Shift+X strike, Shift+P spoiler, around what is selected
    const fmtKey = (e.metaKey || e.ctrlKey) && ({ b: '**', i: '_', e: '`', ...(e.shiftKey ? { x: '~~', p: '||' } : {}) })[e.key.toLowerCase()]
    if (fmtKey && e.currentTarget) {
      e.preventDefault()
      const el = e.currentTarget
      const { next, caretA, caretB } = wrapSelection(el, text, fmtKey)
      setText(next)
      requestAnimationFrame(() => { el.selectionStart = caretA; el.selectionEnd = caretB })
      return
    }
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
  // links that open (in the browser, a new tab) and @usernames lit up, inside a message's text
  const withMentions = (s) => {
    const parts = String(s).split(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|@[a-z0-9_]{3,24})/g)
    return parts.map((p, i) => {
      if (!(i % 2)) return p
      if (p.startsWith('@')) return <span key={i} className="mention">{p}</span>
      const tail = (p.match(/[.,;:!?)\]]+$/) || [''])[0]
      const url = tail ? p.slice(0, -tail.length) : p
      return <span key={i}><a className="msg-link" href={url.startsWith('www.') ? `https://${url}` : url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{url}</a>{tail}</span>
    })
  }

  const sub = room.kind === 'group' ? `${(room.members || []).length} members` : [other ? `@${other.username}` : '', lastSeenText(other)].filter(Boolean).join(' · ')
  const pinnedRaw = room.pinned_message_id ? byId[room.pinned_message_id] || { id: room.pinned_message_id, body: 'Pinned message', kind: 'text' } : null
  const pinned = pinnedRaw?.deleted_at ? null : pinnedRaw
  // a deleted message simply goes, with nothing left in its place (Alex, 16 Oct)
  const shownMsgs = useMemo(() => msgs.filter((m) => !m.deleted_at && (!clearedAt || m.created_at > clearedAt)), [msgs, clearedAt])
  const pickedMsgs = picked ? msgs.filter((m) => picked.includes(m.id)) : []
  const act = (what, arg) => { setHeadMenu(false); onAct(what, arg) }
  // messages here go by themselves after a day, a week or a month
  const setAutoDelete = async (hours) => {
    setHeadMenu(false)
    const { error } = await supabase.rpc('roar_set_auto_delete', { r: room.room_id, hours })
    if (error) { toast(errText(error)); return }
    onRead()
    toast(hours ? `Messages go after ${hours === 24 ? '1 day' : hours === 168 ? '1 week' : '1 month'}` : 'Auto-delete off')
  }
  // the whole chat as a text file: date, time, who, what (deleted and cleared messages left out)
  const exportChat = async () => {
    setHeadMenu(false)
    toast('Preparing the file…')
    let all = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('roar_messages').select('user_id, kind, body, file, created_at').eq('room_id', room.room_id).is('deleted_at', null).order('created_at').range(from, from + 999)
      if (error) { toast(errText(error)); return }
      all = all.concat(data || [])
      if (!data || data.length < 1000) break
    }
    if (clearedAt) all = all.filter((m) => m.created_at > clearedAt)
    const two = (n) => String(n).padStart(2, '0')
    const when = (s) => { const d = new Date(s); return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}` }
    const what = (m) => (m.kind === 'image' ? `[Photo${m.file?.name ? `: ${m.file.name}` : ''}]${m.body ? ` ${m.body}` : ''}` : m.kind === 'voice' ? '[Voice message]' : m.kind === 'file' ? `[File: ${m.file?.name || 'file'}]${m.body ? ` ${m.body}` : ''}` : m.body)
    const lines = all.map((m) => `[${when(m.created_at)}] ${m.user_id === me.id ? nameOf(me) : nameOf(people[m.user_id]) || 'Someone'}: ${what(m)}`)
    const text = `ROAR · ${title}\nExported ${when(new Date().toISOString())} · ${all.length} messages\n\n${lines.join('\n')}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    a.download = `ROAR - ${title.replace(/[\\/:*?"<>|]/g, '')}.txt`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  return (
    <div className={`room-view${prefs.compact ? ' compact' : ''}`} data-bg={wall} style={{ '--fs': `${TEXT_SIZES[prefs.textSize] || 15.5}px` }}
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
            <button type="button" className="round" onClick={() => onCall(false)} aria-label="Voice call" title="Voice call">{I.phone}</button>
            <button type="button" className="round" onClick={() => onCall(true)} aria-label="Video call" title="Video call">{I.video}</button>
            <button type="button" className="round" onClick={() => { setFind(''); setFindAt(0) }} aria-label="Search in this chat" title="Search in this chat">{I.search}</button>
            <span className="plus-wrap">
              <button type="button" className={`round${headMenu ? ' on' : ''}`} onClick={() => { setHeadSub(''); setHeadMenu((v) => !v) }} aria-label="More" title="More">{I.more}</button>
              {headMenu && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setHeadMenu(false)} />
                  <div className="menu head-menu" onMouseLeave={() => setHeadSub('')}>
                    {room.kind === 'group' && room.role === 'admin' && <button type="button" onClick={() => { setHeadMenu(false); onInfo() }} onMouseEnter={() => setHeadSub('')}>{I.edit}<span>Edit</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); onInfo() }} onMouseEnter={() => setHeadSub('')}>{I.info}<span>Info</span></button>
                    {room.muted
                      ? <button type="button" onClick={() => act('mute')} onMouseEnter={() => setHeadSub('')}>{I.bell}<span>Unmute</span></button>
                      : (
                        <div className={`has-sub${headSub === 'mute' ? ' open' : ''}`} onMouseEnter={() => setHeadSub('mute')}>
                          <button type="button" onClick={() => setHeadSub((s) => (s === 'mute' ? '' : 'mute'))}>{I.bellOff}<span>Mute</span><i className="sub-arrow">{I.right}</i></button>
                          {headSub === 'mute' && (
                            <div className="sub-menu menu-list">
                              {[[1, 'For 1 hour'], [8, 'For 8 hours'], [24, 'For 1 day'], [168, 'For 7 days'], [0, 'Forever']].map(([h, l]) => <button key={h} type="button" onClick={() => act('mute', h)}><span>{l}</span></button>)}
                            </div>
                          )}
                        </div>
                      )}
                    <button type="button" onClick={() => { setHeadMenu(false); onCall(true) }} onMouseEnter={() => setHeadSub('')}>{I.video}<span>Video</span></button>
                    {room.kind !== 'group' && other && <button type="button" onClick={() => { setHeadMenu(false); onNewGroup(other) }}>{I.people}<span>Create Group</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); setMedia(true) }}>{I.image}<span>Photos, videos & files</span></button>
                    {pinned && <button type="button" onClick={() => { setHeadMenu(false); goTo(pinned.id) }}>{I.pin}<span>Pinned message</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); setWallPick(true) }}>{I.brush}<span>Change Wallpaper</span></button>
                    <button type="button" onClick={exportChat} onMouseEnter={() => setHeadSub('')}>{I.file}<span>Export Chat History…</span></button>
                    <hr />
                    <div className={`has-sub${headSub === 'auto' ? ' open' : ''}`} onMouseEnter={() => setHeadSub('auto')}>
                      <button type="button" onClick={() => setHeadSub((s) => (s === 'auto' ? '' : 'auto'))}>{I.timer}<span>Auto-Delete Messages</span><i className="sub-arrow">{I.right}</i></button>
                      {headSub === 'auto' && (
                        <div className="sub-menu menu-list">
                          {[[null, 'Off'], [24, 'After 1 day'], [168, 'After 1 week'], [720, 'After 1 month']].map(([h, l]) => <button key={l} type="button" onClick={() => setAutoDelete(h)}><span>{l}</span>{(room.auto_delete_hours || null) === h && <i className="sub-check">{I.check}</i>}</button>)}
                          <p className="sub-note">{room.kind === 'group' ? 'Admins choose, for everyone in the group' : 'For both of you'}</p>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => act('clear')} onMouseEnter={() => setHeadSub('')}>{I.clear}<span>Clear Chat History</span></button>
                    <button type="button" className="danger" onClick={() => act('delete')}>{I.trash}<span>{room.kind === 'group' ? 'Delete and Leave' : 'Delete Chat'}</span></button>
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
        {!shownMsgs.length && <p className="empty">{room.kind === 'group' ? 'No messages yet.' : `No messages with ${title} yet. Say hi.`}</p>}
        {shownMsgs.map((m, i) => {
          const prev = shownMsgs[i - 1]
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
          const isGifFile = m.kind === 'file' && /gif/.test(m.file?.type || '')
          const hit = find && found.includes(m.id)
          return (
            <div key={m.id} id={`m-${m.id}`}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}${new Date(m.created_at).getTime() > bornAt.current - 1500 ? ' fresh' : ''}${flash === m.id ? ' flash' : ''}${isPicked ? ' picked' : ''}${hit ? ' hit' : ''}`}
                onClick={picked ? () => setPicked((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id])) : (e) => onTap(e, m)}
                onDoubleClick={(e) => { clearTimeout(tapTimer.current); if (onBubble(e)) onDouble(m, e) }}
                onContextMenu={(e) => { if (onBubble(e)) openMenu(e, m) }}>
                {picked && <span className={`tick${isPicked ? ' on' : ''}`} />}
                {!mine && room.kind === 'group' && prefs.faces && (first ? <Avatar src={who?.avatar_url} name={nameOf(who)} size={30} /> : <span className="av-gap" />)}
                <div className="bubble-col">
                  <div className={`bubble${(m.kind === 'image' || isVideo || isGifFile) && !m.deleted_at ? ' pic' : ''}${m.deleted_at ? ' gone' : ''}${big ? ' big-emoji' : ''}`}>
                    {!mine && room.kind === 'group' && first && !big && <b className="who" style={{ '--who': colorOf(m.user_id) }}>{nameOf(who)}</b>}
                    {quoted && !quoted.deleted_at && <span className="quote" onClick={(e) => { e.stopPropagation(); goTo(quoted.id) }}><b>{quoted.user_id === me.id ? 'You' : nameOf(people[quoted.user_id])}</b><span>{quoted.deleted_at ? 'Message deleted' : textOf(quoted)}</span></span>}
                    {m.deleted_at ? <i>Message deleted</i>
                      : m.kind === 'image' || isGifFile ? <Pic file={m.file} auto={autoDl} still={isGifFile && prefs.autoplayGifs === false} gif={isGifFile} onOpen={(u) => (isGifFile ? window.open(u, '_blank', 'noopener') : openPhoto(m))} />
                      : m.kind === 'voice' ? <AudioNote file={m.file} />
                      : isVideo ? <VideoTile file={m.file} auto={autoDl} play={prefs.autoplayVideos} />
                      : m.kind === 'file' && isAudioFile(m.file) ? <MusicTile file={m.file} />
                      : m.kind === 'file' ? <FileTile file={m.file} />
                      : null}
                    {!m.deleted_at && m.body && <span className="text">{formatText(m.body, withMentions)}</span>}
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
        {outbox.map((o) => {
          const c = 2 * Math.PI * 19
          return (
            <div key={o.id} className="msg mine first out">
              <div className="bubble-col">
                <div className={`bubble outbox${o.preview ? ' has-pic' : ''}`}>
                  {o.preview && <img src={o.preview} alt="" />}
                  <span className="out-row">
                    <span className="ring" title={o.stage === 'up' ? `${Math.round(o.p * 100)}%` : ''}>
                      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
                        <circle cx="22" cy="22" r="19" className="ring-track" />
                        <circle cx="22" cy="22" r="19" className={`ring-fill${o.stage !== 'up' ? ' spin' : ''}`} strokeDasharray={c} strokeDashoffset={o.stage === 'up' ? c * (1 - o.p) : c * 0.72} />
                      </svg>
                      <button type="button" className="ring-x" onClick={() => { o.holder?.abort?.(); if (!o.holder?.abort) dropOut(o.id) }} aria-label="Stop" title="Stop">{I.x}</button>
                    </span>
                    <span className="out-text">
                      <b>{o.name}</b>
                      <small>{o.stage === 'prep' ? 'Preparing…' : o.stage === 'send' ? 'Sending…' : `${Math.round(o.p * 100)}% · ${fmtBytes(o.size * o.p)} of ${fmtBytes(o.size)}`}</small>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {blocked ? (
        <footer className="compose-wrap"><div className="bar blocked-bar"><span>You blocked {title}. They cannot message or call you.</span><button type="button" className="link" onClick={onUnblock}>Unblock</button></div></footer>
      ) : (
      <footer className="compose-wrap">
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
            <span className="rec-wave" role="img" aria-label="Recording…">{REC_WAVE.map((h, i) => <i key={i} style={{ '--h': h, '--d': `${(i * 137) % 900}ms` }} />)}</span>
            <button type="button" className="round danger" onClick={() => stopVoice(false)} aria-label="Throw away" title="Throw away">{I.trash}</button>
            <button type="button" className="round send ready" onClick={() => stopVoice(true)} aria-label="Send" title="Send">{I.send}</button>
          </div>
        ) : (
          <div className="compose">
            {!editing && <button type="button" className="round" onClick={() => setAttach([])} aria-label="Photo, video or file" title="Photo, video or file">{I.clip}</button>}
            <span className={`compose-box${replyTo || editing ? ' has-ref' : ''}`}>
              {(replyTo || editing) && (
                <span className="compose-ref" style={{ '--ref': editing ? 'var(--accent)' : replyTo.user_id === me.id ? 'var(--accent)' : colorOf(replyTo.user_id) }}>
                  <span className="compose-ref-ico">{editing ? I.edit : I.reply}</span>
                  <span className="compose-ref-text">
                    <b>{editing ? 'Edit message' : `Reply to ${replyTo.user_id === me.id ? 'yourself' : nameOf(people[replyTo.user_id])}`}</b>
                    <span>{textOf(editing || replyTo)}</span>
                  </span>
                  <button type="button" className="compose-ref-x" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText('') } }} aria-label="Cancel">{I.x}</button>
                </span>
              )}
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
      )}

      {menu && (
        <OnTop>
          <button type="button" className="scrim blur" aria-label="Close" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="msg-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="rx-pick">{REACTIONS.map((e) => <button key={e} type="button" className={reactsOf[menu.m.id]?.[e]?.mine ? 'on' : ''} onClick={(ev) => { if (!reactsOf[menu.m.id]?.[e]?.mine) burst(e, ev.clientX, ev.clientY); react(menu.m, e) }}>{e}</button>)}</div>
            <div className="menu-list">
              <button type="button" onClick={() => { setReplyTo(menu.m); setMenu(null) }}>{I.reply}<span>Reply</span></button>
              {menu.m.body && <button type="button" onClick={() => { translate(menu.m.body); setMenu(null) }}>{I.translate}<span>Translate</span></button>}
              {menu.m.body && <button type="button" onClick={() => { copy(prefs.copyFormat === false ? plainText(menu.m.body) : menu.m.body, 'Text copied'); setMenu(null) }}>{I.copy}<span>Copy Text</span></button>}
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
        </OnTop>
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
      {wallPick && (
        <Modal title="Chat wallpaper" onClose={() => setWallPick(false)} foot={<><button type="button" className="btn" onClick={() => { setPrefs({ background: wall }); setWalls({}); setWallPick(false); toast('Wallpaper set for all chats') }}>Use for all chats</button><button type="button" className="btn btn-main" onClick={() => setWallPick(false)}>Done</button></>}>
          <p className="muted">For this chat only, on this computer.</p>
          <WallTiles value={wall} onPick={(k) => setWalls((w) => ({ ...w, [room.room_id]: k }))} />
        </Modal>
      )}
      {forward && <Forward msgs={forward} me={me} rooms={rooms} titleOf={titleOf} fromRoom={room.room_id} onClose={() => setForward(null)} onDone={(n) => { setForward(null); setPicked(null); toast(n > 1 ? `${n} messages forwarded` : 'Forwarded') }} />}
      {viewer && <OnTop><MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} /></OnTop>}
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

/* a photo or GIF in a message; with automatic download off (or a GIF set not to move) it waits for a tap */
function Pic({ file, onOpen, auto = true, still = false, gif = false }) {
  const [go, setGo] = useState(auto && !still)
  const [url, setUrl] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => { if (!go) return undefined; let alive = true; fileLink(file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path, go])
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{gif ? I.play : I.image}<span>{gif ? 'GIF' : 'Photo'} · {fmtBytes(file?.size)}</span><small>Tap to {gif ? 'play' : 'load'}</small></button>
  return url ? <img className={`pic-img${ready ? ' ready' : ''}`} src={url} alt={file?.name || ''} onLoad={() => setReady(true)} onClick={(e) => { e.stopPropagation(); onOpen(url) }} /> : <span className="pic-wait" />
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

function NewGroup({ me, start, onClose, onOpen }) {
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState(start ? [start] : [])
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
    const { error } = await supabase.from('roar_profiles').update(patch).eq('id', me.id)
    if (error) { setErr(errText(error)); return false }
    const { data } = await supabase.from('roar_people').select('*').eq('id', me.id).single()
    setMe(data); setSaved(true)
    return true
  }
  const saveAll = async () => {
    if (!USERNAME_RE.test(username)) { setErr('Username: 3 to 24 characters, small letters, numbers and _.'); return }
    setBusy(true)
    await save({ display_name: name.trim(), username, bio: bio.trim() })
    setBusy(false)
  }
  const [cropFile, setCropFile] = useState(null) // a picture being adjusted before it is saved
  const pickPic = async (file) => {
    setCropFile(null)
    if (!file) return
    const path = `${me.id}/avatar-${Date.now()}.jpg`
    const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (up.error) { setErr(errText(up.error)); return }
    const { data } = supabase.storage.from('roar-avatars').getPublicUrl(path)
    save({ avatar_url: data.publicUrl })
  }
  const fields = (
    <>
      <div className="info-top">
        <button type="button" className="pic-pick" onClick={() => picRef.current?.click()} title="Change your picture"><Avatar src={me.avatar_url} name={nameOf(me)} size={96} /><span>Change</span></button>
        <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { setCropFile(e.target.files?.[0] || null); e.target.value = '' }} />
        {cropFile && <CropModal file={cropFile} title="Your photo" onDone={pickPic} onClose={() => setCropFile(null)} />}
        {me.avatar_url && <button type="button" className="link danger-link pic-remove" onClick={() => { if (window.confirm('Remove your profile photo?')) save({ avatar_url: '' }) }}>Remove photo</button>}
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
