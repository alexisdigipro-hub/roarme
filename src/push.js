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
export const pushSupported = () => typeof window !== 'undefined' && !window.roarDesktop && (inApp() ? !!native() : 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined')
export const badgeSupported = () => typeof navigator !== 'undefined' && 'setAppBadge' in navigator && !window.roarDesktop

/* Inside the iPhone app (Alex, 14 Nov; App Store step 4) there is no Web Push: Apple's own notifications (APNs) come
   through Capacitor's push plugin. The device's token is kept in the same roar_push_subs, as the address
   https://api.push.apple.com/3/device/<token> (p256dh and auth read 'apns'), so who is told and when stays exactly as
   for Web Push; roar-push sees the address and sends to Apple instead. */
const APNS = 'https://api.push.apple.com/3/device/'
const TOKEN = 'roarme-apns'
// the site does not carry @capacitor/core, so when the shell offers no ready proxy the plugin is reached through the
// native bridge itself (nativePromise / nativeCallback, what @capacitor/core's registerPlugin does underneath)
const bridgePlugin = (name) => {
  const C = window.Capacitor
  if (!C?.nativePromise || !C?.nativeCallback) return null
  const call = (m) => (o = {}) => C.nativePromise(name, m, o)
  return {
    checkPermissions: call('checkPermissions'),
    requestPermissions: call('requestPermissions'),
    register: call('register'),
    addListener: (eventName, fn) => {
      const callbackId = C.nativeCallback(name, 'addListener', { eventName }, fn)
      return Promise.resolve({ remove: () => C.nativePromise(name, 'removeListener', { eventName, callbackId }) })
    },
  }
}
let plugin
const native = () => {
  if (!inApp()) return null
  if (plugin === undefined) plugin = window.Capacitor.Plugins?.PushNotifications || window.Capacitor.registerPlugin?.('PushNotifications') || bridgePlugin('PushNotifications')
  return plugin
}
const savedToken = () => { try { return localStorage.getItem(TOKEN) || '' } catch { return '' } }
const saveToken = (t) => { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN) } catch { /* private */ } }
const nativeAllowed = async (P) => { try { return (await P.checkPermissions()).receive } catch { return 'denied' } }
let tokenWait = null
// asks Apple for this iPhone's token (it answers once per register())
const nativeToken = (P) => {
  if (tokenWait) return tokenWait
  tokenWait = new Promise((ok, no) => {
    const subs = []
    const done = (fn, v) => { clearTimeout(timer); subs.forEach((h) => { try { h.remove() } catch { /* gone */ } }); tokenWait = null; fn(v) }
    const timer = setTimeout(() => done(no, new Error('Apple did not answer. Try again in a moment.')), 20000)
    Promise.all([
      P.addListener('registration', (t) => done(ok, t.value)),
      P.addListener('registrationError', (e) => done(no, new Error(e?.error || 'Notifications could not be set up on this iPhone'))),
    ]).then((h) => { subs.push(...h); return P.register() }).catch((e) => done(no, e))
  })
  return tokenWait
}
const keepNative = async (token, preview) => {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.from('roar_push_subs').upsert({ endpoint: APNS + token, user_id: user.id, p256dh: 'apns', auth: 'apns', preview: !!preview, ua: navigator.userAgent.slice(0, 290) })
  if (error) throw error
  saveToken(token)
}
// a tapped notification opens its chat: inside the iPhone app the plugin says so (the service worker does it on the web)
export function onNotificationTap(open) {
  const P = native()
  if (!P) return () => {}
  let h = null
  let gone = false
  Promise.resolve(P.addListener('pushNotificationActionPerformed', (a) => { const room = a?.notification?.data?.room; if (room) open(room) }))
    .then((x) => { h = x; if (gone) x.remove() }).catch(() => {})
  return () => { gone = true; try { h?.remove() } catch { /* gone */ } }
}

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
  const P = native()
  if (P) return !offByHand() && !!savedToken() && (await nativeAllowed(P)) === 'granted'
  if (!pushSupported() || Notification.permission !== 'granted') return false
  return !!(await current())
}

// turned off by hand in Settings on this device: never switched back on by itself
const OFF = 'roarme-push-off'
const offByHand = () => { try { return localStorage.getItem(OFF) === '1' } catch { return false } }
const markOff = (v) => { try { if (v) localStorage.setItem(OFF, '1'); else localStorage.removeItem(OFF) } catch { /* private window */ } }

export async function pushOn(preview) {
  markOff(false)
  const P = native()
  if (P) {
    const r = (await P.requestPermissions()).receive
    if (r !== 'granted') throw new Error('Notifications are off for RoarMe. Turn them on in the iPhone\'s Settings > RoarMe > Notifications.')
    await keepNative(await nativeToken(P), preview)
    return
  }
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
  if (native()) {
    const t = savedToken()
    if (t) await supabase.from('roar_push_subs').delete().eq('endpoint', APNS + t)
    saveToken('')
    return
  }
  const sub = await current()
  if (!sub) return
  await supabase.from('roar_push_subs').delete().eq('endpoint', sub.endpoint)
  try { await sub.unsubscribe() } catch { /* already gone */ }
}

// on every start: the server still knows this browser (and whether the text may show). Allowed but not signed up
// (and not turned off by hand), it signs up by itself, so notifications ring from the first day (Alex, 3 Nov)
export async function pushSync(preview) {
  try {
    const P = native()
    if (P) {
      // a token can change; asking on every start keeps the server's copy right
      if (offByHand() || (await nativeAllowed(P)) !== 'granted') return
      const t = await nativeToken(P)
      const old = savedToken()
      if (old && old !== t) await supabase.from('roar_push_subs').delete().eq('endpoint', APNS + old)
      await keepNative(t, preview)
      return
    }
    if (!pushSupported() || Notification.permission !== 'granted') return
    const sub = await current()
    if (sub) { await registration(); await keep(sub, preview) } else if (!offByHand()) await pushOn(preview)
  } catch { /* offline, or not signed in yet */ }
}

// the first tap after installing: asks for permission and signs this device up for notifications with RoarMe closed,
// no trip to Settings needed. An iPhone allows the question only on a tap, and only from the Home Screen
export async function pushFirstTap(preview) {
  const P = native()
  if (P) {
    if (offByHand() || !String(await nativeAllowed(P)).startsWith('prompt')) return
    try { await pushOn(preview) } catch { /* not allowed: Settings > Notifications can turn it on later */ }
    return
  }
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
