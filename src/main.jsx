import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { TransferPage } from './transfer.jsx'
import './styles.css'
import { startI18n } from './i18n.js'

startI18n()

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

// a RoarTransfer download link (?t=…) opens its own page, no account needed
const transferToken = new window.URLSearchParams(window.location.search).get('t')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {transferToken ? <TransferPage token={transferToken} /> : <App />}
  </StrictMode>,
)
