import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TRANSFER_BUCKET, USERNAME_RE, cleanUsername, tusUpload, uploadWithProgress, dayLabel, errText, fileLink, fmtBytes, lastSeenText, listTime, nameOf, onlineNow, shrinkImage, supabase, timeOf } from './lib.js'
import { Avatar, CropModal, FOOT_I, I, Modal, OnTop, Wordmark, burst, colorOf, setNameColor, svg, useLens } from './ui.jsx'
import { REACTIONS, TEXT_SIZES, chime, isEmojiOnly, setPrefs, swapEmoji, useLocal, usePrefs } from './prefs.js'
import { formatText, hasMark, plainText, toggleMark } from './format.jsx'
import { RecentCalls, useCalls } from './calls.jsx'
import { tr } from './i18n.js'
import { E2E_OFF, E2E_ON, endEncrypted, hasStretchKey, isSealed, myDevice, openText, previewText, sealText, startEncrypted, systemText, useEncrypted, useOpened, withoutDevice } from './e2e.js'
// Settings and a profile load only when opened (Alex, 21 Oct: RoarMe lighter at start)
const Profile = lazy(() => import('./Profile.jsx'))
const SettingsMenu = lazy(() => import('./SettingsPages.jsx').then((m) => ({ default: m.SettingsMenu })))
const SettingsPage = lazy(() => import('./SettingsPages.jsx').then((m) => ({ default: m.SettingsPage })))
// fetched quietly a moment after RoarMe opens, so opening Settings never waits on it (Alex, 21 Oct: the foot bar
// jumped to the top for a second while Settings loaded)
if (typeof window !== 'undefined') setTimeout(() => { import('./SettingsPages.jsx'); import('./Profile.jsx') }, 2500)
import { Library, LibrarySide, useLibrary } from './media.jsx'
import { InviteModal, clearInvite, pendingInvite } from './invite.jsx'
import { EventCard, ScheduleCall } from './events.jsx'
import { ScheduleMessage, ScheduledList, useScheduled, whenText } from './scheduled.jsx'
import { NowPlaying } from './player.jsx'
import { pushSync, setBadge } from './push.js'
import { RoarMeInbox, useInboxCount } from './inbox.jsx'
import { UpdateCard } from './update.jsx'
import { useFolderSync } from './folderSync.js'
import { ContactCard } from './contactCard.jsx'
import { ArticleCard, ArticleEditor, ArticleReader, LocationCard, LocationPicker, LocationView, articleOf } from './share.jsx'
import { OrdinoCard, RoardinoSheet, ordinoBody } from './roardino.jsx'
import { TasksPanel, taskNotice, useTasks } from './tasks.jsx'
import { RemindMe, ReminderCards, addReminder, reminderText } from './reminders.jsx'
import { RolesWindow, mentionsMe } from './roles.jsx'
import { CopyLink, TRANSFER_DAYS, TRANSFER_MAX, TransferMark, TransferWindow } from './transfer.jsx'
import { canCompressVideo, compressVideo, isVideoFile, prepareVideo, releaseVideo } from './videoCompress.js'
import { AttachSheet, AudioNote, Cinema, LinkVideo, MusicTile, isAudioFile, EmojiPicker, MediaViewer, SharedMedia, VideoTile, WallTiles, videoLinkOf } from './extras.jsx'

// the moving bars while a voice message records (Alex, 16 Oct): not the real sound, a lively stand-in

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
  // RoarMe always opens on All (Alex, 18 Oct: it opened on Archived, the folder left last time)
  const [folder, setFolder] = useState('all')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState('') // '' | newchat | newgroup | info | folders | newfolder | pickfolder
  const [plus, setPlus] = useState(false)
  const [tab, setTab] = useState('chats') // the bar at the foot: contacts | calls | chats | settings
  const [cq, setCq] = useState('') // search in Contacts
  const [picking, setPicking] = useState(false)
  const [tabsEdit, setTabsEdit] = useState(false) // the folder tabs being reordered in place, like Telegram (Alex, 21 Oct)
  const [tabDrag, setTabDrag] = useState(null) // { id, dx, order }: the tab under the finger and the order so far
  const [picked, setPicked] = useState([])
  const [hits, setHits] = useState([])
  const [myFolders, setMyFolders] = useLocal('roarme-folders', [])
  useFolderSync(me.id) // the same folders on every device (supabase/folders.sql)
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
  // the way RoarMe opens (Alex, 16 Oct): the chats slide in from the left, the conversation rises after them
  const [intro, setIntro] = useState(true)
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t) }, [])
  const [setPage, setSetPage] = useState('')
  const [folderSeed, setFolderSeed] = useState([]) // chats a new folder starts with
  // a folder is edited on a page of its own in Settings, like Telegram's (Alex, 16 Oct)
  const openFolders = () => { setModal(''); setTab('settings'); setSetPage('folders') }
  const folderBack = useRef('') // the screen a folder was opened for editing from: its tick goes back there
  const editFolder = (id, seed = []) => { folderBack.current = tab === 'settings' ? '' : tab; setModal(''); setFolderSeed(seed); setTab('settings'); setSetPage(`folder:${id}`) }
  const doneFolder = () => { document.activeElement?.blur?.(); const back = folderBack.current; folderBack.current = ''; if (back) { setSetPage(''); setTab(back) } else setSetPage('folders') }
  const tabsLens = useLens(`${tab}|${folder}|${prefs.folderTabs}|${myFolders.length}|${!q.trim()}`)
  // the folder tabs fade at the right edge only while more tabs wait past it (Alex, 21 Oct: the last tab looked shaded)
  useEffect(() => {
    const el = tabsLens.current
    if (!el) return undefined
    const check = () => { if (el.scrollWidth - el.clientWidth - el.scrollLeft > 4) el.dataset.more = ''; else delete el.dataset.more }
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', check); ro.disconnect() }
  }, [tab, prefs.folderTabs, myFolders.length, !q.trim()]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tasksOpen, setTasksOpen] = useState(() => { try { return localStorage.getItem('roarme-tasks') === '1' } catch { return false } })
  const footLens = useLens(`${tab}|${prefs.callsTab}|${picking}|${tasksOpen}`) // the Settings page open on the right
  const [groupWith, setGroupWith] = useState(null) // Create Group from a chat starts with that person in it
  const searchRef = useRef(null)
  // the search box hides and comes out when the list is pulled down at its top (Alex, 17 Oct), as on the iPhone
  const [searchOpen, setSearchOpen] = useState(false)
  const listAtTop = (e) => (e.target.closest?.('.rooms')?.scrollTop || 0) <= 0
  const searchBusy = () => !!q.trim() || document.activeElement === searchRef.current
  const onListWheel = (e) => {
    if (e.deltaY < -4 && listAtTop(e)) setSearchOpen(true)
    else if (e.deltaY > 4 && !searchBusy()) setSearchOpen(false)
  }
  // on a phone a swipe to the right on an open page (a chat, a Settings page, AllMedia, the RoarMe inbox…) goes back,
  // like Back at its top (Alex, 19 Oct): the page's own Back button is pressed, so it always goes where Back goes
  useEffect(() => {
    let s = null
    const NO = 'input, textarea, [contenteditable="true"], .tabs, .themes, .dpick, .wheel, .walls, .seg, .viewer, .modal-back, .call, .menu, input[type="range"]'
    const start = (e) => {
      const main = e.target.closest?.('.main')
      s = window.matchMedia('(max-width: 760px)').matches && main && e.touches.length === 1 && !e.target.closest(NO) ? { main, x: e.touches[0].clientX, y: e.touches[0].clientY } : null
    }
    const end = (e) => {
      if (!s) return
      const { main, x, y } = s
      s = null
      const dx = e.changedTouches[0].clientX - x, dy = e.changedTouches[0].clientY - y
      if (dx < 70 || dx < Math.abs(dy) * 1.5 || window.getSelection?.().toString()) return
      const backs = [...main.querySelectorAll('[data-back]')].filter((b) => b.offsetParent)
      backs[backs.length - 1]?.click()
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchend', end) }
  }, [])
  const [pull, setPull] = useState(0) // how far the list is pulled down for a refresh: 0 to 1 (ready), 2 = reloading
  const [note, setNote] = useState('')
  const noteTimer = useRef(0)
  const toast = useCallback((s) => { setNote(s); clearTimeout(noteTimer.current); noteTimer.current = setTimeout(() => setNote(''), 2200) }, [])
  // the official RoarMe account (Alex, 19 Oct; supabase/official.sql): a badge beside its name, and its chat from Settings
  const [officialIds, setOfficialIds] = useState([])
  useEffect(() => { supabase.from('roar_official').select('user_id').then(({ data }) => setOfficialIds((data || []).map((x) => x.user_id))) }, [])
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => { supabase.rpc('roar_is_admin').then(({ data }) => setIsAdmin(data === true)) }, [])
  const [inboxOpen, setInboxOpen] = useState(false)
  const inboxCount = useInboxCount(isAdmin && officialIds.length > 0 && !inboxOpen)
  const openRoarMe = async () => {
    const { data: r, error } = await supabase.rpc('roar_open_direct', { other: officialIds[0] })
    if (error) { toast(errText(error)); return }
    setTab('chats'); setActiveId(r); loadRooms()
  }

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
  // Media from all chats: its own tab (Alex, 17 Oct); read fresh each time the tab opens
  const [libRoom, setLibRoom] = useState('')
  const [lib, resetLib] = useLibrary(tab === 'media')
  useEffect(() => { if (tab !== 'media') resetLib() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const libChat = (roomId, msgId) => { setTab('chats'); setActiveId(roomId); setJump(msgId) }
  useEffect(() => { try { localStorage.removeItem('roarme-folder') } catch { /* private window */ } }, [])
  // ⌘K / Ctrl+K: the search
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setTab('chats'); setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()) }
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
      supabase.from('roar_contacts').select('person, photo_url, nickname, note').in('person', want),
    ])
    // what I set for someone, only for me (Alex, 19 Oct: "edit other people's profiles, shown only to them"):
    // my name for them, my photo for them, my note; their own stay in real_name / real_avatar
    const mineOf = Object.fromEntries((mine || []).map((c) => [c.person, c]))
    if (data) {
      data.forEach((x) => {
        setNameColor(x.id, x.name_color)
        const c = mineOf[x.id] || {}
        x.own_photo = !!x.avatar_url
        x.real_avatar = x.avatar_url
        x.real_name = x.display_name
        x.my_photo = c.photo_url || ''
        x.nickname = (c.nickname || '').trim()
        x.my_note = c.note || ''
        if (x.my_photo) x.avatar_url = x.my_photo
        if (x.nickname) x.display_name = x.nickname
      })
      // someone who has not changed keeps the same object, and nobody changed means no re-render at all
      setPeople((p) => {
        const fresh = data.filter((x) => JSON.stringify(p[x.id]) !== JSON.stringify(x))
        return fresh.length ? { ...p, ...Object.fromEntries(fresh.map((x) => [x.id, x])) } : p
      })
    }
  }, [])

  // the roles of one's groups, for @mentions (src/roles.jsx)
  const [roles, setRoles] = useState([])
  const rolesRef = useRef([])
  rolesRef.current = roles
  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase.rpc('roar_my_rooms')
    if (error) return
    const list = data || []
    // the pinned message of each chat, and the unread messages that mention one (the @ in the list)
    if (list.length) {
      const ids = list.map((r) => r.room_id)
      const [{ data: pins }, { data: men }, { data: rl }] = await Promise.all([
        supabase.from('roar_rooms').select('id, pinned_message_id, auto_delete_hours, hub_project').in('id', ids),
        supabase.rpc('roar_my_mentions'),
        supabase.from('roar_roles').select('id, room_id, name, user_ids').in('room_id', ids).order('name'),
      ])
      const pin = Object.fromEntries((pins || []).map((x) => [x.id, x]))
      const at = Object.fromEntries((men || []).map((x) => [x.room_id, x.n]))
      list.forEach((r) => { r.pinned_message_id = pin[r.room_id]?.pinned_message_id || null; r.auto_delete_hours = pin[r.room_id]?.auto_delete_hours || null; r.hub_project = pin[r.room_id]?.hub_project || null; r.mentions = at[r.room_id] || 0 })
      setRoles(rl || [])
    }
    // chats that did not change keep the same object, and an unchanged list leaves the screen alone
    setRooms((old) => {
      const was = Object.fromEntries(old.map((r) => [r.room_id, r]))
      const next = list.map((r) => (was[r.room_id] && JSON.stringify(was[r.room_id]) === JSON.stringify(r) ? was[r.room_id] : r))
      return next.length === old.length && next.every((r, i) => r === old[i]) ? old : next
    })
    // only people not known yet; the others are refreshed every 90 seconds
    const known = peopleRef.current || {}
    loadPeople(list.flatMap((r) => r.members || []).filter((id) => !known[id]))
  }, [loadPeople])

  // a burst of messages reloads the list once
  const reloadTimer = useRef(0)
  const reloadSoon = useCallback(() => { clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(loadRooms, 250) }, [loadRooms])

  useEffect(() => { loadRooms() }, [loadRooms])
  // opened from someone's invite link: their chat opens by itself, once
  useEffect(() => {
    const u = pendingInvite()
    if (!u) return
    clearInvite()
    if (u === me.username) return
    supabase.from('roar_people').select('id, username, display_name').eq('username', u).maybeSingle().then(async ({ data: p }) => {
      if (!p) return
      const { data: r, error } = await supabase.rpc('roar_open_direct', { other: p.id })
      if (!error && r) { setTab('chats'); setActiveId(r); loadRooms() }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // online: a heartbeat on one's own profile
  const peopleRef = useRef(people)
  peopleRef.current = people
  // only while RoarMe is in front of you (shown and focused) do you count as here: then your phone stays quiet for
  // new messages; hidden, in the background or closed, notifications come (Alex, 18 Oct; roar_push_targets)
  useEffect(() => {
    const beat = () => {
      const here = !document.hidden && document.hasFocus()
      const now = Date.now()
      const patch = here ? { last_seen: new Date(now).toISOString(), active_until: new Date(now + 75e3).toISOString() } : { active_until: new Date(now).toISOString() }
      supabase.from('roar_profiles').update(patch).eq('id', me.id).then(() => {})
    }
    beat()
    myDevice(me.id) // this device's keys for Encrypted Chat, made the first time
    const id = setInterval(() => { if (!document.hidden && document.hasFocus()) beat() }, 60 * 1000)
    const ppl = setInterval(() => { if (!document.hidden) loadPeople(Object.keys(peopleRef.current)) }, 90 * 1000)
    document.addEventListener('visibilitychange', beat)
    window.addEventListener('focus', beat)
    window.addEventListener('blur', beat)
    window.addEventListener('pagehide', beat)
    return () => {
      clearInterval(id); clearInterval(ppl)
      document.removeEventListener('visibilitychange', beat)
      window.removeEventListener('focus', beat)
      window.removeEventListener('blur', beat)
      window.removeEventListener('pagehide', beat)
    }
  }, [me.id, loadPeople])

  // a sound and a desktop notification when the window is not looking at that chat
  const notifyRef = useRef(null)
  notifyRef.current = (m) => {
    const room = roomsRef.current.find((r) => r.room_id === m.room_id)
    const atMe = mentionsMe(m.body, me, rolesRef.current.filter((g) => g.room_id === m.room_id))
    // a muted chat stays quiet, unless the message mentions you (@you, @all, @here or a role of yours)
    if (room?.muted && !atMe) return
    if (!document.hidden && activeRef.current === m.room_id) return
    if (prefsRef.current.sound) chime()
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const who = peopleRef.current[m.user_id]
    const title = room?.kind === 'group' ? `${room.title}` : nameOf(who)
    const body = !prefsRef.current.notifyPreview ? (atMe ? `${nameOf(who)} mentioned you` : 'New message') : (room?.kind === 'group' ? `${nameOf(who)}${atMe ? ' mentioned you' : ''}: ` : '') + (m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? 'File' : plainText(previewText(m.body, m.kind)))
    try {
      const n = new Notification(title, { body: tr(body), icon: who?.avatar_url || './icon.svg', tag: m.room_id })
      n.onclick = () => { window.focus(); setTab('chats'); setActiveId(m.room_id); n.close() }
    } catch { /* not allowed here */ }
  }

  // back after being away (Alex, 17 Oct): what came while RoarMe was closed comes in as notifications on opening,
  // gathered: one per chat ("3 new messages · the last one"), or a single one when many chats have news
  const awayKey = `roarme-here-${me.id}`
  const awaySince = useRef(null)
  if (awaySince.current === null) { try { awaySince.current = localStorage.getItem(awayKey) || '' } catch { awaySince.current = '' } }
  useEffect(() => {
    const mark = () => { try { localStorage.setItem(awayKey, new Date().toISOString()) } catch { /* private window */ } }
    mark()
    const id = setInterval(mark, 15e3)
    window.addEventListener('pagehide', mark)
    return () => { clearInterval(id); window.removeEventListener('pagehide', mark); mark() }
  }, [awayKey])
  const caughtUp = useRef(false)
  const [namesLate, setNamesLate] = useState(false)
  useEffect(() => { const t = setTimeout(() => setNamesLate(true), 5000); return () => clearTimeout(t) }, [])
  useEffect(() => {
    if (caughtUp.current || !rooms.length) return
    // the first time (no mark yet) only what came in the last day
    const since = awaySince.current || new Date(Date.now() - 864e5).toISOString()
    const missed = rooms.filter((r) => r.unread > 0 && !r.muted && !r.archived && r.last_user !== me.id && r.last_message_at > since)
    const other = (r) => (r.members || []).find((id) => id !== me.id)
    // wait for the names (a few seconds at most)
    if (!namesLate && missed.some((r) => (r.kind === 'direct' && !people[other(r)]) || (r.kind === 'group' && !people[r.last_user]))) return
    caughtUp.current = true
    if (!missed.length) return
    const total = missed.reduce((a, r) => a + r.unread, 0)
    const nameOfRoom = (r) => (r.kind === 'group' ? r.title : nameOf(people[other(r)]))
    const lastOf = (r) => {
      const what = r.last_deleted ? 'Message deleted' : r.last_kind === 'image' ? 'Photo' : r.last_kind === 'voice' ? 'Voice message' : r.last_kind === 'file' ? 'File' : plainText(previewText(r.last_body || '', r.last_kind))
      return (r.kind === 'group' ? `${nameOf(people[r.last_user])}: ` : '') + tr(what)
    }
    const preview = prefsRef.current.notifyPreview
    if (prefsRef.current.sound) chime()
    const show = (title, body, icon, roomId) => {
      try {
        const n = new Notification(title, { body, icon: icon || './icon.svg', tag: roomId || 'roarme-away' })
        n.onclick = () => { window.focus(); setTab('chats'); if (roomId) setActiveId(roomId); n.close() }
        return true
      } catch { return false }
    }
    const can = typeof Notification !== 'undefined' && Notification.permission === 'granted'
    const gathered = `${tr(total === 1 ? '1 new message' : `${total} new messages`)} · ${tr(missed.length === 1 ? 'in 1 chat' : `in ${missed.length} chats`)}`
    if (!can) { toast(gathered); return }
    if (missed.length > 4) {
      const names = missed.slice(0, 3).map(nameOfRoom).join(', ')
      show(tr('While you were away'), `${gathered}: ${names}${missed.length > 3 ? ` ${tr(`and ${missed.length - 3} more`)}` : ''}`, '', '')
      return
    }
    missed.forEach((r) => {
      const count = r.unread === 1 ? '' : tr(`${r.unread} new messages`)
      const body = !preview ? tr(r.unread === 1 ? 'New message' : `${r.unread} new messages`) : count ? `${count} · ${lastOf(r)}` : lastOf(r)
      const icon = r.kind === 'group' ? r.avatar_url : people[other(r)]?.avatar_url
      show(nameOfRoom(r), body, icon, r.room_id)
    })
  }, [rooms, people, namesLate]) // eslint-disable-line react-hooks/exhaustive-deps

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_pins' }, (ev) => listeners.current.forEach((fn) => fn(ev)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_roles' }, reloadSoon)
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
    document.title = unreadAll ? `(${unreadAll}) RoarMe` : 'RoarMe'
    window.roarDesktop?.setBadge(prefs.badge === false ? 0 : unreadAll) // the count on the app's icon (Mac/Windows app)
    setBadge(prefs.badge === false ? 0 : unreadAll) // and on the Home Screen icon of a phone
  }, [unreadAll, prefs.badge])
  // notifications with RoarMe closed: the server keeps knowing this phone; a tapped notification opens its chat
  useEffect(() => { pushSync(prefs.notifyPreview) }, [prefs.notifyPreview])
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null
    if (!sw) return undefined
    const on = (e) => { if (e.data?.roarOpen) { setTab('chats'); setActiveId(e.data.roarOpen) } }
    sw.addEventListener('message', on)
    return () => sw.removeEventListener('message', on)
  }, [])
  // no paw in the menu bar any more (Alex, 18 Oct: "I don't need it"); an app that still shows it puts it away
  useEffect(() => {
    const d = window.roarDesktop
    if (d?.getSettings) d.getSettings().then((s) => { if (s?.tray) d.setSetting('tray', false) }).catch(() => {})
  }, [])

  const BUILTIN = [['all', 'All'], ['unread', 'Unread'], ['groups', 'Groups'], ['archived', 'Archived']]
  // in the order dragged in Settings > Folders (Alex, 16 Oct); a folder not placed yet goes at the end
  const fOrder = prefs.folderOrder || []
  const fRank = (id) => { const i = fOrder.indexOf(id); return i < 0 ? 1e3 : i }
  // the ready-made folders can be renamed and, except All, deleted (Alex, 16 Oct)
  const hiddenF = prefs.hiddenFolders || []
  const allFolders = [...BUILTIN.filter(([id]) => id === 'all' || !hiddenF.includes(id)).map(([id, name]) => ({ id, name: prefs.folderNames?.[id] || name })), ...myFolders.map((f) => ({ ...f, custom: true }))]
    .map((f, i) => ({ f, i })).sort((a, b) => fRank(a.f.id) - fRank(b.f.id) || a.i - b.i).map(({ f }) => f)
  const tabsShown = tabDrag?.order ? tabDrag.order.map((id) => allFolders.find((f) => f.id === id)).filter(Boolean) : allFolders
  const editTabs = tabsEdit || picking
  // a tab dragged sideways in the bar: it follows the finger and swaps places as it passes a neighbour's middle
  const tabDown = (e, f) => {
    if (!editTabs || (e.button != null && e.button !== 0)) return
    const nav = tabsLens.current
    const el = e.currentTarget
    let d = { id: f.id, x0: e.clientX, moved: false, order: tabsShown.map((x) => x.id), shift: 0 }
    const move = (ev) => {
      let off = ev.clientX - d.x0 - d.shift
      if (!d.moved) { if (Math.abs(ev.clientX - d.x0) < 6) return; d.moved = true }
      ev.preventDefault()
      if (nav) { const r = nav.getBoundingClientRect(); if (ev.clientX < r.left + 30) nav.scrollLeft -= 8; else if (ev.clientX > r.right - 30) nav.scrollLeft += 8 }
      const btns = [...(nav?.querySelectorAll('button[data-tab]') || [])]
      const at = d.order.indexOf(d.id)
      const next = btns.find((b) => b.dataset.tab === d.order[at + 1]), prev = btns.find((b) => b.dataset.tab === d.order[at - 1])
      if (next && off > next.offsetWidth / 2) { const o = [...d.order]; [o[at], o[at + 1]] = [o[at + 1], o[at]]; d.order = o; d.shift += next.offsetWidth; off -= next.offsetWidth }
      else if (prev && off < -prev.offsetWidth / 2) { const o = [...d.order]; [o[at - 1], o[at]] = [o[at], o[at - 1]]; d.order = o; d.shift -= prev.offsetWidth; off += prev.offsetWidth }
      setTabDrag({ id: d.id, dx: off, order: d.order })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (d.moved) { setPrefs({ folderOrder: d.order }); tabSkip.current = Date.now() }
      setTabDrag(null)
      d = null
    }
    el.setPointerCapture?.(e.pointerId)
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  useEffect(() => { if (folder !== 'all' && hiddenF.includes(folder)) setFolder('all') }, [hiddenF.join(), folder])
  const fits = (r, f) => {
    if (f === 'archived') return r.archived
    if (r.archived) return false
    // a chat marked as unread by hand belongs here too (Alex, 21 Oct), even when its last message is one's own
    if (f === 'unread') return r.unread > 0 || marked.includes(r.room_id) || (prefs.folderExtra?.unread || []).includes(r.room_id)
    if (f === 'groups') return r.kind === 'group' || (prefs.folderExtra?.groups || []).includes(r.room_id)
    const mine = myFolders.find((x) => x.id === f)
    if (mine) {
      if ((mine.exclude || []).includes(r.room_id)) return false
      if (mine.rooms.includes(r.room_id)) return true
      const t = mine.types || {}
      return (!!t.private && r.kind !== 'group') || (!!t.groups && r.kind === 'group')
    }
    return true
  }
  /* Each chat in one folder only (Settings > Chat Folders, Alex, 21 Oct): an unread chat sits only in Unread, a chat in a
     folder of one's own only there (the first such folder in the tabs' order), a group otherwise only in Groups, and All
     keeps what is left. Archived stays Archived. Off, a chat shows in every folder it fits, as before. */
  const homeOf = (r) => {
    if (r.archived) return 'archived'
    const has = (id) => allFolders.some((f) => f.id === id)
    if (has('unread') && fits(r, 'unread')) return 'unread'
    const own = allFolders.find((f) => f.custom && fits(r, f.id))
    if (own) return own.id
    if (has('groups') && fits(r, 'groups')) return 'groups'
    return 'all'
  }
  const inFolder = (r, f) => (prefs.folderAlone ? homeOf(r) === f : fits(r, f))
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = visible.filter((r) => (t ? titleOf(r).toLowerCase().includes(t) || (otherOf(r)?.username || '').includes(t.replace(/^@/, '')) : inFolder(r, folder)))
    // pinned chats first, in the order they were pinned
    return [...list.filter((r) => pins.includes(r.room_id)).sort((a, b) => pins.indexOf(a.room_id) - pins.indexOf(b.room_id)), ...list.filter((r) => !pins.includes(r.room_id))]
  }, [visible, folder, q, titleOf, myFolders, pins, prefs.folderExtra, marked, prefs.folderAlone, prefs.folderOrder, hiddenF.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  // the chats of another folder, for the page that slides in beside the list while it is dragged
  const listFor = (fid) => {
    const list = visible.filter((r) => inFolder(r, fid))
    return [...list.filter((r) => pins.includes(r.room_id)).sort((a, b) => pins.indexOf(a.room_id) - pins.indexOf(b.room_id)), ...list.filter((r) => !pins.includes(r.room_id))]
  }

  /* On a phone the chat list follows the finger sideways and the next folder slides in beside it, as in
     Telegram (Alex, 21 Oct); let go past a quarter of the width, or flick, and it moves on, else it springs
     back. Past the first or last folder it stretches a little and goes on to the next screen at the foot.
     Native listeners, so a sideways drag can stop the list scrolling and the drag itself never re-renders. */
  const pagerRef = useRef(null)
  const trackRef = useRef(null)
  const [pageDrag, setPageDrag] = useState(null) // { dir, id }: the folder showing beside the list
  const [swipedTo, setSwipedTo] = useState('') // a folder reached by a swipe comes in without the row cascade
  const pagerNow = useRef({})
  const tabSkip = useRef(0)
  // a slow slide on one chat shows Telegram's buttons under it (Alex, 21 Oct): to the left Mute and Delete,
  // to the right Unread and Pin; a quick flick still turns the folder
  const [rowActs, setRowActs] = useState(null) // { id, side: 'left' | 'right', top, h }
  const rowNow = useRef(null) // { el, id }: the chat slid open
  const rowSkip = useRef(0)
  const shutRow = () => {
    const o = rowNow.current
    rowNow.current = null
    if (o?.el) { o.el.style.transition = 'transform .28s cubic-bezier(.22,1,.36,1)'; o.el.style.transform = '' }
    setTimeout(() => { if (!rowNow.current) setRowActs(null) }, 280)
  }
  useLayoutEffect(() => {
    const t = trackRef.current
    if (t) { t.style.transition = 'none'; t.style.transform = '' }
  }, [folder])
  useEffect(() => {
    const el = pagerRef.current
    if (!el) return
    let g = null
    const move = (x) => { if (trackRef.current) trackRef.current.style.transform = x ? `translate3d(${x}px,0,0)` : '' }
    const glide = (x, then) => {
      const t = trackRef.current
      if (!t) { then?.(); return }
      t.style.transition = 'transform .32s cubic-bezier(.22,1,.36,1)' // a soft ease-out, no snap
      move(x)
      let done = false
      const fin = () => { if (done) return; done = true; t.removeEventListener('transitionend', fin); then?.() }
      t.addEventListener('transitionend', fin)
      setTimeout(fin, 380)
    }
    // pulled down at the top of the list (Alex, 21 Oct): only that, never together with the sideways drag. With the search
    // closed the list follows the finger with a little resistance and the search opens only past a clear pull, like a
    // magnet; with the search open, the same pull reloads RoarMe (the arrow fills, let go when it is full)
    const PULL_OPEN = 90
    const sheet = (y, ease) => {
      const list = el.querySelector('.rooms')
      if (!list) return
      list.style.transition = ease ? 'transform .3s cubic-bezier(.2,.8,.25,1)' : 'none'
      list.style.transform = y ? `translate3d(0,${y}px,0)` : ''
    }
    const start = (e) => {
      const n = pagerNow.current
      if (e.touches.length !== 1) { g = null; return }
      if (e.target.closest?.('.row-acts')) { g = null; return } // a tap on Mute, Delete, Unread or Pin
      if (rowNow.current) { shutRow(); rowSkip.current = Date.now(); g = null; return } // a touch anywhere closes the open chat first
      const phone = window.matchMedia('(max-width: 760px)').matches
      g = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: '', dx: 0, t: Date.now(), lx: e.touches[0].clientX, lt: Date.now(), v: 0,
        side: !n.busy && phone, top: (el.querySelector('.rooms')?.scrollTop || 0) <= 0, open: n.searchOpen, phone, pull: 0,
        // from the screen's edges the slide turns the folder; from anywhere else on a chat it opens that chat's buttons (Alex, 21 Oct)
        rowEl: phone && !n.picking && e.touches[0].clientX > EDGE && e.touches[0].clientX < window.innerWidth - EDGE ? e.target.closest?.('.rooms:not(.rooms-ghost) .room[data-rid]') : null }
    }
    const touchMove = (e) => {
      if (!g) return
      const x = e.touches[0].clientX, dx = x - g.x, dy = e.touches[0].clientY - g.y
      if (!g.lock) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return
        g.lock = Math.abs(dx) > Math.abs(dy) * 1.1 ? (g.side ? 'x' : 'none') : 'y'
        if (g.lock === 'x' && g.rowEl) {
          g.lock = 'row'
          g.rs = dx < 0 ? 'right' : 'left'
          g.rowEl.style.transition = 'none'
          setRowActs({ id: g.rowEl.dataset.rid, side: g.rs, top: g.rowEl.offsetTop, h: g.rowEl.offsetHeight })
        }
        if (g.lock === 'x') {
          const n = pagerNow.current
          const at = n.allFolders.findIndex((f) => f.id === n.folder)
          g.w = el.clientWidth || 1
          g.prev = n.allFolders[at - 1]?.id || ''
          g.next = n.allFolders[at + 1]?.id || ''
          if (trackRef.current) trackRef.current.style.transition = 'none'
        }
      }
      if (g.lock === 'y') {
        const n = pagerNow.current
        if (dy < -24 && n.searchOpen && !n.searchBusy()) { setSearchOpen(false); g.open = false }
        if (!g.top || dy <= 0 || n.picking) return
        if (e.cancelable) e.preventDefault()
        if (!g.open) {
          g.pull = dy
          sheet(Math.round(56 * (1 - Math.exp(-dy / 110))), false) // the list gives a little, then resists
          if (dy >= PULL_OPEN && !g.felt) { g.felt = true; navigator.vibrate?.(8) } // the click of the magnet where it will open
        } else if (g.phone) {
          // the reload wants a long, deliberate pull (Alex, 21 Oct: it got mixed up with the search): the arrow shows after
          // 120 px and is full at 280 px; the list follows with resistance all the way
          sheet(Math.round(90 * (1 - Math.exp(-dy / 200))), false)
          const p = Math.max(0, Math.min(1.15, (dy - 120) / 160))
          if (p >= 1 && !g.felt) { g.felt = true; navigator.vibrate?.(8) }
          setPull(p)
        }
        return
      }
      if (g.lock === 'row') {
        if (e.cancelable) e.preventDefault()
        const rs = dx < 0 ? 'right' : 'left'
        if (rs !== g.rs) { g.rs = rs; setRowActs((a) => (a ? { ...a, side: rs } : a)) }
        const a = Math.abs(dx), m = a > ROW_W ? ROW_W + (a - ROW_W) * 0.25 : a
        g.dx = dx
        g.rowEl.style.transform = `translate3d(${Math.sign(dx) * m}px,0,0)`
        return
      }
      if (g.lock !== 'x') return
      if (e.cancelable) e.preventDefault()
      const now = Date.now()
      g.v = (x - g.lx) / Math.max(1, now - g.lt)
      g.lx = x; g.lt = now
      const dir = dx < 0 ? 1 : -1
      const id = dir > 0 ? g.next : g.prev
      if (id && g.shown !== id) { g.shown = id; setPageDrag({ dir, id }) }
      g.dx = id ? dx : dx * 0.3 // no folder that way: it only stretches
      move(g.dx)
    }
    const end = () => {
      if (g?.lock === 'row') {
        const { rowEl, dx } = g
        g = null
        rowSkip.current = Date.now()
        if (Math.abs(dx) > 56) {
          rowEl.style.transition = 'transform .28s cubic-bezier(.22,1,.36,1)'
          rowEl.style.transform = `translate3d(${Math.sign(dx) * ROW_W}px,0,0)`
          rowNow.current = { el: rowEl, id: rowEl.dataset.rid }
        } else { rowNow.current = { el: rowEl }; shutRow() }
        return
      }
      if (g?.lock === 'y') {
        const { pull: pulled, open } = g
        g = null
        if (!open) {
          sheet(0, true)
          if (pulled >= PULL_OPEN) setSearchOpen(true)
          return
        }
        // pulled far enough down with the search open: RoarMe reloads, with any new version (Alex, 19 Oct)
        sheet(0, true)
        const p = pagerNow.current.pull
        if (p >= 1) { setPull(2); setTimeout(() => window.location.reload(), 150); return }
        if (p) setPull(0)
        return
      }
      if (!g || g.lock !== 'x') { g = null; return }
      const { dx, w, v, next, prev } = g
      g = null
      const dir = dx < 0 ? 1 : -1
      const id = dir > 0 ? next : prev
      // soft and easy (Alex, 21 Oct): the next folder from a fifth of the width, or any light flick that way
      const far = Math.abs(dx) > w * 0.2 || (Math.abs(v) > 0.25 && Math.abs(dx) > 24 && Math.sign(v) === Math.sign(dx))
      if (!id) {
        glide(0, () => setPageDrag(null))
        if (Math.abs(dx) / 0.3 > 120) pagerNow.current.goStop(dir) // past the last folder: the next screen in the bar at the foot
        return
      }
      if (!far) { glide(0, () => setPageDrag(null)); return }
      glide(-dir * (w + 8), () => {
        setSwipedTo(id)
        setFolder(id)
        setPageDrag(null)
        setTimeout(() => document.querySelector('.tabs-scroll > button.on')?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }), 30)
      })
    }
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', touchMove, { passive: false })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', touchMove)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [tab])

  // messages that match the search, in every chat one is in (the database only gives one's own chats)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setHits([]); return }
    let alive = true
    const id = setTimeout(async () => {
      const { data } = await supabase.from('roar_messages').select('id, room_id, user_id, body, created_at').ilike('body', `%${t.replace(/[%_]/g, '')}%`).is('deleted_at', null).order('created_at', { ascending: false }).limit(60)
      if (alive) setHits((data || []).filter((h) => !isSealed(h.body) && h.body !== E2E_ON && h.body !== E2E_OFF))
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

  // a long press on a chat on a phone opens the same as a right click (Alex, 19 Oct, like Telegram)
  const press = useRef(null)
  const pressed = useRef(false)
  const closedAt = useRef(0) // the menu closed on a touch outside: the click that follows must not open the chat under it
  const pressStart = (e, r) => {
    const t = e.touches[0]
    pressed.current = false
    clearTimeout(press.current?.timer)
    press.current = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
      pressed.current = true
      navigator.vibrate?.(12)
      setRoomMenu({ r, x: 0, y: 0, sub: '', at: Date.now() })
      // the finger is still down: no word under it gets selected (Alex, 21 Oct)
      const clear = () => window.getSelection?.()?.removeAllRanges()
      clear(); setTimeout(clear, 60); setTimeout(clear, 400)
    }, 450) }
  }
  // a long press on a folder tab opens its menu, like Telegram (Alex, 21 Oct)
  const tabHold = useRef(null)
  const tabPress = (f) => ({
    onTouchStart: (e) => {
      const t = e.touches[0], el = e.currentTarget
      clearTimeout(tabHold.current?.timer)
      tabHold.current = { x: t.clientX, y: t.clientY, fired: false, timer: setTimeout(() => {
        tabHold.current.fired = true
        navigator.vibrate?.(12)
        const clear = () => window.getSelection?.()?.removeAllRanges()
        clear(); setTimeout(clear, 60); setTimeout(clear, 400)
        const b = el.getBoundingClientRect()
        const x = Math.max(8, Math.min(b.left, window.innerWidth - 248))
        // tabs at the foot: the menu opens above them, never over the tab itself
        setFolderMenu(b.top > window.innerHeight / 2 ? { f, x, bottom: window.innerHeight - b.top + 8, at: Date.now() } : { f, x, y: b.bottom + 8, at: Date.now() })
      }, 450) }
    },
    onTouchMove: (e) => { const h = tabHold.current, t = e.touches[0]; if (h && !h.fired && Math.hypot(t.clientX - h.x, t.clientY - h.y) > 8) clearTimeout(h.timer) },
    onTouchEnd: (e) => { const h = tabHold.current; if (!h) return; clearTimeout(h.timer); if (h.fired && e.cancelable) e.preventDefault() },
    onTouchCancel: () => clearTimeout(tabHold.current?.timer),
  })
  const deleteFolder = (f) => {
    if (!f || f.id === 'all') return
    if (!window.confirm(`Delete the folder ${f.name}? The chats in it stay.`)) return
    if (f.custom) setMyFolders((list) => list.filter((x) => x.id !== f.id))
    else setPrefs({ hiddenFolders: [...new Set([...(prefs.hiddenFolders || []), f.id])] })
    if (folder === f.id) setFolder('all')
    toast('Folder deleted')
  }
  const muteFolder = async (f) => {
    const ids = listFor(f.id).map((r) => r.room_id)
    if (!ids.length) { toast('No chats in this folder'); return }
    const all = listFor(f.id).every((r) => r.muted)
    const { error } = await supabase.from('roar_members').update({ muted: !all }).eq('user_id', me.id).in('room_id', ids)
    if (error) { toast(errText(error)); return }
    if (all) setMuteUntil((m) => { const n = { ...m }; ids.forEach((id) => delete n[id]); return n })
    toast(all ? 'Sounds on' : 'Muted'); loadRooms()
  }
  const pressMove = (e) => {
    const p = press.current, t = e.touches[0]
    if (p && Math.hypot(t.clientX - p.x, t.clientY - p.y) > 10) { clearTimeout(p.timer); press.current = null }
  }
  // the finger lifting after a long press must not also tap the menu that just opened
  const pressEnd = (e) => { clearTimeout(press.current?.timer); press.current = null; if (pressed.current && e?.cancelable) e.preventDefault() }
  // the menu of a chat in the list (right click, or a long press on a phone), as in Telegram: the screen blurs, the chat's
  // last messages show on a card (a tap on it opens the chat) and the actions sit under it
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
    // a chat put by hand into Unread or Groups as well as the ones that are there by themselves
    if (what === 'readyfolder') {
      const extra = { ...(prefs.folderExtra || {}) }
      const l = extra[arg] || []
      extra[arg] = l.includes(r.room_id) ? l.filter((x) => x !== r.room_id) : [...l, r.room_id]
      setPrefs({ folderExtra: extra })
    }
    if (what === 'clear') {
      if (!window.confirm(`Clear the history of ${titleOf(r)}? It goes for you only. Once everyone in the chat has cleared it, it leaves RoarMe's servers too.`)) return
      const at = new Date().toISOString()
      setCleared((c) => ({ ...c, [r.room_id]: at })); toast('History cleared')
      // the server knows too, so what everyone has cleared is deleted for good (supabase/cleanup.sql)
      mine({ cleared_at: at }).then(() => {})
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
        mine({ cleared_at: at }).then(() => {})
      }
      if (activeId === r.room_id) setActiveId('')
      setPins((l) => l.filter((x) => x !== r.room_id))
      loadRooms()
    }
  }

  const preview = (r) => {
    if (drafts[r.room_id] && r.room_id !== activeId) return <><span className="draft">Draft:</span> {drafts[r.room_id]}</>
    if (!prefs.listPreview) return ''
    if (cleared[r.room_id] && r.last_message_at <= cleared[r.room_id]) return ''
    if (!r.last_kind) return r.kind === 'group' ? 'Group created' : 'Say hi'
    if (r.last_deleted) return ''
    const who = r.last_user === me.id ? 'You: ' : r.kind === 'group' && people[r.last_user] ? `${nameOf(people[r.last_user]).split(' ')[0]}: ` : ''
    const what = r.last_kind === 'image' ? 'Photo' : r.last_kind === 'voice' ? 'Voice message' : r.last_kind === 'file' ? 'File' : plainText(previewText(r.last_body, r.last_kind))
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
  // Tasks (Alex, 18 Oct): the panel stays open while you move between chats, and remembers it on this device
  // a tap on someone in Contacts opens their card (Alex, 21 Oct, like the iPhone's Contacts); favourites come first
  const [card, setCard] = useState('')
  const [favs, setFavs] = useLocal('roarme-fav', [])
  const cardPerson = card ? people[card] : null
  const showTasks = (v) => { setTasksOpen(v); try { localStorage.setItem('roarme-tasks', v ? '1' : '0') } catch { /* private window */ } }
  // on a phone the swipe runs on through the bar at the foot (Alex, 19 Oct): Contacts · Calls · Messages and its folders ·
  // Tasks and its tabs · Settings. Coming into Messages or Tasks from the right lands on its last folder or tab.
  const goStop = (dir) => {
    const stops = ['contacts', ...(prefs.callsTab ? ['calls'] : []), 'chats', 'tasks', 'settings']
    const next = stops[stops.indexOf(tasksOpen ? 'tasks' : tab === 'media' ? 'settings' : tab) + dir]
    if (!next) return
    if (next === 'tasks') { try { localStorage.setItem('roarme-tasks-tab', dir > 0 ? 'all' : 'done') } catch { /* private window */ } showTasks(true); return }
    if (tasksOpen) showTasks(false)
    setTab(next)
    if (next === 'chats') { const f = allFolders[dir > 0 ? 0 : allFolders.length - 1]; if (f) setFolder(f.id) }
  }
  pagerNow.current = { allFolders, folder, busy: picking || tabsEdit || !!q.trim(), picking, searchOpen: searchOpen || !!q.trim(), searchBusy, pull, goStop } // what the drags on the list read
  const stopSwipe = useRef(null)
  const onStopTouch = {
    onTouchStart: (e) => { stopSwipe.current = tab !== 'chats' && tab !== 'media' && e.touches.length === 1 && !e.target.closest('.tabs, input, .seg') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null },
    onTouchEnd: (e) => {
      const st = stopSwipe.current
      stopSwipe.current = null
      if (!st || !window.matchMedia('(max-width: 760px)').matches) return
      const dx = e.changedTouches[0].clientX - st.x, dy = e.changedTouches[0].clientY - st.y
      if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy) * 1.5) goStop(dx < 0 ? 1 : -1)
    },
  }
  const tasksKit = useTasks(me, loadPeople, (kind, t) => { const s = taskNotice(kind, t, peopleRef.current, () => showTasks(true)); if (s) toast(s) })
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

  // one row of the chat list; `ghost` is the copy in the folder sliding in beside the list, never pressed
  const roomRow = (r, ghost = false) => {
    const other = otherOf(r)
    const isPicked = picked.includes(r.room_id)
    if (ghost) {
      return (
        <div key={r.room_id} className="room" aria-hidden="true">
          <Avatar src={r.kind === 'group' ? r.avatar_url : other?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} online={onlineNow(other)} size={prefs.listPreview ? 54 : 48} />
          <span className="room-main">
            <span className="room-top"><strong>{titleOf(r)}</strong></span>
            <span className="room-bottom"><span className="room-prev">{preview(r)}</span>{r.unread > 0 && <span className={`badge${r.muted ? ' quiet' : ''}`}>{r.unread}</span>}</span>
          </span>
        </div>
      )
    }
    return (
      <button key={r.room_id} type="button" data-rid={r.room_id} className={`room${r.room_id === activeId && !picking ? ' on' : ''}${isPicked ? ' picked' : ''}${roomMenu?.r.room_id === r.room_id ? ' menu-on' : ''}`} onClick={() => { if (pressed.current) { pressed.current = false; return } if (Date.now() - rowSkip.current < 450) return; if (Date.now() - closedAt.current < 500) return; if (picking) setPicked((l) => (isPicked ? l.filter((x) => x !== r.room_id) : [...l, r.room_id])); else setActiveId(r.room_id) }} onContextMenu={(e) => !picking && openRoomMenu(e, r)}
        onTouchStart={(e) => !picking && pressStart(e, r)} onTouchMove={pressMove} onTouchEnd={pressEnd} onTouchCancel={pressEnd}>
        {picking && <span className={`tick${isPicked ? ' on' : ''}`} />}
        <Avatar src={r.kind === 'group' ? r.avatar_url : other?.avatar_url} name={titleOf(r)} group={r.kind === 'group'} online={onlineNow(other)} size={prefs.listPreview ? 54 : 48} />
        <span className="room-main">
          <span className="room-top"><strong>{titleOf(r)}{r.kind === 'direct' && officialIds.includes(otherOf(r)?.id) && OFFICIAL}</strong></span>
          <span className="room-bottom"><span className="room-prev">{preview(r)}</span>{r.muted && <span className="room-muted" title="Muted">{I.bell}</span>}{r.mentions > 0 && <span className="badge at" title="You were mentioned">@</span>}{r.unread > 0 ? <span key={r.unread} className={`badge${r.muted ? ' quiet' : ''}${prefs.peekBadge ? ' peekable' : ''}`} onClick={prefs.peekBadge ? (e) => { e.stopPropagation(); setPeek(r) } : undefined} title={prefs.peekBadge ? 'Preview' : undefined}>{r.unread}</span> : marked.includes(r.room_id) ? <span className={`badge dot${r.muted ? ' quiet' : ''}`} /> : pins.includes(r.room_id) ? <span className="room-pin" title="Pinned">{I.pin}</span> : null}</span>
          {prefs.folderTags && tagsOf(r).length > 0 && <span className="room-tags">{tagsOf(r).map((t) => <span key={t}>{t}</span>)}</span>}
        </span>
      </button>
    )
  }

  return (
    <div className={`app${intro ? ' intro' : ''}${tasksOpen ? ' tasks-open' : ''}`} style={{ '--side-w': `${sideW}px` }}>
      <span className="side-grip" onPointerDown={drag} onDoubleClick={() => { setSideW(370); try { localStorage.setItem('roarme-side', '370') } catch { /* private window */ } }} title="Drag to widen, double-click to reset" />
      <aside className="side">
        <div className="side-col" {...onStopTouch}>
        <div className="side-head">
          <button type="button" className="pill-btn" onClick={() => { setPlus(false); if (picking || tabsEdit) { endPick(); setTabsEdit(false) } else { setTab('chats'); setPicking(true) } }}>{picking || tabsEdit ? 'Done' : 'Edit'}</button>
          <span className="side-brand">{picking ? (picked.length ? `${picked.length} selected` : 'Select chats') : <Wordmark />}</span>
          {picking ? (
            <button type="button" className="pill-btn" onClick={() => setPicked(picked.length === shown.length && shown.length ? [] : shown.map((r) => r.room_id))}>{picked.length === shown.length && shown.length ? 'None' : 'All'}</button>
          ) : (
            <span className="side-acts">
            <span className="plus-wrap">
              <button type="button" className={`round${plus ? ' on' : ''}`} onClick={() => setPlus((v) => !v)} aria-label="New" title="New chat, group or folder">{I.plus}</button>
              {plus && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setPlus(false)} />
                  <div className="menu">
                    <button type="button" onClick={() => { setPlus(false); setModal('newchat') }}>{I.person}<span>New chat</span></button>
                    <button type="button" onClick={() => { setPlus(false); setModal('newgroup') }}>{I.people}<span>New group</span></button>
                    <button type="button" onClick={() => { setPlus(false); setModal('newcall') }}>{I.phone}<span>New call</span></button>
                    <button type="button" onClick={() => { setPlus(false); setModal('invite') }}>{I.link}<span>Invite people</span></button>
                    <button type="button" onClick={() => { setPlus(false); editFolder('new') }}>{I.folder}<span>New folder</span></button>
                    {myFolders.length > 0 && <button type="button" onClick={() => { setPlus(false); openFolders() }}>{I.edit}<span>Edit folders</span></button>}
                  </div>
                </>
              )}
            </span>
            </span>
          )}
        </div>
        {/* on a phone the list and a chat are separate screens: the bar shows on the list too */}
        <NowPlaying className="in-side" onOpen={(id) => { setTab('chats'); setActiveId(id) }} />
        {tab === 'chats' && (
          <>
            <div className={`search-wrap${searchOpen || q.trim() ? ' open' : ''}`}><div>
              <label className="search">{I.search}<input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search (⌘K)" tabIndex={searchOpen ? 0 : -1}
                onBlur={() => { if (!q.trim()) setTimeout(() => setSearchOpen(false), 1200) }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); setSearchOpen(false) } }} /></label>
            </div></div>
            <div className={`rooms-area${prefs.folderTabs === 'bottom' && !q.trim() ? ' bottom' : ''}`} onWheel={onListWheel}>
            {!q.trim() && (
              <nav ref={tabsLens} className={`tabs lens tabs-scroll${editTabs ? ' editing' : ''}`} onWheel={(e) => { const el = e.currentTarget; if (el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY }}>
                {tabsShown.map((f) => {
                  const n = folderUnread(f)
                  const dragged = tabDrag?.id === f.id
                  return <button key={f.id} type="button" data-tab={f.id} title={f.name} className={`${folder === f.id ? 'on' : ''}${dragged ? ' tab-dragging' : ''}`} style={dragged ? { transform: `translateX(${tabDrag.dx}px)` } : undefined}
                    {...(editTabs ? { onPointerDown: (e) => tabDown(e, f) } : tabPress(f))} onClick={(e) => { if (Date.now() - tabSkip.current < 400) return; setFolder(f.id); e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }) }} onContextMenu={(e) => { e.preventDefault(); setFolderMenu({ f, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) }) }}><span className="tab-ico">{f.id === 'all' ? I.chats : f.id === 'unread' ? I.unread : f.id === 'groups' ? I.people : f.id === 'archived' ? I.archive : I.folder}</span><span className="tab-name">{f.name}</span>{editTabs ? (f.id !== 'all' && <i className="tab-x" role="button" aria-label={`Delete ${f.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); deleteFolder(f) }}>{I.x}</i>) : n > 0 && f.id !== 'archived' && <small>{n}</small>}</button>
                })}
              </nav>
            )}
            {pull > 0 && <div className={`ptr${pull >= 1 ? ' ready' : ''}${pull === 2 ? ' spin' : ''}`} style={{ '--p': Math.min(pull, 1) }} aria-hidden="true">{svg(<><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></>, 20)}</div>}
            <div className="rooms-pager" ref={pagerRef}>
            <div className="rooms-track" ref={trackRef}>
            <div className={`rooms${swipedTo === folder ? '' : ' stagger'}${prefs.listPreview ? '' : ' no-prev'}`} key={folder}>
              {!rooms.length && (
                <div className="rooms-empty">
                  <p>No chats yet.</p>
                  <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>Find someone</button>
                </div>
              )}
              {rooms.length > 0 && !shown.length && !hits.length && <p className="muted rooms-none">{q.trim() ? 'Nothing found.' : myFolders.some((f) => f.id === folder) ? 'This folder is empty. Add chats to it under Edit folders.' : 'Nothing here.'}</p>}
              {shown.map((r) => roomRow(r))}
              {rowActs && (() => {
                const r = rooms.find((x) => x.room_id === rowActs.id)
                if (!r) return null
                const go = (what) => { shutRow(); roomAct(what, what === 'mute' ? 0 : undefined, r) }
                const unread = r.unread > 0 || marked.includes(r.room_id)
                return (
                  <div className={`row-acts ${rowActs.side}`} style={{ top: rowActs.top, height: rowActs.h }}>
                    {rowActs.side === 'left'
                      ? <><button type="button" className="ra-unread" onClick={() => go('unread')}><i>{I.unread}</i><span>{unread ? 'Read' : 'Unread'}</span></button>
                          <button type="button" className="ra-pin" onClick={() => go('pin')}><i>{I.pin}</i><span>{pins.includes(r.room_id) ? 'Unpin' : 'Pin'}</span></button></>
                      : <><button type="button" className="ra-mute" onClick={() => go('mute')}><i>{r.muted ? I.bell : I.bellOff}</i><span>{r.muted ? 'Unmute' : 'Mute'}</span></button>
                          <button type="button" className="ra-del" onClick={() => go('delete')}><i>{I.trash}</i><span>Delete</span></button></>}
                  </div>
                )
              })()}
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
                          <span className="room-top"><strong>{titleOf(r)}{r.kind === 'direct' && officialIds.includes(otherOf(r)?.id) && OFFICIAL}</strong><small>{listTime(h.created_at)}</small></span>
                          <span className="room-bottom"><span className="room-prev">{h.user_id === me.id ? 'You: ' : r.kind === 'group' ? `${nameOf(people[h.user_id]).split(' ')[0]}: ` : ''}{mark(h.body)}</span></span>
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
            </div>
            {pageDrag && (
              <div className={`rooms rooms-ghost ${pageDrag.dir > 0 ? 'next' : 'prev'}${prefs.listPreview ? '' : ' no-prev'}`} aria-hidden="true">
                {listFor(pageDrag.id).slice(0, 16).map((r) => roomRow(r, true))}
              </div>
            )}
            </div>
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
            {/* the same rows as the chat list (Alex, 21 Oct): its sizes, gaps and lines between them */}
            <div className="rooms contacts-list">
            {[...contacts].sort((a, b) => favs.includes(b.id) - favs.includes(a.id)).filter((p) => !cq.trim() || `${nameOf(p)} ${p.username}`.toLowerCase().includes(cq.trim().toLowerCase().replace(/^@/, ''))).map((p) => (
              <div key={p.id} className="room contact" role="button" tabIndex={0} onClick={() => setCard(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setCard(p.id) }}>
                <Avatar src={p.avatar_url} name={nameOf(p)} online={onlineNow(p)} size={prefs.listPreview ? 54 : 48} />
                <span className="room-main">
                  <span className="room-top"><strong>{nameOf(p)}</strong></span>
                  <span className="room-bottom"><span className={`room-prev${onlineNow(p) ? ' is-online' : ''}`}>{lastSeenText(p)}</span></span>
                </span>
                {favs.includes(p.id) && <span className="contact-fav" title="Favourite">{FAV_STAR}</span>}
              </div>
            ))}
            </div>
            {!contacts.length && <div className="calls-empty"><span className="side-panel-ico">{I.person}</span><b>No contacts yet</b><p>People you chat with show up here.</p><button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>Find people</button></div>}
          </div>
        )}
        {tab === 'calls' && prefs.callsTab && (
          <>
          <div className="side-scroll calls">
            <RecentCalls me={me} people={people} loadPeople={loadPeople} toast={toast} onCall={(p, roomId, video) => startCall(p, roomId || directWith(p), video)}
              empty={<div className="calls-empty"><span className="side-panel-ico">{I.calls}</span><b>No calls yet</b><p>Call someone from Create New Call, or from the phone and camera buttons in a chat.</p></div>} />
          </div>
          {/* at the foot, as wide as the bar under it (Alex, 21 Oct) */}
          <button type="button" className="new-call new-call-bar" onClick={() => setModal('newcall')}><span className="new-call-ico">{svg(<><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /><path d="M18 3v6M15 6h6" /></>, 20)}</span><span>Create New Call</span></button>
          </>
        )}
        {tab === 'settings' && <Suspense fallback={<div className="side-scroll" />}><SettingsMenu me={me} page={setPage || 'general'} onPage={setSetPage} onMedia={() => setTab('media')} onRoarMe={officialIds.length && !officialIds.includes(me.id) && !isAdmin ? openRoarMe : null}
          onInbox={isAdmin && officialIds.length ? () => setInboxOpen(true) : null} inboxCount={inboxCount} /></Suspense>}
        {tab === 'media' && <LibrarySide data={lib} rooms={visible} titleOf={titleOf} room={libRoom} onRoom={setLibRoom}
          face={(r, size = 36) => <Avatar src={r.kind === 'group' ? r.avatar_url : otherOf(r)?.avatar_url} name={titleOf(r)} size={size} group={r.kind === 'group'} />} />}
        </div>
        {picking ? (
          <nav className="foot bulk">
            <button type="button" disabled={!picked.length} onClick={bulkRead}>{I.read}<span>Read</span></button>
            <button type="button" disabled={!picked.length} onClick={bulkArchive}>{I.archive}<span>{allArchived ? 'Unarchive' : 'Archive'}</span></button>
            <button type="button" disabled={!picked.length} onClick={() => setModal('pickfolder')}>{I.folder}<span>Folder</span></button>
            <button type="button" className="danger" disabled={!picked.length} onClick={bulkDelete}>{I.trash}<span>Delete</span></button>
          </nav>
        ) : (
          <nav ref={footLens} className="foot lens" onClickCapture={(e) => { if (tasksOpen && !e.target.closest('.foot-tasks') && window.matchMedia('(max-width: 760px)').matches) showTasks(false) }}>
            {/* Contacts · Calls · Messages in the middle, a little bigger · Tasks · Settings (Alex, 19 Oct); AllMedia lives in Settings */}
            <button type="button" className={tab === 'contacts' && !tasksOpen ? 'on' : ''} onClick={() => setTab('contacts')}>{FOOT_I.contacts}<span>Contacts</span></button>
            {prefs.callsTab && <button type="button" className={tab === 'calls' && !tasksOpen ? 'on' : ''} onClick={() => setTab('calls')}>{FOOT_I.calls}<span>Calls</span></button>}
            <button type="button" className={`foot-main${tab === 'chats' && !tasksOpen ? ' on' : ''}`} onClick={() => setTab('chats')}><span className="foot-ico">{FOOT_I.messages}{unreadAll > 0 && <i>{unreadAll > 99 ? '99+' : unreadAll}</i>}</span><span>Messages</span></button>
            {/* Tasks in the bar at the foot, beside Settings (Alex, 18 Oct); it opens the panel, it is not a page, so it is marked open, not on.
                On a phone the bar stays under the open panel, and any other button in it puts the panel away */}
            <button type="button" className={`foot-tasks${tasksOpen ? ' open on' : ''}`} onClick={() => showTasks(!tasksOpen)} title="Tasks"><span className="foot-ico">{FOOT_I.tasks}{tasksKit.count > 0 && <i className={tasksKit.waiting ? 'ask' : ''}>{tasksKit.count > 99 ? '99+' : tasksKit.count}</i>}</span><span>Tasks</span></button>
            <button type="button" className={(tab === 'settings' || tab === 'media') && !tasksOpen ? 'on' : ''} onClick={() => setTab('settings')}>{FOOT_I.settings}<span>Settings</span></button>
          </nav>
        )}
      </aside>

      <main className="main">
        <NowPlaying onOpen={(id) => { setTab('chats'); setActiveId(id) }} />
        {tab === 'settings' ? (
          <Suspense fallback={<div className="set-body" />}><SettingsPage page={setPage || 'general'} chosen={!!setPage} onPage={setSetPage} onBack={() => setSetPage('')} onFolderDone={doneFolder} toast={toast} me={me} setMe={setMe}
            profile={<Settings me={me} setMe={setMe} inline />} folders={allFolders} onFolders={(m) => (m === 'newfolder' ? editFolder('new') : m.startsWith('folder:') ? editFolder(m.slice(7)) : m.startsWith('delete:') ? deleteFolder(allFolders.find((f) => f.id === m.slice(7))) : openFolders())}
            folderKit={{ folders: myFolders, setFolders: setMyFolders, rooms: visible, titleOf, seed: folderSeed, face: (r, size = 36) => <Avatar src={r.kind === 'group' ? r.avatar_url : otherOf(r)?.avatar_url} name={titleOf(r)} size={size} group={r.kind === 'group'} />, onDeleted: (id) => { if (folder === id) setFolder('all') } }}
            onFolderMenu={(f, e) => setFolderMenu({ f, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 160) })} /></Suspense>
        ) : tab === 'media' ? (
          <Library data={lib} room={libRoom} people={people} me={me} rooms={visible} titleOf={titleOf} onChat={libChat} onBack={() => setTab('settings')} />
        ) : active ? (
          <Room key={active.room_id} room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} official={active.kind === 'direct' && officialIds.includes(otherOf(active)?.id)} listen={listen} onRead={reloadSoon} onInfo={() => setModal('info')} onBack={() => setActiveId('')}
            rooms={rooms} titleOf={titleOf} toast={toast} jump={jump} onJumped={clearJump} prefs={prefs} clearedAt={cleared[active.room_id]} roles={roles.filter((g) => g.room_id === active.room_id)}
            onAct={(what, arg) => roomAct(what, arg, active)} onNewGroup={(p) => { setGroupWith(p); setModal('newgroup') }} onTasks={() => showTasks(true)} tasksCount={tasksKit.count}
            blocked={active.kind === 'direct' && blocks.has(otherOf(active)?.id)} onUnblock={() => unblock(otherOf(active)?.id)} onCall={(v) => callRoom(active, v)} />
        ) : (
          <div className="pick">
            <span className="pick-mark"><Wordmark by /></span>
            <p>Pick a chat, or start a new one.</p>
            <div className="pick-acts">
              <button type="button" className="btn btn-main" onClick={() => setModal('newchat')}>{I.person} New chat</button>
              <button type="button" className="btn" onClick={() => setModal('newgroup')}>{I.people} New group</button>
              <button type="button" className="btn" onClick={() => setModal('invite')}>{I.link} Invite people</button>
            </div>
          </div>
        )}
      </main>

      <ReminderCards me={me} rooms={rooms} titleOf={titleOf} onOpen={libChat}
        onDue={(r, m) => {
          if (prefsRef.current.sound) chime()
          if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          const room = rooms.find((x) => x.room_id === r.room_id)
          try {
            const n = new Notification(tr('Reminder'), { body: `${room ? `${titleOf(room)}: ` : ''}${reminderText(m)}`, icon: './icon.svg', tag: `reminder-${r.id}` })
            n.onclick = () => { window.focus(); libChat(r.room_id, r.message_id); n.close() }
          } catch { /* not allowed here */ }
        }} />
      {tasksOpen && <TasksPanel me={me} people={people} contacts={contacts} kit={tasksKit} toast={toast} onClose={() => showTasks(false)} onEdge={goStop} rooms={rooms} titleOf={titleOf} onOpenChat={(roomId, msgId) => { if (msgId) libChat(roomId, msgId); else { setTab('chats'); setActiveId(roomId) } }} />}

      {modal === 'invite' && <InviteModal me={me} toast={toast} onClose={() => setModal('')} />}
      {inboxOpen && <RoarMeInbox onClose={() => setInboxOpen(false)} />}
      {modal === 'newchat' && <NewChat me={me} onClose={() => setModal('')} onOpen={openRoom} />}
      {modal === 'newcall' && (
        <Modal title="New call" onClose={() => setModal('')}>
          <p className="muted">Pick who to call. Calls go straight from your computer to theirs.</p>
          <div className="people">
            {calls.map((p) => (
              <div key={p.id} className="person call-row">
                <Avatar src={p.avatar_url} name={nameOf(p)} size={48} online={onlineNow(p)} />
                <span className="person-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
                <button type="button" className="round" onClick={() => { setModal(''); startCall(p, directWith(p), false) }} aria-label="Voice call">{I.phone}</button>
                <button type="button" className="round" onClick={() => { setModal(''); startCall(p, directWith(p), true) }} aria-label="Video call">{I.video}</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === 'newgroup' && <NewGroup me={me} start={groupWith} onClose={() => { setModal(''); setGroupWith(null) }} onOpen={(id) => { setGroupWith(null); openRoom(id) }} />}
      {modal === 'info' && active && <Suspense fallback={null}><Profile room={active} me={me} people={people} title={titleOf(active)} other={otherOf(active)} rooms={rooms} titleOf={titleOf} toast={toast}
        onClose={() => setModal('')} onMessage={() => setModal('')} onOpenRoom={(id) => { setModal(''); setActiveId(id) }}
        onChanged={loadRooms} onLeft={() => { setActiveId(''); setModal(''); loadRooms() }} loadPeople={loadPeople}
        blocked={active.kind === 'direct' && blocks.has(otherOf(active)?.id)} onBlocks={loadBlocks} siteAdmin={isAdmin} onCall={active.kind === 'direct' ? (v) => { setModal(''); callRoom(active, v) } : null} /></Suspense>}
      {cardPerson && (
        <ContactCard me={me} person={cardPerson} toast={toast} loadPeople={loadPeople} onClose={() => setCard('')}
          fav={favs.includes(cardPerson.id)} onFav={() => { const on = favs.includes(cardPerson.id); setFavs(on ? favs.filter((x) => x !== cardPerson.id) : [...favs, cardPerson.id]); toast(on ? 'Removed from Favourites' : 'Added to Favourites') }}
          blocked={blocks.has(cardPerson.id)} onBlocks={loadBlocks}
          onMessage={() => { setCard(''); chatWith(cardPerson) }} onCall={(v) => { setCard(''); startCall(cardPerson, directWith(cardPerson), v) }} />
      )}
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
          <div className="ctx" onClick={() => { if (!roomMenu.at || Date.now() - roomMenu.at > 250) setRoomMenu(null) }} onPointerDown={(e) => { if (e.target === e.currentTarget && (!roomMenu.at || Date.now() - roomMenu.at > 250)) { e.preventDefault(); closedAt.current = Date.now(); setRoomMenu(null) } }} onContextMenu={(e) => { e.preventDefault(); setRoomMenu(null) }}>
          <div className="ctx-stack" onClick={(e) => e.stopPropagation()}>
          {/* on a phone the long press shows only the menu; the messages are one tap away in it (Alex, 21 Oct) */}
          {!window.matchMedia('(max-width: 760px)').matches && (
          <div className="ctx-card" role="button" tabIndex={0} onClick={() => { const r = roomMenu.r; setRoomMenu(null); setActiveId(r.room_id) }}>
            <span className="ctx-head"><b>{titleOf(roomMenu.r)}</b><small>{roomMenu.r.kind === 'group' ? 'Group' : otherOf(roomMenu.r) ? lastSeenText(otherOf(roomMenu.r)) : ''}</small></span>
            <PeekList room={roomMenu.r} me={me} people={people} clearedAt={cleared[roomMenu.r.room_id]} />
          </div>
          )}
          <div className="room-menu menu-list ctx-menu">
            {!window.matchMedia('(max-width: 760px)').matches && <button type="button" onClick={() => roomAct('window')}>{I.popout}<span>Open In Window</span></button>}
            {window.matchMedia('(max-width: 760px)').matches && <button type="button" onClick={() => roomAct('preview')}>{I.eye}<span>Preview Messages</span></button>}
            <button type="button" onClick={() => roomAct('pin')}>{I.pin}<span>{pins.includes(roomMenu.r.room_id) ? 'Unpin' : 'Pin'}</span></button>
            {roomMenu.r.muted
              ? <button type="button" onClick={() => roomAct('mute')}>{I.bell}<span>Unmute</span></button>
              : (
                <div className={`has-sub${roomMenu.sub === 'mute' ? ' open' : ''}`} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setRoomMenu((m) => ({ ...m, sub: 'mute' })) }}>
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
            <button type="button" onClick={() => roomAct('unread')} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setRoomMenu((m) => ({ ...m, sub: '' })) }}>{I.unread}<span>{roomMenu.r.unread > 0 || marked.includes(roomMenu.r.room_id) ? 'Mark As Read' : 'Mark As Unread'}</span></button>
            <hr />
            <button type="button" onClick={() => roomAct('archive')}>{I.archive}<span>{roomMenu.r.archived ? 'Unarchive' : 'Archive'}</span></button>
            <div className={`has-sub${roomMenu.sub === 'folder' ? ' open' : ''}`} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setRoomMenu((m) => ({ ...m, sub: 'folder' })) }}>
              <button type="button" onClick={() => setRoomMenu((m) => ({ ...m, sub: m.sub === 'folder' ? '' : 'folder' }))}>{I.folder}<span>Add to folder…</span><i className="sub-arrow">{I.right}</i></button>
              {roomMenu.sub === 'folder' && (
                <div className="sub-menu menu-list">
                  {/* every folder in the tabs, the ready-made ones too (Alex, 19 Oct); All holds every chat already */}
                  {allFolders.filter((f) => f.id !== 'all').map((f) => {
                    const r = roomMenu.r
                    const on = f.custom ? f.rooms.includes(r.room_id) : f.id === 'archived' ? r.archived : (prefs.folderExtra?.[f.id] || []).includes(r.room_id)
                    const fixed = f.id === 'groups' && r.kind === 'group'
                    return <button key={f.id} type="button" disabled={fixed} onClick={() => roomAct(f.custom ? 'folder' : f.id === 'archived' ? 'archive' : 'readyfolder', f.id)}><span>{f.name}</span>{(on || fixed) && <i className="sub-check">{I.check}</i>}</button>
                  })}
                  <hr />
                  <button type="button" onClick={() => roomAct('newfolder')}>{I.plus}<span>New folder</span></button>
                </div>
              )}
            </div>
            <hr />
            <button type="button" onClick={() => roomAct('clear')} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setRoomMenu((m) => ({ ...m, sub: '' })) }}>{I.clear}<span>Clear History</span></button>
            <button type="button" className="danger" onClick={() => roomAct('delete')}>{I.trash}<span>{roomMenu.r.kind === 'group' ? 'Delete and Leave' : 'Delete Chat'}</span></button>
          </div>
          </div>
          </div>
        </OnTop>
      )}
      {folderMenu && (() => {
        const allMuted = listFor(folderMenu.f.id).length > 0 && listFor(folderMenu.f.id).every((r) => r.muted)
        const folderMute = <button type="button" onClick={() => { const f = folderMenu.f; setFolderMenu(null); muteFolder(f) }}>{allMuted ? I.bell : I.bellOff}<span>{allMuted ? 'Unmute All' : 'Mute All'}</span></button>
        const folderReorder = <><hr /><button type="button" onClick={() => { setFolderMenu(null); setTab('chats'); setTabsEdit(true) }}>{REORDER}<span>Reorder Tabs</span></button></>
        return (
        <OnTop>
          <button type="button" className="scrim" aria-label="Close" onClick={() => { if (!folderMenu.at || Date.now() - folderMenu.at > 350) setFolderMenu(null) }} onContextMenu={(e) => { e.preventDefault(); setFolderMenu(null) }} />
          <div className="room-menu folder-menu menu-list" style={folderMenu.bottom != null ? { left: folderMenu.x, bottom: folderMenu.bottom, top: 'auto' } : { left: folderMenu.x, top: folderMenu.y }}>
            {folderMenu.f.custom ? (
              <>
                <button type="button" onClick={() => { const f = folderMenu.f; setFolderMenu(null); editFolder(f.id) }}>{I.edit}<span>Edit Folder</span></button>
                <button type="button" onClick={() => { setFolderChats(folderMenu.f.id); setFolderMenu(null) }}>{I.plus}<span>Add Chats</span></button>
                {folderMute}
                <hr />
                <button type="button" className="danger" onClick={() => {
                  const f = folderMenu.f
                  setFolderMenu(null)
                  if (!window.confirm(`Delete the folder ${f.name}? The chats in it stay.`)) return
                  setMyFolders((list) => list.filter((x) => x.id !== f.id))
                  if (folder === f.id) setFolder('all')
                  toast('Folder deleted')
                }}>{I.trash}<span>Delete</span></button>
                {folderReorder}
              </>
            ) : (
              <>
                <button type="button" onClick={() => { const f = folderMenu.f; setFolderMenu(null); editFolder(f.id) }}>{I.edit}<span>Edit Folder</span></button>
                <button type="button" onClick={() => { setFolderMenu(null); editFolder('new') }}>{I.plus}<span>New Folder</span></button>
                {folderMenu.f.id !== 'archived' && folderMute}
                {folderMenu.f.id !== 'all' && (
                  <>
                    <hr />
                    <button type="button" className="danger" onClick={() => {
                      const f = folderMenu.f
                      setFolderMenu(null)
                      if (!window.confirm(`Delete the folder ${f.name}? The chats in it stay.`)) return
                      setPrefs({ hiddenFolders: [...new Set([...(prefs.hiddenFolders || []), f.id])] })
                      if (folder === f.id) setFolder('all')
                      toast('Folder deleted')
                    }}>{I.trash}<span>Delete</span></button>
                  </>
                )}
                {folderReorder}
              </>
            )}
          </div>
        </OnTop>
        )
      })()}
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
      <UpdateCard />
    </div>
  )
}

/* Preview: a chat's last messages, looked at without opening it (so nothing is marked read) */
function Peek({ room, me, people, title, clearedAt, onClose, onOpen }) {
  return (
    <Modal title={title} onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Close</button><button type="button" className="btn btn-main" onClick={onOpen}>Open chat</button></>}>
      <PeekList room={room} me={me} people={people} clearedAt={clearedAt} />
    </Modal>
  )
}
// the last messages of a chat, newest at the foot, read without marking anything read
function PeekList({ room, me, people, clearedAt }) {
  const [list, setList] = useState(null)
  const box = useRef(null)
  useEffect(() => {
    supabase.from('roar_messages').select('id, user_id, kind, body, file, created_at').eq('room_id', room.room_id).is('deleted_at', null).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setList((data || []).filter((m) => !clearedAt || m.created_at > clearedAt).reverse()))
  }, [room.room_id, clearedAt])
  useLayoutEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [list])
  return (
      <div className="peek" ref={box}>
        {list === null && <p className="muted">Loading…</p>}
        {list && !list.length && <p className="muted">No messages.</p>}
        {(list || []).map((m) => (
          <div key={m.id} className={`peek-msg${m.user_id === me.id ? ' mine' : ''}`}>
            {room.kind === 'group' && m.user_id !== me.id && <b style={{ color: colorOf(m.user_id) }}>{nameOf(people[m.user_id])}</b>}
            <span>{m.kind === 'image' ? '📷 Photo' : m.kind === 'voice' ? '🎤 Voice message' : m.kind === 'file' ? `📎 ${m.file?.name || 'File'}` : previewText(m.body, m.kind)}</span>
            <small>{timeOf(m.created_at)}</small>
          </div>
        ))}
      </div>
  )
}

/* ---------- one conversation ---------- */
// the official RoarMe account's mark beside its name (Alex, 19 Oct)
const FAV_STAR = svg(<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />, 15)
const EDGE = 36 // px from either side of the screen where a slide turns the folder
const ROW_W = 156 // how far a chat slides open to show its two buttons
const REORDER = svg(<><rect x="3" y="4" width="18" height="6" rx="2" /><path d="M5 15v4M12 15v4M19 15v4M3.5 15h17" /></>, 16)
const OFFICIAL = <i className="official" title="Official RoarMe account" aria-label="Official">{svg(<><path d="M12 2.5l2.4 1.8 3-.1.9 2.8 2.4 1.8-.9 2.8.9 2.8-2.4 1.8-.9 2.8-3-.1L12 21.5l-2.4-1.8-3 .1-.9-2.8L3.3 15.2l.9-2.8-.9-2.8 2.4-1.8.9-2.8 3 .1z" fill="currentColor" stroke="none" /><path d="M8.5 12.2l2.3 2.3 4.7-4.8" stroke="#fff" strokeWidth="2.2" /></>, 15)}</i>

function Room({ room, me, people, title, other, official = false, listen, onRead, onInfo, onBack, rooms, titleOf, toast, jump, onJumped, prefs, clearedAt, onAct, onNewGroup, blocked, onUnblock, onCall, onTasks, tasksCount = 0, roles = [] }) {
  const [rawMsgs, setMsgs] = useState([])
  // Encrypted Chat (Alex, 17 Oct): whether it is on here, and the messages with the locked ones opened on this device
  const [sealOn, reloadSeal] = useEncrypted(room.room_id)
  const msgs = useOpened(rawMsgs, room.room_id, me.id, sealOn?.id)
  const [keyOk, setKeyOk] = useState(true)
  useEffect(() => {
    let alive = true
    if (sealOn) hasStretchKey(sealOn.id, me.id).then((ok) => { if (alive) setKeyOk(ok) }); else setKeyOk(true)
    return () => { alive = false }
  }, [sealOn, me.id])
  const [sealAsk, setSealAsk] = useState(null) // the Turn on window: { missing, busy }
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
  // scheduled messages (Alex, 18 Oct): hold Send or right click it; the clock in the box lists what waits
  const sched = useScheduled(room.room_id, me.id)
  const [schedNew, setSchedNew] = useState(false)
  const [remindFor, setRemindFor] = useState(null) // Remind Me on a message (src/reminders.jsx)
  const [rolesOpen, setRolesOpen] = useState(false) // the group's roles for @mentions (src/roles.jsx)
  const [pinTab, setPinTab] = useState('all') // in the pinned window: everything, or the files only
  const [schedEdit, setSchedEdit] = useState(null)
  const [schedList, setSchedList] = useState(false)
  const holdT = useRef(null)
  const held = useRef(false)
  // Delete for Me, and asking someone to delete what they wrote (Alex, 18 Oct; supabase/delete-asks.sql)
  const [hidden, setHidden] = useState(() => new Set())
  const [asks, setAsks] = useState([])
  useEffect(() => {
    let alive = true
    setHidden(new Set()); setAsks([])
    supabase.from('roar_msg_hides').select('message_id').eq('room_id', room.room_id).then(({ data }) => { if (alive) setHidden(new Set((data || []).map((x) => x.message_id))) })
    supabase.from('roar_delete_asks').select('*').eq('room_id', room.room_id).eq('status', 'pending').then(({ data }) => { if (alive) setAsks(data || []) })
    const ch = supabase.channel(`roar-asks-${room.room_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_delete_asks', filter: `room_id=eq.${room.room_id}` }, (ev) => {
        const a = ev.new
        if (!a?.id) return
        setAsks((l) => (a.status === 'pending' ? [...l.filter((x) => x.id !== a.id), a] : l.filter((x) => x.id !== a.id)))
        if (ev.eventType === 'UPDATE' && a.asked_by === me.id && a.status !== 'pending') {
          const who = nameOf(people[a.owner])
          toast(a.status === 'accepted' ? `${who} deleted the message` : `${who} kept the message`)
        }
      })
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [room.room_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const hideForMe = async (m) => {
    setMenu(null)
    setHidden((h) => new Set([...h, m.id]))
    const { error } = await supabase.from('roar_msg_hides').upsert({ user_id: me.id, message_id: m.id, room_id: room.room_id })
    if (error) { setErr(errText(error)); setHidden((h) => { const n = new Set(h); n.delete(m.id); return n }) }
  }
  const askDelete = async (m) => {
    setMenu(null)
    const { data, error } = await supabase.rpc('roar_ask_delete', { msg: m.id })
    if (error) { setErr(errText(error)); return }
    setAsks((l) => [...l.filter((x) => x.id !== data), { id: data, message_id: m.id, room_id: room.room_id, asked_by: me.id, owner: m.user_id, status: 'pending' }])
    toast(`Asked ${nameOf(people[m.user_id])} to delete it`)
  }
  const answerAsk = async (a, accept) => {
    setAsks((l) => l.filter((x) => x.id !== a.id))
    const { error } = await supabase.rpc('roar_answer_delete', { ask: a.id, accept })
    if (error) { setErr(errText(error)); return }
    if (accept) setMsgs((all) => all.map((x) => (x.id === a.message_id ? { ...x, deleted_at: new Date().toISOString(), body: '' } : x)))
    toast(accept ? 'Deleted for everyone' : 'Kept')
  }
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [viewer, setViewer] = useState(null) // { items, index }
  const [menu, setMenu] = useState(null) // { m, x, y }
  const [wideIds, setWideIds] = useState(() => new Set()) // videos widened across the chat
  const [cinema, setCinema] = useState(null) // lights off: { kind: 'file' | 'embed', src, at }
  const flipWide = (id) => setWideIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
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
  const [transferOpen, setTransferOpen] = useState(false)
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
  // who has read up to where: the same answer again changes nothing on screen
  const loadReads = useCallback(() => supabase.from('roar_members').select('user_id, last_read_at').eq('room_id', room.room_id).then(({ data }) => {
    const n = Object.fromEntries((data || []).map((x) => [x.user_id, x.last_read_at]))
    setReads((o) => (JSON.stringify(o) === JSON.stringify(n) ? o : n))
  }), [room.room_id])
  // pinned messages: as many as one likes, each with a pin on it; the bar opens them all in a window (Alex, 16 Oct)
  const [pinRows, setPinRows] = useState([])
  const [pinView, setPinView] = useState(false)
  const [schedOpen, setSchedOpen] = useState(false)
  const [locOpen, setLocOpen] = useState(false)
  const [locView, setLocView] = useState(null)
  const [artOpen, setArtOpen] = useState(null) // true for a new one, or the message being edited
  const [ordOpen, setOrdOpen] = useState(false) // Roardino, from the clip
  const [artView, setArtView] = useState(null)
  // the message box grows with what is written, wrapped lines too; past a few lines a corner button makes it big
  // (Alex, 17 Oct, as on Telegram) and it shrinks back once the message is sent
  const [bigBox, setBigBox] = useState(false)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = bigBox ? Math.round(window.innerHeight * 0.55) : 200
    const full = el.scrollHeight
    el.style.height = `${bigBox ? max : Math.min(max, full)}px`
    setTall(full > 90)
  }, [text, bigBox])
  useEffect(() => { if (!text) setBigBox(false) }, [text])
  const [pinExtra, setPinExtra] = useState({})
  const loadPins = useCallback(() => supabase.from('roar_pins').select('message_id, pinned_by, pinned_at').eq('room_id', room.room_id).order('pinned_at').then(({ data }) => setPinRows(data || [])), [room.room_id])
  useEffect(() => {
    loadReacts(); loadReads(); loadPins()
    const id = setInterval(() => { if (!document.hidden) loadReads() }, 15000)
    return () => clearInterval(id)
  }, [loadReacts, loadReads, loadPins])

  // live messages and reactions for this room
  useEffect(() => listen((ev) => {
    if (ev.table === 'roar_pins') { loadPins(); return }
    if (ev.table === 'roar_reactions') {
      const r = ev.new?.room_id ? ev.new : ev.old
      if (r?.room_id === room.room_id) loadReacts()
      return
    }
    const m = ev.new
    if (!m || m.room_id !== room.room_id) return
    if (ev.eventType === 'INSERT' && m.kind === 'system' && (m.body === E2E_ON || m.body === E2E_OFF)) reloadSeal()
    if (ev.eventType === 'INSERT') { setMsgs((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])); setTimeout(loadReads, 1500) }
    if (ev.eventType === 'UPDATE') setMsgs((list) => list.map((x) => (x.id === m.id ? m : x)))
  }), [listen, room.room_id, loadReacts, loadReads, loadPins, reloadSeal])

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
  const olderBusy = useRef(false) // one page of older messages at a time, however fast the scroll events come
  const onScroll = async (e) => {
    const el = e.currentTarget
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (menu) setMenu(null)
    // back at the bottom of a long chat: the oldest pages read on the way up are let go, and come back if needed
    // (Alex, 21 Oct: RoarMe lighter; a chat scrolled far back no longer keeps every message in memory)
    if (stick.current && msgs.length > 240 && !find && !picked) { setMsgs((list) => list.slice(-150)); setMore(true) }
    if (el.scrollTop < 60 && more && msgs.length && !olderBusy.current) {
      olderBusy.current = true
      const h = el.scrollHeight
      try {
        const older = await load(msgs[0].created_at)
        if (older.length) {
          setMsgs((list) => { const have = new Set(list.map((m) => m.id)); return [...older.filter((m) => !have.has(m.id)), ...list] })
          requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h + el.scrollTop })
        }
      } finally { olderBusy.current = false }
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

  // on a phone, opening a chat no longer brings the keyboard up (Alex, 21 Oct): the box takes the focus there only for a reply or an edit
  useEffect(() => {
    if (find !== null) return
    if (window.matchMedia('(pointer: coarse)').matches && !replyTo && !editing) return
    inputRef.current?.focus()
  }, [room.room_id, replyTo, editing, find])

  // the people of this chat, for @mentions
  const members = useMemo(() => (room.members || []).filter((id) => id !== me.id).map((id) => people[id]).filter(Boolean), [room.members, people, me.id])
  const mentionQ = useMemo(() => {
    const before = text.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\p{L}\p{N}_.]{0,24})$/u)
    return m ? m[1].toLowerCase() : null
  }, [text, caret])
  // @all, @here and the group's roles first, then its people (Alex, 20 Oct: mentions as in Slack, src/roles.jsx)
  const mentionHits = mentionQ === null || room.kind !== 'group' ? [] : [
    ...[['all', 'Everyone', 'Everyone in this group'], ['here', 'Online now', 'Who is in RoarMe right now']].filter(([n]) => n.startsWith(mentionQ)).map(([n, label, sub]) => ({ key: n, name: n, label, sub: `@${n} · ${sub}`, special: true })),
    ...roles.filter((g) => g.name.includes(mentionQ)).map((g) => ({ key: g.id, name: g.name, label: `@${g.name}`, sub: g.user_ids.length === 1 ? 'Role · 1 person' : `Role · ${g.user_ids.length} people`, special: true })),
    ...members.filter((p) => nameOf(p).toLowerCase().includes(mentionQ) || p.username.includes(mentionQ)).map((p) => ({ key: p.id, name: p.username, label: nameOf(p), sub: `@${p.username}`, p })),
  ].slice(0, 8)
  const pickMention = (p) => {
    const before = text.slice(0, caret).replace(/@([\p{L}\p{N}_.]{0,24})$/u, `@${p.name} `)
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
    // while Encrypted Chat is on the text is locked here, before it leaves the device
    let out = body
    const stretch = editing ? editing.sealed : sealOn?.id
    if (stretch) {
      try { out = await sealText(body, stretch, room.room_id, me.id) } catch (e) { setErr(errText(e)); return }
      if (out.length > 20000) { setErr('Too long for one encrypted message. Send it in two parts.'); return }
    }
    if (editing) {
      const { error } = await supabase.from('roar_messages').update({ body: out, edited_at: new Date().toISOString() }).eq('id', editing.id)
      if (error) { setErr(errText(error)); return }
      setMsgs((list) => list.map((x) => (x.id === editing.id ? { ...x, body: out, edited_at: new Date().toISOString() } : x)))
      setEditing(null); setText('')
      return
    }
    setText('')
    stick.current = true
    const { data, error } = await supabase.from('roar_messages').insert({ room_id: room.room_id, user_id: me.id, body: out, reply_to: replyTo?.id || null }).select().single()
    setReplyTo(null)
    if (error) { setErr(errText(error)); setText(body); return }
    setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
  }

  const canSched = !editing && !sealOn && !!text.trim()
  const scheduleIt = async ({ body, at, repeat }) => {
    const out = prefs.autoEmoji ? swapEmoji(body) : body
    const e = await sched.add({ body: out, replyTo: replyTo?.id, at, repeat })
    if (e) return e
    setSchedNew(false); setText(''); setReplyTo(null)
    toast(`Scheduled for ${whenText(at.toISOString())}`)
    return ''
  }

  // what is on its way up: one tile each, with a ring that fills (Alex, 16 Oct)
  const setOut = (id, patch) => setOutbox((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const dropOut = (id) => setOutbox((l) => { const x = l.find((y) => y.id === id); if (x?.preview) URL.revokeObjectURL(x.preview); return l.filter((y) => y.id !== id) })
  const upload = async (file, kind, extra = {}, outId = null, viaTransfer = false) => {
    const safe = (file.name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
    const path = `${room.room_id}/${crypto.randomUUID()}-${safe}`
    // a sound file the computer did not name (some .wav, .aiff, .flac) gets its type from its ending, so it plays
    const ext = ((file.name || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase()
    const type = file.type || (ext && isAudioFile({ name: file.name }) ? `audio/${{ mp3: 'mpeg', m4a: 'mp4', aif: 'aiff', oga: 'ogg' }[ext] || ext}` : '')
    const holder = {}
    const big = viaTransfer || file.size > SMALL_MAX
    if (outId) setOut(outId, { holder, stage: 'up', size: file.size, big })
    await (big ? tusUpload : uploadWithProgress)(big ? TRANSFER_BUCKET : 'roar-files', path, file, type, (p) => { if (outId) setOut(outId, { p }) }, holder)
    if (outId) setOut(outId, { stage: 'send', p: 1 })
    // RoarTransfer: past 50 MB the file goes to its own place and is kept 3 days (Alex, 16 Oct)
    const tr = big ? { bucket: TRANSFER_BUCKET, expires: new Date(Date.now() + TRANSFER_DAYS * 864e5).toISOString() } : {}
    return { path, name: file.name, size: file.size, type, ...tr, ...extra }
  }

  // viaTransfer: the RoarTransfer button beside the clip (Alex, 16 Oct) sends the files as they are, any size up to 3 GB
  // hooks: the RoarTransfer window follows its own files (batch), can stop them, and hears each one sent
  const sendFiles = async (files, caption = '', compress = true, viaTransfer = false, hooks = {}) => {
    if (sealOn) { setAttach(null); setErr('While Encrypted Chat is on, only text can be sent. Turn it off to send photos, files, places and voice messages.'); return }
    if (viaTransfer) compress = false
    setAttach(null); setErr('')
    const reply = replyTo
    setReplyTo(null)
    stick.current = true
    // Standard quality shrinks videos to 720p first; anything still over 50 MB goes by RoarTransfer, up to 3 GB
    const shrinkVid = (f) => compress && isVideoFile(f) && canCompressVideo()
    const ok = files.filter((f) => { if (f.size > TRANSFER_MAX) { setErr(`${f.name} is over 3 GB, the most RoarTransfer takes.`); return false } return true })
    // Safari lets a video play only from inside the tap: each clip is readied now, before anything waits
    const handles = new Map(ok.filter(shrinkVid).map((f) => [f, prepareVideo(f)]))
    const tiles = ok.map((f) => ({ id: crypto.randomUUID(), name: f.name, size: f.size, big: viaTransfer || (f.size > SMALL_MAX && !shrinkVid(f)), batch: hooks.batch, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : '', p: 0, stage: 'prep' }))
    setOutbox((l) => [...l, ...tiles])
    let n = 0
    for (const raw of ok) {
      const tile = tiles[n]
      n += 1
      if (hooks.stopped?.()) { dropOut(tile.id); continue }
      const isImg = /^image\/(jpeg|png|webp)$/.test(raw.type)
      try {
        let file = isImg && compress ? await shrinkImage(raw, prefs.largePhotos ? 2560 : 1600, prefs.largePhotos ? 0.88 : 0.82) : raw
        if (handles.get(raw)) {
          const small = await compressVideo(handles.get(raw), (p) => setOut(tile.id, { stage: 'shrink', p }))
          if (small?.file) file = small.file
          setOut(tile.id, { stage: 'prep', p: 0 })
        }
        const meta = await upload(file, null, {}, tile.id, viaTransfer)
        stick.current = true
        const last = n === ok.length
        const { data, error } = await supabase.from('roar_messages').insert({
          room_id: room.room_id, user_id: me.id, kind: /^image\//.test(file.type) && !/gif|svg/.test(file.type) && !meta.bucket ? 'image' : 'file', body: last ? caption : '',
          file: meta, reply_to: reply?.id || null,
        }).select().single()
        if (error) throw error
        stick.current = true
        setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
        hooks.onFile?.(meta)
      } catch (e) {
        if (!e?.cancelled) { setErr(`${raw.name}: ${errText(e)}`); hooks.onError?.(raw.name, errText(e)) }
      }
      releaseVideo(handles.get(raw))
      dropOut(tile.id)
    }
    hooks.onEnd?.()
  }

  // voice messages: record, then send or throw away
  const canVoice = typeof window !== 'undefined' && !!window.MediaRecorder && !!navigator.mediaDevices?.getUserMedia
  useEffect(() => {
    if (!rec) return
    const id = setInterval(() => setRecSecs(Math.round((Date.now() - rec.started) / 1000)), 250)
    return () => clearInterval(id)
  }, [rec])
  const startVoice = async () => {
    if (sealOn) { setErr('While Encrypted Chat is on, only text can be sent. Turn it off to send photos, files, places and voice messages.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || ''
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
      const chunks = []
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      recRef.current = { mr, stream, chunks, type: mr.mimeType || type || 'audio/webm' }
      mr.start(250)
      setRecSecs(0)
      setRec({ started: Date.now(), stream })
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
    const on = pinRows.some((p) => p.message_id === m.id)
    setPinRows((l) => (on ? l.filter((p) => p.message_id !== m.id) : [...l, { message_id: m.id, pinned_by: me.id, pinned_at: new Date().toISOString() }]))
    const { error } = on
      ? await supabase.from('roar_pins').delete().eq('message_id', m.id)
      : await supabase.from('roar_pins').insert({ message_id: m.id, room_id: room.room_id })
    if (error) setErr(errText(error))
    else toast(on ? 'Unpinned' : 'Pinned')
    loadPins()
  }
  const unpinAll = async () => {
    setPinView(false)
    setPinRows([])
    const { error } = await supabase.from('roar_pins').delete().eq('room_id', room.room_id)
    if (error) setErr(errText(error)); else toast('All unpinned')
    loadPins()
  }

  // a message that shows as a card (a scheduled call, a place, an article): its text in body, the card's details in file
  const sendCard = async (body, file, done, close) => {
    if (sealOn) { close?.(); setErr('While Encrypted Chat is on, only text can be sent. Turn it off to send photos, files, places and voice messages.'); return false }
    const { data, error } = await supabase.from('roar_messages').insert({ room_id: room.room_id, user_id: me.id, kind: 'text', body, file }).select().single()
    if (error) { setErr(errText(error)); return false }
    close?.()
    stick.current = true
    setMsgs((list) => (list.some((x) => x.id === data.id) ? list : [...list, data]))
    if (file?.event) window.dispatchEvent(new Event('roarme-cal')) // the calendar under Tasks shows it at once
    if (done) toast(done)
    return true
  }
  // one's own text messages can be changed; a locked one only while its stretch of Encrypted Chat is still on
  const canEdit = (m) => m.user_id === me.id && m.kind === 'text' && (!m.sealed || (m.sealed === sealOn?.id && keyOk && !m.locked))
  const askSeal = async () => {
    setSealAsk({ missing: null })
    const missing = await withoutDevice(room.members || []).catch(() => [])
    setSealAsk((a) => (a ? { ...a, missing: missing.filter((id) => id !== me.id) } : a))
  }
  const turnOn = async () => {
    setSealAsk((a) => ({ ...a, busy: true }))
    try { await startEncrypted(room.room_id, room.members || [], me.id); setSealAsk(null); toast('Encrypted Chat is on') } catch (e) { setSealAsk(null); setErr(errText(e)) }
    reloadSeal()
  }
  const turnOff = async () => {
    try { await endEncrypted(room.room_id); toast('Encrypted Chat is off') } catch (e) { setErr(errText(e)) }
    reloadSeal()
  }
  const textOf = (m) => (m.kind === 'system' ? previewText(m.body, 'system') : m.sealed && !m.body ? 'Encrypted message' : m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? `${isAudioFile(m.file) ? '🎵 ' : ''}${m.file?.name || 'File'}` : m.body)
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
    if (how === 'edit' && canEdit(m)) { setReplyTo(null); setEditing(m); setText(m.body) }
    else if (how === 'forward') { if (!m.sealed) setForward([m]) }
    else if (how === 'reply' || how === 'edit') setReplyTo(m)
    else { react(m, prefs.quick); if (!reactsOf[m.id]?.[prefs.quick]?.mine) burst(prefs.quick, e?.clientX, e?.clientY) }
  }

  // the small format bar: it shows over the box while some text is selected (Alex, 16 Oct)
  const [sel, setSel] = useState(null)
  const readSel = (el) => setSel(el && el.selectionEnd > el.selectionStart ? { a: el.selectionStart, b: el.selectionEnd } : null)
  const applyMark = (mark) => {
    const el = inputRef.current
    if (!el) return
    const { next, caretA, caretB } = toggleMark(el, text, mark)
    setText(next)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = caretA; el.selectionEnd = caretB; readSel(el) })
  }

  const onKey = (e) => {
    // Cmd/Ctrl + B bold, I italic, U underline, E code, Shift+X strike, Shift+P spoiler, around what is selected
    const fmtKey = (e.metaKey || e.ctrlKey) && ({ b: '**', i: '_', u: '__', e: '`', ...(e.shiftKey ? { x: '~~', p: '||' } : {}) })[e.key.toLowerCase()]
    if (fmtKey && e.currentTarget) {
      e.preventDefault()
      applyMark(fmtKey)
      return
    }
    if (mentionHits.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(mentionHits[0]); return }
    const sendKey = prefs.enterSends ? e.key === 'Enter' && !e.shiftKey : e.key === 'Enter' && (e.metaKey || e.ctrlKey)
    if (sendKey) { e.preventDefault(); send(); return }
    if (e.key === 'Escape') { setReplyTo(null); setEmoji(false); if (editing) { setEditing(null); setText('') } }
    if (e.key === 'ArrowUp' && !text) {
      const mine = [...msgs].reverse().find((m) => canEdit(m) && !m.deleted_at)
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
    const items = await Promise.all(photos.map(async (x) => ({ url: await fileLink(x.file), type: x.file?.type, name: x.file?.name })))
    setViewer({ items, index: Math.max(0, photos.findIndex((x) => x.id === m.id)) })
  }
  // @username in a message, lit up
  // links that open (in the browser, a new tab) and @usernames lit up, inside a message's text
  const withMentions = (s) => {
    const parts = String(s).split(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|@[\p{L}\p{N}_]{2,24})/gu)
    return parts.map((p, i) => {
      if (!(i % 2)) return p
      if (p.startsWith('@')) return <span key={i} className={`mention${mentionsMe(p, me, roles) ? ' me' : ''}`}>{p}</span>
      const tail = (p.match(/[.,;:!?)\]]+$/) || [''])[0]
      const url = tail ? p.slice(0, -tail.length) : p
      return <span key={i}><a className="msg-link" href={url.startsWith('www.') ? `https://${url}` : url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{url}</a>{tail}</span>
    })
  }

  const sub = room.kind === 'group' ? `${(room.members || []).length} members` : [other ? `@${other.username}` : '', lastSeenText(other)].filter(Boolean).join(' · ')
  // a scheduled call in this chat: a notice when it starts (while the app is open)
  useEffect(() => {
    const timers = msgs.filter((m) => m.file?.event && !m.deleted_at).map((m) => {
      const wait = new Date(m.file.event.start).getTime() - Date.now()
      if (wait <= 0 || wait > 864e5) return null
      return setTimeout(() => {
        toast(`Starting now: ${m.file.event.title}`)
        try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('RoarMe', { body: `Starting now: ${m.file.event.title}` }) } catch { /* not allowed here */ }
      }, wait)
    }).filter(Boolean)
    return () => timers.forEach(clearTimeout)
  }, [msgs]) // eslint-disable-line react-hooks/exhaustive-deps

  // pinned messages older than what is loaded are fetched on their own
  useEffect(() => {
    const missing = pinRows.map((p) => p.message_id).filter((id) => !byId[id] && !pinExtra[id])
    if (!missing.length) return
    supabase.from('roar_messages').select('*').in('id', missing).then(({ data }) => { if (data?.length) setPinExtra((x) => ({ ...x, ...Object.fromEntries(data.map((m) => [m.id, m])) })) })
  }, [pinRows, byId]) // eslint-disable-line react-hooks/exhaustive-deps -- byId too: a long chat trimmed back can drop an old pinned one
  const pinExtraList = useMemo(() => Object.values(pinExtra), [pinExtra])
  const pinOpened = useOpened(pinExtraList, room.room_id, me.id, sealOn?.id)
  const pinOpenedById = useMemo(() => Object.fromEntries(pinOpened.map((m) => [m.id, m])), [pinOpened])
  const pinnedSet = useMemo(() => new Set(pinRows.map((p) => p.message_id)), [pinRows])
  const pinnedList = pinRows.map((p) => byId[p.message_id] || pinOpenedById[p.message_id]).filter((m) => m && !m.deleted_at)
  const pinned = pinnedList[pinnedList.length - 1] || null
  // photos, videos, voice, files and transfers, for the Files tab of the pinned window (Alex, 20 Oct)
  const isPinFile = (m) => m.kind === 'image' || m.kind === 'file' || m.kind === 'voice'
  // a deleted message simply goes, with nothing left in its place (Alex, 16 Oct)
  const shownMsgs = useMemo(() => msgs.filter((m) => !m.deleted_at && !hidden.has(m.id) && (!clearedAt || m.created_at > clearedAt)), [msgs, clearedAt, hidden])
  // what others ask me to delete, one at a time, above the writing box
  const askForMe = asks.filter((a) => a.owner === me.id && msgs.some((m) => m.id === a.message_id && !m.deleted_at))
  const askedByMe = new Set(asks.filter((a) => a.asked_by === me.id).map((a) => a.message_id))
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
    // Encrypted Chat: the locked messages this device can open go in as text, the lines on and off as words
    all = await Promise.all(all.map(async (m) => (m.kind === 'system' ? { ...m, body: previewText(m.body, 'system') }
      : isSealed(m.body) ? { ...m, body: (await openText(m.body, room.room_id, me.id)) ?? '[Encrypted message]' } : m)))
    const two = (n) => String(n).padStart(2, '0')
    const when = (s) => { const d = new Date(s); return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}` }
    const what = (m) => (m.kind === 'image' ? `[Photo${m.file?.name ? `: ${m.file.name}` : ''}]${m.body ? ` ${m.body}` : ''}` : m.kind === 'voice' ? '[Voice message]' : m.kind === 'file' ? `[File: ${m.file?.name || 'file'}]${m.body ? ` ${m.body}` : ''}` : m.body)
    const lines = all.map((m) => `[${when(m.created_at)}] ${m.user_id === me.id ? nameOf(me) : nameOf(people[m.user_id]) || 'Someone'}: ${what(m)}`)
    const text = `RoarMe · ${title}\nExported ${when(new Date().toISOString())} · ${all.length} messages\n\n${lines.join('\n')}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    a.download = `RoarMe - ${title.replace(/[\\/:*?"<>|]/g, '')}.txt`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }

  /* The messages, drawn again only when something they show changes (Alex, 21 Oct: RoarMe lighter): typing in the box
     below no longer redraws every message. Their buttons call the newest handlers through `hands`. */
  const hands = useRef({})
  hands.current = { onTap, onDouble, onBubble, openMenu, goTo, react, hideForMe, setReplies, flipWide, openPhoto, onCall, setLocView, setArtView, setCinema, byId, picked, setReplyTo }
  // a message slid to the left on a phone is answered, like Telegram (Alex, 21 Oct): the bubble follows the finger,
  // the reply arrow fills in on its right, and past 56 px letting go starts the reply
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return undefined
    let g = null
    const ARROW = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4"/></svg>'
    const start = (e) => {
      g = null
      if (e.touches.length !== 1 || !window.matchMedia('(max-width: 760px)').matches || hands.current.picked) return
      const row = e.target.closest?.('[id^="m-"]')
      const msg = row?.querySelector(':scope > .msg')
      const m = row && hands.current.byId[row.id.slice(2)]
      if (!msg || !m || m.deleted_at) return
      g = { msg, m, x: e.touches[0].clientX, y: e.touches[0].clientY, lock: '', dx: 0, felt: false }
    }
    const move = (e) => {
      if (!g) return
      const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y
      if (!g.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        g.lock = dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'no'
        if (g.lock === 'x') {
          g.msg.style.transition = 'none'
          g.icon = document.createElement('span')
          g.icon.className = 'swipe-reply'
          g.icon.innerHTML = ARROW
          g.msg.parentElement.style.position = 'relative'
          g.msg.parentElement.appendChild(g.icon)
        }
      }
      if (g.lock !== 'x') return
      if (e.cancelable) e.preventDefault()
      const a = Math.min(0, dx), m = a < -70 ? -70 + (a + 70) * 0.25 : a
      g.dx = a
      g.msg.style.transform = `translate3d(${m}px,0,0)`
      const p = Math.min(1, -a / 56)
      g.icon.style.opacity = String(p)
      g.icon.style.transform = `translateY(-50%) scale(${0.6 + p * 0.4})`
      if (p >= 1 && !g.felt) { g.felt = true; navigator.vibrate?.(8); g.icon.classList.add('ready') }
      if (p < 1 && g.felt) { g.felt = false; g.icon.classList.remove('ready') }
    }
    const end = () => {
      if (!g || g.lock !== 'x') { g = null; return }
      const { msg, icon, dx, m } = g
      g = null
      msg.style.transition = 'transform .28s cubic-bezier(.22,1,.36,1)'
      msg.style.transform = ''
      icon.style.transition = 'opacity .2s'
      icon.style.opacity = '0'
      setTimeout(() => icon.remove(), 250)
      if (dx <= -56) hands.current.setReplyTo(m)
    }
    box.addEventListener('touchstart', start, { passive: true })
    box.addEventListener('touchmove', move, { passive: false })
    box.addEventListener('touchend', end, { passive: true })
    box.addEventListener('touchcancel', end, { passive: true })
    return () => {
      box.removeEventListener('touchstart', start)
      box.removeEventListener('touchmove', move)
      box.removeEventListener('touchend', end)
      box.removeEventListener('touchcancel', end)
    }
  }, [room.room_id])
  const msgList = useMemo(() => shownMsgs.map((m, i) => {
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
          const isTransfer = m.kind === 'file' && m.file?.bucket === TRANSFER_BUCKET
          const isVideo = m.kind === 'file' && !isTransfer && /^video\//.test(m.file?.type || '')
          const isGifFile = m.kind === 'file' && !isTransfer && /gif/.test(m.file?.type || '')
          const vlink = !m.deleted_at && m.kind === 'text' ? videoLinkOf(m.body) : null
          const wide = wideIds.has(m.id)
          const hit = find && found.includes(m.id)
          // a line in the middle when someone turns Encrypted Chat on or off
          if (m.kind === 'system') {
            return (
              <div key={m.id} id={`m-${m.id}`}>
                {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
                <div className="sys-note"><span>{m.body === E2E_OFF ? I.unlock : I.lock}<b>{mine ? 'You' : nameOf(who)}</b><span>{systemText(m.body)}</span><small>{timeOf(m.created_at)}</small><button type="button" className="sys-x" onClick={() => hands.current.hideForMe(m)} aria-label="Delete for Me" title="Delete for Me">{I.x}</button></span></div>
              </div>
            )
          }
          return (
            <div key={m.id} id={`m-${m.id}`}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <div className={`msg${mine ? ' mine' : ''}${first ? ' first' : ''}${new Date(m.created_at).getTime() > bornAt.current - 1500 ? ' fresh' : ''}${flash === m.id ? ' flash' : ''}${isPicked ? ' picked' : ''}${hit ? ' hit' : ''}${!mine && !m.deleted_at && mentionsMe(m.body, me, roles) ? ' at-me' : ''}${wide ? ' wide-media' : ''}`}
                onClick={picked ? () => setPicked((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id])) : (e) => hands.current.onTap(e, m)}
                onDoubleClick={(e) => { clearTimeout(tapTimer.current); if (hands.current.onBubble(e)) hands.current.onDouble(m, e) }}
                onContextMenu={(e) => { if (hands.current.onBubble(e)) hands.current.openMenu(e, m) }}>
                {picked && <span className={`tick${isPicked ? ' on' : ''}`} />}
                {!mine && room.kind === 'group' && prefs.faces && (first ? <Avatar src={who?.avatar_url} name={nameOf(who)} size={30} /> : <span className="av-gap" />)}
                <div className="bubble-col">
                  <div className={`bubble${(m.kind === 'image' || isVideo || isGifFile) && !m.deleted_at ? ' pic' : ''}${isTransfer && !m.deleted_at ? ' transfer-b' : ''}${m.file?.event && !m.deleted_at ? ' event-b' : ''}${m.file?.location && !m.deleted_at ? ' loc-b' : ''}${m.file?.article && !m.deleted_at ? ' art-b' : ''}${m.file?.ordino && !m.deleted_at ? ' art-b ord-b' : ''}${m.deleted_at ? ' gone' : ''}${big ? ' big-emoji' : ''}`}>
                    {!mine && room.kind === 'group' && first && !big && <b className="who" style={{ '--who': colorOf(m.user_id) }}>{nameOf(who)}</b>}
                    {quoted && !quoted.deleted_at && <span className="quote" onClick={(e) => { e.stopPropagation(); hands.current.goTo(quoted.id) }}><b>{quoted.user_id === me.id ? 'You' : nameOf(people[quoted.user_id])}</b><span>{quoted.deleted_at ? 'Message deleted' : textOf(quoted)}</span></span>}
                    {m.deleted_at ? <i>Message deleted</i>
                      : m.file?.location ? <LocationCard loc={m.file.location} onOpen={() => hands.current.setLocView(m.file.location)} />
                      : m.file?.article ? <ArticleCard {...articleOf(m.body)} onOpen={() => hands.current.setArtView(m)} />
                      : m.file?.ordino ? <OrdinoCard o={m.file.ordino} />
                      : m.file?.event ? <EventCard ev={m.file.event} sent={m.created_at} who={title} canJoin={room.kind !== 'group'} onJoin={(v) => hands.current.onCall(v)} />
                      : m.kind === 'image' || isGifFile ? <Pic file={m.file} auto={autoDl} still={isGifFile && prefs.autoplayGifs === false} gif={isGifFile} onOpen={(u) => (isGifFile ? window.open(u, '_blank', 'noopener') : hands.current.openPhoto(m))} />
                      : m.kind === 'voice' ? <AudioNote file={m.file} />
                      : isTransfer ? <TransferTile file={m.file} onCinema={hands.current.setCinema} />
                      : isVideo ? <VideoTile file={m.file} auto={autoDl} play={prefs.autoplayVideos} wide={wide} onWide={() => hands.current.flipWide(m.id)} onCinema={hands.current.setCinema} />
                      : m.kind === 'file' && isAudioFile(m.file) ? <MusicTile file={m.file} from={title} roomId={room.room_id} />
                      : m.kind === 'file' ? <FileTile file={m.file} />
                      : null}
                    {!m.deleted_at && m.body && !m.file?.event && !m.file?.location && !m.file?.article && !m.file?.ordino && <span className="text">{formatText(m.body, withMentions)}</span>}
                    {!m.deleted_at && m.sealed && !m.body && <span className="text sealed-none">{m.locked ? 'Encrypted message. This device has no key for it.' : 'Opening…'}</span>}
                    {vlink && <LinkVideo link={vlink} wide={wide} onWide={() => hands.current.flipWide(m.id)} onCinema={hands.current.setCinema} />}
                    <span className="meta">{m.file?.auto && <i className="auto-mark" title="Sent by auto-reply">Auto-reply · </i>}{m.sealed && !m.deleted_at && <i className="seal-mark" title="Encrypted">{I.lock}</i>}{pinnedSet.has(m.id) && <i className="pin-mark" title="Pinned">{I.pin}</i>}{m.edited_at && !m.deleted_at && 'edited · '}{timeOf(m.created_at)}{mine && !m.deleted_at && <i className={`ticks${seen ? ' seen' : ''}`} title={seen ? `Seen by ${seenBy(m).map((u) => nameOf(people[u])).join(', ')}` : 'Sent'}>{seen ? I.ticks : I.tick1}</i>}</span>
                  </div>
                  {(rx || replyCount[m.id]) && (
                    <span className="rx">
                      {rx && Object.entries(rx).map(([e, v]) => <button key={e} type="button" className={v.mine ? 'on' : ''} title={v.who.map((u) => (u === me.id ? 'You' : nameOf(people[u]))).join(', ')} onClick={(ev) => { ev.stopPropagation(); hands.current.react(m, e) }}>{e}{v.n > 1 && <small>{v.n}</small>}</button>)}
                      {replyCount[m.id] > 0 && <button type="button" className="rx-replies" onClick={(ev) => { ev.stopPropagation(); hands.current.setReplies(m) }}>{I.reply}<small>{replyCount[m.id]}</small></button>}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
  }), [shownMsgs, people, picked, prefs, byId, reactsOf, reads, wideIds, find, found, flash, roles, room, title, autoDl, pinnedSet, replyCount, me]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`room-view${prefs.compact ? ' compact' : ''}`} data-bg={wall} style={{ '--fs': `${TEXT_SIZES[prefs.textSize] || 15.5}px` }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.length) { if (sealOn) setErr('While Encrypted Chat is on, only text can be sent. Turn it off to send photos, files, places and voice messages.'); else setAttach([...e.dataTransfer.files]) } }}>
      <header className="room-head">
        <button type="button" className="round back" onClick={onBack} aria-label="Back" data-back="">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
        {picked ? (
          <div className="head-card head-pick">
            <button type="button" className="link" onClick={() => setPicked(null)}>Cancel</button>
            <strong>{picked.length} selected</strong>
            <span className="head-pick-acts">
              <button type="button" className="round" disabled={!picked.length} onClick={() => copy(pickedMsgs.map(textOf).join('\n'), 'Copied')} title="Copy">{I.copy}</button>
              <button type="button" className="round" disabled={!picked.length || pickedMsgs.some((m) => m.sealed)} onClick={() => setForward(pickedMsgs)} title="Forward">{I.forward}</button>
              <button type="button" className="round danger" disabled={!pickedMsgs.some((m) => m.user_id === me.id)} onClick={() => { remove(pickedMsgs); setPicked(null) }} title="Delete yours">{I.trash}</button>
            </span>
          </div>
        ) : (
          <>
            <button type="button" className="head-card" onClick={onInfo} title="Info">
              {/* the profile picture, large, tilted and faint, behind the name (Alex, 17 Oct) */}
              {(room.kind === 'group' ? room.avatar_url : other?.avatar_url) && <i className="head-bg" aria-hidden="true" style={{ backgroundImage: `url("${room.kind === 'group' ? room.avatar_url : other?.avatar_url}")` }} />}
              <Avatar src={room.kind === 'group' ? room.avatar_url : other?.avatar_url} name={title} size={40} group={room.kind === 'group'} online={onlineNow(other)} />
              <span className="head-text"><strong>{sealOn && <i className="head-lock" title="Encrypted Chat is on">{I.lock}</i>}{title}{official && OFFICIAL}</strong><small>{sub}</small></span>
            </button>
            <button type="button" className="round" onClick={() => onCall(false)} aria-label="Voice call" title="Voice call">{I.phone}</button>
            <button type="button" className="round head-video" onClick={() => onCall(true)} aria-label="Video call" title="Video call">{I.video}</button>
            <button type="button" className="round head-find" onClick={() => { setFind(''); setFindAt(0) }} aria-label="Search in this chat" title="Search in this chat">{I.search}</button>
            {/* on a phone the chat list (with its Tasks button) is another screen, so Tasks is here too */}
            {onTasks && <button type="button" className="round tasks-btn only-phone" onClick={onTasks} aria-label="Tasks" title="Tasks">{I.tasks}{tasksCount > 0 && <i>{tasksCount > 99 ? '99+' : tasksCount}</i>}</button>}
            <span className="plus-wrap">
              <button type="button" className={`round${headMenu ? ' on' : ''}`} onClick={() => { setHeadSub(''); setHeadMenu((v) => !v) }} aria-label="More" title="More">{I.more}</button>
              {headMenu && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setHeadMenu(false)} />
                  <div className="menu head-menu" onMouseLeave={() => setHeadSub('')}>
                    {/* on a phone the search sits here, so the name has room in the head (Alex, 17 Oct) */}
                    <button type="button" className="only-phone" onClick={() => { setHeadMenu(false); setFind(''); setFindAt(0) }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.search}<span>Search</span></button>
                    {room.kind === 'group' && room.role === 'admin' && <button type="button" onClick={() => { setHeadMenu(false); onInfo() }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.edit}<span>Edit</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); onInfo() }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.info}<span>Info</span></button>
                    <button type="button" onClick={() => { setHeadMenu(false); if (sealOn) turnOff(); else askSeal() }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{sealOn ? I.unlock : I.lock}<span>{sealOn ? 'Turn Off Encrypted Chat' : 'Encrypted Chat'}</span></button>
                    {room.muted
                      ? <button type="button" onClick={() => act('mute')} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.bell}<span>Unmute</span></button>
                      : (
                        <div className={`has-sub${headSub === 'mute' ? ' open' : ''}`} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('mute') }}>
                          <button type="button" onClick={() => setHeadSub((s) => (s === 'mute' ? '' : 'mute'))}>{I.bellOff}<span>Mute</span><i className="sub-arrow">{I.right}</i></button>
                          {headSub === 'mute' && (
                            <div className="sub-menu menu-list">
                              {[[1, 'For 1 hour'], [8, 'For 8 hours'], [24, 'For 1 day'], [168, 'For 7 days'], [0, 'Forever']].map(([h, l]) => <button key={h} type="button" onClick={() => act('mute', h)}><span>{l}</span></button>)}
                            </div>
                          )}
                        </div>
                      )}
                    <button type="button" onClick={() => { setHeadMenu(false); onCall(true) }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.video}<span>Video</span></button>
                    {room.kind !== 'group' && <button type="button" onClick={() => { setHeadMenu(false); setSchedOpen(true) }} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.timer}<span>Schedule Call</span></button>}
                    {room.kind !== 'group' && other && <button type="button" onClick={() => { setHeadMenu(false); onNewGroup(other) }}>{I.people}<span>Create Group</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); setMedia(true) }}>{I.image}<span>Photos, videos & files</span></button>
                    {pinned && <button type="button" onClick={() => { setHeadMenu(false); setPinView(true) }}>{I.pin}<span>Pinned messages</span></button>}
                    {!sealOn && !editing && <button type="button" onClick={() => { setHeadMenu(false); setSchedNew(true) }}>{I.timer}<span>Schedule Message</span></button>}
                    {room.kind === 'group' && <button type="button" onClick={() => { setHeadMenu(false); setRolesOpen(true) }}>{I.people}<span>Roles for @mentions</span></button>}
                    <button type="button" onClick={() => { setHeadMenu(false); setWallPick(true) }}>{I.brush}<span>Change Wallpaper</span></button>
                    <button type="button" onClick={exportChat} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.file}<span>Export Chat History…</span></button>
                    <hr />
                    <div className={`has-sub${headSub === 'auto' ? ' open' : ''}`} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('auto') }}>
                      <button type="button" onClick={() => setHeadSub((s) => (s === 'auto' ? '' : 'auto'))}>{I.timer}<span>Auto-Delete Messages</span><i className="sub-arrow">{I.right}</i></button>
                      {headSub === 'auto' && (
                        <div className="sub-menu menu-list">
                          {[[null, 'Off'], [24, 'After 1 day'], [168, 'After 1 week'], [720, 'After 1 month']].map(([h, l]) => <button key={l} type="button" onClick={() => setAutoDelete(h)}><span>{l}</span>{(room.auto_delete_hours || null) === h && <i className="sub-check">{I.check}</i>}</button>)}
                          <p className="sub-note">{room.kind === 'group' ? 'Admins choose, for everyone in the group' : 'For both of you'}</p>
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={() => act('clear')} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeadSub('') }}>{I.clear}<span>Clear Chat History</span></button>
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
        <div className="pinbar" role="button" tabIndex={0} onClick={() => setPinView(true)} title="All pinned messages">
          <span className="pinbar-main"><b>{pinnedList.length > 1 ? `Pinned messages · ${pinnedList.length}` : 'Pinned message'}</b><span>{textOf(pinned)}</span></span>
          <span className="pinbar-ico">{I.pin}{pinnedList.length > 1 && <i>{pinnedList.length}</i>}</span>
        </div>
      )}

      <div className={`scroll${picked ? ' picking' : ''}`} ref={scrollRef} onScroll={onScroll}>
        {!shownMsgs.length && <p className="empty">{room.kind === 'group' ? 'No messages yet.' : `No messages with ${title} yet. Say hi.`}</p>}
        {msgList}
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
                      {o.big && <em className="tr-tag">{I.transfer}<span>RoarTransfer</span></em>}
                      <b>{o.name}</b>
                      <small>{o.stage === 'shrink' ? `Making it smaller · ${Math.round(o.p * 100)}%` : o.stage === 'prep' ? 'Preparing…' : o.stage === 'send' ? 'Sending…' : `${Math.round(o.p * 100)}% · ${fmtBytes(o.size * o.p)} of ${fmtBytes(o.size)}`}</small>
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
        {sealOn && (
          <div className={`e2e-bar${keyOk ? '' : ' no-key'}`}>
            <i className="e2e-ico">{I.lock}</i>
            <span className="e2e-text"><b>Encrypted Chat</b><small>{keyOk ? 'Only the devices in this chat can read what is written now.' : 'This device has no key for it, so it cannot read or write here while it is on.'}</small></span>
            <button type="button" className="btn e2e-off" onClick={turnOff} title="Turn off Encrypted Chat">{I.unlock}<span>Turn off</span></button>
          </div>
        )}
        {askForMe.length > 0 && (() => {
          const a = askForMe[0]
          const m = msgs.find((x) => x.id === a.message_id)
          return (
            <div className="ask-bar">
              <button type="button" className="ask-text" onClick={() => goTo(a.message_id)}>
                <b>{nameOf(people[a.asked_by])} asks to delete your message{askForMe.length > 1 ? ` (1 of ${askForMe.length})` : ''}</b>
                <span>{m ? textOf(m) : ''}</span>
              </button>
              <button type="button" className="btn" onClick={() => answerAsk(a, false)}>Decline</button>
              <button type="button" className="btn btn-main" onClick={() => answerAsk(a, true)}>Accept</button>
            </div>
          )
        })()}
        {mentionHits.length > 0 && (
          <div className="mention-pick">
            {mentionHits.map((h) => <button key={h.key} type="button" onMouseDown={(e) => { e.preventDefault(); pickMention(h) }}>{h.special ? <span className="mention-at">@</span> : <Avatar src={h.p.avatar_url} name={h.label} size={28} />}<b>{h.label}</b><small>{h.sub}</small></button>)}
          </div>
        )}
        {rec ? (
          <div className="compose rec">
            <span className="rec-dot" />
            <b>{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, '0')}</b>
            <LiveWave stream={rec.stream} />
            <button type="button" className="round danger" onClick={() => stopVoice(false)} aria-label="Throw away" title="Throw away">{I.trash}</button>
            <button type="button" className="round send ready" onClick={() => stopVoice(true)} aria-label="Send" title="Send">{I.send}</button>
          </div>
        ) : (
          <div className="compose">
            {!editing && !sealOn && <button type="button" className="round" onClick={() => setAttach([])} aria-label="Photo, video or file" title="Photo, video or file">{I.clip}</button>}
            {!editing && !sealOn && <button type="button" className="round compose-transfer" onClick={() => setTransferOpen(true)} aria-label="RoarTransfer" title="RoarTransfer: big files as they are, up to 3 GB, kept 3 days">{I.transfer}</button>}
            {/* Roardino beside the clip on a computer (Alex, 18 Oct); on a phone it waits in the clip, like RoarTransfer */}
            {!editing && !sealOn && <button type="button" className="round compose-ordino" onClick={() => setOrdOpen(true)} aria-label="Ordino" title="Ordino: make or pick a call sheet in Roardino and send it here">{I.ordino}</button>}
            <span className={`compose-box${replyTo || editing ? ' has-ref' : ''}`}>
              {sel && (
                <span className="fmt-bar" role="toolbar" aria-label="Format" onMouseDown={(e) => e.preventDefault()}>
                  {FMT_MARKS.map(([mark, label, face, keys]) => (
                    <button key={mark} type="button" className={hasMark(text, sel.a, sel.b, mark) ? 'on' : ''} onClick={() => applyMark(mark)} aria-label={label} title={`${label} (${keys})`}>{face}</button>
                  ))}
                </span>
              )}
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
                onSelect={(e) => readSel(e.currentTarget)} onBlur={() => setSel(null)}
                onPaste={(e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); if (sealOn) setErr('While Encrypted Chat is on, only text can be sent. Turn it off to send photos, files, places and voice messages.'); else setAttach(f) } }}
                disabled={!!sealOn && !keyOk} placeholder={sealOn ? 'Encrypted message…' : 'Write a message…'} />
              {(bigBox || tall) && <button type="button" className="compose-grow" onMouseDown={(e) => e.preventDefault()} onClick={() => { setBigBox((v) => !v); inputRef.current?.focus() }} aria-label={bigBox ? 'Smaller' : 'Bigger'} title={bigBox ? 'Smaller' : 'Bigger'}>{bigBox ? GROW_OFF : GROW_ON}</button>}
              {sched.list.length > 0 && <button type="button" className="sched-btn" onClick={() => setSchedList(true)} aria-label="Scheduled Messages" title="Scheduled Messages">{I.timer}<i>{sched.list.length}</i></button>}
              <button type="button" className="emoji-btn" onClick={() => setEmoji((v) => !v)} aria-label="Emoji" title="Emoji">{I.smile}</button>
              {emoji && <EmojiPicker onPick={addEmoji} onClose={() => setEmoji(false)} />}
            </span>
            {text.trim() || editing || sealOn
              ? <button type="button" className={`round send${text.trim() || editing ? ' ready' : ''}`}
                  onClick={() => { if (held.current) { held.current = false; return } send() }}
                  onContextMenu={(e) => { if (canSched) { e.preventDefault(); clearTimeout(holdT.current); setSchedNew(true) } }}
                  onPointerDown={() => { held.current = false; clearTimeout(holdT.current); if (canSched) holdT.current = setTimeout(() => { held.current = true; setSchedNew(true) }, 450) }}
                  onPointerUp={() => clearTimeout(holdT.current)} onPointerLeave={() => clearTimeout(holdT.current)}
                  aria-label={editing ? 'Save' : 'Send'} title={editing ? 'Save (Enter)' : 'Send (Enter) · hold to schedule'}>{editing ? I.check : I.send}</button>
              : <button type="button" className="round" onClick={() => (canVoice ? startVoice() : setErr('This browser cannot record voice messages.'))} aria-label="Voice message" title="Voice message">{I.mic}</button>}
          </div>
        )}
      </footer>
      )}

      {schedNew && <ScheduleMessage body={text.trim()} onClose={() => setSchedNew(false)} onSave={scheduleIt} />}
      {schedEdit && <ScheduleMessage item={schedEdit} onClose={() => setSchedEdit(null)} onSave={async (v) => { const e = await sched.move(schedEdit.id, v); if (!e) { setSchedEdit(null); toast(`Scheduled for ${whenText(v.at.toISOString())}`) } return e }} />}
      {remindFor && <RemindMe preview={textOf(remindFor)} onClose={() => setRemindFor(null)} onSave={async (at) => { const e = await addReminder(room.room_id, remindFor.id, at); if (!e) { setRemindFor(null); toast(`Reminder set for ${whenText(at.toISOString())}`) } return e }} />}
      {rolesOpen && <RolesWindow room={room} roles={roles} people={people} me={me} toast={toast} onClose={() => setRolesOpen(false)} />}
      {schedList && !schedEdit && <ScheduledList sched={sched} toast={toast} onEdit={setSchedEdit} onClose={() => setSchedList(false)} />}

      {menu && (
        <OnTop>
          <button type="button" className="scrim blur" aria-label="Close" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="msg-menu" style={{ left: menu.x, top: menu.y }}>
            <div className="rx-pick">{REACTIONS.map((e) => <button key={e} type="button" className={reactsOf[menu.m.id]?.[e]?.mine ? 'on' : ''} onClick={(ev) => { if (!reactsOf[menu.m.id]?.[e]?.mine) burst(e, ev.clientX, ev.clientY); react(menu.m, e) }}>{e}</button>)}</div>
            <div className="menu-list">
              <button type="button" onClick={() => { setReplyTo(menu.m); setMenu(null) }}>{I.reply}<span>Reply</span></button>
              {menu.m.body && !menu.m.sealed && <button type="button" onClick={() => { translate(menu.m.body); setMenu(null) }}>{I.translate}<span>Translate</span></button>}
              {menu.m.body && <button type="button" onClick={() => { copy(prefs.copyFormat === false ? plainText(menu.m.body) : menu.m.body, 'Text copied'); setMenu(null) }}>{I.copy}<span>Copy Text</span></button>}
              <button type="button" onClick={() => { copy(linkOf(menu.m), 'Link copied'); setMenu(null) }}>{I.link}<span>Copy Message Link</span></button>
              {(menu.m.kind === 'image' || /^video\//.test(menu.m.file?.type || '')) && <button type="button" onClick={async () => { const m = menu.m; setMenu(null); if (m.kind === 'image') openPhoto(m); else { const u = await fileLink(m.file); if (u) setViewer({ items: [{ url: u, type: m.file?.type, name: m.file?.name }], index: 0 }) } }}>{I.download}<span>Save {menu.m.kind === 'image' ? 'Image' : 'Video'}</span></button>}
              {replyCount[menu.m.id] > 0 && <button type="button" onClick={() => { setReplies(menu.m); setMenu(null) }}>{I.reply}<span>View {replyCount[menu.m.id]} {replyCount[menu.m.id] === 1 ? 'Reply' : 'Replies'}</span></button>}
              <hr />
              {canEdit(menu.m) && !menu.m.file?.event && !menu.m.file?.location && !menu.m.file?.ordino && <button type="button" onClick={() => { if (menu.m.file?.article) setArtOpen(menu.m); else { setEditing(menu.m); setText(menu.m.body) } setMenu(null) }}>{I.edit}<span>Edit</span></button>}
              <button type="button" onClick={() => pin(menu.m)}>{I.pin}<span>{pinnedSet.has(menu.m.id) ? 'Unpin' : 'Pin'}</span></button>
              <button type="button" onClick={() => { setRemindFor(menu.m); setMenu(null) }}>{I.bell}<span>Remind Me</span></button>
              {!menu.m.sealed && <button type="button" onClick={() => { setForward([menu.m]); setMenu(null) }}>{I.forward}<span>Forward</span></button>}
              <button type="button" onClick={() => { setPicked([menu.m.id]); setMenu(null) }}>{I.select}<span>Select</span></button>
              <hr />
              <button type="button" onClick={() => hideForMe(menu.m)}>{I.trash}<span>Delete for Me</span></button>
              {menu.m.user_id && menu.m.user_id !== me.id && (askedByMe.has(menu.m.id)
                ? <button type="button" disabled>{I.timer}<span>Waiting for {nameOf(people[menu.m.user_id])}</span></button>
                : <button type="button" className="danger" onClick={() => askDelete(menu.m)}>{I.trash}<span>Ask to Delete for Everyone</span></button>)}
              {menu.m.user_id === me.id && (
                <>
                  <hr />
                  <div className="menu-seen">
                    <i className="ticks seen">{I.ticks}</i>
                    <span>{room.kind === 'direct' ? (seenBy(menu.m).length ? 'Seen' : 'Not seen yet') : `${seenBy(menu.m).length} Seen`}</span>
                    <span className="menu-faces">{seenBy(menu.m).slice(0, 3).map((u) => <Avatar key={u} src={people[u]?.avatar_url} name={nameOf(people[u])} size={22} />)}</span>
                  </div>
                  <hr />
                  <button type="button" className="danger" onClick={() => { if (window.confirm('Delete this message for everyone?')) remove([menu.m]); setMenu(null) }}>{I.trash}<span>Delete for Everyone</span></button>
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
      {sealAsk && (
        <Modal title="Encrypted Chat" onClose={() => setSealAsk(null)}
          foot={<><button type="button" className="btn" onClick={() => setSealAsk(null)}>Cancel</button><button type="button" className="btn btn-main" disabled={!!sealAsk.busy || sealAsk.missing === null} onClick={turnOn}>{I.lock}<span>{sealAsk.busy ? 'Turning on…' : 'Turn on'}</span></button></>}>
          <div className="inst">
            <p className="inst-lead">End-to-end encryption for this chat. While it is on, what is written is locked on the device before it is sent, and only the devices of the people in this chat can open it. Not even RoarMe's server can read it.</p>
            <ul className="inst-steps">
              <li><i>{I.unlock}</i><span><b>On for a while</b><small>Turn it off whenever you like and the chat goes back to normal. What was sent while it was on stays locked.</small></span></li>
              <li><i>{I.devices}</i><span><b>These devices only</b><small>The computers, phones and browsers each of you uses now. A device added later cannot read these messages.</small></span></li>
              <li><i>{I.chats}</i><span><b>Text only, for now</b><small>Photos, files, places and voice messages wait until it is off. Calls work as always.</small></span></li>
            </ul>
            {sealAsk.missing?.length > 0 && (
              <p className="e2e-warn">{I.info}<span><b>{sealAsk.missing.map((id) => nameOf(people[id])).join(', ')}</b><small>Not on the new RoarMe yet, so they cannot read these messages. Ask them to open RoarMe first, then turn it on.</small></span></p>
            )}
          </div>
        </Modal>
      )}
      {attach && <AttachSheet initial={attach} onClose={() => setAttach(null)} onSend={sendFiles} onTransfer={() => { setAttach(null); setTransferOpen(true) }} onLocation={() => { setAttach(null); setLocOpen(true) }} onArticle={() => { setAttach(null); setArtOpen(true) }} onOrdino={() => { setAttach(null); setOrdOpen(true) }} />}
      {ordOpen && <RoardinoSheet onClose={() => setOrdOpen(false)} onSend={(o) => sendCard(ordinoBody(o), { ordino: o }, 'Ordino sent', () => setOrdOpen(false))} />}
      {transferOpen && <TransferWindow title={title} outbox={outbox} onStart={(files, note, hooks) => sendFiles(files, note, false, true, hooks)} onClose={() => setTransferOpen(false)} />}
      {media && <SharedMedia roomId={room.room_id} onClose={() => setMedia(false)} onOpen={async (list, index) => { setMedia(false); const items = await Promise.all(list.map(async (x) => ({ url: await fileLink(x.file), type: x.file?.type, name: x.file?.name }))); setViewer({ items, index }) }} />}
      {wallPick && (
        <Modal title="Chat wallpaper" onClose={() => setWallPick(false)} foot={<><button type="button" className="btn" onClick={() => { setPrefs({ background: wall }); setWalls({}); setWallPick(false); toast('Wallpaper set for all chats') }}>Use for all chats</button><button type="button" className="btn btn-main" onClick={() => setWallPick(false)}>Done</button></>}>
          <p className="muted">For this chat only, on this computer.</p>
          <WallTiles value={wall} onPick={(k) => setWalls((w) => ({ ...w, [room.room_id]: k }))} />
        </Modal>
      )}
      {schedOpen && <ScheduleCall who={title} onClose={() => setSchedOpen(false)} onSend={(event) => sendCard(event.title, { event }, 'Call scheduled', () => setSchedOpen(false))} />}
      {locOpen && <LocationPicker onClose={() => setLocOpen(false)} onSend={(location) => sendCard(location.name, { location }, '', () => setLocOpen(false))} />}
      {locView && <LocationView loc={locView} onClose={() => setLocView(null)} />}
      {artOpen && (
        <ArticleEditor initial={artOpen === true ? null : articleOf(artOpen.body)}
          onClose={() => setArtOpen(null)}
          onSend={async ({ title: t, text: x }) => {
            const body = `${t}\n\n${x}`
            if (artOpen === true) return sendCard(body, { article: { v: 1 } }, '', () => setArtOpen(null))
            const edited = new Date().toISOString()
            const { error } = await supabase.from('roar_messages').update({ body, edited_at: edited }).eq('id', artOpen.id)
            if (error) { setErr(errText(error)); return false }
            setMsgs((list) => list.map((y) => (y.id === artOpen.id ? { ...y, body, edited_at: edited } : y)))
            setArtOpen(null)
            return true
          }} />
      )}
      {artView && <ArticleReader {...articleOf(artView.body)} who={artView.user_id === me.id ? 'You' : nameOf(people[artView.user_id])} at={artView.created_at} plain={withMentions} onClose={() => setArtView(null)} />}
      {pinView && (
        <Modal title={pinnedList.length === 1 ? '1 pinned message' : `${pinnedList.length} pinned messages`} onClose={() => setPinView(false)}
          foot={pinnedList.length > 1 ? <button type="button" className="btn btn-danger pins-all" onClick={unpinAll}>{I.pin}<span>Unpin all</span></button> : null}>
          {!pinnedList.length && <p className="empty">Nothing pinned yet. Pin a message from its menu.</p>}
          {pinnedList.some(isPinFile) && (
            <div className="squick pin-tabs">
              <button type="button" className={pinTab === 'all' ? 'on' : ''} onClick={() => setPinTab('all')}>All · {pinnedList.length}</button>
              <button type="button" className={pinTab === 'files' ? 'on' : ''} onClick={() => setPinTab('files')}>Files · {pinnedList.filter(isPinFile).length}</button>
            </div>
          )}
          <div className="pins">
            {[...pinnedList].reverse().filter((m) => pinTab !== 'files' || isPinFile(m)).map((m) => {
              const who = people[m.user_id]
              return (
                <div key={m.id} className="pin-row" role="button" tabIndex={0} onClick={() => { setPinView(false); goTo(m.id) }}>
                  <Avatar src={who?.avatar_url} name={nameOf(who)} size={34} />
                  <span className="pin-text">
                    <span className="pin-top"><b>{m.user_id === me.id ? 'You' : nameOf(who)}</b><small>{dayLabel(m.created_at)} · {timeOf(m.created_at)}</small></span>
                    <span className="pin-body">{m.kind === 'text' ? formatText(m.body) : <>{m.kind === 'image' ? '📷 ' : m.kind === 'voice' ? '🎤 ' : '📎 '}{textOf(m)}</>}</span>
                  </span>
                  <button type="button" className="pin-un" onClick={(e) => { e.stopPropagation(); pin(m) }} aria-label="Unpin" title="Unpin">{I.x}</button>
                </div>
              )
            })}
          </div>
        </Modal>
      )}
      {forward && <Forward msgs={forward} me={me} rooms={rooms} titleOf={titleOf} fromRoom={room.room_id} onClose={() => setForward(null)} onDone={(n) => { setForward(null); setPicked(null); toast(n > 1 ? `${n} messages forwarded` : 'Forwarded') }} />}
      {viewer && <OnTop><MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} /></OnTop>}
      {cinema && <OnTop><Cinema item={cinema} onClose={() => setCinema(null)} /></OnTop>}
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
        const { error } = await supabase.storage.from(file.bucket || 'roar-files').copy(file.path, to)
        if (error) { setErr(errText(error)); continue }
        file = { ...file, path: to, ...(file.bucket ? { expires: new Date(Date.now() + TRANSFER_DAYS * 864e5).toISOString() } : {}) }
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
  useEffect(() => { if (!go) return undefined; let alive = true; fileLink(file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [file?.path, go])
  if (!go) return <button type="button" className="load-tap" onClick={(e) => { e.stopPropagation(); setGo(true) }}>{gif ? I.play : I.image}<span>{gif ? 'GIF' : 'Photo'} · {fmtBytes(file?.size)}</span><small>Tap to {gif ? 'play' : 'load'}</small></button>
  return url ? <img className={`pic-img${ready ? ' ready' : ''}`} src={url} alt={file?.name || ''} loading="lazy" decoding="async" onLoad={() => setReady(true)} onClick={(e) => { e.stopPropagation(); onOpen(url) }} /> : <span className="pic-wait" />
}

function FileTile({ file }) {
  const open = async () => { const u = await fileLink(file); if (u) window.open(u, '_blank', 'noopener') }
  return (
    <button type="button" className="file" onClick={open} title="Open">
      <span className="file-ico">{I.file}</span>
      <span className="file-text"><b>{file?.name}</b><small>{fmtBytes(file?.size)}</small></span>
    </button>
  )
}

/* the format bar's buttons: the mark, its name, what the button shows, its keys */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+'
/* the line while recording (Alex, 17 Oct: "can it really read the sound? and more minimal"): the microphone's real
   loudness, one thin bar every 80 ms sliding in from the right; silence is a row of dots */
function LiveWave({ stream }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    const AC = window.AudioContext || window.webkitAudioContext
    if (!cv || !stream || !AC) return undefined
    const ac = new AC()
    const an = ac.createAnalyser()
    an.fftSize = 1024
    ac.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    const levels = []
    let raf = 0
    let last = 0
    let peak = 0
    const draw = (t) => {
      raf = requestAnimationFrame(draw)
      an.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; sum += x * x }
      peak = Math.max(peak, Math.sqrt(sum / buf.length))
      if (t - last < 80) return
      last = t
      levels.push(Math.min(1, Math.sqrt(peak) * 1.7))
      peak = 0
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const g = cv.getContext('2d')
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = getComputedStyle(cv).color
      const step = 5
      while (levels.length > Math.floor(w / step)) levels.shift()
      levels.forEach((l, i) => {
        const bh = Math.max(2, Math.round(l * h))
        const x = w - (levels.length - i) * step
        g.beginPath()
        g.roundRect ? g.roundRect(x, (h - bh) / 2, 2, bh, 1) : g.rect(x, (h - bh) / 2, 2, bh)
        g.fill()
      })
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ac.close().catch(() => {}) }
  }, [stream])
  return <canvas ref={ref} className="rec-wave" role="img" aria-label="Recording…" />
}

const FMT_MARKS = [
  ['**', 'Bold', <b key="b">B</b>, `${MOD}B`],
  ['_', 'Italic', <i key="i">I</i>, `${MOD}I`],
  ['__', 'Underline', <u key="u">U</u>, `${MOD}U`],
  ['~~', 'Strikethrough', <s key="s">S</s>, `${MOD}Shift+X`],
  ['`', 'Code', <span key="c" className="fmt-mono">{'</>'}</span>, `${MOD}E`],
  ['||', 'Spoiler', <span key="p" className="fmt-blur">Aa</span>, `${MOD}Shift+P`],
]

/* RoarTransfer: a big file kept 3 days, then gone; Download saves it under its own name, a video can play
   with the lights off */
const SMALL_MAX = 50e6
function TransferTile({ file, onCinema }) {
  // a fresher card (Alex, 17 Oct): no file name; the RoarTransfer mark big on top with the time left, the size as the
  // headline with the file's kind, a thin line that empties as the 3 days run out, then Download, link and Play
  const left = new Date(file?.expires || 0).getTime() - Date.now()
  const gone = left <= 0
  const short = gone ? 'Expired' : left > 864e5 ? `${Math.ceil(left / 864e5)} days left` : left > 36e5 ? `${Math.ceil(left / 36e5)} h left` : 'Last hour'
  const share = gone ? 0 : Math.min(1, left / (TRANSFER_DAYS * 864e5))
  const type = file?.type || ''
  const isVid = /^video\//.test(type)
  const kind = isVid ? 'Video' : /^image\//.test(type) ? 'Image' : /^audio\//.test(type) ? 'Audio' : /pdf|word|document|text|sheet|presentation/.test(type) ? 'Document' : 'File'
  const ext = ((file?.name || '').match(/\.(\w{1,5})$/) || [])[1]?.toUpperCase()
  const [busy, setBusy] = useState(false)
  const get = async (e) => {
    e.stopPropagation(); setBusy(true)
    const u = await fileLink(file, file?.name || 'file')
    setBusy(false)
    if (u) { const a = document.createElement('a'); a.href = u; a.download = file?.name || ''; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove() }
  }
  const play = async (e) => { e.stopPropagation(); const u = await fileLink(file); if (u) onCinema({ kind: 'file', src: u, at: 0 }) }
  return (
    <span className={`file transfer trx${gone ? ' gone' : left < 864e5 ? ' soon' : ''}`} onClick={(e) => e.stopPropagation()}>
      {/* the mark centred on top (Alex, 17 Oct); the days left sit beside the line that empties */}
      <span className="trx-head"><TransferMark /></span>
      <span className="trx-hero">
        <i className="trx-type">{isVid ? I.play : kind === 'Image' ? I.image : I.file}</i>
        <span className="trx-size"><b>{fmtBytes(file?.size)}</b><small>{ext ? `${ext} · ${kind}` : kind}</small></span>
      </span>
      <span className="trx-timeline">
        <span className="trx-time" title={short}><i style={{ width: `${share * 100}%` }} /></span>
        <span className="trx-left">{I.timer}<span>{short}</span></span>
      </span>
      {!gone && (
        <span className="trx-acts">
          <button type="button" className="trx-get" disabled={busy} onClick={get}>{I.download}<span>{busy ? 'Opening…' : 'Download'}</span></button>
          <CopyLink file={file} round />
          {isVid && onCinema && <button type="button" className="trx-round" onClick={play} title="Play" aria-label="Play">{I.play}</button>}
        </span>
      )}
    </span>
  )
}

const GROW_ON = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></svg>
const GROW_OFF = <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4" /></svg>

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
