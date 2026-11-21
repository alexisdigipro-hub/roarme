/* "typing…" in the chat list (Alex, 21 Nov). Each chat has a Realtime broadcast channel, typing-<room>, named by the
   chat's id, which only its members know. While one writes, the writing box sends { u, on: true } at most every 2.5 s
   and { on: false } once the box is empty; the list shows who writes until 5 s pass with no word from them. Nothing is
   stored. watchTyping keeps channels for the chats in the list (the first 40), onTyping tells who writes where. */
import { supabase } from './lib.js'

const chans = new Map() // room -> channel
const now = new Map() // room -> { u, until }
const fans = new Set()
let me = ''
const tell = () => { const m = Object.fromEntries([...now].map(([r, v]) => [r, v.u])); fans.forEach((f) => f(m)) }
setInterval(() => { let gone = false; const t = Date.now(); now.forEach((v, r) => { if (v.until < t) { now.delete(r); gone = true } }); if (gone) tell() }, 1000)

const open = (room) => {
  if (chans.has(room)) return chans.get(room)
  const ch = supabase.channel(`typing-${room}`, { config: { broadcast: { self: false } } })
  ch.on('broadcast', { event: 't' }, ({ payload }) => {
    if (!payload?.u || payload.u === me) return
    if (payload.on) now.set(room, { u: payload.u, until: Date.now() + 5000 }); else now.delete(room)
    tell()
  }).subscribe()
  chans.set(room, ch)
  return ch
}

export function watchTyping(rooms, meId) {
  me = meId || me
  const want = new Set((rooms || []).slice(0, 40))
  chans.forEach((ch, r) => { if (!want.has(r)) { supabase.removeChannel(ch); chans.delete(r); now.delete(r) } })
  want.forEach(open)
}

export function onTyping(fn) { fans.add(fn); return () => fans.delete(fn) }

const sentAt = new Map()
export function sendTyping(room, meId, on = true) {
  if (!room || !meId) return
  me = meId
  const t = Date.now()
  if (on && t - (sentAt.get(room) || 0) < 2500) return
  if (!on && !sentAt.get(room)) return
  sentAt.set(room, on ? t : 0)
  const ch = open(room)
  ch.send({ type: 'broadcast', event: 't', payload: { u: meId, on } }).catch(() => {})
}
