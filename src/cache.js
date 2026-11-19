/* What RoarMe brings from the cloud is kept on the device too (Alex, 19 Nov: "whatever loads from the cloud should be on
   the phone as well, so the app is fast"). The app shows what it kept at once and brings the fresh copy behind it:
   - the chat list and the people in it: localStorage, read at once when RoarMe opens (roarme-c-rooms-<me>, -people-<me>)
   - each chat's last 60 messages: IndexedDB 'roarme-data' (key m:<room>), with a copy in memory for this visit
   - pictures: lib.js picLink ('roarme-pics')
   Signing out empties all of it (the device may not be one's own). Messages of an Encrypted Chat are kept as they come,
   locked; nothing is opened before it is kept. */
import { dropPics, supabase } from './lib.js'

const PRE = 'roarme-c-'
export const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(PRE + k) || 'null') } catch { return null } }
const lsTimers = {}
export const lsSet = (k, v, wait = 600) => {
  clearTimeout(lsTimers[k])
  lsTimers[k] = setTimeout(() => { try { localStorage.setItem(PRE + k, JSON.stringify(v)) } catch { /* full or private */ } }, wait)
}

let dbp = null
const openDb = () => {
  if (dbp) return dbp
  dbp = new Promise((ok, bad) => {
    try {
      const rq = indexedDB.open('roarme-data', 1)
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv')
      rq.onsuccess = () => ok(rq.result)
      rq.onerror = () => bad(rq.error)
    } catch (e) { bad(e) }
  }).catch(() => { dbp = null; return null })
  return dbp
}
const kv = async (mode, fn) => {
  const db = typeof indexedDB !== 'undefined' ? await openDb() : null
  if (!db) return null
  return new Promise((ok) => {
    try {
      const tx = db.transaction('kv', mode)
      const rq = fn(tx.objectStore('kv'))
      tx.oncomplete = () => ok(rq?.result ?? null)
      tx.onerror = tx.onabort = () => ok(null)
    } catch { ok(null) }
  })
}

const msgMem = new Map()
export const keptMsgs = (roomId) => msgMem.get(roomId) || null
export async function readMsgs(roomId) {
  if (msgMem.has(roomId)) return msgMem.get(roomId)
  const v = await kv('readonly', (os) => os.get(`m:${roomId}`))
  if (Array.isArray(v)) msgMem.set(roomId, v)
  return Array.isArray(v) ? v : null
}
const msgTimers = {}
export function keepMsgs(roomId, list) {
  if (!roomId || !Array.isArray(list)) return
  const last = list.filter((m) => m && m.id && !m.deleted_at).slice(-60)
  msgMem.set(roomId, last)
  clearTimeout(msgTimers[roomId])
  msgTimers[roomId] = setTimeout(() => kv('readwrite', (os) => os.put(last, `m:${roomId}`)), 900)
}

export async function dropKept() {
  msgMem.clear()
  try { Object.keys(localStorage).filter((k) => k.startsWith(PRE)).forEach((k) => localStorage.removeItem(k)) } catch { /* private */ }
  const db = dbp ? await dbp : null
  try { db?.close() } catch { /* closed */ }
  dbp = null
  await new Promise((ok) => { try { const rq = indexedDB.deleteDatabase('roarme-data'); rq.onsuccess = rq.onerror = rq.onblocked = () => ok() } catch { ok() } })
  await dropPics()
}
supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') dropKept() })
