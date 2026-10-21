import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { isIOS, isStandalone, onPhone } from './push.js'

/* RoarMe opened in a phone's browser: a card in the middle of the screen asks to put it on the Home Screen (Alex, 21 Oct).
   Android (Chrome, Edge, Samsung) hands the page its own install window: one tap on Install App opens it.
   An iPhone lets no page do that, so the card shows the two taps in Safari's Share menu instead.
   "Not Now" keeps it away for three days; it never shows inside the hub, in the desktop app or once installed. */

const LATER_KEY = 'roarme-install-later'
const LATER_MS = 3 * 24 * 3600 * 1000

let deferred = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; window.dispatchEvent(new Event('roar-installable')) })
  window.addEventListener('appinstalled', () => { deferred = null })
}

const wanted = () => {
  if (typeof window === 'undefined' || !onPhone() || isStandalone() || window.roarDesktop) return false
  if (document.documentElement.dataset.embed || window.parent !== window) return false
  try { return Date.now() - Number(localStorage.getItem(LATER_KEY) || 0) > LATER_MS } catch { return true }
}

const shareIco = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" /></svg>
const addIco = <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
const menuIco = <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>

export function InstallPrompt() {
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState(false)
  useEffect(() => {
    if (!wanted()) return
    const t = setTimeout(() => setOpen(true), 1500) // after the first paint, not over the splash
    return () => clearTimeout(t)
  }, [])
  if (!open) return null
  const later = () => { try { localStorage.setItem(LATER_KEY, String(Date.now())) } catch { /* private mode */ } setOpen(false) }
  const install = async () => {
    if (deferred) {
      const e = deferred
      deferred = null
      try { e.prompt(); const r = await e.userChoice; if (r?.outcome === 'accepted') { setOpen(false); return } } catch { /* falls back to the steps */ }
    }
    setSteps(true)
  }
  const ios = isIOS()
  return createPortal(
    <div className="modal-back install-back" onMouseDown={(e) => { if (e.target === e.currentTarget) later() }}>
      <div className="install-card" role="dialog" aria-label="Install RoarMe">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h2>Get the RoarMe App</h2>
        {!steps
          ? <p>Add RoarMe to your Home Screen: it opens full screen, like an app, with notifications when it is closed.</p>
          : ios
            ? <ol className="install-steps">
                <li><span className="install-ico">{shareIco}</span><span>Tap <b>Share</b> in Safari's bar</span></li>
                <li><span className="install-ico">{addIco}</span><span>Tap <b>Add to Home Screen</b></span></li>
              </ol>
            : <ol className="install-steps">
                <li><span className="install-ico">{menuIco}</span><span>Open the browser's <b>menu</b></span></li>
                <li><span className="install-ico">{addIco}</span><span>Tap <b>Add to Home Screen</b> or <b>Install App</b></span></li>
              </ol>}
        {!steps && <button type="button" className="btn btn-main install-go" onClick={install}>Install App</button>}
        <button type="button" className="btn install-later" onClick={steps ? () => setOpen(false) : later}>{steps ? 'Done' : 'Not Now'}</button>
      </div>
    </div>,
    document.body,
  )
}
