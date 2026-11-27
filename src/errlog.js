// What goes wrong on people's devices reaches us (Alex, 27 Nov: "when the app breaks for someone, we should know at
// once"). Any error the page does not catch, and any screen that falls over (RootGuard in main.jsx), is sent once a
// visit to roar_report_error (supabase/app-errors.sql): the message, where in the code, the page, the device and the
// build. Never a message's words, a name or a file. Settings > Admin > Errors lists them.
import { supabase } from './lib.js'
import { inApp } from './push.js'

// noise every browser makes and nothing of ours: a lost connection, a stopped fetch, the resize loop warning
const NOISE = /ResizeObserver loop|Failed to fetch|Load failed|NetworkError|AbortError|The operation was aborted|cancelled|Script error\.?$|Non-Error promise rejection|The user aborted|NotAllowedError|play\(\) request was interrupted|Importing a module script failed|error loading dynamically imported module/i
const sent = new Set()
let count = 0

const device = () => {
  const ua = navigator.userAgent || ''
  const kind = inApp() ? 'iPhone app' : window.roarDesktop ? (window.roarDesktop.store ? 'Mac App Store app' : 'Desktop app') : 'Web'
  const os = /iPhone|iPad/.test(ua) ? `iOS ${(ua.match(/OS (\d+[_\d]*)/) || [])[1]?.replace(/_/g, '.') || ''}`
    : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Other'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  return [kind, os.trim(), br, `${innerWidth}×${innerHeight}`].filter(Boolean).join(' · ')
}
// the build is the name of the app's own script file, which changes with every build
const build = () => (document.querySelector('script[type="module"][src]')?.getAttribute('src') || '').split('/').pop()
// where in the app: the page's own address and what is open (the foot bar's lit tab, a chat, a window)
const place = () => {
  const tab = document.querySelector('.foot .on span:last-child')?.textContent || ''
  const bits = [tab, document.querySelector('.room-view') ? 'chat' : '', document.querySelector('.modal') ? 'window' : '', document.querySelector('.set-body') ? 'settings page' : '']
  return [location.pathname, bits.filter(Boolean).join(' / ')].filter(Boolean).join(' · ')
}

export function reportError(err, extra = '') {
  try {
    const msg = String(err?.message || err || 'Unknown error').slice(0, 500)
    if (NOISE.test(msg) || NOISE.test(String(err?.name || ''))) return
    const stack = String(err?.stack || '') + (extra ? `\n--- component\n${extra}` : '')
    const key = msg + (stack.split('\n')[1] || '')
    if (sent.has(key) || count >= 12) return
    sent.add(key); count += 1
    supabase.rpc('roar_report_error', { m: msg, st: stack.slice(0, 4000), pl: place(), dev: device(), b: build() }).then(() => {}, () => {})
  } catch { /* reporting must never break anything itself */ }
}

let started = false
export function startErrLog() {
  if (started) return
  started = true
  window.addEventListener('error', (e) => {
    // a picture or a script that fails to load is not an error of ours
    if (!e.error && e.target && e.target !== window) return
    reportError(e.error || e.message)
  })
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason))
}
