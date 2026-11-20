import { createClient } from '@supabase/supabase-js'
import { locale } from './i18n.js'

// RoarMe's own Supabase project (moved out of the THEMADLIONS hub's project on 16 Oct 2026).
// The publishable key is public by design: what each person can read or write is enforced by the
// database (supabase/schema.sql).
export const SUPABASE_URL = 'https://bzmjhbnwhdwmncxkqkdl.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_7mQ3e0NH5lCmdoIKx2-FUA_EgCoXx9X'

// a new key for the saved sign-in, so a login from the old project is never sent to the new one
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'roarme-auth-2', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// the address that goes into emails (confirm, reset) and invitations. Inside the iPhone app the page lives at
// capacitor://localhost, which no email can open, so there it is the website's own address (Alex, 14 Nov)
export const SITE_URL = 'https://alexisdigipro-hub.github.io/roarme/'
// inside the iPhone app (capacitor://) or the Mac App Store app (app://roarme) the page has no web address of its own
export const appUrl = () => (window.Capacitor?.isNativePlatform?.() || !/^https?:$/.test(window.location.protocol) ? SITE_URL : window.location.origin + window.location.pathname)

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/
export const cleanUsername = (v) => String(v || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24)

export const nameOf = (p) => (p ? p.display_name || `@${p.username}` : 'Someone')
export const initialsOf = (s) => String(s || '?').replace(/^@/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

export const onlineNow = (p) => !!p?.last_seen && Date.now() - new Date(p.last_seen).getTime() < 3 * 60 * 1000

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
// one formatter per locale and style, kept: making a new one for every time on screen is slow, above all on an iPhone
const fmts = new Map()
const fmt = (opts) => {
  const k = `${locale() || ''}|${JSON.stringify(opts)}`
  let f = fmts.get(k)
  if (!f) { f = new Intl.DateTimeFormat(locale() || undefined, opts); fmts.set(k, f) }
  return f
}
export const timeOf = (iso) => fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
export const listTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return timeOf(iso)
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  if (now - d < 6 * 864e5) return fmt({ weekday: 'short' }).format(d)
  return fmt({ day: 'numeric', month: 'short' }).format(d)
}
export const dayLabel = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  return fmt({ weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }).format(d)
}
export const lastSeenText = (p) => {
  if (!p?.last_seen) return ''
  if (onlineNow(p)) return 'online'
  return `last seen ${listTime(p.last_seen).toLowerCase() === 'yesterday' ? 'yesterday' : listTime(p.last_seen)}`
}

export const fmtBytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1e3))} KB`)

// a photo made smaller before it is sent, as WhatsApp and Telegram do
/* one frame of a video as a small JPEG, the poster the chat shows instead of the video itself (Alex, 15 Nov: "nothing
   heavy inside the messages, small pictures"); null when the device cannot read the video */
export function videoPoster(file, max = 640, quality = 0.72) {
  return new Promise((resolve) => {
    let done = false
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    const end = (b) => { if (done) return; done = true; clearTimeout(t); v.removeAttribute('src'); v.load?.(); URL.revokeObjectURL(url); resolve(b) }
    const t = setTimeout(() => end(null), 6000)
    v.muted = true; v.playsInline = true; v.preload = 'auto'
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 3) } catch { end(null) } }
    v.onseeked = () => {
      try {
        const w = v.videoWidth; const h = v.videoHeight
        if (!w || !h) { end(null); return }
        const k = Math.min(1, max / Math.max(w, h))
        const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k)
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        c.toBlob((b) => end(b ? new File([b], 'poster.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', quality)
      } catch { end(null) }
    }
    v.onerror = () => end(null)
    v.src = url
  })
}

export async function shrinkImage(file, max = 1920, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url })
    const k = Math.min(1, max / Math.max(img.width, img.height))
    if (k === 1 && file.size < 1.5e6) return file
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', quality))
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}

// signed links to files in a room, kept for the hour they are good for. Takes the message's file
// ({ path, bucket }) or a bare path; RoarTransfer files live in their own bucket
const signed = new Map()
export const TRANSFER_BUCKET = 'roar-transfers'
// a photo's small copy, for the chat and the media grids; the whole photo opens full screen (Alex, 21 Oct: lighter)
export const thumbOf = (file) => (file?.thumb ? { path: file.thumb, bucket: file.bucket } : file)
/* Pictures kept on the device (Alex, 19 Nov: "the pictures are slow to load"): a file's signed link changes every time,
   so neither the browser nor the iPhone app ever found a picture it had already fetched, and every chat fetched its
   photos again. picLink(file) keeps each small picture (a photo's thumb, a video's frame, any photo) in IndexedDB under
   its own place in storage, which never changes, and hands back a local link to it; only the first time it is fetched.
   At most PIC_MAX pictures stay; the oldest go first. Settings > Data and Storage > Clear Cache empties it (dropPics),
   and Storage Usage counts it. Where IndexedDB is missing it falls back to the signed link. */
const PIC_DB = 'roarme-pics'
const PIC_MAX = 2000
const picMem = new Map() // key -> local link, for this visit
const picWait = new Map() // key -> the fetch under way
let picDb = null
const openPics = () => {
  if (picDb) return picDb
  picDb = new Promise((ok, bad) => {
    try {
      const rq = indexedDB.open(PIC_DB, 1)
      rq.onupgradeneeded = () => { const os = rq.result.createObjectStore('pics'); os.createIndex('at', 'at') }
      rq.onsuccess = () => ok(rq.result)
      rq.onerror = () => bad(rq.error)
    } catch (e) { bad(e) }
  }).catch(() => { picDb = null; return null })
  return picDb
}
const picTx = (db, mode, fn) => new Promise((ok) => {
  try {
    const tx = db.transaction('pics', mode)
    const out = fn(tx.objectStore('pics'))
    tx.oncomplete = () => ok(out?.result ?? out)
    tx.onerror = tx.onabort = () => ok(null)
  } catch { ok(null) }
})
let picPuts = 0
async function trimPics(db) {
  const n = await picTx(db, 'readonly', (os) => os.count())
  if (!(n > PIC_MAX)) return
  let drop = n - Math.round(PIC_MAX * 0.85)
  await picTx(db, 'readwrite', (os) => { const c = os.index('at').openCursor(); c.onsuccess = () => { const cur = c.result; if (cur && drop-- > 0) { cur.delete(); cur.continue() } } })
}
// a picture already opened in this visit, at once (no wait, so a chat that opens again draws it in the first frame)
export function picNow(file) {
  const path = typeof file === 'string' ? file : file?.path
  if (!path) return ''
  return picMem.get(`${(typeof file === 'object' && file?.bucket) || 'roar-files'}|${path}`) || ''
}
export async function picLink(file) {
  const path = typeof file === 'string' ? file : file?.path
  if (!path) return ''
  const bucket = (typeof file === 'object' && file?.bucket) || 'roar-files'
  const key = `${bucket}|${path}`
  // only pictures: a video or a sound handed over (an old message with no frame of its own) or a big file keeps its link
  if (typeof file === 'object' && (/^(video|audio)\//.test(file.type || '') || file.size > 8e6)) return fileLink(file)
  if (picMem.has(key)) return picMem.get(key)
  if (picWait.has(key)) return picWait.get(key)
  const job = (async () => {
    const db = typeof indexedDB !== 'undefined' ? await openPics() : null
    if (!db) return fileLink(file)
    const hit = await picTx(db, 'readonly', (os) => os.get(key))
    if (hit?.blob) { const u = URL.createObjectURL(hit.blob); picMem.set(key, u); return u }
    const url = await fileLink(file)
    if (!url) return ''
    try {
      const res = await fetch(url)
      if (!res.ok) return url
      const blob = await res.blob()
      await picTx(db, 'readwrite', (os) => os.put({ blob, at: Date.now() }, key))
      if (++picPuts % 40 === 0) trimPics(db)
      const u = URL.createObjectURL(blob)
      picMem.set(key, u)
      return u
    } catch { return url }
  })()
  picWait.set(key, job)
  try { return await job } finally { picWait.delete(key) }
}
export async function dropPics() {
  picMem.forEach((u) => { try { URL.revokeObjectURL(u) } catch { /* gone */ } })
  picMem.clear()
  const db = picDb ? await picDb : null
  try { db?.close() } catch { /* closed */ }
  picDb = null
  await new Promise((ok) => { try { const rq = indexedDB.deleteDatabase(PIC_DB); rq.onsuccess = rq.onerror = rq.onblocked = () => ok() } catch { ok() } })
}

export async function fileLink(file, download = '') {
  const path = typeof file === 'string' ? file : file?.path
  if (!path) return ''
  const bucket = (typeof file === 'object' && file?.bucket) || 'roar-files'
  const key = `${bucket}|${path}|${download}`
  const hit = signed.get(key)
  if (hit && hit.until > Date.now()) return hit.url
  if (!download) return batchLink(bucket, path, key)
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
  const url = data?.signedUrl ? withName(data.signedUrl, download) : ''
  if (url) signed.set(key, { url, until: Date.now() + 3500 * 1000 })
  return url
}
/* a download link that saves under the file's real name, Greek, spaces, & and all (Alex, 21 Oct: a RoarTransfer came down
   as "%CE%93%CE%B9…"): the name goes in encoded exactly once. supabase-js leaves it raw or, in the Edge Function, encodes
   it twice; any download= already there is replaced */
export function withName(url, name) {
  if (!url || !name || name === true) return url
  try {
    const u = new URL(url)
    u.searchParams.delete('download')
    return `${u.toString()}${u.search ? '&' : '?'}download=${encodeURIComponent(name)}`
  } catch { return url }
}
/* the links asked for in the same moment (a chat opening with twenty photos) go to the server as one request,
   not twenty (Alex, 21 Oct: RoarMe lighter) */
const waiting = new Map() // bucket -> Map(path -> [{ key, resolve }])
function batchLink(bucket, path, key) {
  return new Promise((resolve) => {
    let q = waiting.get(bucket)
    if (!q) {
      q = new Map()
      waiting.set(bucket, q)
      setTimeout(async () => {
        waiting.delete(bucket)
        const paths = [...q.keys()]
        let rows = []
        try { rows = (await supabase.storage.from(bucket).createSignedUrls(paths, 3600)).data || [] } catch { rows = [] }
        const byPath = Object.fromEntries(rows.filter((r) => r?.signedUrl).map((r) => [r.path, r.signedUrl]))
        q.forEach((list, p) => list.forEach((w) => {
          const url = byPath[p] || ''
          if (url) signed.set(w.key, { url, until: Date.now() + 3500 * 1000 })
          w.resolve(url)
        }))
      }, 30)
    }
    if (!q.has(path)) q.set(path, [])
    q.get(path).push({ key, resolve })
  })
}

export const errText = (e) => {
  const m = e?.message || String(e || 'Something went wrong')
  if (/duplicate key|roar_profiles_username/i.test(m)) return 'That username is taken.'
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.'
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent you.'
  return m
}

/* An upload that tells how far it has got (the Supabase library does not), and can be stopped:
   holder.abort() stops it. onProgress gets 0..1. */
export async function uploadWithProgress(bucket, path, file, type, onProgress, holder = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', SUPABASE_KEY)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('Content-Type', type || 'application/octet-stream')
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(1); resolve() }
      else { let m = `Upload failed (${xhr.status})`; try { m = JSON.parse(xhr.responseText).message || m } catch { /* plain text */ } reject(new Error(m)) }
    }
    xhr.onerror = () => reject(new Error('The upload stopped. Check the connection and try again.'))
    xhr.onabort = () => { const e = new Error('Cancelled'); e.cancelled = true; reject(e) }
    holder.abort = () => xhr.abort()
    xhr.send(file)
  })
}

/* RoarTransfer (Alex, 16 Oct): a big file (up to 3 GB) goes up in 6 MB pieces through Supabase's resumable
   upload (TUS), so a dropped connection picks up where it stopped instead of starting over. Same holder and
   onProgress as uploadWithProgress. */
const TUS_URL = SUPABASE_URL.replace('.supabase.co', '.storage.supabase.co') + '/storage/v1/upload/resumable'
const PIECE = 6 * 1024 * 1024
const b64 = (t) => { let s = ''; new TextEncoder().encode(t).forEach((c) => { s += String.fromCharCode(c) }); return btoa(s) }
const tokenNow = async () => {
  const { data } = await supabase.auth.getSession()
  const t = data?.session?.access_token
  if (!t) throw new Error('Not signed in')
  return t
}
export async function tusUpload(bucket, path, file, type, onProgress, holder = {}) {
  let stopped = false
  let xhr = null
  holder.abort = () => { stopped = true; xhr?.abort() }
  const cancelled = () => { const e = new Error('Cancelled'); e.cancelled = true; return e }
  const call = (method, url, headers, body, onUp) => new Promise((resolve, reject) => {
    if (stopped) { reject(cancelled()); return }
    xhr = new XMLHttpRequest()
    xhr.open(method, url)
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v))
    if (onUp) xhr.upload.onprogress = (e) => onUp(e.loaded)
    xhr.onload = () => resolve(xhr)
    xhr.onerror = () => reject(new Error('The upload stopped. Check the connection and try again.'))
    xhr.onabort = () => reject(cancelled())
    xhr.send(body ?? null)
  })
  const base = async () => ({ Authorization: `Bearer ${await tokenNow()}`, apikey: SUPABASE_KEY, 'Tus-Resumable': '1.0.0' })
  const failed = (r) => { let m = `Upload failed (${r.status})`; try { m = JSON.parse(r.responseText).message || m } catch { /* plain text */ } return new Error(m) }

  const made = await call('POST', TUS_URL, {
    ...(await base()), 'Upload-Length': String(file.size), 'x-upsert': 'false',
    'Upload-Metadata': [['bucketName', bucket], ['objectName', path], ['contentType', type || 'application/octet-stream'], ['cacheControl', '3600']].map(([k, v]) => `${k} ${b64(v)}`).join(','),
  })
  if (made.status === 413) throw new Error('Too big for the server right now: its upload limit (Supabase > Storage > Settings) is below this file.')
  if (made.status !== 201) throw failed(made)
  const loc = made.getResponseHeader('Location') || ''
  const at = /^https?:/.test(loc) ? loc : new URL(loc, TUS_URL).href
  let offset = 0
  let tries = 0
  while (offset < file.size) {
    const piece = file.slice(offset, Math.min(offset + PIECE, file.size))
    try {
      const r = await call('PATCH', at, { ...(await base()), 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' }, piece, (n) => onProgress?.((offset + n) / file.size))
      if (r.status === 204) { offset = Number(r.getResponseHeader('Upload-Offset')) || offset + piece.size; tries = 0; onProgress?.(offset / file.size); continue }
      if (r.status !== 409 && r.status < 500) throw failed(r)
      throw new Error(`Upload failed (${r.status})`)
    } catch (e) {
      if (e?.cancelled || stopped) throw cancelled()
      tries += 1
      if (tries > 6) throw e
      // wait a little, then ask the server how far it really got and go on from there
      await new Promise((ok) => setTimeout(ok, Math.min(30000, 1000 * 2 ** tries)))
      try { const h = await call('HEAD', at, await base()); if (h.status === 200) offset = Number(h.getResponseHeader('Upload-Offset')) || offset } catch (x) { if (x?.cancelled) throw x }
    }
  }
  onProgress?.(1)
}

/* A short tick under the finger (Alex, 8 Nov: "a small vibration, as every app does, so I know the long press took").
   Android and most browsers: navigator.vibrate. An iPhone has no vibrate for web pages, but Safari (iOS 18 and later)
   gives the system's own tick when a switch-style checkbox is toggled, so one hidden switch is clicked. Anything else:
   nothing, quietly. */
export const isIPhone = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
// Safari ticks only inside a real tap (a click, or the finger lifting): never from a timer while the finger is still down.
// A fresh hidden switch each time, put in and taken out at once, as Safari expects (Alex, 8 Nov: no tick was felt)
// text as a search compares it (Alex, 12 Nov: "the search should find it without accents too"): lower case, the accents
// and the Greek diaeresis taken off (ά -> α, ϊ -> ι, é -> e), and the final ς read as σ
export const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ')
export const foldHas = (hay, needle) => fold(hay).includes(fold(needle))
// the same, letter for letter, keeping the text's length (for marking the words found in it)
export const foldKeep = (s) => [...String(s || '')].map((c) => { const f = fold(c); return f.length === 1 ? f : c }).join('')
// a search for the database that does not mind accents (Postgres ~*, case is already ignored): each letter matches itself
// with or without its accent, everything else matches itself
const ACC = { α: 'αά', ε: 'εέ', η: 'ηή', ι: 'ιίϊΐ', ο: 'οό', υ: 'υύϋΰ', ω: 'ωώ', σ: 'σς', a: 'aàáâäã', e: 'eèéêë', i: 'iìíîï', o: 'oòóôöõ', u: 'uùúûü', c: 'cç', n: 'nñ' }
export const foldRx = (t) => [...fold(t)].map((c) => (ACC[c] ? `[${ACC[c]}]` : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')

// inside the iPhone app the phone's own Taptic Engine answers (Capacitor's Haptics, mobile/package.json; Alex, 14 Nov:
// "a small click wherever I press"): a light tap for a touch, a firmer one for a long press
export function nativeTap(style = 'LIGHT') {
  const C = typeof window !== 'undefined' && window.Capacitor
  if (!C?.isNativePlatform?.()) return false
  try {
    const H = C.Plugins?.Haptics
    const p = H?.impact ? H.impact({ style }) : C.nativePromise?.('Haptics', 'impact', { style })
    p?.catch?.(() => {})
    return true
  } catch { return false }
}
export function haptic(ms = 10) {
  try {
    if (nativeTap(ms > 10 ? 'MEDIUM' : 'LIGHT')) return
    if (navigator.vibrate && navigator.vibrate(ms)) return
    if (!isIPhone()) return
    const label = document.createElement('label')
    label.setAttribute('aria-hidden', 'true')
    label.style.display = 'none'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.setAttribute('switch', '')
    label.appendChild(box)
    document.head.appendChild(label)
    label.click()
    document.head.removeChild(label)
  } catch { /* no tick here */ }
}
