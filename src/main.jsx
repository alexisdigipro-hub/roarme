import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TransferPage } from './transfer.jsx'
import { InstallPrompt } from './install.jsx'
import { takeInvite } from './invite.jsx'
import './styles.css'
import { startI18n } from './i18n.js'
import { wearTheme } from './prefs.js'

// the Privacy Policy and the Terms come only when opened, not with every start of RoarMe
const LegalPage = lazy(() => import('./legal.jsx').then((m) => ({ default: m.LegalPage })))

startI18n()
// a lab theme left on: its styles start coming now, alongside the sign-in (prefs.js wearTheme)
try { wearTheme(JSON.parse(localStorage.getItem('roarme-prefs') || '{}').theme) } catch { /* no saved look */ }

// Jost for the wordmark, from the site itself (fetched at build time into public/fonts); Futura is the fallback
try {
  const jost = new window.FontFace('Jost RoarMe', `url(${import.meta.env.BASE_URL}fonts/jost.woff2) format('woff2')`, { weight: '100 900' })
  jost.load().then((f) => document.fonts.add(f)).catch(() => {})
} catch { /* an old browser keeps the fallback */ }

// inside the RoarMe app (Mac/Windows) with no title bar: the page keeps a band for the window buttons
if (window.roarDesktop?.platform) document.documentElement.dataset.desktop = window.roarDesktop.platform

// while the window is dragged bigger or smaller, the heavy glass effects pause so the new part paints at once
// (styles.css html.win-resizing; Alex, 16 Oct: black empty space while resizing)
let resizeT = 0
window.addEventListener('resize', () => {
  document.documentElement.classList.add('win-resizing')
  clearTimeout(resizeT)
  resizeT = setTimeout(() => document.documentElement.classList.remove('win-resizing'), 180)
})

// scroll bars show only while something scrolls, then fade (Alex, 17 Oct): the scrolling box gets .is-scrolling
// a phone draws its own thin bars over the content, so there it is left alone and the list is not restyled on every scroll
const scrollTimers = new WeakMap()
if (!window.matchMedia?.('(pointer: coarse)').matches) document.addEventListener('scroll', (e) => {
  const el = e.target === document ? document.documentElement : e.target
  if (!el?.classList) return
  if (!el.classList.contains('is-scrolling')) el.classList.add('is-scrolling')
  clearTimeout(scrollTimers.get(el))
  scrollTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900))
}, true)

// on a phone, while the keyboard is up (a text field has the focus), the room kept for the home bar goes, so the
// writing box sits right on the keyboard with no gap (Alex, 21 Oct; styles.css html.kb)
if (window.matchMedia?.('(pointer: coarse)').matches) {
  const typing = (el) => el?.matches?.('textarea, [contenteditable="true"], input:not([type]), input[type=text], input[type=search], input[type=email], input[type=password], input[type=url], input[type=tel], input[type=number]')
  // the strip behind iOS's bar over the keyboard (^ v Done) shows the page's own dark background: it takes the
  // app's colour instead (the band under the clock, theme-color, set in App.jsx)
  document.addEventListener('focusin', (e) => {
    if (!typing(e.target)) return
    const c = document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
    if (c) document.documentElement.style.setProperty('--kb-bg', c)
    document.documentElement.classList.add('kb')
  })
  const down = () => { if (!typing(document.activeElement) || !document.activeElement.isConnected) { document.documentElement.classList.remove('kb'); if (window.scrollY) window.scrollTo(0, 0) } }
  document.addEventListener('focusout', () => setTimeout(down, 60))
  // a field taken off the page while it had the keyboard (closing a chat) never says focusout: the keyboard going
  // down still shrinks or grows the visible area, and that is checked too (Alex, 21 Oct: the bar at the foot hung low)
  window.visualViewport?.addEventListener('resize', () => setTimeout(down, 60))
}

// the service worker keeps the app's built files on the device, so RoarMe starts faster (public/sw.js); the desktop
// app has its own
if ('serviceWorker' in navigator && !window.roarDesktop && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}))
}

// a RoarTransfer download link (?t=…) opens its own page, no account needed
const params = new window.URLSearchParams(window.location.search)
const transferToken = params.get('t')
// the Privacy Policy and the Terms (?legal=privacy | terms) are public pages too
const legalDoc = params.get('legal')
// a personal invite link (?u=username): kept until the person is signed in, then their chat opens
if (!transferToken && !legalDoc) takeInvite()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {transferToken ? <TransferPage token={transferToken} /> : legalDoc ? <Suspense fallback={null}><LegalPage doc={legalDoc} /></Suspense> : <><App /><InstallPrompt /></>}
  </StrictMode>,
)
