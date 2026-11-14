import { SUPABASE_URL, supabase } from './lib.js'

/* Notifications with RoarMe closed (Alex, 18 Oct): Web Push on phones and browsers (supabase/push.sql, the Edge
   Function roar-push). Turning it on asks for permission, signs this browser up with the server's public key and
   keeps its address in roar_push_subs; off forgets it. The Mac and Windows app has its own notifications. On an
   iPhone it works once RoarMe is on the Home Screen (Share > Add to Home Screen) and opened from there. */

const FN = `${SUPABASE_URL}/functions/v1/roar-push`
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0))

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const onPhone = () => isIOS() || /Android/i.test(navigator.userAgent)
// inside the iPhone app from the App Store (the shell built with Capacitor; Alex, 14 Nov): there is nothing to add to
// a Home Screen and nothing to download, so whatever asks isStandalone() already sees an app of its own
export const inApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
export const isStandalone = () => inApp() || window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
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

// turned off by hand in Settings on this device: never switched back on by itself
const OFF = 'roarme-push-off'
const offByHand = () => { try { return localStorage.getItem(OFF) === '1' } catch { return false } }
const markOff = (v) => { try { if (v) localStorage.setItem(OFF, '1'); else localStorage.removeItem(OFF) } catch { /* private window */ } }

export async function pushOn(preview) {
  markOff(false)
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
  markOff(true)
  const sub = await current()
  if (!sub) return
  await supabase.from('roar_push_subs').delete().eq('endpoint', sub.endpoint)
  try { await sub.unsubscribe() } catch { /* already gone */ }
}

// on every start: the server still knows this browser (and whether the text may show). Allowed but not signed up
// (and not turned off by hand), it signs up by itself, so notifications ring from the first day (Alex, 3 Nov)
export async function pushSync(preview) {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return
    const sub = await current()
    if (sub) { await registration(); await keep(sub, preview) } else if (!offByHand()) await pushOn(preview)
  } catch { /* offline, or not signed in yet */ }
}

// the first tap after installing: asks for permission and signs this device up for notifications with RoarMe closed,
// no trip to Settings needed. An iPhone allows the question only on a tap, and only from the Home Screen
export async function pushFirstTap(preview) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return
  if (!pushSupported()) { try { await Notification.requestPermission() } catch { /* not here */ } return }
  if (offByHand()) return
  try { await pushOn(preview) } catch { /* not allowed: Settings > Notifications can turn it on later */ }
}

// the unread count on the Home Screen icon while RoarMe is open (the service worker sets it while closed)
export function setBadge(n) {
  if (!badgeSupported()) return
  try { if (n > 0) navigator.setAppBadge(n); else navigator.clearAppBadge() } catch { /* not here */ }
}

// Settings > Send Test: after 5 seconds a test notification to each of your devices; says what each push service answered
export async function pushTest() {
  const { data, error } = await supabase.functions.invoke('roar-push', { body: { test: true } })
  if (error) {
    let msg = error.message
    try { msg = (await error.context.json()).error || msg } catch { /* plain error */ }
    throw new Error(msg)
  }
  return data?.results || []
}
