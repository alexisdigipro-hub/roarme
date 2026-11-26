import { useEffect, useRef, useState } from 'react'
import { Wordmark } from './ui.jsx'
import { inApp } from './push.js'

/* Passcode Lock (Alex, 16 Oct): a code kept on this device that closes RoarMe after a while away.
   Only a salted SHA-256 of the code is stored, in this browser or app, never the code itself. */
const KEY = 'roarme-lock'
export const getLock = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } }
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const hashOf = async (code, salt) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${code}`)))

export async function setLockCode(code, after) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await hashOf(code, salt), after: after || 5, len: code.length }))
  window.dispatchEvent(new Event('roarme-lock'))
}
export function setLockAfter(after) {
  const l = getLock()
  if (!l) return
  localStorage.setItem(KEY, JSON.stringify({ ...l, after }))
  window.dispatchEvent(new Event('roarme-lock'))
}
export async function checkCode(code) {
  const l = getLock()
  const ok = !!l && (await hashOf(code, l.salt)) === l.hash
  // a lock made before its length was kept learns it the first time it opens, so the next time opens on the last digit
  if (ok && !l.len) try { localStorage.setItem(KEY, JSON.stringify({ ...l, len: code.length })) } catch { /* private */ }
  return ok
}
export function clearLock() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new Event('roarme-lock'))
}
export const lockNow = () => window.dispatchEvent(new Event('roarme-lock-now'))

/* Face ID / Touch ID (Alex, 19 Nov 2026): the phone's or computer's own unlock opens the lock instead of the code.
   A passkey made on this device only to ask for the face or the finger; nothing is sent anywhere, and the passcode
   stays as the way in when it does not work. */
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
// inside the iPhone app a passkey cannot be made (the app's page has no web address of its own), so there the phone's own
// Face ID is asked through the native plugin @capgo/capacitor-native-biometric (mobile/; plugin NativeBiometric), reached
// as Capacitor.Plugins or over the native bridge; the lock then keeps bio 'native' instead of a passkey's id
const native = () => {
  const C = typeof window !== 'undefined' ? window.Capacitor : null
  if (!inApp() || !C) return null
  const P = C.Plugins?.NativeBiometric
  if (P?.verifyIdentity) return P
  if (!C.nativePromise) return null
  return { isAvailable: (o = {}) => C.nativePromise('NativeBiometric', 'isAvailable', o), verifyIdentity: (o = {}) => C.nativePromise('NativeBiometric', 'verifyIdentity', o) }
}
const nativeAsk = async () => { try { await native().verifyIdentity({ reason: 'Unlock RoarMe', title: 'Unlock RoarMe', useFallback: false }); return true } catch { return false } }
// the Mac app (desktop/, Electron) asks the Mac's own Touch ID; the lock then keeps bio 'mac' (Alex, 26 Nov)
const macTouch = () => (typeof window !== 'undefined' ? window.roarDesktop?.touchId : null)
const macAsk = async () => { try { return !!(await macTouch()?.ask()) } catch { return false } }
export async function bioAvailable() {
  if (macTouch()) { try { return !!(await macTouch().can()) } catch { return false } }
  if (inApp()) { try { return !!(await native()?.isAvailable({ useFallback: false }))?.isAvailable } catch { return false } }
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}
export const bioName = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'Face ID' : /Mac/.test(navigator.userAgent) ? 'Touch ID' : 'Face or fingerprint')
export async function bioOn() {
  const l = getLock()
  if (!l) return false
  if (macTouch()) {
    if (!(await macAsk())) return false
    localStorage.setItem(KEY, JSON.stringify({ ...l, bio: 'mac' }))
    window.dispatchEvent(new Event('roarme-lock'))
    return true
  }
  if (inApp()) {
    if (!(await nativeAsk())) return false
    localStorage.setItem(KEY, JSON.stringify({ ...l, bio: 'native' }))
    window.dispatchEvent(new Event('roarme-lock'))
    return true
  }
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'RoarMe' },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'RoarMe lock', displayName: 'RoarMe lock' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
    timeout: 60000,
  } })
  if (!cred) return false
  localStorage.setItem(KEY, JSON.stringify({ ...l, bio: b64(cred.rawId) }))
  window.dispatchEvent(new Event('roarme-lock'))
  return true
}
export function bioOff() {
  const l = getLock()
  if (!l) return
  const { bio: _b, ...rest } = l
  localStorage.setItem(KEY, JSON.stringify(rest))
  window.dispatchEvent(new Event('roarme-lock'))
}
export async function bioCheck() {
  const l = getLock()
  if (!l?.bio) return false
  if (l.bio === 'native') return inApp() ? nativeAsk() : false
  if (l.bio === 'mac') return macTouch() ? macAsk() : false
  try {
    const got = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: unb64(l.bio), transports: ['internal'] }],
      userVerification: 'required', timeout: 60000,
    } })
    return !!got
  } catch { return false }
}

/* locked when the app opens, after the chosen minutes away or idle, or by Lock Now */
// a reload (the pull to refresh, a new version) is not opening the app (Alex, 26 Nov: "when I refresh it asks for Face
// ID again, why, it is not needed"): while unlocked the app keeps the time in sessionStorage, which a reload keeps and a
// fresh start of the app does not, and a reload inside the lock's own minutes stays open
const SEEN = 'roarme-unlocked-at'
const stamp = () => { try { sessionStorage.setItem(SEEN, String(Date.now())) } catch { /* private window */ } }
const fresh = (l) => { try { const t = Number(sessionStorage.getItem(SEEN)); return t > 0 && Date.now() - t < Math.max(1, l.after || 0) * 60000 } catch { return false } }
export function useAutoLock() {
  const [locked, setLocked] = useState(() => { const l = getLock(); return !!l && !fresh(l) })
  const away = useRef(Date.now())
  useEffect(() => {
    const touch = () => { away.current = Date.now(); if (!document.hidden) stamp() }
    const vis = () => {
      const l = getLock()
      if (document.hidden) { away.current = Date.now(); return }
      if (l && Date.now() - away.current >= l.after * 60000) setLocked(true)
      away.current = Date.now()
    }
    const tick = setInterval(() => {
      const l = getLock()
      if (l && !document.hidden && Date.now() - away.current >= l.after * 60000) setLocked(true)
    }, 15000)
    window.addEventListener('beforeunload', () => { if (!document.hidden) stamp() })
    const now = () => { if (getLock()) setLocked(true) }
    const changed = () => { if (!getLock()) setLocked(false) }
    ;['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('roarme-lock-now', now)
    window.addEventListener('roarme-lock', changed)
    return () => {
      clearInterval(tick)
      ;['pointerdown', 'keydown', 'wheel'].forEach((ev) => window.removeEventListener(ev, touch))
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('roarme-lock-now', now)
      window.removeEventListener('roarme-lock', changed)
    }
  }, [])
  useEffect(() => { if (locked) { try { sessionStorage.removeItem(SEEN) } catch { /* private window */ } } else stamp() }, [locked])
  return [locked, () => { away.current = Date.now(); setLocked(false) }]
}

export function LockScreen({ onUnlock, onSignOut }) {
  const [code, setCode] = useState('')
  const [bad, setBad] = useState(false)
  const bio = !!getLock()?.bio
  const face = async () => { if (await bioCheck()) onUnlock() }
  // asked at once when the lock shows; the button asks again (some browsers want a tap first)
  useEffect(() => {
    if (!bio) return
    if (document.hidden) document.addEventListener('visibilitychange', () => face(), { once: true }); else face()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const try1 = async (c) => {
    if (await checkCode(c)) onUnlock()
    else { setBad(true); setCode(''); setTimeout(() => setBad(false), 600) }
  }
  // no field of its own (Alex, 19 Nov: "no need for two keyboards"): a phone's own keyboard no longer comes up under
  // the keypad; a computer's keys still type, Backspace takes one off and Enter tries the code
  const codeRef = useRef('')
  codeRef.current = code
  const pressRef = useRef(null)
  useEffect(() => {
    const k = (e) => {
      if (/^\d$/.test(e.key)) { e.preventDefault(); pressRef.current(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); setCode((c) => c.slice(0, -1)) }
      else if (e.key === 'Enter') { e.preventDefault(); if (codeRef.current.length >= 4) try1(codeRef.current) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // opens on the last digit, no OK (Alex, 23 Nov): with the code's length known, the full length is tried at once
  // (a wrong one shakes); without it (a lock from before), any 4 or more digits that are right open it
  const len = getLock()?.len || 0
  const press = async (d) => {
    const c = (codeRef.current + d).slice(0, 8)
    codeRef.current = c
    setCode(c)
    if (len) { if (c.length === len) try1(c) }
    else if (c.length >= 4 && await checkCode(c)) onUnlock()
  }
  pressRef.current = press
  return (
    <div className="lock">
      <div className={`lock-card${bad ? ' shake' : ''}`}>
        <Wordmark by />
        <p>Enter your passcode</p>
        <div className="lock-dots">{Array.from({ length: Math.max(4, code.length) }).map((_, i) => <i key={i} className={i < code.length ? 'on' : ''} />)}</div>
        <div className="lock-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
          <button type="button" className="lock-ghost" onClick={() => setCode((c) => c.slice(0, -1))}>⌫</button>
          <button type="button" onClick={() => press('0')}>0</button>
          {len ? <span aria-hidden="true" /> : <button type="button" className="lock-go" onClick={() => try1(code)} disabled={code.length < 4}>OK</button>}
        </div>
        {bio && <button type="button" className="btn lock-bio" onClick={face}>{bioName()}</button>}
        <button type="button" className="link" onClick={onSignOut}>Forgot it? Sign out</button>
      </div>
    </div>
  )
}
