import { createClient } from '@supabase/supabase-js'

// For now RoarMe lives in the THEMADLIONS Supabase project, in its own roar_ tables; before it goes
// public it moves to a project of its own and only these two lines change. The publishable key is
// public by design: what each person can read or write is enforced by the database (supabase/schema.sql).
export const SUPABASE_URL = 'https://naibamqexcqnqhbbqafa.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_o1OB_ohozPq1Xr2jg2ZSHA_3GsusXFL'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storageKey: 'roarme-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export const appUrl = () => window.location.origin + window.location.pathname

export const USERNAME_RE = /^[a-z0-9_]{3,24}$/
export const cleanUsername = (v) => String(v || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 24)

export const nameOf = (p) => (p ? p.display_name || `@${p.username}` : 'Someone')
export const initialsOf = (s) => String(s || '?').replace(/^@/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

export const onlineNow = (p) => !!p?.last_seen && Date.now() - new Date(p.last_seen).getTime() < 3 * 60 * 1000

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
export const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
export const listTime = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return timeOf(iso)
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-GB', { weekday: 'short' })
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
export const dayLabel = (iso) => {
  const d = new Date(iso)
  const now = new Date()
  if (sameDay(d, now)) return 'Today'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (sameDay(d, y)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
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

// signed links to files in a room, kept for the hour they are good for
const signed = new Map()
export async function fileLink(path) {
  const hit = signed.get(path)
  if (hit && hit.until > Date.now()) return hit.url
  const { data } = await supabase.storage.from('roar-files').createSignedUrl(path, 3600)
  if (data?.signedUrl) signed.set(path, { url: data.signedUrl, until: Date.now() + 3500 * 1000 })
  return data?.signedUrl || ''
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
