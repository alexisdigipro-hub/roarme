// More than one RoarMe account on one device, switched in a tap (Alex, 26 Nov, from Telegram's Settings: "multiple
// accounts that switch"). Each account's sign-in (the whole Supabase session) is kept on this device in localStorage
// roarme-accounts, up to MAX; the one in use is also Supabase's own key (roarme-auth-2). Switching writes the other
// account's session into that key and reloads, so every part of RoarMe starts fresh as that person (what each keeps
// on the device is already per person). Adding one puts the present account aside without signing it out and shows the
// sign-in page; the new sign-in joins the list. Nothing of this leaves the device.
import { supabase } from './lib.js'
import { staySet } from './stay.js'
import { pushForget } from './push.js'

const KEY = 'roarme-accounts'
const AUTH = 'roarme-auth-2'
const ADDING = 'roarme-adding'
export const MAX_ACCOUNTS = 3

export function accounts() {
  try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l.filter((a) => a && a.id && a.s?.refresh_token) : [] } catch { return [] }
}
const save = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX_ACCOUNTS))) } catch { /* full or private */ } window.dispatchEvent(new Event('roarme-accounts')) }

/** keep the account in use, with its newest sign-in and what shows of it (name, @username, picture) */
export function rememberAccount(session, me) {
  if (!session?.user?.id || !session.refresh_token) return
  const l = accounts()
  const i = l.findIndex((a) => a.id === session.user.id)
  const was = i >= 0 ? l[i] : {}
  const row = {
    id: session.user.id, email: session.user.email || was.email || '',
    name: me?.display_name ?? was.name ?? '', username: me?.username ?? was.username ?? '', avatar: me?.avatar_url ?? was.avatar ?? '',
    s: session, at: Date.now(),
  }
  if (i >= 0) l[i] = row
  else if (l.length < MAX_ACCOUNTS) l.push(row)
  else return
  save(l)
}

/** the account in use stays kept with its newest sign-in, every time Supabase hands a new one */
supabase.auth.onAuthStateChange((ev, session) => {
  if (session && (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION' || ev === 'USER_UPDATED')) {
    rememberAccount(session)
    if (ev === 'SIGNED_IN') { try { sessionStorage.removeItem(ADDING) } catch { /* private */ } }
  }
})

async function keepNow() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session) rememberAccount(session)
  return session
}

/** go to another kept account; where = { chat } opens that chat once it is up */
export async function switchAccount(id, where = {}) {
  const now = await keepNow()
  if (now?.user?.id === id) return
  const to = accounts().find((a) => a.id === id)
  if (!to) return
  try { localStorage.setItem(AUTH, JSON.stringify(to.s)) } catch { return }
  staySet('tab', 'chats'); staySet('folder', 'all'); staySet('chat', where.chat || ''); staySet('setPage', '')
  window.location.reload()
}

/** put the present account aside (not signed out) and show the sign-in page for one more */
export async function addAccount() {
  if (accounts().length >= MAX_ACCOUNTS) return false
  await keepNow()
  try { sessionStorage.setItem(ADDING, '1'); localStorage.removeItem(AUTH) } catch { return false }
  staySet('tab', 'chats'); staySet('chat', ''); staySet('setPage', '')
  window.location.reload()
  return true
}
export const addingAccount = () => { try { return sessionStorage.getItem(ADDING) === '1' } catch { return false } }
/** back from the sign-in page to the newest kept account, without adding one */
export function cancelAdd() {
  try { sessionStorage.removeItem(ADDING) } catch { /* private */ }
  const last = [...accounts()].sort((a, b) => b.at - a.at)[0]
  if (!last) return
  try { localStorage.setItem(AUTH, JSON.stringify(last.s)) } catch { return }
  window.location.reload()
}

/** sign out of the account in use only; the next kept account takes its place */
export async function signOutHere() {
  const { data: { session } } = await supabase.auth.getSession()
  const me = session?.user?.id
  const rest = accounts().filter((a) => a.id !== me)
  save(rest)
  if (rest.length) await pushForget()
  await supabase.auth.signOut()
  const next = [...rest].sort((a, b) => b.at - a.at)[0]
  if (!next) return
  try { localStorage.setItem(AUTH, JSON.stringify(next.s)) } catch { return }
  staySet('tab', 'chats'); staySet('chat', ''); staySet('setPage', '')
  window.location.reload()
}

/** a notification for another kept account: switch to it and open the chat; true when it did */
export function openForAccount(to, room, current) {
  if (!to || to === current || !accounts().some((a) => a.id === to)) return false
  switchAccount(to, { chat: room })
  return true
}
