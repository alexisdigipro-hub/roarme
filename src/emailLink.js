/* The links in RoarMe's emails open the app (Alex, 21 Nov: "when I tap Confirm, take me to the app, not the web").
   The Confirm signup email links to https://roarme.app/?token_hash=…&type=signup (supabase/email-templates); on an
   iPhone with RoarMe that address is handed to the app (Associated Domains, public/.well-known/apple-app-site-association),
   anywhere else it opens the website. Either way the token is checked here with verifyOtp and the account is signed in. */
import { supabase } from './lib.js'

const TYPES = new Set(['signup', 'email', 'magiclink', 'invite', 'email_change', 'recovery'])
const done = new Set()

export async function takeEmailLink(url) {
  let u
  try { u = new URL(url) } catch { return false }
  const token_hash = u.searchParams.get('token_hash')
  const type = u.searchParams.get('type') || 'signup'
  if (!token_hash || !TYPES.has(type) || done.has(token_hash)) return false
  done.add(token_hash)
  const { error } = await supabase.auth.verifyOtp({ token_hash, type })
  if (error) window.dispatchEvent(new CustomEvent('roarme-email-link', { detail: { error: error.message } }))
  return !error
}

// the page's own address (the website, or the app opened cold by the link), then every link the app is handed later
export function watchEmailLinks() {
  const here = window.location.href
  if (/[?&]token_hash=/.test(here)) {
    takeEmailLink(here).finally(() => { try { window.history.replaceState(null, '', window.location.pathname + window.location.hash) } catch { /* fine */ } })
  }
  const C = window.Capacitor
  if (!C?.isNativePlatform?.()) return
  const on = (e) => { if (e?.url) takeEmailLink(e.url) }
  try {
    const A = C.Plugins?.App
    if (A?.addListener) A.addListener('appUrlOpen', on)
    else C.addListener?.('App', 'appUrlOpen', on)
    const launch = A?.getLaunchUrl ? A.getLaunchUrl() : C.nativePromise?.('App', 'getLaunchUrl', {})
    launch?.then?.((r) => on(r)).catch?.(() => {})
  } catch { /* a shell without the App plugin */ }
}
