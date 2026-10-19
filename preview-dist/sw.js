// RoarMe's service worker (Alex, 18 Oct 2026): only notifications with the app closed (supabase/push.sql). It keeps
// nothing offline, so RoarMe always loads fresh. A push shows the message and puts the unread count on the icon;
// a tap opens RoarMe at that chat.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

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
