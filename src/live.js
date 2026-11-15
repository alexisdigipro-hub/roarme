import { useEffect, useState } from 'react'
import { supabase } from './lib.js'

/* Live location (Alex, 15 Nov, from Telegram's). The sender's device keeps the shares it has going in localStorage
   (roarme-live: [{ id, until }]) and, while RoarMe is open, follows the phone's position and writes it to roar_live
   (supabase/live-location.sql) at most every 8 seconds; the chat's members see it move through Realtime. */
const KEY = 'roarme-live'
const EVERY = 8000
let watch = null
const last = new Map() // message id -> when it was last written

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
const write = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)) } catch { /* private window */ } }
const alive = (s) => !s.until || new Date(s.until).getTime() > Date.now()
const tell = () => window.dispatchEvent(new Event('roarme-live'))

function follow() {
  const list = read().filter(alive)
  write(list)
  if (!list.length) { if (watch !== null) { navigator.geolocation?.clearWatch(watch); watch = null } return }
  if (watch !== null || !navigator.geolocation) return
  watch = navigator.geolocation.watchPosition((pos) => {
    const now = Date.now()
    const shares = read()
    const keep = shares.filter(alive)
    if (keep.length !== shares.length) { write(keep); tell() }
    if (!keep.length) { follow(); return }
    keep.forEach((s) => {
      if (now - (last.get(s.id) || 0) < EVERY) return
      last.set(s.id, now)
      supabase.from('roar_live').update({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || null, updated_at: new Date().toISOString() }).eq('message_id', s.id).then(() => {})
    })
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 })
}

export function startLive(id, until) {
  write([...read().filter((s) => s.id !== id), { id, until }])
  last.set(id, Date.now())
  follow(); tell()
}
export async function stopLive(id) {
  write(read().filter((s) => s.id !== id))
  follow(); tell()
  await supabase.from('roar_live').update({ stopped_at: new Date().toISOString() }).eq('message_id', id)
}
export const isMyLive = (id) => read().some((s) => s.id === id && alive(s))
// at start: carry on with the shares still running
export function resumeLive() { follow() }

/* one live message's place, kept current through Realtime */
export function useLive(id) {
  const [row, setRow] = useState(null)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!id) return undefined
    let on = true
    supabase.from('roar_live').select('*').eq('message_id', id).maybeSingle().then(({ data }) => { if (on && data) setRow(data) })
    const ch = supabase.channel(`live-${id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_live', filter: `message_id=eq.${id}` }, (p) => { if (p.new) setRow(p.new) })
      .subscribe()
    const t = setInterval(() => tick((n) => n + 1), 30000) // "updated a minute ago" and the end move on by themselves
    const f = () => tick((n) => n + 1)
    window.addEventListener('roarme-live', f)
    return () => { on = false; supabase.removeChannel(ch); clearInterval(t); window.removeEventListener('roarme-live', f) }
  }, [id])
  return row
}
export const liveOn = (row) => !!row && !row.stopped_at && (!row.until || new Date(row.until).getTime() > Date.now())
