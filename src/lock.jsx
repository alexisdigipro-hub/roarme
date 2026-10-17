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
        <button type="button" className="link" onClick={onSignOut}>Forgot it? Sign out</button>
      </div>
    </div>
  )
}
