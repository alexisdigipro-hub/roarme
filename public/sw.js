// RoarMe's service worker (Alex, 18 Oct 2026): notifications with the app closed (supabase/push.sql), and the app's
// built files kept on the device (below); the page itself always loads fresh. A push shows the message and puts the unread count on the icon;
// a tap opens RoarMe at that chat.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// the app's own built files (assets/, each name carries its own fingerprint, so a file never changes under its name)
// are kept on the device: RoarMe starts without fetching them again. The page itself always comes fresh, so a new
// version is there on the next start as before (Alex, 21 Oct: RoarMe lighter)
const ASSETS = 'roarme-assets-1'
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (!url.href.startsWith(new URL('./assets/', self.registration.scope).href)) return
  e.respondWith((async () => {
    const cache = await caches.open(ASSETS)
    const hit = await cache.match(req)
    if (hit) return hit
    const res = await fetch(req)
    if (res.ok) {
      cache.put(req, res.clone())
      // only the newest few versions are kept
      cache.keys().then((keys) => keys.slice(0, Math.max(0, keys.length - 40)).forEach((k) => cache.delete(k)))
    }
    return res
  })())
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    if (typeof d.count === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
      try { if (d.count > 0) await self.navigator.setAppBadge(d.count); else await self.navigator.clearAppBadge() } catch { /* no badge here */ }
    }
    await self.registration.showNotification(d.title || 'RoarMe', {
      body: d.body || 'New message',
      tag: d.tag || 'roarme',
      renotify: true,
      icon: 'icon-512.png',
      badge: 'icon-512.png',
      data: { room: d.room || '' },
    })
  })())
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const room = (e.notification.data && e.notification.data.room) || ''
  const url = new URL(room ? `./#c=${room}` : './', self.registration.scope).href
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = list.find((c) => c.url.startsWith(self.registration.scope))
    if (open) {
      await open.focus()
      if (room) open.postMessage({ roarOpen: room })
      return
    }
    await self.clients.openWindow(url)
  })())
})
