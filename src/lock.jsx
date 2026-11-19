import { useEffect, useRef, useState } from 'react'
import { Wordmark } from './ui.jsx'

/* Passcode Lock (Alex, 16 Oct): a code kept on this device that closes RoarMe after a while away.
   Only a salted SHA-256 of the code is stored, in this browser or app, never the code itself. */
const KEY = 'roarme-lock'
export const getLock = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } }
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const hashOf = async (code, salt) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${code}`)))

export async function setLockCode(code, after) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)))
  localStorage.setItem(KEY, JSON.stringify({ salt, hash: await hashOf(code, salt), after: after || 5 }))
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
  return !!l && (await hashOf(code, l.salt)) === l.hash
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
export async function bioAvailable() {
  try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() } catch { return false }
}
export const bioName = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'Face ID' : /Mac/.test(navigator.userAgent) ? 'Touch ID' : 'Face or fingerprint')
export async function bioOn() {
  const l = getLock()
  if (!l) return false
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
export function useAutoLock() {
  const [locked, setLocked] = useState(() => !!getLock())
  const away = useRef(Date.now())
  useEffect(() => {
    const touch = () => { away.current = Date.now() }
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
  return [locked, () => { away.current = Date.now(); setLocked(false) }]
}

export function LockScreen({ onUnlock, onSignOut }) {
  const [code, setCode] = useState('')
  const [bad, setBad] = useState(false)
  const bio = !!getLock()?.bio
  const face = async () => { if (await bioCheck()) onUnlock() }
  // asked at once when the lock shows; the button asks again (some browsers want a tap first)
  useEffect(() => { if (bio) face() }, [])
  const try1 = async (c) => {
    if (await checkCode(c)) onUnlock()
    else { setBad(true); setCode(''); setTimeout(() => setBad(false), 600) }
  }
  const press = (d) => {
    const c = (code + d).slice(0, 8)
    setCode(c)
  }
  return (
    <div className="lock">
      <div className={`lock-card${bad ? ' shake' : ''}`}>
        <Wordmark by />
        <p>Enter your passcode</p>
        <form onSubmit={(e) => { e.preventDefault(); try1(code) }}>
          <input className="lock-input" type="password" inputMode="numeric" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} aria-label="Passcode" />
        </form>
        <div className="lock-dots">{Array.from({ length: Math.max(4, code.length) }).map((_, i) => <i key={i} className={i < code.length ? 'on' : ''} />)}</div>
        <div className="lock-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)}>{d}</button>)}
          <button type="button" className="lock-ghost" onClick={() => setCode((c) => c.slice(0, -1))}>⌫</button>
          <button type="button" onClick={() => press('0')}>0</button>
          <button type="button" className="lock-go" onClick={() => try1(code)} disabled={code.length < 4}>OK</button>
        </div>
        {bio && <button type="button" className="btn lock-bio" onClick={face}>{bioName()}</button>}
        <button type="button" className="link" onClick={onSignOut}>Forgot it? Sign out</button>
      </div>
    </div>
  )
}
