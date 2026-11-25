// RoarMail inside RoarMe (Alex, 24 Nov). A switch only Alex sees (Settings, inThemeLab), kept on this device; on, the gold
// ROARMAIL folder joins the folder bar. Its inside in three steps, as RoarMail on the Mac (sample
// https://claude.ai/artifact/SodwiHjKHvXDTjZmKjTTAU, "Μ' αρέσει, ξεκίνα"): 1 the accounts (All Inboxes, then each account
// with its picture and address), 2 an account's folders (Inbox, Drafts, Sent, Junk, Trash, Archive, then its own), 3 the
// folder's mails, and a mail opens over them. The accounts and folders come from the Roar Account (roarmail_sync, which
// RoarMail on the computer keeps); the mail itself is read through RoarMe's Edge Function roarmail-cloud, for the
// accounts sent there with RoarMail's Send to RoarMe (their passwords locked in Supabase Vault).
import { stayGet, staySet } from './stay.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SUPABASE_KEY, SUPABASE_URL, haptic, supabase } from './lib.js'
import { Avatar, I, Modal } from './ui.jsx'
import { entryName, keptBook } from './book.jsx'
import { onPhone } from './push.js'
import { dropKv, keepKv, keptKv, lsGet, lsSet, readKv } from './cache.js'

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
  conv: s(<path d="M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8.5z" />),
  day: s(<><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></>),
  sort: s(<path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3" />),
  sender: s(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-3.6 3.8-5.5 7-5.5s6 1.9 7 5.5" /></>),
  compose: s(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  reply: s(<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4" />),
  replyAll: s(<><path d="M12 14 7 9l5-5M7 9h7a6 6 0 0 1 6 6v4" /><path d="M7 14 2 9l5-5" /></>),
  forward: s(<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0-6 6v4" />),
  move: s(<><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5" /></>),
  block: s(<><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>),
  read: s(<><path d="M3 10l9-6 9 6v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3.5 10.5L12 16l8.5-5.5" /></>),
  x: s(<path d="M6 6l12 12M18 6L6 18" />),
  plus: s(<path d="M12 5v14M5 12h14" />),
  tick: s(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  more: s(<><circle cx="6" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="18" cy="12" r="1.3" /></>),
  grip: s(<path d="M5 9h14M5 15h14" />),
  select: s(<><circle cx="12" cy="12" r="9" /><path d="M8 12.3l2.8 2.8L16.2 9.5" /></>),
  send: s(<><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>),
}
// eight filters, as RoarMail on the Mac (Alex, 24 Nov, version B of https://claude.ai/artifact/Nmb2XBaCTYcECN2sYubCsL):
// one glass capsule as tall as the folder bar, back and the name at the left, the filters at the right, sliding
// no Unread filter: unread mail shows as such anyway (Alex, 25 Nov)
const FILTERS = [['search', 'Search'], ['star', 'Starred'], ['clip', 'With attachments'], ['conv', 'Conversations'], ['day', 'Mail of one day'], ['sort', 'Oldest first'], ['sender', 'Same sender']]
// the folders every account has, in RoarMail's order; for All Inboxes the same, across the accounts
const ROLES = [['inbox', 'Inbox'], ['drafts', 'Drafts'], ['sent', 'Sent'], ['spam', 'Junk'], ['trash', 'Trash'], ['archive', 'Archive']]
const ROLE_I = { inbox: 'inbox', drafts: 'drafts', sent: 'sent', spam: 'spam', trash: 'trash', archive: 'archive', flagged: 'flagged' }

// what RoarMail's home can hold besides All Inboxes and the accounts (Alex, 25 Nov, from Apple Mail's Mailboxes > Edit):
// a folder of every account at once, or All Inboxes looked at one way
const SMART = [
  ['sent', 'All Sent', 'sent', { role: 'sent' }], ['drafts', 'All Drafts', 'drafts', { role: 'drafts' }], ['trash', 'All Trash', 'trash', { role: 'trash' }],
  ['spam', 'All Junk', 'spam', { role: 'spam' }], ['archive', 'All Archive', 'archive', { role: 'archive' }],
  ['flagged', 'Flagged', 'flagged', { role: 'inbox', preset: 'star' }], ['unread', 'Unread', 'unread', { role: 'inbox', preset: 'unread' }],
  ['files', 'Attachments', 'clip', { role: 'inbox', preset: 'clip' }], ['today', 'Today', 'day', { role: 'inbox', preset: 'today' }],
]

// the gold word, as PROJECTS: ROAR bold in gold, MAIL thin in the words' colour
export const MailWord = () => <span className="tab-gold"><b>ROAR</b><i>MAIL</i></span>

/** RoarMail's setup from the Roar Account: the accounts (with their pictures) and their folders */
async function loadSetup() {
  const { data, error } = await supabase.from('roarmail_sync').select('data').maybeSingle()
  if (error) throw error
  const T = data?.data?.tables || {}
  const accounts = (T.accounts || []).filter((a) => a.enabled !== 0 && a.enabled !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((a) => ({ id: String(a.id), email: a.email, name: a.description || a.display_name || a.email.split('@')[0], display: a.display_name || '', color: a.color || '#3aa7e8', avatar: /^data:image\/|^https:\/\//.test(a.avatar || '') ? a.avatar : '' }))
  const folders = (T.folders || []).filter((f) => !f.hidden).map((f) => ({ account: String(f.account_id), path: f.path, name: f.name || f.path.split(f.delimiter || '/').pop(), role: f.role || '' }))
  // the names RoarMail knows for addresses, and who is blocked
  const contacts = {}, blocked = []
  for (const c of T.contacts || []) { const e = String(c.email || '').toLowerCase(); if (!e) continue; if (c.blocked) blocked.push(e); else if (c.name) contacts[e] = c.name }
  // the block list, as RoarMail keeps it: addresses, names from any address, whole domains
  const rules = (T.block_rules || []).filter((r) => r && r.value && ['name', 'domain', 'brand'].includes(r.kind)).map((r) => ({ kind: r.kind, value: String(r.value), label: r.label || String(r.value) }))
  const block = { emails: blocked, names: rules.filter((r) => r.kind === 'name').map((r) => r.value), domains: rules.filter((r) => r.kind === 'domain').map((r) => r.value),
    list: [...blocked.map((e) => ({ kind: 'email', value: e, label: e })), ...rules] }
  // each account's signature (its default identity's), and RoarMail's own settings to start from
  const sigs = Object.fromEntries((T.signatures || []).map((x) => [String(x.id), x.html || '']))
  const signature = {}
  for (const i of T.identities || []) { if (i.signature_id && (i.is_default || !signature[i.account_id])) signature[String(i.account_id)] = sigs[String(i.signature_id)] || '' }
  const settings = Object.fromEntries((T.settings || []).map((x) => [x.key, x.value]))
  return { accounts, folders, contacts, signature, settings: { previewLines: settings.previewLines, threadOrder: settings.threadOrder }, blockedCount: block.list.length, block }
}

// a mail from someone on the block list (the same test as RoarMail on the computer: the address, a whole domain, or the
// sender's name from any address)
const foldName = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ').replace(/["'`«»“”‘’]/g, '').replace(/\s+/g, ' ').trim()
export function isBlocked(from, setup) {
  const b = setup?.block
  if (!b || !from?.address) return false
  const e = String(from.address).toLowerCase(), d = e.split('@')[1] || ''
  if (b.emails.includes(e)) return true
  if (b.domains.some((x) => d === x || d.endsWith(`.${x}`))) return true
  const n = foldName(from.name)
  return n.length >= 3 && b.names.includes(n)
}
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.gr', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'zoho.com', 'yandex.com', 'otenet.gr', 'hol.gr', 'windowslive.com'])
// the sender's domain, only when it can be blocked as a whole (never a mailbox provider like gmail.com)
// a block or an unblock done here is in the kept setup at once, so every other mail of that sender leaves the Inbox now,
// not when RoarMail's list is read again (Alex, 25 Nov: "why does Block Sender not work")
function noteBlock(kind, value, on) {
  const st = lsGet('mail-setup'); if (!st) return
  const v = String(value || '').toLowerCase().trim(); if (!v) return
  const b = st.block || { emails: [], names: [], domains: [], list: [] }
  const key = kind === 'email' ? 'emails' : kind === 'domain' ? 'domains' : kind === 'name' ? 'names' : ''
  const nb = { ...b, list: on ? (b.list.some((x) => x.kind === kind && x.value.toLowerCase() === v) ? b.list : [...b.list, { kind, value: v, label: v }]) : b.list.filter((x) => !(x.kind === kind && x.value.toLowerCase() === v)) }
  if (key) nb[key] = on ? [...new Set([...(b[key] || []), v])] : (b[key] || []).filter((x) => x.toLowerCase() !== v)
  const next = { ...st, block: nb, blockedCount: nb.list.length }
  lsSet('mail-setup', next, 0)
  window.dispatchEvent(new CustomEvent('roarme-mail-setup', { detail: next }))
}
const domainOf = (a) => { const d = String(a?.address || '').toLowerCase().split('@')[1] || ''; return d && !PERSONAL.has(d) && !PERSONAL.has(d.split('.').slice(-2).join('.')) ? d : '' }

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
const sameM = (a, b) => a && b && a.account === b.account && a.path === b.path && a.uid === b.uid
const keyM = (m) => `${m.account}|${m.path}|${m.uid}`

// Settings > ROARMAIL, kept on this phone (Alex, 24 Nov: "the settings of RoarMail in our RoarMail tab")
const PREF_KEY = 'roarme-mail-prefs'
const PREF_START = { images: false, markRead: true, lines: 2, oldest: false, askDelete: false, askBlock: true, signature: true,
  pics: true, quote: true, defAcc: '', countUnread: true, every: 3, autoJunk: true, keep: 150, allHide: [], home: null }
export const mailPrefs = () => { try { return { ...PREF_START, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } } catch { return { ...PREF_START } } }
const setMailPref = (k, v) => {
  const n = { ...mailPrefs(), [k]: v }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(n)) } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent('roarme-mail-prefs', { detail: n }))
}
function usePrefs() {
  const [p, setP] = useState(mailPrefs)
  useEffect(() => { const f = (e) => setP(e.detail); window.addEventListener('roarme-mail-prefs', f); return () => window.removeEventListener('roarme-mail-prefs', f) }, [])
  return p
}

// a sender who is in my contacts shows with the contact's name and picture (Alex, 24 Nov): the address book first (its
// photo, or the RoarMe person it is linked to), then the names RoarMail knows
function useWho(me, people, book, setup) {
  return useMemo(() => {
    const m = new Map()
    for (const [e, n] of Object.entries(setup?.contacts || {})) m.set(e, { name: n, photo: '' })
    for (const e of book || keptBook(me?.id)) {
      const p = e.person && people?.[e.person]
      const photo = e.photo_url || p?.avatar_url || ''
      for (const x of e.emails || []) { const k = String(x.value || '').trim().toLowerCase(); if (k) m.set(k, { name: entryName(e), photo, book: true }) }
    }
    return (a) => {
      const hit = a?.address ? m.get(String(a.address).toLowerCase()) : null
      return { name: hit?.name || nameOf(a), photo: hit?.photo || '', book: !!hit?.book }
    }
  }, [me?.id, people, book, setup])
}

function AccPic({ a, size = 50 }) {
  if (a.id === 'all') return <span className="av av-init rmx-all" style={{ width: size, height: size, '--ia': '#5cc0f2', '--ib': '#3aa7e8' }}>{MAIL_I.inbox}</span>
  return <Avatar src={a.avatar} name={a.name} size={size} />
}

// every head inside ROARMAIL is one capsule, as wide and as tall as the folder bar: back at the left, a small picture
// and the name on one line in the middle, anything else at the right (Alex, 25 Nov: "make the menus alike")
function Crumb({ title, pic, onBack, end }) {
  return (
    <div className="rmx-crumb rmx-cap">
      <button type="button" className="round rmx-hback" onClick={onBack} aria-label="Back" data-back="">{MAIL_I.back}</button>
      <span className="rmx-cw">{pic}<b>{title}</b></span>
      <span className="rmx-cap-end">{end}</span>
    </div>
  )
}

const listCache = new Map()

// ---- kept on the phone (Alex, 24 Nov: "the mail should be on the phone, at least the latest, so it does not load every
// time"): the accounts, folders and counts in localStorage, each list's newest 60 and every mail opened (up to KEEP) in
// IndexedDB; what is kept shows at once and the cloud's answer replaces it when it comes. The newest few of a list are
// fetched ahead, quietly (seen stays as it is), so they open at once too.
const keepMax = () => Number(mailPrefs().keep) || 150
const mailKey = (m) => `mm:${m.account}|${m.path}|${m.uid}`
function keepMail(m, j) {
  const k = mailKey(m)
  keepKv(k, j)
  const list = (lsGet('mail-kept') || []).filter((x) => x !== k)
  list.unshift(k)
  list.slice(keepMax()).forEach((x) => dropKv(x))
  lsSet('mail-kept', list.slice(0, keepMax()), 0)
}
function keepList(ck, val) {
  listCache.set(ck, val)
  keepKv(`ml:${ck}`, { rows: (val.rows || []).slice(0, 60), more: true, page: 0 })
}
let ahead = Promise.resolve()
function fetchAhead(rows) {
  rows.slice(0, 8).forEach((m) => {
    ahead = ahead.then(async () => {
      if (keptKv(mailKey(m)) || await readKv(mailKey(m))) return
      try { const j = await cloud({ action: 'get', account: m.account, path: m.path, uid: m.uid, seen: false }); keepMail(m, j) } catch { /* next time */ }
    })
  })
}

// counts and the newest of every Inbox fetched in the background while RoarMe is open (Alex, 24 Nov: "preload them as
// mail comes, it takes long to load"): at the start, every 3 minutes and when RoarMe comes back to the front. The lists
// are kept on the phone and their newest mails fetched ahead, so a folder and a mail open at once.
let warmAt = 0, warming = null
const inboxItems = (setup, on) => setup.accounts.filter((a) => on.has(a.id)).map((a) => ({ account: a.id, path: setup.folders.find((f) => f.account === a.id && f.role === 'inbox')?.path || 'INBOX' }))
const tell = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }))
export function warmMail(force) {
  if (warming || (!force && Date.now() - warmAt < Math.max(45e3, (Number(mailPrefs().every) || 3) * 60e3 - 30e3))) return warming
  warmAt = Date.now()
  warming = (async () => {
    try {
      const setup = await loadSetup(); lsSet('mail-setup', setup)
      const st = await cloud({ action: 'state' }); const l = (st.accounts || []).map((a) => [a.account_id, a]); lsSet('mail-on', l)
      const items = inboxItems(setup, new Set(l.map(([id]) => id)))
      if (!items.length) return
      const c = await cloud({ action: 'counts', items })
      const counts = {}; for (const it of items) counts[it.account] = c.counts?.[`${it.account}|${it.path}`]?.unseen || 0
      lsSet('mail-counts', counts); tell('roarme-mail-counts', counts)
      const [j, u] = await Promise.all([cloud({ action: 'list', items, limit: 30 }), cloud({ action: 'list', items, limit: 20, unseen: true })])
      const hide = mailPrefs().allHide || [], junkOn = mailPrefs().autoJunk
      const all = (j.items || []).filter((m) => !(junkOn && isBlocked(m.from, setup)))
      for (const it of items) keepList(`${it.account}|${it.path}`, { rows: all.filter((m) => m.account === it.account) })
      keepList('all|inbox', { rows: all.filter((m) => !hide.includes(m.account)) })
      const un = (u.items || []).filter((m) => !hide.includes(m.account) && !(junkOn && isBlocked(m.from, setup))).slice(0, 60)
      keepKv('mu', un); tell('roarme-mail-unread', un)
      fetchAhead(un.length ? un : all)
    } catch { /* next time */ } finally { warming = null }
  })()
  return warming
}
const sumOf = (c) => Object.values(c || {}).reduce((a, n) => a + (n || 0), 0)
/** every account's unread mail, for the app's own Unread (Alex, 24 Nov: "the Unread up at the left shows them all, chats and mails") */
const sumShown = (c) => { const hide = mailPrefs().allHide || []; return sumOf(Object.fromEntries(Object.entries(c || {}).filter(([k]) => !hide.includes(k)))) }
export function useMailUnread(on) {
  const prefs = usePrefs()
  const [n, setN] = useState(() => sumShown(lsGet('mail-counts')))
  useEffect(() => { setN(sumShown(lsGet('mail-counts'))) }, [prefs.allHide])
  useEffect(() => {
    if (!on) return
    const f = (e) => setN(sumShown(e.detail))
    const v = () => { if (document.visibilityState === 'visible') warmMail() }
    window.addEventListener('roarme-mail-counts', f)
    document.addEventListener('visibilitychange', v)
    const t = setInterval(v, (Number(prefs.every) || 3) * 60e3)
    warmMail()
    return () => { window.removeEventListener('roarme-mail-counts', f); document.removeEventListener('visibilitychange', v); clearInterval(t) }
  }, [on, prefs.every])
  return on && prefs.countUnread ? n : 0
}
// a mail tapped in Unread opens in the ROARMAIL folder, at its own Inbox
let pendingOpen = null
export const openMailFromUnread = (m) => { pendingOpen = m; tell('roarme-mail-open', m) }

// a slide right goes one step back, a slide left one step on (Alex, 24 Nov: "swipe right and left in all the mail"); the
// page follows the finger a little and springs back if let go early; fields, the mail's own frame and files are left alone
function useSlide(onRight, onLeft) {
  const g = useRef(null)
  const el = useRef(null)
  const put = (x, ease) => { const n = el.current; if (!n) return; n.style.transition = ease ? 'transform .26s cubic-bezier(.22,1,.36,1)' : 'none'; n.style.transform = x ? `translate3d(${x}px,0,0)` : '' }
  const finish = (gr) => {
    const s = gr.current; gr.current = null
    put(0, true)
    if (!s || s.lock !== 'x') return
    const fast = Math.abs(s.dx || 0) > 30 && Date.now() - s.t < 260
    if (!(Math.abs(s.dx || 0) > 70 || fast)) return
    if (s.dx > 0 && onRight) onRight(); else if (s.dx < 0 && onLeft) onLeft()
  }
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
    onTouchEnd: () => finish(g),
    // the iPhone cancels a touch once it decides the page is being scrolled: the page goes back to its place, never left
    // shifted (Alex, 24 Nov); a slide already well on its way still counts (Alex, 25 Nov: "swipe back does not work")
    onTouchCancel: () => finish(g),
  }
}

// Edit Mailboxes: a tick shows or hides a row on the home, the grip at the right moves it up or down
function HomeEdit({ order, rowOf, isShown, onToggle, onOrder }) {
  const [list, setList] = useState(order)
  const [held, setHeld] = useState('')
  useEffect(() => { if (!held) setList(order) }, [order.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef(null), g = useRef(null)
  const down = (e, k) => {
    e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId)
    const row = e.currentTarget.closest('.rmx-he-row')
    g.current = { k, y: e.clientY, h: row?.offsetHeight || 52 }
    setHeld(k)
  }
  const move = (e) => {
    const s0 = g.current; if (!s0) return
    const dy = e.clientY - s0.y
    if (Math.abs(dy) < s0.h * 0.6) return
    setList((l) => {
      const i = l.indexOf(s0.k), j = i + (dy > 0 ? 1 : -1)
      if (j < 0 || j >= l.length) return l
      const n = [...l]; [n[i], n[j]] = [n[j], n[i]]; return n
    })
    s0.y += dy > 0 ? s0.h : -s0.h
    haptic(6)
  }
  const up = () => { if (!g.current) return; g.current = null; setHeld(''); onOrder(list) }
  return (
    <div ref={box} className="rmx-he" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {list.map(rowOf).filter(Boolean).map((r) => {
        const shown = isShown(r.k)
        return (
          <div key={r.k} className={`rmx-he-row${held === r.k ? ' held' : ''}`}>
            <button type="button" className={`rmx-check${shown ? ' on' : ''}`} onClick={() => onToggle(r.k)} aria-label={shown ? `Hide ${r.name}` : `Show ${r.name}`}>{shown && MAIL_I.tick}</button>
            {r.a ? <AccPic a={r.a} size={34} /> : <span className="av rmx-smart sm">{r.icon}</span>}
            <span className="rmx-he-name">{r.name}</span>
            <span className="rmx-he-grip" onPointerDown={(e) => down(e, r.k)} aria-label={`Move ${r.name}`} role="button" tabIndex={0}>{MAIL_I.grip}</span>
          </div>
        )
      })}
    </div>
  )
}

export function MailView({ me, people, book }) {
  const mprefs = usePrefs()
  const [setup, setSetup] = useState(() => lsGet('mail-setup'))       // null loading · { accounts, folders } · { error }
  const [on, setOn] = useState(() => { const l = lsGet('mail-on'); return l ? new Map(l) : null }) // the accounts RoarMe can read
  const [counts, setCounts] = useState(() => lsGet('mail-counts') || {}) // account id -> unread in its Inbox
  // a mail tapped in the app's Unread opens here, over its account's Inbox
  const [step, setStep] = useState(() => {
    const m = pendingOpen; pendingOpen = null
    return m ? { s: 'list', acc: m.account, role: 'inbox', path: m.path, name: 'Inbox', open: m } : stayGet('mail', { s: 'accs' })
  })
  // a pull to refresh comes back to the same step (an open mail comes back as its folder's list)
  useEffect(() => { const { open: _o, from: _f, ...rest } = step; staySet('mail', rest.s === 'folders' || rest.s === 'list' ? rest : { s: 'accs' }) }, [step]) // accs · folders { acc } · list { acc, role|path, name } · read
  useEffect(() => { const f = (e) => { pendingOpen = null; const m = e.detail; setStep({ s: 'list', acc: m.account, role: 'inbox', path: m.path, name: 'Inbox', open: m }) }; window.addEventListener('roarme-mail-open', f); return () => window.removeEventListener('roarme-mail-open', f) }, [])
  const [fwd, setFwd] = useState(null) // the step a slide right left, so a slide left can go on to it again
  const [editHome, setEditHome] = useState(false)
  useEffect(() => { window.dispatchEvent(new CustomEvent('roarme-mail-edit', { detail: editHome })) }, [editHome])
  useEffect(() => { if (step.s !== 'accs') setEditHome(false) }, [step.s])
  const [compose, setCompose] = useState(null) // { mode: 'new' | 'reply' | 'replyAll' | 'forward', m?, account? }
  const back = (to) => { setFwd(step); setStep(to) }
  // inside ROARMAIL the bar at the foot is Contacts · New Mail · Settings (Alex, 25 Nov); its buttons speak through
  // roarme-mail-cmd, and the step is told back so Contacts can be lit
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    const f = (e) => {
      const what = e.detail?.what, st = stepRef.current
      if (what === 'new') setCompose({ mode: 'new', account: st.acc && st.acc !== 'all' ? st.acc : '' })
      else if (what === 'home') { setFwd(null); setStep({ s: 'accs' }) }
      else if (what === 'edit') { if (st.s !== 'accs') { setFwd(null); setStep({ s: 'accs' }); setEditHome(true) } else setEditHome((v) => !v) }
      else if (what === 'contacts') { if (st.s !== 'contacts') { setFwd(null); setStep({ s: 'contacts', from: st }) } }
    }
    window.addEventListener('roarme-mail-cmd', f)
    return () => window.removeEventListener('roarme-mail-cmd', f)
  }, [])
  useEffect(() => { window.dispatchEvent(new CustomEvent('roarme-mail-step', { detail: step.s })) }, [step.s])
  // the list that holds ROARMAIL never stands sideways (Alex, 25 Nov, iPhone: "they still spill over"): WebKit lets a
  // finger pan a box whose overflow is auto by a few pixels; any sideways scroll there or in its holders goes back to 0
  useEffect(() => {
    const host = document.querySelector('.side .rooms-pager')
    if (!host) return undefined
    const boxes = [host, host.querySelector('.rooms-track'), ...host.querySelectorAll('.rooms')].filter(Boolean)
    const fix = (e) => { const b = e.currentTarget; if (b.scrollLeft) b.scrollLeft = 0 }
    boxes.forEach((b) => { b.scrollLeft = 0; b.addEventListener('scroll', fix, { passive: true }) })
    return () => boxes.forEach((b) => b.removeEventListener('scroll', fix))
  }, [step.s])
  useEffect(() => () => { window.dispatchEvent(new CustomEvent('roarme-mail-step', { detail: '' })); window.dispatchEvent(new CustomEvent('roarme-mail-edit', { detail: false })) }, [])
  const foldSlide = useSlide(() => back({ s: 'accs' }), fwd && fwd.s === 'list' && fwd.acc === step.acc ? () => setStep(fwd) : null)
  const who = useWho(me, people, book, setup)
  useEffect(() => {
    let gone = false
    loadSetup().then((x) => { if (!gone) setSetup(x); lsSet('mail-setup', x) }, (e) => { if (!gone) setSetup((had) => had?.accounts ? had : { error: e.message || 'Could not read RoarMail' }) })
    cloud({ action: 'state' }).then((j) => { const l = (j.accounts || []).map((a) => [a.account_id, a]); lsSet('mail-on', l); if (!gone) setOn(new Map(l)) }, () => { if (!gone) setOn((had) => had || new Map()) })
    const f = (e) => setCounts(e.detail || {})
    const g = (e) => { if (e.detail) setSetup(e.detail) }
    window.addEventListener('roarme-mail-counts', f)
    window.addEventListener('roarme-mail-setup', g)
    return () => { gone = true; window.removeEventListener('roarme-mail-counts', f); window.removeEventListener('roarme-mail-setup', g) }
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
      setCounts(c); lsSet('mail-counts', c); tell('roarme-mail-counts', c)
    }, () => {})
  }, [setup, on])
  // unread in every folder of the account opened (Alex, 24 Nov: "the numbers of the unread on the folders"); for All
  // Inboxes every account's folder of each kind. Asked 30 at a time, kept for the visit.
  const [fcounts, setFcounts] = useState(() => lsGet('mail-fcounts') || {})
  useEffect(() => {
    if (step.s !== 'folders' || !setup?.folders || !on || !on.size) return
    const items = setup.folders.filter((f) => on.has(f.account) && (step.acc === 'all' ? ROLES.some(([r]) => r === f.role) : f.account === step.acc))
      .map((f) => ({ account: f.account, path: f.path }))
    if (!items.length) return
    let gone = false
    for (let i = 0; i < items.length; i += 30) {
      cloud({ action: 'counts', items: items.slice(i, i + 30) }).then((j) => { if (!gone) setFcounts((c) => { const n = { ...c, ...Object.fromEntries(Object.entries(j.counts || {}).map(([k, v]) => [k, v.unseen || 0])) }; lsSet('mail-fcounts', n); return n }) }, () => {})
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
  const total = Object.entries(counts).reduce((x, [id, n]) => x + ((mprefs.allHide || []).includes(id) ? 0 : n), 0) // All Inboxes leaves out the accounts kept out of it
  // New Mail: a round button of the accent at the foot of every step but the open mail (Alex, 24 Nov: "I found nowhere to write a new mail")
  // New Mail is the bar at the foot's middle button inside ROARMAIL (Alex, 25 Nov: the round pencil "totally off")
  const newBtn = null
  const composer = compose && <Compose init={compose} accounts={accounts} on={on} setup={setup} who={who} abook={book || keptBook(me?.id)} onClose={() => setCompose(null)} />

  if (step.s === 'contacts') {
    return <><MailContacts who={who} setup={setup} me={me} people={people} book={book} onBack={() => setStep(step.from && step.from.s !== 'contacts' ? step.from : { s: 'accs' })}
      onWrite={(to) => setCompose({ mode: 'new', to, account: '' })} />{composer}</>
  }
  if (step.s === 'accs') {
    // the home's rows in the order kept (Alex, 25 Nov: "on the home page this must be possible", Apple Mail's Edit):
    // ids 'all', 'acc:<id>' and the SMART ones; what is not in the order yet goes after, shown by default for All
    // Inboxes and the accounts, hidden for the smart ones
    const ids = ['all', ...accounts.map((a) => `acc:${a.id}`), ...SMART.map(([k]) => k)]
    const kept = mprefs.home || { order: [], hide: [] }
    const order = [...kept.order.filter((k) => ids.includes(k)), ...ids.filter((k) => !kept.order.includes(k))]
    const isShown = (k) => (kept.order.includes(k) ? !kept.hide.includes(k) : !SMART.some(([x]) => x === k))
    const rowOf = (k) => {
      if (k === 'all') return { k, a: all, name: all.name, sub: all.email, n: total, go: () => setStep({ s: 'folders', acc: 'all' }) }
      if (k.startsWith('acc:')) {
        const a = accounts.find((x) => `acc:${x.id}` === k); if (!a) return null
        const off = on && !on.has(a.id)
        return { k, a, name: a.name, sub: off ? `${a.email} · not in RoarMe yet` : a.email, n: counts[a.id] || 0, go: () => { if (fwd?.acc !== a.id) setFwd(null); setStep({ s: 'folders', acc: a.id }) } }
      }
      const sm = SMART.find(([x]) => x === k); if (!sm) return null
      return { k, icon: MAIL_I[sm[2]], name: sm[1], sub: sm[3].preset ? 'Across your inboxes' : 'Every account', n: 0, go: () => setStep({ s: 'list', acc: 'all', name: sm[1], ...sm[3] }) }
    }
    const hidden = order.filter((k) => !isShown(k))
    const save = (o, hide) => setMailPref('home', { order: o, hide })
    const toggle = (k) => save(order, isShown(k) ? [...hidden, k] : hidden.filter((x) => x !== k))
    return (
      <div className="rmx rmx-accl">
        {editHome ? <HomeEdit order={order} rowOf={rowOf} isShown={isShown} onToggle={toggle} onOrder={(o) => save(o, hidden)} />
          : order.filter(isShown).map(rowOf).filter(Boolean).map((r) => (
            <button key={r.k} type="button" className="room rmx-accrow" onClick={r.go}>
              {r.a ? <AccPic a={r.a} /> : <span className="av rmx-smart">{r.icon}</span>}
              <span className="room-main">
                <span className="room-top"><strong>{r.name}</strong></span>
                <span className="room-bottom"><span className="room-prev">{r.sub}</span>{r.n > 0 && <span className="badge">{r.n}</span>}</span>
              </span>
              <i className="rmx-chev">{MAIL_I.chev}</i>
            </button>
          ))}
        {newBtn}{composer}
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
        <Crumb title={acc.name} pic={<AccPic a={acc} size={26} />} onBack={() => back({ s: 'accs' })} />
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
        {newBtn}{composer}
      </div>
    )
  }

  // which folders of which accounts this list reads: one folder, or for All Inboxes every account's folder of that role
  const targets = acc.id === 'all'
    ? accounts.filter((a) => on?.has(a.id) && !(mprefs.allHide || []).includes(a.id)).map((a) => ({ account: a.id, path: setup.folders.find((f) => f.account === a.id && f.role === step.role)?.path })).filter((x) => x.path)
    : [{ account: acc.id, path: step.path }]
  return <>
    <MailList key={`${step.acc}|${step.path || step.role}`} acc={acc} step={step} targets={targets} accounts={accounts} folders={setup.folders} who={who} setup={setup}
      offline={acc.id !== 'all' && on && !on.has(acc.id)} onBack={() => back({ s: 'folders', acc: step.acc })} onCompose={setCompose} newBtn={newBtn} />
    {composer}
  </>
}

// ---- one mail in a list: a slide from the screen's right edge brings out its buttons and they stay out (Alex, 24 Nov:
// "as in the chats: it must catch from the edge of the screen, and stay, not jump away"), a long press its menu --------
const EDGE = 72, ACTS_W = 5 * 64
let openRow = null // the row whose buttons are out: a touch on any other row puts them away first
function MailRow({ m, who, bar, onOpen, onAct, onMenu, count, picking, selOn, checked }) {
  const [x, setX] = useState(0)
  const [drag, setDrag] = useState(false)
  const g = useRef(null), lp = useRef(0), skip = useRef(0), self = useRef(null), row = useRef(null)
  self.current = () => setX(0)
  useEffect(() => () => { clearTimeout(lp.current); if (openRow === self) openRow = null }, [])
  const settle = (open) => { if (open && !x) haptic(8); setDrag(false); setX(open ? -ACTS_W : 0); if (open) openRow = self; else if (openRow === self) openRow = null; skip.current = Date.now() }
  const h = {
    onTouchStart: (e) => {
      if (e.touches.length !== 1 || selOn) return // while picking several, no slide and no long press
      const t = e.touches[0]
      if (openRow && openRow !== self) { openRow.current(); openRow = null; skip.current = Date.now(); g.current = null; e.stopPropagation(); return }
      const ours = t.clientX > window.innerWidth - EDGE || x !== 0
      g.current = { x: t.clientX, y: t.clientY, base: x, nx: x, ours, lock: '', moved: false }
      if (ours) e.stopPropagation() // the page's own slide (back, on) leaves this touch to the row
      clearTimeout(lp.current)
      lp.current = setTimeout(() => {
        const s = g.current
        if (!s || s.moved) return
        g.current = null; skip.current = Date.now(); haptic(12)
        if (x) settle(false)
        onMenu(row.current?.getBoundingClientRect())
      }, 460)
    },
    onTouchMove: (e) => {
      const s = g.current; if (!s) return
      const t = e.touches[0], dx = t.clientX - s.x, dy = t.clientY - s.y
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { s.moved = true; clearTimeout(lp.current) }
      if (!s.ours) return
      if (!s.lock) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'; if (s.lock === 'x') setDrag(true) }
      if (s.lock !== 'x') return
      e.stopPropagation()
      s.nx = Math.max(-ACTS_W - 36, Math.min(0, s.base + dx))
      setX(s.nx)
    },
    onTouchEnd: (e) => {
      clearTimeout(lp.current)
      const s = g.current; g.current = null
      if (!s || !s.ours) return
      e.stopPropagation()
      if (s.lock !== 'x') { if (s.base && !s.moved) settle(false); return } // a tap on an open row puts its buttons away
      settle(s.nx < (s.base ? -ACTS_W * 0.7 : -ACTS_W * 0.28))
    },
    onTouchCancel: () => { clearTimeout(lp.current); const s = g.current; g.current = null; if (s?.ours) settle(s.lock === 'x' ? s.nx < -ACTS_W / 2 : !!s.base) },
  }
  const tap = (k) => { settle(false); onAct(k) }
  const w = who(m.from)
  return (
    <div className={`rmx-sw${x ? ' open' : ''}${drag ? ' drag' : ''}`} style={{ '--sx': `${x}px` }} {...h}>
      <div className="rmx-swacts">
        <button type="button" className="rsa-read" onClick={() => tap('read')} tabIndex={x ? 0 : -1}><i>{m.seen ? MAIL_I.markUnread : MAIL_I.read}</i><span>{m.seen ? 'Unread' : 'Read'}</span></button>
        <button type="button" className="rsa-star" onClick={() => tap('star')} tabIndex={x ? 0 : -1}><i>{m.flagged ? MAIL_I.starF : MAIL_I.star}</i><span>{m.flagged ? 'Unstar' : 'Star'}</span></button>
        <button type="button" className="rsa-move" onClick={() => tap('move')} tabIndex={x ? 0 : -1}><i>{MAIL_I.move}</i><span>Move</span></button>
        <button type="button" className="rsa-block" onClick={() => tap('block')} tabIndex={x ? 0 : -1}><i>{MAIL_I.block}</i><span>Block</span></button>
        <button type="button" className="rsa-trash" onClick={() => tap('trash')} tabIndex={x ? 0 : -1}><i>{MAIL_I.trash}</i><span>Trash</span></button>
      </div>
      <button ref={row} type="button" className={`room rmx-row${m.seen ? '' : ' rmx-un'}${picking ? ' rmx-pickme' : ''}${selOn ? ' rmx-selrow' : ''}${checked ? ' rmx-checked' : ''}`} onContextMenu={(e) => { e.preventDefault(); if (!selOn) onMenu(row.current?.getBoundingClientRect()) }}
        onClick={() => { if (Date.now() - skip.current < 450) return; if (x) { settle(false); return } onOpen() }}>
        {selOn && <i className="rmx-check" aria-hidden="true">{checked && MAIL_I.tick}</i>}
        <Avatar src={w.photo} name={w.name || '?'} size={50} />
        <span className="room-main">
          <span className="room-top"><strong>{w.name || '(no sender)'}</strong>{count > 1 && <em className="rmx-cnt">{count}</em>}<small>{!m.seen && <i className="rmx-udot" />}{m.files > 0 && <i className="rmx-mi">{MAIL_I.clip}</i>}{m.flagged && <i className="rmx-mi rmx-star">{MAIL_I.starF}</i>}{when(m.date)}</small></span>
          <span className="rmx-sub">{m.subject || '(no subject)'}</span>
          <span className="room-bottom"><span className="room-prev rmx-sn">{m.snippet}</span>{!m.seen && <span className="badge dot" />}</span>
        </span>
        {bar && <i className="rmx-abar" style={{ background: bar }} />}
      </button>
    </div>
  )
}

// the long-press menu (Alex, 24 Nov: "a long press gives these and more, as on the desktop"), the app's own menu glass
function MailMenu({ m, at, inJunk, noSelect, onAct, onClose }) {
  const H = 560
  const top = at ? (at.bottom + H + 12 < window.innerHeight ? at.bottom + 6 : Math.max(12, at.top - H - 6)) : 80
  const go = (k) => { onClose(); onAct(k) }
  return createPortal(<>
    <button type="button" className="scrim rmx-lpveil" aria-label="Close" onClick={onClose} />
    <div className="menu rmx-lp" style={{ top, left: 16, right: 'auto', bottom: 'auto' }}>
      {!noSelect && <><button type="button" onClick={() => go('select')}>{MAIL_I.select}<span>Select</span></button><hr /></>}
      <button type="button" onClick={() => go('reply')}>{MAIL_I.reply}<span>Reply</span></button>
      <button type="button" onClick={() => go('replyAll')}>{MAIL_I.replyAll}<span>Reply All</span></button>
      <button type="button" onClick={() => go('forward')}>{MAIL_I.forward}<span>Forward</span></button>
      <hr />
      <button type="button" onClick={() => go('read')}>{m.seen ? MAIL_I.markUnread : MAIL_I.read}<span>{m.seen ? 'Mark as Unread' : 'Mark as Read'}</span></button>
      <button type="button" onClick={() => go('star')}>{m.flagged ? MAIL_I.starF : MAIL_I.star}<span>{m.flagged ? 'Remove Star' : 'Star'}</span></button>
      <button type="button" onClick={() => go('move')}>{MAIL_I.move}<span>Move To</span></button>
      <button type="button" onClick={() => go('archive')}>{MAIL_I.archive}<span>Archive</span></button>
      <button type="button" onClick={() => go('sender')}>{MAIL_I.sender}<span>All From This Sender</span></button>
      <hr />
      {inJunk
        ? <button type="button" onClick={() => go('notjunk')}>{MAIL_I.inbox}<span>Not Junk</span></button>
        : <button type="button" onClick={() => go('junk')}>{MAIL_I.spam}<span>Move to Junk</span></button>}
      <button type="button" className="danger" onClick={() => go('block')}>{MAIL_I.block}<span>Block Sender</span></button>
      {domainOf(m.from) && <button type="button" className="danger" onClick={() => go('domain')}>{MAIL_I.block}<span>{`Block @${domainOf(m.from)}`}</span></button>}
      <button type="button" className="danger" onClick={() => go('trash')}>{MAIL_I.trash}<span>Delete</span></button>
    </div>
  </>, document.body)
}

// Move To: the account's folders, as on the folders page
function MovePick({ m, folders, onPick, onClose }) {
  const mine = folders.filter((f) => f.account === m.account && f.path !== m.path && f.role !== 'flagged')
  const rank = (f) => { const i = ROLES.findIndex(([r]) => r === f.role); return i < 0 ? 99 : i }
  mine.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
  return (
    <Modal title="Move To" onClose={onClose}>
      <div className="rmx-box rmx-movebox">
        {mine.map((f) => (
          <button key={f.path} type="button" className="rmx-fr" onClick={() => onPick(f.path)}>
            {MAIL_I[ROLE_I[f.role] || 'folder']}<span>{ROLES.find(([r]) => r === f.role)?.[1] || f.name}</span><i className="rmx-chev">{MAIL_I.chev}</i>
          </button>
        ))}
      </div>
    </Modal>
  )
}

const reSubj = (s) => String(s || '').replace(/^\s*((re|fw|fwd|απ|σχετ)\s*(\[\d+\])?\s*:\s*)+/i, '').trim().toLowerCase()

function MailList({ acc, step, targets, accounts, folders, who, setup, offline, onBack, onCompose, newBtn }) {
  const prefs = usePrefs()
  const ck = `${acc.id}|${step.path || step.role}`
  const [rows, setRows] = useState(() => listCache.get(ck)?.rows || null)
  const [more, setMore] = useState(() => listCache.get(ck)?.more ?? true)
  const [page, setPage] = useState(() => listCache.get(ck)?.page || 0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState(() => (step.preset === 'today' ? 'day' : step.preset || ''))   // search · unread · star · clip · day · sender (one at a time); a smart mailbox starts with its own
  const [oldest, setOldest] = useState(() => prefs.oldest)
  const [conv, setConv] = useState(false)
  const [thread, setThread] = useState('')   // a conversation opened
  const [q, setQ] = useState('')
  const [day, setDay] = useState(() => (step.preset === 'today' ? new Date().toLocaleDateString('en-CA') : ''))
  const [sender, setSender] = useState(null)
  const [found, setFound] = useState(null)   // { key, rows } from the server for unread, starred, a day, a sender or words
  const [open, setOpen] = useState(() => step.open || null)
  const [menu, setMenu] = useState(null)     // { m, at }
  const [moving, setMoving] = useState(null)
  const [sel, setSel] = useState(null)       // several picked (Alex, 25 Nov: "pick multiple mails and delete or move them in bulk, as on the desktop"): a Set of keys, null when off
  const [flash, setFlash] = useState('')
  const lastOpen = useRef(null)
  const flashT = useRef(0)
  const say = (t) => { setFlash(t); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(''), 2400) }
  const load = async (p = 0) => {
    if (!targets.length) { setRows([]); setMore(false); return }
    setBusy(true); setErr('')
    try {
      const j = await cloud({ action: 'list', items: targets, limit: 30, page: p })
      const errs = Object.values(j.errors || {}).filter((e) => e !== 'missing')
      if (errs.length && !(j.items || []).length) setErr(errs[0])
      const got = j.items || []
      setRows((r) => {
        const next = p === 0 ? got : [...(r || []), ...got.filter((x) => !(r || []).some((y) => sameM(x, y)))]
        const hasMore = Object.entries(j.totals || {}).some(([, t]) => t > 30 * (p + 1))
        keepList(ck, { rows: next, more: hasMore, page: p })
        if (p === 0) fetchAhead(got)
        setMore(hasMore)
        return next
      })
      setPage(p)
    } catch (e) { setErr(e.message || 'Could not read the mail') }
    setBusy(false)
  }
  useEffect(() => {
    if (offline) return
    if (!rows) readKv(`ml:${ck}`).then((v) => { if (v?.rows) setRows((r) => r || v.rows) })
    load(0)
  }, [])
  // what the server is asked to look for: every unread or starred (not only the ones loaded), a day, a sender, words
  const find = filter === 'unread' ? { unseen: true } : filter === 'star' ? { flagged: true } : filter === 'day' && day ? { on: day }
    : filter === 'sender' && sender?.address ? { from: sender.address } : filter === 'search' && q.trim().length >= 2 ? { text: q.trim() } : null
  const findKey = find ? JSON.stringify(find) : ''
  useEffect(() => {
    if (!find || offline || !targets.length) { setFound(null); return }
    let gone = false
    const t = setTimeout(() => {
      setFound((f) => (f?.key === findKey ? f : { key: findKey, rows: null }))
      cloud({ action: 'list', items: targets, limit: 60, find }).then((j) => { if (!gone) setFound({ key: findKey, rows: j.items || [] }) }, (e) => { if (!gone) { setFound({ key: findKey, rows: [] }); setErr(e.message) } })
    }, filter === 'search' ? 550 : 0)
    return () => { gone = true; clearTimeout(t) }
  }, [findKey])
  const colourOf = (id) => accounts.find((a) => a.id === id)?.color
  const base = found?.key === findKey && found.rows ? found.rows : rows || []
  const shown = useMemo(() => {
    let l = base.filter((m) => {
      if (filter === 'unread' && m.seen) return false
      if (filter === 'star' && !m.flagged) return false
      if (filter === 'clip' && !m.files) return false
      if (filter === 'sender' && sender?.address && String(m.from?.address || '').toLowerCase() !== sender.address.toLowerCase()) return false
      if (filter === 'day' && day && new Date(m.date).toLocaleDateString('en-CA') !== day) return false
      const k = filter === 'search' ? q.trim().toLowerCase() : ''
      if (k && !found?.rows && !`${who(m.from).name} ${m.from?.address} ${m.subject} ${m.snippet}`.toLowerCase().includes(k)) return false
      if (thread && reSubj(m.subject) !== thread) return false
      return true
    })
    if (oldest) l = [...l].reverse()
    if (conv && !thread) {
      const seen = new Map()
      for (const m of l) { const k = reSubj(m.subject) || keyM(m); const had = seen.get(k); if (had) had.n++; else seen.set(k, { m, n: 1 }) }
      return [...seen.values()].map((x) => ({ ...x.m, _n: x.n }))
    }
    return l
  }, [base, filter, q, oldest, conv, thread, day, sender, found, who])
  const patchIn = (l, m, p) => (l || []).map((x) => sameM(x, m) ? { ...x, ...p } : x)
  const patch = (m, p) => {
    setRows((r) => { const next = patchIn(r, m, p); keepList(ck, { rows: next, more, page }); return next })
    setFound((f) => f && f.rows ? { ...f, rows: patchIn(f.rows, m, p) } : f)
    setOpen((o) => sameM(o, m) ? { ...o, ...p } : o)
  }
  const drop = (m) => {
    setRows((r) => { const next = (r || []).filter((x) => !sameM(x, m)); keepList(ck, { rows: next, more, page }); return next })
    setFound((f) => f && f.rows ? { ...f, rows: f.rows.filter((x) => !sameM(x, m)) } : f)
    setOpen((o) => sameM(o, m) ? null : o)
  }
  const folderOf = (m, role) => folders.find((f) => f.account === m.account && f.role === role)?.path
  const flag = (m, f, v) => cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: f, on: v })
  // every action on a mail, from its slide, its long press or its own page
  const act = async (k, m) => {
    try {
      if (k === 'read') { const v = !m.seen; patch(m, { seen: v }); await flag(m, 'seen', v) }
      else if (k === 'star') { const v = !m.flagged; patch(m, { flagged: v }); await flag(m, 'flagged', v) }
      else if (k === 'move') setMoving(m)
      else if (k === 'archive') {
        const to = folderOf(m, 'archive'); if (!to) throw new Error('This account has no Archive folder.')
        drop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to }); say('Archived')
      } else if (k === 'trash') {
        if (prefs.askDelete && !window.confirm('Delete this mail?')) return
        const tr = folderOf(m, 'trash')
        drop(m); await cloud({ action: 'delete', account: m.account, path: m.path, uid: m.uid, trash: tr && tr !== m.path ? tr : '' }); say(tr && tr !== m.path ? 'Moved to Trash' : 'Deleted')
      } else if (k === 'block') {
        const name = who(m.from).name || m.from?.address
        if (!m.from?.address) return
        if (prefs.askBlock && !window.confirm(`Block ${name}? Their mail goes to Junk, here and in RoarMail on your computers.`)) return
        const junk = folderOf(m, 'spam')
        drop(m); await cloud({ action: 'block', email: m.from.address, name: m.from.name || '', account: m.account, path: m.path, uid: m.uid, junk: junk && junk !== m.path ? junk : '' })
        noteBlock('email', m.from.address, true); say(`${name} is blocked, their mail goes to Junk`)
        // every other mail of theirs in this list goes too, as RoarMail on the computer sweeps them
        const addr = String(m.from.address).toLowerCase()
        for (const x of (rows || []).filter((r) => !sameM(r, m) && String(r.from?.address || '').toLowerCase() === addr)) {
          const to = folderOf(x, 'spam'); drop(x)
          if (to && to !== x.path) cloud({ action: 'move', account: x.account, path: x.path, uid: x.uid, to }).catch(() => {})
        }
      } else if (k === 'junk') {
        const to = folderOf(m, 'spam'); if (!to) throw new Error('This account has no Junk folder.')
        drop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to }); say('Moved to Junk')
      } else if (k === 'notjunk') {
        const to = folderOf(m, 'inbox') || 'INBOX'
        drop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to })
        if (m.from?.address && isBlocked(m.from, setup)) { await cloud({ action: 'unblock', kind: 'email', value: m.from.address }).catch(() => {}); noteBlock('email', m.from.address, false) }
        say('Back in the Inbox')
      } else if (k === 'domain') {
        const d = domainOf(m.from); if (!d) return
        if (!window.confirm(`Block everyone at @${d}? Their mail goes to Junk, here and in RoarMail on your computers.`)) return
        const junk = folderOf(m, 'spam')
        await cloud({ action: 'blockDomain', domain: d, account: m.account, path: m.path, uid: m.uid, junk: junk && junk !== m.path ? junk : '' })
        drop(m); noteBlock('domain', d, true); say(`Everyone at @${d} is blocked`)
      } else if (k === 'reply' || k === 'replyAll' || k === 'forward') onCompose({ mode: k, m })
      else if (k === 'sender') { setOpen(null); setThread(''); setSender(m.from); setFilter('sender') }
      else if (k === 'select') { setOpen(null); setSel(new Set([keyM(m)])) }
    } catch (e) { say(e.message || 'Not done'); load(0) }
  }
  // what is done to all the picked mails at once, a few at a time
  const bulk = async (k) => {
    const list = shown.filter((m) => sel?.has(keyM(m)))
    if (!list.length) return
    if (k === 'move') {
      if (new Set(list.map((m) => m.account)).size > 1) { say('Pick mails of one account to move them together'); return }
      setMoving({ ...list[0], _bulk: list }); return
    }
    if (k === 'trash' && prefs.askDelete && !window.confirm(`Delete ${list.length} mail${list.length === 1 ? '' : 's'}?`)) return
    const unread = list.some((m) => !m.seen), unstar = list.every((m) => m.flagged)
    const one = async (m) => {
      if (k === 'read') { patch(m, { seen: unread }); await flag(m, 'seen', unread) }
      else if (k === 'star') { patch(m, { flagged: !unstar }); await flag(m, 'flagged', !unstar) }
      else if (k === 'trash') { const tr = folderOf(m, 'trash'); drop(m); await cloud({ action: 'delete', account: m.account, path: m.path, uid: m.uid, trash: tr && tr !== m.path ? tr : '' }) }
      else if (k === 'junk') { const to = folderOf(m, 'spam'); if (!to || to === m.path) return; drop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to }) }
    }
    setSel(null)
    try {
      for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one))
      say(k === 'trash' ? `${list.length} moved to Trash` : k === 'junk' ? `${list.length} moved to Junk` : k === 'read' ? (unread ? 'Marked as read' : 'Marked as unread') : unstar ? 'Stars removed' : 'Starred')
    } catch (e) { say(e.message || 'Not all done'); load(0) }
  }
  const moveTo = async (m, to) => {
    setMoving(null)
    const list = m._bulk || [m]
    setSel(null)
    try {
      for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map((x) => { drop(x); return cloud({ action: 'move', account: x.account, path: x.path, uid: x.uid, to }) }))
      say(list.length > 1 ? `${list.length} moved` : 'Moved')
    } catch (e) { say(e.message || 'Not moved'); load(0) }
  }
  const openMail = (m) => {
    if (sel) { const k = keyM(m); setSel((s0) => { const n = new Set(s0); if (n.has(k)) n.delete(k); else n.add(k); return n }); return }
    if (filter === 'sender' && !sender) { setSender(m.from); return } // Same sender: the mail tapped picks whose mail to show
    if (conv && !thread && m._n > 1) { setThread(reSubj(m.subject)); return }
    lastOpen.current = m; setOpen(m); if (!m.seen && prefs.markRead) patch(m, { seen: true })
  }
  const nextOf = (m) => { const i = shown.findIndex((x) => sameM(x, m)); return i >= 0 ? shown[i + 1] : null }
  const listSlide = useSlide(thread ? () => setThread('') : onBack, lastOpen.current && !open ? () => setOpen(lastOpen.current) : null)
  const role = step.role || folders.find((f) => f.account === acc.id && f.path === step.path)?.role
  // Junk (Alex, 25 Nov: "make the spam work"): mail from anyone on the block list leaves the Inbox by itself (Settings >
  // ROARMAIL > Junk, on to start), so a sender blocked here or on the computer stays gone while RoarMail there is shut
  const junked = useRef(new Set())
  useEffect(() => {
    if (!prefs.autoJunk || role !== 'inbox' || !rows?.length) return
    for (const m of rows) {
      if (!isBlocked(m.from, setup) || junked.current.has(keyM(m))) continue
      junked.current.add(keyM(m))
      const to = folderOf(m, 'spam')
      drop(m)
      if (to && to !== m.path) cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to }).catch(() => {})
    }
  }, [rows, prefs.autoJunk, role, setup]) // eslint-disable-line react-hooks/exhaustive-deps
  const emptyable = role === 'trash' || role === 'spam'
  const emptyAll = async () => {
    if (!window.confirm(`Delete every mail in ${role === 'trash' ? 'Trash' : 'Junk'} for good?`)) return
    setBusy(true)
    try { for (const t of targets) await cloud({ action: 'empty', account: t.account, path: t.path }); setRows([]); keepList(ck, { rows: [] }); say(role === 'trash' ? 'Trash is empty' : 'Junk is empty') } catch (e) { say(e.message || 'Not emptied') }
    setBusy(false)
  }
  const pick = (k) => {
    setThread('')
    if (k === 'sort') { setOldest((o) => !o); return }
    if (k === 'conv') { setConv((c) => !c); return }
    setFilter((f) => (f === k ? '' : k))
    if (k !== 'search') setQ('')
    if (k !== 'sender') setSender(null)
    if (k !== 'day') setDay('')
  }
  const isOn = (k) => (k === 'sort' ? oldest : k === 'conv' ? conv : filter === k)
  const flashEl = flash && createPortal(<div className="rmx-flash">{flash}</div>, document.body)
  const sheets = <>
    {menu && <MailMenu m={menu.m} at={menu.at} inJunk={role === 'spam'} onAct={(k) => act(k, menu.m)} onClose={() => setMenu(null)} />}
    {moving && <MovePick m={moving} folders={folders} onPick={(to) => moveTo(moving, to)} onClose={() => setMoving(null)} />}
    {flashEl}
  </>

  if (open) {
    const nx = nextOf(open)
    return <>
      <MailRead key={keyM(open)} m={open} accounts={accounts} who={who} prefs={prefs} onBack={() => setOpen(null)} onNext={nx ? () => openMail(nx) : null}
        onAct={(k) => { if (k === 'read' && open.seen) { act('read', open); setOpen(null); return } act(k, open) }} onMore={(at) => setMenu({ m: open, at })} />
      {sheets}
    </>
  }
  const sub = filter === 'sender' && sender ? `From ${who(sender).name || sender.address}` : filter === 'day' && day ? new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
    : thread ? 'Conversation' : acc.id === 'all' ? 'All accounts' : acc.email
  const finding = find && found?.key === findKey && !found.rows
  return (
    <div className={`rmx rmx-ml rmx-l${prefs.lines}${prefs.pics ? '' : ' rmx-nopic'}`} {...listSlide}>
      {/* one glass capsule as tall as the folder bar: back and the folder's name, then every filter, sliding sideways
          (Alex, 24 Nov, version B of https://claude.ai/artifact/Nmb2XBaCTYcECN2sYubCsL) */}
      {sel ? (
        <div className="rmx-head rmx-selhead">
          <button type="button" className="round rmx-hback" onClick={() => setSel(null)} aria-label="Cancel" title="Cancel">{MAIL_I.x}</button>
          <b className="rmx-selcount">{sel.size ? `${sel.size} Selected` : 'Select Mails'}</b>
          <button type="button" className="pill-btn rmx-selall" onClick={() => setSel(sel.size === shown.length ? new Set() : new Set(shown.map(keyM)))}>{sel.size === shown.length && shown.length ? 'None' : 'All'}</button>
        </div>
      ) : <div className="rmx-head">
        {/* back alone, in the same line as the filters; no folder name or address over the mails (Alex, 25 Nov) */}
        <button type="button" className="round rmx-hback" onClick={thread ? () => setThread('') : onBack} aria-label="Back" title={thread ? 'Back' : `Back · ${step.name}`} data-back="">{MAIL_I.back}</button>
        <div className="rmx-fbar">
          <span className="rmx-filters">
            {FILTERS.map(([k, label]) => k === 'day' && filter !== 'day'
              // a day: the phone's own date picker, opened by a tap on the sign itself
              ? <label key={k} className="round rmx-dayb" aria-label={label} title={label}>{MAIL_I.day}<input type="date" max={new Date().toLocaleDateString('en-CA')} onChange={(e) => { if (e.target.value) { setThread(''); setDay(e.target.value); setFilter('day'); setQ(''); setSender(null) } }} /></label>
              : <button key={k} type="button" className={`round${isOn(k) ? ' on' : ''}`} aria-label={label} title={label} onClick={() => pick(k)}>{MAIL_I[k]}</button>)}
          </span>
        </div>
      </div>}
      {filter === 'search' && <label className="search rmx-search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these mails" /></label>}
      {filter === 'sender' && !sender && <p className="rmx-hint">Tap a mail to see all mail from its sender.</p>}
      {((filter === 'sender' && sender) || (filter === 'day' && day)) && <p className="rmx-hint">{sub}</p>}
      {emptyable && rows && rows.length > 0 && !filter && <div className="rmx-more rmx-emptyrow"><button type="button" className="pill-btn" disabled={busy} onClick={emptyAll}>{MAIL_I.trash}<span>{role === 'trash' ? 'Empty Trash' : 'Empty Junk'}</span></button></div>}
      {offline ? <p className="rmx-note">To read this account here, open RoarMail on your computer: Settings › Roar Account › My mail in RoarMe › Send to RoarMe.</p>
        : rows === null && !found?.rows ? <p className="muted rooms-none">{busy ? 'Getting your mail…' : ''}</p>
        : err && !base.length ? <p className="rmx-note">{err}</p>
        : finding && !shown.length ? <p className="muted rooms-none">Looking…</p>
        : !shown.length ? <p className="muted rooms-none">{targets.length ? 'Nothing here.' : 'No account is in RoarMe yet. Send one from RoarMail on your computer.'}</p>
        : shown.map((m) => (
          <MailRow key={keyM(m)} m={m} who={who} bar={acc.id === 'all' ? colourOf(m.account) : ''} count={m._n || 0} picking={filter === 'sender' && !sender} selOn={!!sel} checked={!!sel?.has(keyM(m))}
            onOpen={() => openMail(m)} onAct={(k) => act(k, m)} onMenu={(at) => setMenu({ m, at })} />
        ))}
      {!offline && rows && rows.length > 0 && more && !filter && !thread && <div className="rmx-more"><button type="button" className="pill-btn" disabled={busy} onClick={() => load(page + 1)}>{busy ? 'Loading…' : 'Older Mail'}</button></div>}
      {newBtn}
      {sel && createPortal(
        <div className="rmx-selbar" role="toolbar" aria-label="Selected mails">
          {[['read', shown.some((m) => sel.has(keyM(m)) && !m.seen) ? 'Read' : 'Unread', MAIL_I.read], ['star', 'Star', MAIL_I.star], ['move', 'Move', MAIL_I.move], ['junk', 'Junk', MAIL_I.spam], ['trash', 'Delete', MAIL_I.trash]].map(([k, l, ic]) => (
            <button key={k} type="button" className={k === 'trash' ? 'danger' : ''} disabled={!sel.size || (k === 'junk' && role === 'spam')} onClick={() => bulk(k)}><i>{ic}</i><span>{l}</span></button>
          ))}
        </div>, document.body)}
      {sheets}
    </div>
  )
}

// a mail's html as plain lines (for a reply's quote, a forward, a signature)
const htmlText = (h) => {
  try {
    const d = new DOMParser().parseFromString(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '$&\n'), 'text/html')
    d.querySelectorAll('style, script, head').forEach((n) => n.remove())
    return (d.body.textContent || '').replace(/[ \t\u00a0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch { return '' }
}

// a mail's own page: what it says drawn in a sealed frame (no scripts, no forms, nothing from outside until Show Images)
function MailRead({ m, accounts, who, prefs, onBack, onNext, onAct, onMore }) {
  const [mail, setMail] = useState(() => keptKv(mailKey(m)) || null)
  const [err, setErr] = useState('')
  const [pics, setPics] = useState(() => !!prefs.images)
  const [busy, setBusy] = useState('')
  const frame = useRef(null)
  const actsRef = useRef(null)
  const readSlide = useSlide(onBack, onNext)
  const acc = accounts.find((a) => a.id === m.account)
  useEffect(() => {
    let gone = false
    // kept on the phone: shown at once (and marked read on the server quietly); else fetched and kept
    readKv(mailKey(m)).then((had) => {
      if (gone) return
      if (had) { setMail(had); if (!m.seen && prefs.markRead) cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: 'seen', on: true }).catch(() => {}); return }
      cloud({ action: 'get', account: m.account, path: m.path, uid: m.uid, seen: !!prefs.markRead }).then((j) => { keepMail(m, j); if (!gone) setMail(j) }, (e) => { if (!gone) setErr(e.message || 'Could not open this mail') })
    })
    return () => { gone = true }
  }, [])
  const doc = useMemo(() => {
    if (!mail) return ''
    const body = mail.html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${(mail.text || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>`
    const csp = `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${pics ? ' https: http:' : ''}`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">
<style>html,body{touch-action:pan-y pinch-zoom;overflow-x:hidden}html,body{margin:0;padding:0;background:#fff;color:#1d1d24;font:15px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;word-wrap:break-word;overflow-wrap:anywhere}body{padding:${mail.html ? '0' : '14px 16px 18px'}}img{max-width:100%;height:auto}table{max-width:100%!important}a{color:#1a7fd0}</style></head><body>${body}</body></html>`
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
  const w = who(from)
  return (
    <div className="rmx rmx-rd" {...readSlide}>
      <Crumb title={m.subject || '(no subject)'} onBack={onBack} />
      <article className="rmx-mail">
        <div className="rmx-mh">
          <Avatar src={w.photo} name={w.name || '?'} size={42} />
          <span className="rmx-mw"><b>{w.name}</b><small>{from?.address}</small>{mail?.to?.length > 0 && <small>To: {mail.to.map((a) => who(a).name).join(', ')}</small>}</span>
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
      <div className="rmx-acts" ref={actsRef}>
        <button type="button" className="round" onClick={() => onAct('reply')} aria-label="Reply" title="Reply">{MAIL_I.reply}</button>
        <button type="button" className="round" onClick={() => onAct('forward')} aria-label="Forward" title="Forward">{MAIL_I.forward}</button>
        <button type="button" className={`round${m.flagged ? ' rmx-on' : ''}`} onClick={() => onAct('star')} aria-label="Star" title="Star">{m.flagged ? MAIL_I.starF : MAIL_I.star}</button>
        <button type="button" className="round" onClick={() => onAct('archive')} aria-label="Archive" title="Archive">{MAIL_I.archive}</button>
        <button type="button" className="round rmx-del" onClick={() => onAct('trash')} aria-label="Delete" title="Delete">{MAIL_I.trash}</button>
        <button type="button" className="round" onClick={() => { const r = actsRef.current?.getBoundingClientRect(); onMore(r ? { top: r.top, bottom: r.top } : null) }} aria-label="More" title="More">{I.more}</button>
      </div>
    </div>
  )
}

// ---- writing: a new mail, a reply, a forward (Alex, 24 Nov: "I found nowhere to make a new mail"), sent from the
// account itself through roarmail-cloud --------------------------------------------------------------------------------
const parseAddrs = (s) => String(s || '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const m = x.match(/^(.*)<([^>]+)>$/)
  return m ? { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() } : { name: '', address: x }
})
const fmtAddrs = (l) => (l || []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
const esc = (t) => String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const okAddr = (a) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a.address)

/* Contacts inside ROARMAIL (Alex, 25 Nov, "all together"): everyone with an email in the address book, RoarMail's own
   contacts and whoever wrote to me in the mail kept on this phone, one row each; a tap writes them a new mail */
function MailContacts({ who, setup, me, book, onBack, onWrite }) {
  const [q, setQ] = useState('')
  const [extra, setExtra] = useState([])
  useEffect(() => { readKv('ml:all|inbox').then((v) => { if (v?.rows) setExtra(v.rows) }, () => {}) }, [])
  const list = useMemo(() => {
    const m = new Map()
    const add = (email, name) => { const e = String(email || '').trim().toLowerCase(); if (!e || !e.includes('@') || /no[-_.]?reply|mailer-daemon|notifications?@|bounce/.test(e)) return; if (!m.has(e)) m.set(e, name || '') }
    for (const e of book || keptBook(me?.id)) for (const x of e.emails || []) add(x.value, entryName(e))
    for (const [e, n] of Object.entries(setup?.contacts || {})) add(e, n)
    const rows = [...extra]; for (const v of listCache.values()) rows.push(...(v.rows || []))
    for (const r of rows) add(r.from?.address, r.from?.name)
    return [...m.entries()].map(([email, name]) => { const w = who({ address: email, name }); return { email, name: w.name || name || email, photo: w.photo, book: w.book } })
      .sort((a, b) => (b.book - a.book) || a.name.localeCompare(b.name))
  }, [who, setup, book, me, extra])
  const ql = q.trim().toLowerCase()
  const shown = ql ? list.filter((c) => c.name.toLowerCase().includes(ql) || c.email.includes(ql)) : list
  return (
    <div className="rmx rmx-ct">
      <Crumb title="Contacts" onBack={onBack} end={<span className="rmx-ct-n">{list.length}</span>} />
      <label className="search rmx-ct-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
      {!shown.length && <p className="rmx-ct-empty">{ql ? 'Nobody found.' : 'No email contacts yet.'}</p>}
      <div className="rooms rmx-ct-list">
        {shown.slice(0, 400).map((c) => (
          <button key={c.email} type="button" className="room rmx-ct-row" onClick={() => onWrite(c.email)}>
            <Avatar src={c.photo} name={c.name} size={42} />
            <span className="room-main"><span className="room-top"><strong>{c.name}</strong></span><span className="room-bottom"><span className="room-prev">{c.email}</span></span></span>
            <i className="rmx-ct-go">{MAIL_I.compose}</i>
          </button>
        ))}
      </div>
    </div>
  )
}

function Compose({ init, accounts, on, setup, who, abook, onClose }) {
  const prefs = usePrefs()
  const usable = accounts.filter((a) => on?.has(a.id))
  const m = init.m
  const pickFrom = () => (m && on?.has(m.account) ? m.account : init.account && on?.has(init.account) ? init.account : prefs.defAcc && on?.has(prefs.defAcc) ? prefs.defAcc : usable[0]?.id || '')
  const [from, setFrom] = useState(pickFrom)
  const [mail, setMail] = useState(() => (m ? keptKv(mailKey(m)) || null : null))
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [moreFields, setMoreFields] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const filled = useRef(false)
  const typed = useRef(false)
  const sigOf = (id) => (prefs.signature ? htmlText(setup.signature?.[id] || '').trim() : '')
  useEffect(() => { if (m && !mail) cloud({ action: 'get', account: m.account, path: m.path, uid: m.uid, seen: false }).then((j) => { keepMail(m, j); setMail(j) }, (e) => setErr(e.message || 'Could not read the mail')) }, [])
  // the fields of a reply or a forward, once the mail is here
  useEffect(() => {
    if (filled.current) return
    if (init.mode === 'new') { filled.current = true; if (init.to) setTo(init.to); const sg = sigOf(from); setBody(sg ? `\n\n${sg}` : ''); return }
    if (!mail) return
    filled.current = true
    const mine = new Set(accounts.map((a) => String(a.email).toLowerCase()))
    const sg = sigOf(from)
    const plain = (mail.text || htmlText(mail.html)).trim()
    const fromWho = mail.from ? (mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address) : ''
    const dt = new Date(mail.date || m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    if (init.mode === 'forward') {
      setSubject(/^fwd?:/i.test(mail.subject || '') ? mail.subject : `Fwd: ${mail.subject || ''}`)
      setBody(`\n\n${sg ? `${sg}\n\n` : ''}---------- Forwarded message ----------\nFrom: ${fromWho}\nDate: ${dt}\nSubject: ${mail.subject || ''}\nTo: ${fmtAddrs(mail.to)}\n\n${plain}`)
    } else {
      const back = mail.replyTo?.length ? mail.replyTo : mail.from ? [mail.from] : []
      setTo(fmtAddrs(back))
      if (init.mode === 'replyAll') {
        const seen = new Set(back.map((a) => a.address.toLowerCase()))
        const rest = [...(mail.to || []), ...(mail.cc || [])].filter((a) => { const k = a.address.toLowerCase(); if (mine.has(k) || seen.has(k)) return false; seen.add(k); return true })
        if (rest.length) { setCc(fmtAddrs(rest)); setMoreFields(true) }
      }
      setSubject(/^re:/i.test(mail.subject || '') ? mail.subject : `Re: ${mail.subject || ''}`)
      setBody(`\n\n${sg ? `${sg}\n\n` : ''}${prefs.quote ? `On ${dt}, ${mail.from?.name || mail.from?.address || ''} wrote:\n${plain.split('\n').map((l) => `> ${l}`).join('\n')}` : ''}`)
    }
  }, [mail])
  const addFiles = async (list) => {
    const got = []
    for (const f of list) {
      const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ok(''); r.readAsDataURL(f) })
      got.push({ name: f.name, mime: f.type || 'application/octet-stream', size: f.size, b64 })
    }
    setFiles((x) => [...x, ...got])
  }
  const total = files.reduce((a, f) => a + f.size, 0)
  const book = useMemo(() => {
    const l = new Map()
    for (const e of abook || []) for (const x of e.emails || []) { const k = String(x.value || '').trim().toLowerCase(); if (k) l.set(k, entryName(e)) }
    for (const [e, n] of Object.entries(setup.contacts || {})) if (!l.has(e)) l.set(e, n)
    return [...l.entries()].sort((a, b) => String(a[1] || a[0]).localeCompare(String(b[1] || b[0]))).slice(0, 800)
  }, [setup, abook])
  const send = async () => {
    const T = parseAddrs(to), C = parseAddrs(cc), B = parseAddrs(bcc)
    const bad = [...T, ...C, ...B].find((a) => !okAddr(a))
    if (bad) { setErr(`“${bad.address}” is not an address.`); return }
    if (!T.length && !C.length && !B.length) { setErr('Add who it goes to.'); return }
    if (total > 18e6) { setErr('The files are too big together (18 MB at most).'); return }
    const acc = accounts.find((a) => a.id === from)
    if (!acc) { setErr('Choose the account it goes from.'); return }
    setBusy(true); setErr('')
    try {
      const reply = (init.mode === 'reply' || init.mode === 'replyAll') && mail
      await cloud({
        action: 'send', account: from, fromName: acc.display || '', to: T, cc: C, bcc: B, subject, text: body,
        html: `<div style="white-space:pre-wrap">${esc(body)}</div>`,
        inReplyTo: reply ? mail.msgid || '' : '', references: reply ? mail.msgid || '' : '',
        sent: setup.folders.find((f) => f.account === from && f.role === 'sent')?.path || '',
        replyOf: reply && m.account === from ? { path: m.path, uid: m.uid } : null,
        forwardOf: init.mode === 'forward' && m ? { account: m.account, path: m.path, uid: m.uid } : null,
        files: files.map(({ name, mime, b64 }) => ({ name, mime, b64 })),
      })
      onClose(true)
      tell('roarme-mail-sent', from)
    } catch (e) { setErr(e.message || 'Not sent') }
    setBusy(false)
  }
  const close = () => { if (typed.current && !window.confirm('Discard this mail?')) return; onClose() }
  const title = init.mode === 'forward' ? 'Forward' : init.mode === 'reply' || init.mode === 'replyAll' ? 'Reply' : 'New Mail'
  const t = (set) => (e) => { typed.current = true; set(e.target.value) }
  const ready = !busy && usable.length && (to.trim() || cc.trim() || bcc.trim())
  const fromAcc = usable.find((a) => a.id === from)
  // + beside To: pick from the people with an address, written in as they are tapped
  const addTo = (e) => { typed.current = true; setTo((v) => { const l = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean); return l.includes(e) ? v : [...l, e].join(', ') + ', ' }) }
  const toLast = to.split(/[,;]/).pop().trim().toLowerCase()
  const picks = pickOpen ? book.filter(([e, n]) => !toLast || e.includes(toLast) || String(n || '').toLowerCase().includes(toLast)).slice(0, 60) : []
  // the page as Apple's Mail writes a mail (Alex, 25 Nov, its screenshot: "clean, nice, a full page to write what you want"):
  // X at the left and the round Send at the right, the title large, To · Cc/Bcc, From · Subject as hairline rows, then
  // the whole page for the words
  return (
    <Modal title={title} onClose={close}>
      <div className="rmx-c2">
        <div className="rmx-c2-top">
          <button type="button" className="round" onClick={close} aria-label="Close" title="Close">{MAIL_I.x}</button>
          <button type="button" className={`round rmx-c2-send${ready ? ' on' : ''}`} disabled={!ready} onClick={send} aria-label="Send" title="Send">{busy ? <i className="rmx-spin" /> : MAIL_I.send}</button>
        </div>
        <h1 className="rmx-c2-title">{title === 'New Mail' ? 'New Message' : title}</h1>
        {!usable.length ? <p className="rmx-note">To write from an account here, send it to RoarMe from RoarMail on your computer first.</p> : <>
          <label className="rmx-c2-row"><span>To:</span>
            <input type="email" multiple inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={to} onChange={t(setTo)} onFocus={() => setPickOpen(false)} />
            <button type="button" className="round rmx-c2-plus" onClick={(e) => { e.preventDefault(); setPickOpen((v) => !v) }} aria-label="Add from contacts" title="Add from contacts">{MAIL_I.plus || '+'}</button>
          </label>
          {pickOpen && <div className="rmx-c2-picks">
            {picks.length ? picks.map(([e, n]) => <button key={e} type="button" onClick={() => addTo(e)}><b>{n || e}</b>{n && <small>{e}</small>}</button>) : <p className="rmx-hint">Nobody with that name or address.</p>}
          </div>}
          {!moreFields
            ? <button type="button" className="rmx-c2-row rmx-c2-more" onClick={() => setMoreFields(true)}><span>Cc/Bcc, From:</span><em>{fromAcc?.email || ''}</em></button>
            : <>
              <label className="rmx-c2-row"><span>Cc:</span><input type="email" multiple inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={cc} onChange={t(setCc)} autoFocus /></label>
              <label className="rmx-c2-row"><span>Bcc:</span><input type="email" multiple inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={bcc} onChange={t(setBcc)} /></label>
              <label className="rmx-c2-row rmx-c2-from"><span>From:</span><em>{fromAcc?.email || ''}</em>
                <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From">{usable.map((a) => <option key={a.id} value={a.id}>{a.display ? `${a.display} <${a.email}>` : a.email}</option>)}</select></label>
            </>}
          <label className="rmx-c2-row"><span>Subject:</span><input value={subject} onChange={t(setSubject)} />
            <label className="round rmx-c2-clip" aria-label="Add files" title="Add files" onClick={(e) => e.stopPropagation()}>{MAIL_I.clip}<input type="file" multiple onChange={(e) => { typed.current = true; addFiles([...e.target.files]); e.target.value = '' }} /></label>
          </label>
          {files.length > 0 && <div className="rmx-cfiles">{files.map((f, i) => (
            <span key={i} className="rmx-cfile"><b>{f.name}</b><small>{sizeOf(f.size)}</small><button type="button" className="round" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}>{MAIL_I.x}</button></span>
          ))}</div>}
          {init.mode === 'forward' && mail?.files?.length > 0 && <p className="rmx-hint">The mail's {mail.files.length === 1 ? 'file goes' : `${mail.files.length} files go`} with it.</p>}
          {err && <p className="rmx-note">{err}</p>}
          <textarea className="rmx-c2-body" value={body} onChange={t(setBody)} placeholder={init.m && !mail ? 'Getting the mail…' : ''} />
        </>}
      </div>
    </Modal>
  )
}

// the unread mails in the app's own Unread, version B (Alex, 24 Nov: "all together by time, with a minimal choice that
// takes no line of its own"): Chat.jsx mixes these rows with the unread chats by time, and the head's All · Chats · Mail
// (in the place of ROARME, as Calls' All | Missed) shows one kind or both
export function useUnreadMails(on) {
  const prefs = usePrefs()
  const [list, setList] = useState(() => keptKv('mu') || null)
  useEffect(() => {
    if (!on) return
    if (!list) readKv('mu').then((v) => { if (v) setList((l) => l || v) })
    const f = (e) => setList(e.detail || [])
    window.addEventListener('roarme-mail-unread', f)
    return () => window.removeEventListener('roarme-mail-unread', f)
  }, [on])
  const drop = (m) => setList((l) => { const n = (l || []).filter((x) => !sameM(x, m)); keepKv('mu', n); return n })
  return { rows: on && prefs.countUnread ? (list || []).filter((m) => !m.seen && !(prefs.allHide || []).includes(m.account)) : [], drop }
}
export function useMailWho(me, people, book) { return useWho(me, people, book, lsGet('mail-setup')) }

/** one unread mail among the chats: the same row, slide and long press as in ROARMAIL; what needs the folder opens it there */
export function UnreadMail({ m, who, onDrop }) {
  const [menu, setMenu] = useState(null)
  const setup = lsGet('mail-setup')
  const prefs = mailPrefs()
  const folderOf = (role) => setup?.folders?.find((f) => f.account === m.account && f.role === role)?.path
  const act = async (k) => {
    try {
      if (k === 'read') { onDrop(m); await cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: 'seen', on: true }) }
      else if (k === 'star') await cloud({ action: 'flag', account: m.account, path: m.path, uid: m.uid, flag: 'flagged', on: !m.flagged })
      else if (k === 'archive' && folderOf('archive')) { onDrop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to: folderOf('archive') }) }
      else if (k === 'trash') { if (prefs.askDelete && !window.confirm('Delete this mail?')) return; onDrop(m); await cloud({ action: 'delete', account: m.account, path: m.path, uid: m.uid, trash: folderOf('trash') || '' }) }
      else if (k === 'block') {
        const name = who(m.from).name || m.from?.address
        if (!m.from?.address || (prefs.askBlock && !window.confirm(`Block ${name}? Their mail goes to Junk, here and in RoarMail on your computers.`))) return
        onDrop(m); await cloud({ action: 'block', email: m.from.address, name: m.from.name || '', account: m.account, path: m.path, uid: m.uid, junk: folderOf('spam') || '' })
        noteBlock('email', m.from.address, true)
      } else if (k === 'junk' && folderOf('spam')) { onDrop(m); await cloud({ action: 'move', account: m.account, path: m.path, uid: m.uid, to: folderOf('spam') }) }
      else if (k === 'domain') {
        const d = domainOf(m.from); if (!d || !window.confirm(`Block everyone at @${d}? Their mail goes to Junk, here and in RoarMail on your computers.`)) return
        onDrop(m); await cloud({ action: 'blockDomain', domain: d, account: m.account, path: m.path, uid: m.uid, junk: folderOf('spam') || '' }); noteBlock('domain', d, true)
      } else { openMailFromUnread(m); return }
      warmMail(true)
    } catch { warmMail(true) }
  }
  return (
    <div className={`rmx rmx-mu1 rmx-l${prefs.lines}${prefs.pics ? '' : ' rmx-nopic'}`}>
      <MailRow m={m} who={who} bar={setup?.accounts?.find((a) => a.id === m.account)?.color} onOpen={() => openMailFromUnread(m)} onAct={act} onMenu={(at) => setMenu({ at })} />
      {menu && <MailMenu m={m} at={menu.at} noSelect onAct={act} onClose={() => setMenu(null)} />}
    </div>
  )
}

// Settings > ROARMAIL (Alex, 24 Nov: "the settings of RoarMail, from the desktop, in our RoarMail tab"); kept on this phone
export function MailPage() {
  const [on, setOn] = useState(mailSwitchNow)
  const prefs = usePrefs()
  const [setup, setSetup] = useState(() => lsGet('mail-setup'))
  const [state, setState] = useState(() => { const l = lsGet('mail-on'); return l ? new Map(l) : null })
  const [kept, setKept] = useState(() => (lsGet('mail-kept') || []).length)
  useEffect(() => { const f = (e) => setOn(!!e.detail); window.addEventListener('roarme-mail-switch', f); return () => window.removeEventListener('roarme-mail-switch', f) }, [])
  useEffect(() => {
    if (!on) return
    loadSetup().then((x) => { setSetup(x); lsSet('mail-setup', x) }, () => {})
    cloud({ action: 'state' }).then((j) => { const l = (j.accounts || []).map((a) => [a.account_id, a]); lsSet('mail-on', l); setState(new Map(l)) }, () => {})
  }, [on])
  const sw = (k, label, sub) => (
    <label className="set-row rmx-setrow"><span className="rmx-st"><b>{label}</b>{sub && <small>{sub}</small>}</span>
      <span className="switch"><input type="checkbox" checked={!!prefs[k]} onChange={(e) => setMailPref(k, e.target.checked)} /><span /></span></label>
  )
  const seg = (k, label, opts) => (
    <div className="set-row rmx-setrow"><span className="rmx-st"><b>{label}</b></span>
      <span className="seg rmx-seg">{opts.map(([v, t]) => <button key={String(v)} type="button" className={prefs[k] === v ? 'on' : ''} onClick={() => setMailPref(k, v)}>{t}</button>)}</span></div>
  )
  const [showBlocked, setShowBlocked] = useState(false)
  const [busy, setBusy] = useState('')
  const [gone, setGone] = useState([])
  const blockList = (setup?.block?.list || []).filter((x) => !gone.includes(`${x.kind}:${x.value}`))
  const unblockOne = async (x) => {
    const k = `${x.kind}:${x.value}`
    setBusy(k)
    try { await cloud({ action: 'unblock', kind: x.kind, value: x.value }); noteBlock(x.kind, x.value, false); setGone((g) => [...g, k]); loadSetup().then((n) => { setSetup(n); lsSet('mail-setup', n) }, () => {}) } catch (e) { window.alert(e.message || 'Not unblocked') }
    setBusy('')
  }
  const clearKept = () => {
    for (const k of lsGet('mail-kept') || []) dropKv(k)
    lsSet('mail-kept', [], 0); listCache.clear(); setKept(0)
  }
  return (
    <div className="hb-page rmx-set">
      <label className="set-box hb-on hb-switch">
        <span className="hb-t"><b><MailWord /></b><small>{on ? 'The ROARMAIL folder is in your folder bar.' : 'Turn on to see your mail in a ROARMAIL folder.'}</small></span>
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); mailSwitchSet(e.target.checked) }} /><span /></span>
      </label>
      {on && <>
        <div className="set-title">Accounts</div>
        <div className="set-box rmx-accset">
          {(setup?.accounts || []).map((a) => {
            const st = state?.get(a.id), inAll = !(prefs.allHide || []).includes(a.id)
            return (
              <div key={a.id} className="set-row rmx-setacc">
                <Avatar src={a.avatar} name={a.name} size={34} />
                <span className="rmx-st"><b>{a.name}</b><small>{a.email} · {st ? (st.status === 'ok' ? 'In RoarMe' : 'Send again from RoarMail') : 'Not sent yet'}</small></span>
                {st?.status === 'ok'
                  ? <label className="rmx-inall" title="In All Inboxes and Unread"><small>All</small><span className="switch"><input type="checkbox" checked={inAll} onChange={(e) => setMailPref('allHide', e.target.checked ? (prefs.allHide || []).filter((x) => x !== a.id) : [...(prefs.allHide || []), a.id])} /><span /></span></label>
                  : <em className={`rmx-tag${st ? ' bad' : ''}`}>{st ? 'Send again' : 'Not sent'}</em>}
              </div>
            )
          })}
          {!setup?.accounts?.length && <p className="hb-hint">No accounts yet.</p>}
        </div>
        <p className="hb-hint">The switch puts an account in All Inboxes and in the app's Unread. An account comes here from RoarMail on your computer: Settings › Roar Account › My mail in RoarMe › Send to RoarMe.</p>
        <div className="set-title">Reading</div>
        <div className="set-box">
          {sw('markRead', 'Mark as Read When Opened')}
          {sw('images', 'Load Images', 'Pictures from the web in every mail, without asking.')}
          {seg('lines', 'Preview Lines', [[0, 'None'], [1, '1'], [2, '2']])}
          {sw('pics', 'Sender Pictures', 'The round picture beside each mail.')}
          {sw('oldest', 'Oldest First', 'The order a folder opens in.')}
        </div>
        <div className="set-title">New Mail</div>
        <div className="set-box">
          {sw('countUnread', 'Mail in Unread', 'Unread mail beside the unread chats, and in the count.')}
          {seg('every', 'Check Every', [[1, '1 min'], [3, '3 min'], [10, '10 min']])}
        </div>
        <div className="set-title">Writing</div>
        <div className="set-box">
          {sw('signature', 'Add My Signature', 'Each account’s signature from RoarMail.')}
          {sw('quote', 'Quote the Mail in Replies', 'The mail you answer, under your words.')}
          <label className="set-row rmx-setrow rmx-pickrow"><span className="rmx-st"><b>Send New Mail From</b><small>{(setup?.accounts || []).find((a) => a.id === prefs.defAcc)?.email || 'The first account in RoarMe'}</small></span>
            <i className="set-chev">{I.right}</i>
            <select value={prefs.defAcc || ''} onChange={(e) => setMailPref('defAcc', e.target.value)} aria-label="Send New Mail From">
              <option value="">The first account in RoarMe</option>
              {(setup?.accounts || []).filter((a) => state?.get(a.id)?.status === 'ok').map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select></label>
        </div>
        <div className="set-title">Actions</div>
        <div className="set-box">
          {sw('askDelete', 'Ask Before Deleting')}
          {sw('askBlock', 'Ask Before Blocking')}
        </div>
        <p className="hb-hint">A slide from the right edge of a mail brings out Read, Star, Move, Block and Trash; a long press gives Reply, Forward, Move to Junk, Block and more.</p>
        <div className="set-title">Junk</div>
        <div className="set-box">
          {sw('autoJunk', 'Blocked Senders to Junk', 'Mail from anyone you blocked leaves the Inbox by itself, here and while RoarMail on the computer is shut.')}
          <button type="button" className="set-row set-pick" onClick={() => setShowBlocked((v) => !v)}><span className="set-text">Blocked Senders<small>{blockList.length ? `${blockList.length} blocked, the same list as RoarMail on your computers` : 'Nobody blocked yet'}</small></span><i className={`set-chev${showBlocked ? ' rmx-chev-down' : ''}`}>{I.right}</i></button>
          {showBlocked && blockList.map((x) => (
            <div key={`${x.kind}:${x.value}`} className="set-row rmx-setrow rmx-blockrow">
              <span className="rmx-st"><b>{x.kind === 'domain' ? `@${x.label}` : x.label}</b><small>{x.kind === 'email' ? 'Address' : x.kind === 'domain' ? 'Everyone at this domain' : x.kind === 'name' ? 'This name, from any address' : 'Brand'}</small></span>
              <button type="button" className="pill-btn" disabled={busy === `${x.kind}:${x.value}`} onClick={() => unblockOne(x)}>{busy === `${x.kind}:${x.value}` ? '…' : 'Unblock'}</button>
            </div>
          ))}
        </div>
        <p className="hb-hint">In Junk, hold a mail and choose Not Junk to bring it back to the Inbox and unblock its sender. Block @domain blocks everyone at a company’s address, never Gmail, Outlook or iCloud.</p>
        <div className="set-title">On This Phone</div>
        <div className="set-box">
          <div className="set-row rmx-setrow"><span className="rmx-st"><b>Kept Mail</b><small>{kept ? `${kept} mails open at once, without the network.` : 'Nothing kept yet.'}</small></span>
            <button type="button" className="pill-btn" disabled={!kept} onClick={clearKept}>Clear</button></div>
          {seg('keep', 'Keep Up To', [[50, '50'], [150, '150'], [500, '500']])}
        </div>
      </>}
      {!on && <p className="hb-hint">Only you see this while it is being built. To read an account here, send it from RoarMail on your computer: Settings › Roar Account › My mail in RoarMe.</p>}
    </div>
  )
}
