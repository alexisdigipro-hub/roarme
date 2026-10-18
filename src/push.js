import { SUPABASE_URL, supabase } from './lib.js'

/* Notifications with RoarMe closed (Alex, 18 Oct): Web Push on phones and browsers (supabase/push.sql, the Edge
   Function roar-push). Turning it on asks for permission, signs this browser up with the server's public key and
   keeps its address in roar_push_subs; off forgets it. The Mac and Windows app has its own notifications. On an
   iPhone it works once RoarMe is on the Home Screen (Share > Add to Home Screen) and opened from there. */

const FN = `${SUPABASE_URL}/functions/v1/roar-push`
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
export const pushSupported = () => typeof window !== 'undefined' && !window.roarDesktop && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined'
export const badgeSupported = () => typeof navigator !== 'undefined' && 'setAppBadge' in navigator && !window.roarDesktop

const registration = async () => {
  const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' })
  await navigator.serviceWorker.ready
  return reg
}
const current = async () => {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration('./')
  return reg ? reg.pushManager.getSubscription() : null
}
const keep = async (sub, preview) => {
  const j = sub.toJSON()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('roar_push_subs').upsert({ endpoint: j.endpoint, user_id: user.id, p256dh: j.keys.p256dh, auth: j.keys.auth, preview: !!preview, ua: navigator.userAgent.slice(0, 290) })
  if (error) throw error
}

export async function pushIsOn() {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  return !!(await current())
}

export async function pushOn(preview) {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for RoarMe. Allow them in the settings of this phone or browser.' : 'Notifications were not allowed.')
  const reg = await registration()
  // a fresh sign-up each time, so an old one (another account on this browser) never lingers
  const old = await reg.pushManager.getSubscription()
  if (old) { try { await old.unsubscribe() } catch { /* already gone */ } }
  const res = await fetch(`${FN}?key`)
  const { key } = await res.json()
  if (!key) throw new Error('The notification server did not answer. Try again in a moment.')
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) })
  await keep(sub, preview)
}

export async function pushOff() {
  const sub = await current()
  if (!sub) return
  await supabase.from('roar_push_subs').delete().eq('endpoint', sub.endpoint)
  try { await sub.unsubscribe() } catch { /* already gone */ }
}

// on every start: the server still knows this browser (and whether the text may show)
export async function pushSync(preview) {
  try {
    if (Notification.permission !== 'granted') return
    const sub = await current()
    if (sub) { await registration(); await keep(sub, preview) }
  } catch { /* offline, or not signed in yet */ }
}

// the unread count on the Home Screen icon while RoarMe is open (the service worker sets it while closed)
export function setBadge(n) {
  if (!badgeSupported()) return
  try { if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge() } catch { /* not here */ }
}
