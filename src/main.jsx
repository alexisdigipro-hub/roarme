import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TransferPage } from './transfer.jsx'
import { LegalPage } from './legal.jsx'
import { InstallPrompt } from './install.jsx'
import { takeInvite } from './invite.jsx'
import { takeEmbed, takeHubLink, takeHubSignin } from './hubLink.jsx'
import './styles.css'
import { startI18n } from './i18n.js'

startI18n()

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
const scrollTimers = new WeakMap()
document.addEventListener('scroll', (e) => {
  const el = e.target === document ? document.documentElement : e.target
  if (!el?.classList) return
  el.classList.add('is-scrolling')
  clearTimeout(scrollTimers.get(el))
  scrollTimers.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900))
}, true)

// a RoarTransfer download link (?t=…) opens its own page, no account needed
const params = new window.URLSearchParams(window.location.search)
const transferToken = params.get('t')
// the Privacy Policy and the Terms (?legal=privacy | terms) are public pages too
const legalDoc = params.get('legal')
// a personal invite link (?u=username): kept until the person is signed in, then their chat opens
if (!transferToken && !legalDoc) takeInvite()
// linking this account to the THEMADLIONS hub (?link=hub&state=…): kept until signed in (hubLink.jsx)
if (!transferToken && !legalDoc) takeHubLink()
// back from the hub with a one-time sign-in code (#hub_code=…, "Sign in with THEMADLIONS Hub", hubLink.jsx)
if (!transferToken && !legalDoc) takeHubSignin()
// shown inside the hub's RoarMe page (?embed=hub): signs in through the hub without a click (hubLink.jsx)
if (!transferToken && !legalDoc) takeEmbed()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {transferToken ? <TransferPage token={transferToken} /> : legalDoc ? <LegalPage doc={legalDoc} /> : <><App /><InstallPrompt /></>}
  </StrictMode>,
)
