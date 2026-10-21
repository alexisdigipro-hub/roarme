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

export const appUrl = () => window.location.origin + window.location.pathname

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
export async function shrinkImage(file, max = 1920, quality = 0.85) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file
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
