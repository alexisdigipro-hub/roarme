import { useEffect, useState } from 'react'
import { supabase } from './lib.js'

/* RoarMe inside Roardino (Alex, Nov 2026): themadlions.com/social/ shows RoarMe in a frame as its Chat tab, with
   ?embed=roardino. Only then: RoarMe talks to that page alone (its origin checked, the frame's own parent), wears
   Roardino's day or night look over Stone without saving it, and leaves out its own name and the app nags.
   The protocol:
     RoarMe -> Roardino  { type: 'roarme:ready', signedIn }   once the session is known, again when it changes
     Roardino -> RoarMe  { type: 'roardino:signin', token_hash } a one-time magic-link token (as roar-connect gives);
                          used only while signed out, through supabase.auth.verifyOtp; nothing else is ever taken
     Roardino -> RoarMe  { type: 'roardino:look', theme: 'light' | 'dark' }
     Roardino -> RoarMe  { type: 'roardino:open', page: 'settings' | 'chats' | 'contacts' | 'calls' | 'room', room? }  (Alex, 5 Nov: the chat's
                          settings live in Roardino's Settings, and on a phone RoarMe's own bar is hidden) */

const params = (() => { try { return new window.URLSearchParams(window.location.search) } catch { return null } })()
export const IN_ROARDINO = params?.get('embed') === 'roardino'

const ROARDINO_ORIGIN = 'https://themadlions.com'
const okOrigin = (o) => o === ROARDINO_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(o || ''))
const PARENT_ORIGIN = (() => {
  try { const o = new URL(document.referrer).origin; if (okOrigin(o)) return o } catch { /* no referrer */ }
  return ROARDINO_ORIGIN
})()
const framed = () => { try { return window.parent && window.parent !== window } catch { return false } }

// Roardino's day or night: until it says, the computer's own setting
let look = (() => { try { return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' } catch { return 'light' } })()
const subs = new Set()
const wearLook = (t) => {
  look = t
  const r = document.documentElement
  r.classList.toggle('rd-dark', t === 'dark')
  r.classList.toggle('rd-light', t !== 'dark')
  subs.forEach((f) => f(t))
}
export function useRoardinoLook() {
  const [v, setV] = useState(look)
  useEffect(() => { subs.add(setV); setV(look); return () => { subs.delete(setV) } }, [])
  return v
}

const post = (msg) => { try { window.parent.postMessage(msg, PARENT_ORIGIN) } catch { /* the parent is gone */ } }

export function startRoardino() {
  if (!IN_ROARDINO) return
  document.documentElement.classList.add('in-roardino')
  wearLook(look)
  if (!framed()) return
  let signedIn = null
  const report = (now) => {
    if (now === signedIn) return
    signedIn = now
    post({ type: 'roarme:ready', signedIn: now })
  }
  supabase.auth.getSession().then(({ data }) => report(!!data?.session)).catch(() => report(false))
  supabase.auth.onAuthStateChange((_event, s) => report(!!s))
  let verifying = false
  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || !okOrigin(e.origin)) return
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'roardino:look') {
      if (d.theme === 'light' || d.theme === 'dark') wearLook(d.theme)
      return
    }
    if (d.type === 'roardino:open') {
      if (['settings', 'chats', 'contacts', 'calls'].includes(d.page)) window.dispatchEvent(new window.CustomEvent('roardino-open', { detail: d.page }))
      // a conversation Roardino has just opened with roar_open_direct (Message on a profile)
      else if (d.page === 'room' && typeof d.room === 'string' && /^[0-9a-f-]{36}$/.test(d.room)) window.dispatchEvent(new window.CustomEvent('roardino-open', { detail: { room: d.room } }))
      return
    }
    if (d.type === 'roardino:signin') {
      const hash = d.token_hash
      if (typeof hash !== 'string' || !/^[A-Za-z0-9_.-]{6,1024}$/.test(hash) || verifying) return
      verifying = true
      try {
        const { data } = await supabase.auth.getSession()
        // already signed in: the token is left unused
        if (!data?.session) await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: hash })
      } catch { /* the sign-in screen stays */ } finally { verifying = false }
    }
  })
}
