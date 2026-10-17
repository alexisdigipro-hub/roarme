import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from './lib.js'

/* Encrypted Chat (Alex, 17 Oct): end-to-end encryption for one chat, on for a while and off again.
   - Every device (the Mac or Windows app, a browser) makes its own key pair the first time it opens RoarMe
     (ECDH P-256, WebCrypto). The private half is kept in this device's own storage and cannot be read out;
     the public half goes to roar_devices.
   - Turning it on makes one new key (AES-GCM 256) and seals a copy for every device of everyone in the chat
     (a fresh ECDH key each time, HKDF, AES-GCM), sent with roar_e2e_start. Only that device can open its copy.
   - While it is on, text is locked on the device before it is sent: body = "e2e1.<stretch>.<iv>.<locked>".
     The server keeps the locked text only. Turning it off goes back to normal; what was locked stays locked.
   See supabase/encrypted-chat.sql. */

const PREFIX = 'e2e1.'
export const E2E_ON = 'e2e:on'
export const E2E_OFF = 'e2e:off'
export const isSealed = (body) => typeof body === 'string' && body.startsWith(PREFIX)
export const stretchOf = (body) => (isSealed(body) ? body.slice(PREFIX.length).split('.')[0] : '')
// a line in the chat when someone turns it on or off
export const systemText = (body) => (body === E2E_ON ? 'turned on Encrypted Chat' : body === E2E_OFF ? 'turned off Encrypted Chat' : body)
// what a list, a notification, a search or a peek shows instead of the locked text
export const previewText = (body, kind) => (kind === 'system' || body === E2E_ON || body === E2E_OFF
  ? (body === E2E_ON ? 'Encrypted Chat on' : body === E2E_OFF ? 'Encrypted Chat off' : body)
  : isSealed(body) ? 'Encrypted message' : body)

const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
const utf8 = (s) => new TextEncoder().encode(s)
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
export const canEncrypt = () => !!globalThis.crypto?.subtle && typeof indexedDB !== 'undefined'

// this device's keys live in IndexedDB (a CryptoKey that cannot be read out can still be stored there)
const idb = () => new Promise((res, rej) => {
  const q = indexedDB.open('roarme-e2e', 1)
  q.onupgradeneeded = () => q.result.createObjectStore('keys')
  q.onsuccess = () => res(q.result)
  q.onerror = () => rej(q.error)
})
const idbDo = async (mode, fn) => {
  const db = await idb()
  return new Promise((res, rej) => {
    const tx = db.transaction('keys', mode)
    const q = fn(tx.objectStore('keys'))
    tx.oncomplete = () => { db.close(); res(q?.result) }
    tx.onerror = () => { db.close(); rej(tx.error) }
  })
}

const deviceLabel = () => {
  const ua = navigator.userAgent
  const where = /Electron\//.test(ua) ? 'RoarMe app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : ''
  return [where, os].filter(Boolean).join(' on ')
}

// this device: made once, then kept (made again if it was removed on the server)
let devicePromise = null
let deviceUser = ''
export function myDevice(userId) {
  if (devicePromise && deviceUser === userId) return devicePromise
  deviceUser = userId
  devicePromise = (async () => {
    if (!canEncrypt() || !userId) return null
    const slot = `device:${userId}`
    const kept = await idbDo('readonly', (s) => s.get(slot)).catch(() => null)
    if (kept) {
      const { data, error } = await supabase.from('roar_devices').update({ last_seen: new Date().toISOString() }).eq('id', kept.id).select('id')
      if (error || data?.length) return kept
    }
    const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
    const pub = JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y })
    const { data, error } = await supabase.from('roar_devices').insert({ public_key: pub, label: deviceLabel() }).select('id').single()
    if (error) throw error
    const dev = { id: data.id, priv: pair.privateKey, pub }
    await idbDo('readwrite', (s) => s.put(dev, slot))
    return dev
  })().catch(() => { devicePromise = null; return null })
  return devicePromise
}

// the key that seals one copy of a stretch's key for one device
async function wrapKey(priv, pubJwk, sid, deviceId) {
  const pub = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y, ext: true }, ECDH, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256)
  const hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8(sid), info: utf8(`roarme e2e ${deviceId}`) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
async function sealFor(raw, device, sid) {
  const eph = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  const k = await wrapKey(eph.privateKey, JSON.parse(device.public_key), sid, device.id)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw))
  const e = await crypto.subtle.exportKey('jwk', eph.publicKey)
  return JSON.stringify({ x: e.x, y: e.y, iv: b64(iv), ct: b64(ct) })
}

// a stretch's key, opened once from this device's copy (nothing when this device was not in it)
const stretchKeys = new Map()
function stretchKey(sid, userId) {
  if (!stretchKeys.has(sid)) {
    const p = (async () => {
      const dev = await myDevice(userId)
      if (!dev) return null
      const { data } = await supabase.from('roar_e2e_keys').select('sealed').eq('session_id', sid).eq('device_id', dev.id).maybeSingle()
      if (!data) return null
      const s = JSON.parse(data.sealed)
      const k = await wrapKey(dev.priv, s, sid, dev.id)
      const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, k, unb64(s.ct))
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
    })().catch(() => null)
    stretchKeys.set(sid, p)
    // a missing copy is looked up again a little later (a slow network, a key on its way)
    p.then((k) => { if (!k) setTimeout(() => { if (stretchKeys.get(sid) === p) stretchKeys.delete(sid) }, 15000) })
  }
  return stretchKeys.get(sid)
}
export const hasStretchKey = async (sid, userId) => !!(await stretchKey(sid, userId))

export async function sealText(text, sid, roomId, userId) {
  const k = await stretchKey(sid, userId)
  if (!k) throw new Error('This device has no key for Encrypted Chat.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`${roomId}.${sid}`) }, k, utf8(text)))
  return `${PREFIX}${sid}.${b64(iv)}.${b64(ct)}`
}

// opened text, by its locked form, for as long as the app is open
const opened = new Map()
export async function openText(body, roomId, userId) {
  if (opened.has(body)) return opened.get(body)
  const [sid, iv, ct] = body.slice(PREFIX.length).split('.')
  try {
    const k = await stretchKey(sid, userId)
    if (!k) return null
    const text = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: utf8(`${roomId}.${sid}`) }, k, unb64(ct)))
    opened.set(body, text)
    return text
  } catch { return null }
}

/* the messages of a chat with the locked ones opened: body is the text (or '' while it opens or when this device
   cannot open it), sealed is the stretch it belongs to, locked is true when this device cannot open it */
export function useOpened(list, roomId, userId, retry) {
  const [n, bump] = useState(0)
  const failed = useRef(new Set())
  useEffect(() => { failed.current = new Set(); bump((x) => x + 1) }, [retry])
  useEffect(() => {
    const todo = list.filter((m) => isSealed(m.body) && !opened.has(m.body) && !failed.current.has(m.body))
    if (!todo.length) return undefined
    let alive = true
    Promise.all(todo.map(async (m) => { if ((await openText(m.body, roomId, userId)) === null) failed.current.add(m.body) }))
      .then(() => { if (alive) bump((x) => x + 1) })
    return () => { alive = false }
  }, [list, roomId, userId, n])
  return useMemo(() => list.map((m) => (isSealed(m.body)
    ? { ...m, body: opened.get(m.body) ?? '', sealed: stretchOf(m.body), locked: failed.current.has(m.body) }
    : m)), [list, n])
}

// whether Encrypted Chat is on in a chat now: { id, started_by, started_at } or null
export function useEncrypted(roomId) {
  const [on, setOn] = useState(null)
  const load = useCallback(() => supabase.from('roar_e2e_sessions').select('id, started_by, started_at').eq('room_id', roomId).is('ended_at', null).maybeSingle()
    .then(({ data }) => setOn(data || null)), [roomId])
  useEffect(() => { setOn(null); load() }, [load])
  return [on, load]
}

// who in the chat has no device that can take a key yet (has not opened RoarMe since Encrypted Chat came)
const RECENT = 90 * 864e5
export async function withoutDevice(memberIds) {
  const { data } = await supabase.from('roar_devices').select('user_id').in('user_id', memberIds).gte('last_seen', new Date(Date.now() - RECENT).toISOString())
  const have = new Set((data || []).map((d) => d.user_id))
  return memberIds.filter((id) => !have.has(id))
}

export async function startEncrypted(roomId, memberIds, userId) {
  const dev = await myDevice(userId)
  if (!dev) throw new Error('This browser cannot keep the keys for Encrypted Chat (a private window?). Use the RoarMe app or a normal window.')
  const { data, error } = await supabase.from('roar_devices').select('id, user_id, public_key').in('user_id', memberIds).gte('last_seen', new Date(Date.now() - RECENT).toISOString())
  if (error) throw error
  const devices = (data || []).some((d) => d.id === dev.id) ? data : [...(data || []), { id: dev.id, user_id: userId, public_key: dev.pub }]
  const sid = crypto.randomUUID()
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const keys = await Promise.all(devices.map(async (d) => ({ device: d.id, sealed: await sealFor(raw, d, sid) })))
  const { error: e2 } = await supabase.rpc('roar_e2e_start', { r: roomId, sid, keys })
  if (e2) throw e2
  stretchKeys.set(sid, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  raw.fill(0)
  return sid
}

export async function endEncrypted(roomId) {
  const { error } = await supabase.rpc('roar_e2e_end', { r: roomId })
  if (error) throw error
}
