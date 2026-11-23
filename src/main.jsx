import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TransferPage } from './transfer.jsx'
import { InstallPrompt } from './install.jsx'
import { takeInvite } from './invite.jsx'
import './styles.css'
import './themes-halo.css'
import './themes-glass.css'
import './themes-frost.css' // Frost, worn only with data-frost on <html> (Alex, 14 Nov)
import { startI18n } from './i18n.js'
import { dressTheme } from './prefs.js'
import { nativeTap, swAt } from './lib.js'

// the Privacy Policy and the Terms come only when opened, not with every start of RoarMe
const LegalPage = lazy(() => import('./legal.jsx').then((m) => ({ default: m.LegalPage })))

startI18n()
// Glass, the one theme, is on <html> before the first paint (prefs.js dressTheme)
dressTheme()

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
  // a field given the focus by the page itself brings no keyboard on an iPhone: if the visible area has not shrunk a
  // moment later, the keyboard is not up and the room for the home bar comes back
  // inside the iPhone app the page itself shrinks above the keyboard, so this test would always say "no keyboard" and
  // bring back the room for the home bar, a gap over the keyboard (Alex, 14 Nov, TestFlight): there it is skipped
  const shell = !!window.Capacitor?.isNativePlatform?.()
  const noKeys = () => { const vv = window.visualViewport; if (!shell && /iPhone|iPad|iPod/.test(navigator.userAgent) && vv && vv.height > window.innerHeight - 120 && document.documentElement.classList.contains('kb')) document.documentElement.classList.remove('kb') }
  document.addEventListener('focusin', () => setTimeout(noKeys, 700))
  // the iPhone's bar of arrows and Done over the keyboard does not belong in a chat app: off inside the iPhone app
  // (Capacitor's Keyboard plugin, mobile/package.json; reached through the native bridge, as push.js does)
  // inside the iPhone app a light tap of the Taptic Engine on every button, tab and switch a finger presses (Alex, 14 Nov)
  if (shell) {
    // controls only: rows of lists (chats, people, messages) are touched to scroll too, so they tick only on a long press
    const TAP = '.round, .send, .btn, .switch, .tick, .foot button, .tabs button, .seg button, .lens button, .as-tabs button, .pf-acts > button, .menu > button, .menu-list > button, .head-card, .chip, .call-minus, .call-del-go'
    document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.target.closest?.(TAP) && !e.target.closest('[disabled]')) nativeTap('LIGHT') }, { capture: true, passive: true })
  }
  if (shell) {
    const C = window.Capacitor
    const K = C.Plugins?.Keyboard
    const off = { isVisible: false }
    try { if (K?.setAccessoryBarVisible) K.setAccessoryBarVisible(off).catch(() => {}); else C.nativePromise?.('Keyboard', 'setAccessoryBarVisible', off)?.catch?.(() => {}) } catch { /* an older shell */ }
    // the keyboard rides up with the writing box, and the page stays whole behind it (Alex, 15 Nov: the box came up
    // late, and black showed at the keyboard's round corners, where the shrunk page left the iPhone's own black):
    // the shell no longer shrinks the page (mobile/capacitor.config.json Keyboard resize none); as the keyboard starts
    // to rise, iOS says how tall it will be, and the app takes that much off its own height (#root, --kbh) on the
    // keyboard's own curve, so both move together and the page's colour stays under the keyboard's corners
    const root = document.documentElement
    const kbOn = (info) => {
      const h = Math.round(info?.keyboardHeight || 0)
      if (!h) return
      window.dispatchEvent(new Event('roarme-kb-move')) // the open chat keeps its last message in sight (Chat.jsx)
      root.style.setProperty('--kbh', `${h}px`)
      root.style.setProperty('--vvh', `${window.innerHeight - h}px`)
      root.style.setProperty('--vvt', '0px')
      root.classList.add('kb', 'kb-native')
      if (window.scrollY) window.scrollTo(0, 0)
    }
    const kbOff = () => {
      window.dispatchEvent(new Event('roarme-kb-move'))
      root.style.setProperty('--kbh', '0px')
      root.style.setProperty('--vvh', `${window.innerHeight}px`)
      root.classList.remove('kb-native')
      setTimeout(down, 60)
    }
    const listen = (ev, fn) => { try { if (K?.addListener) K.addListener(ev, fn); else C.addListener?.('Keyboard', ev, fn) } catch { /* an older shell */ } }
    listen('keyboardWillShow', kbOn)
    listen('keyboardWillHide', kbOff)
    // iOS still tries to scroll a focused field into sight: the app does that itself, so the page stays put
    window.addEventListener('scroll', () => { if (root.classList.contains('kb-native') && window.scrollY) window.scrollTo(0, 0) }, { passive: true })
    root.classList.add('in-shell')
  }
  // a field taken off the page while it had the keyboard (closing a chat) never says focusout: the keyboard going
  // down still shrinks or grows the visible area, and that is checked too (Alex, 21 Oct: the bar at the foot hung low)
  window.visualViewport?.addEventListener('resize', () => setTimeout(down, 60))
  // the part of the screen the keyboard leaves free, for windows that must fit above it (the article editor; Alex, 12 Nov:
  // "when you write you see nothing")
  const vv = window.visualViewport
  if (vv) {
    const fit = () => { if (document.documentElement.classList.contains('kb-native')) return; window.dispatchEvent(new Event('roarme-kb-move')); const r = document.documentElement.style; r.setProperty('--vvh', `${Math.round(vv.height)}px`); r.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`) }
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    fit()
  }
}

// the service worker keeps the app's built files on the device, so RoarMe starts faster (public/sw.js); the desktop
// app has its own; inside Roardino none, so the framed copy always loads fresh
if ('serviceWorker' in navigator && !window.roarDesktop && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(...swAt()).catch(() => {}))
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
