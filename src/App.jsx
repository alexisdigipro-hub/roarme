import { useEffect, useState } from 'react'
import { supabase } from './lib.js'
import { applyLook, applyMode, haloish, setPrefs, themeFor, usePrefs, wearTheme, dressTheme } from './prefs.js'
import { Auth, MfaGate, NewPassword, Onboarding } from './Auth.jsx'
import Chat from './Chat.jsx'
import { LockScreen, clearLock, useAutoLock } from './lock.jsx'
import { useWalls, wallLook } from './walls.js'

// The order of things: sign in (or sign up) with email, then pick a @username once, then the chat.
export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [recovering, setRecovering] = useState(false)
  const prefs = usePrefs()
  const { lite, theme } = prefs
  const mode = prefs.mode
  useEffect(() => applyLook(prefs), [prefs.theme, prefs.accent, prefs.accentHex, prefs.myBubble, prefs.theirBubble, prefs.bubbleR, prefs.font, prefs.density, prefs.radius, prefs.motion, prefs.focusRings, prefs.glassBubbles, prefs.mode, prefs.accentOpacity, prefs.uiText, prefs.listPanel, prefs.listPanelOp, prefs.listPanelFill, prefs.listPanelGrain, prefs.contactShape, prefs.listShape, prefs.frost, prefs.frostShape, prefs.frostList]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => applyMode(mode), [mode])
  // in Halo the whole app sits on the wallpaper chosen for the chats (Alex, 12 Nov: "the overall background follows the
  // one we chose", then: chosen apart in Settings, prefs.appBackground): the body wears what a chat wears (class app-wall, data-bg and the rest), themes-halo.css draws it
  const walls = useWalls(true)
  const appStrength = prefs.appBackground ? prefs.appWallStrength ?? prefs.wallStrength : prefs.wallStrength
  useEffect(() => {
    const b = document.body
    // Frost draws its own taupe wall (themes-frost.css, data-bg 'frost'); the chosen wallpapers wait for Glass
    const look = prefs.frost ? { 'data-bg': 'frost', style: {} } : haloish(theme) ? wallLook(prefs.appBackground || prefs.background, walls, appStrength) : null
    b.classList.toggle('app-wall', !!look)
    ;['bg', 'img', 'own', 'wop'].forEach((k) => { delete b.dataset[k] })
    ;['--wall', '--wall-op', '--wall-color', '--wop'].forEach((v) => b.style.removeProperty(v))
    if (!look) return
    if (look['data-bg']) b.dataset.bg = look['data-bg']
    ;[['img', 'data-img'], ['own', 'data-own'], ['wop', 'data-wop']].forEach(([k, a]) => { if (look[a] !== undefined) b.dataset[k] = '' })
    Object.entries(look.style || {}).forEach(([k, v]) => b.style.setProperty(k, String(v)))
  }, [theme, prefs.background, prefs.appBackground, appStrength, walls, prefs.frost])
  // the colour of the band under the clock on a phone follows day and night (Alex, 19 Oct: no black at the top)
  useEffect(() => {
    const m = document.querySelector('meta[name="theme-color"]')
    // Stone is grey stone in either mode (21 Oct)
    const set = () => { const d = document.documentElement.dataset; m?.setAttribute('content', d.frost ? (d.mode === 'light' ? '#b3a79a' : '#2a2521') : d.mode === 'light' ? '#ecedf2' : '#15151b') }
    set()
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    mq?.addEventListener?.('change', set)
    return () => mq?.removeEventListener?.('change', set)
  }, [mode, theme, prefs.frost])
  useEffect(() => { if (lite) document.documentElement.dataset.lite = '1'; else delete document.documentElement.dataset.lite }, [lite])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s || null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Two-Step Verification: an account with an authenticator app needs its 6-digit code after the password
  const [aal, setAal] = useState('')
  const token = session?.access_token
  useEffect(() => {
    if (!token) { setAal(''); return }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => setAal(data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2' ? 'need' : 'ok'))
  }, [token])
  const [locked, unlock] = useAutoLock()
  // signing in on an iPhone can leave the page scrolled up under the clock by the keyboard: back to the top once in
  useEffect(() => { if (token) window.scrollTo(0, 0) }, [token])

  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) { setProfile(undefined); return }
    let alive = true
    supabase.from('roar_people').select('*').eq('id', uid).maybeSingle().then(({ data }) => { if (alive) setProfile(data || null) })
    return () => { alive = false }
  }, [uid])
  // an account an admin blocked (supabase/suspend.sql) sees why RoarMe is empty, and can only sign out
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    if (!uid) { setBlocked(false); return }
    supabase.rpc('roar_am_blocked').then(({ data }) => setBlocked(data === true))
  }, [uid])
  // a theme still in Alex's lab shows only for him; anyone else sees Stone
  useEffect(() => {
    const t = themeFor(theme)
    wearTheme(t)
    dressTheme(t)
    // once signed in, someone left on a lab theme moves to Stone for good
    if (profile && t !== (theme || 'glass')) setPrefs({ theme: t })
  }, [theme, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (uid && profile === undefined)) return <div className="splash"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></div>
  if (!session) return <Auth />
  if (!aal) return <div className="splash"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></div>
  if (aal === 'need') return <MfaGate onDone={() => setAal('ok')} />
  if (locked) return <LockScreen onUnlock={unlock} onSignOut={() => { clearLock(); supabase.auth.signOut() }} />
  if (recovering) return <NewPassword onDone={() => setRecovering(false)} />
  if (blocked) {
    return (
      <div className="splash blocked-screen">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <b>This account is blocked</b>
        <p>It can no longer use RoarMe. If you think this is a mistake, write to info@themadlions.com.</p>
        <button type="button" className="btn" onClick={() => supabase.auth.signOut()}>Sign Out</button>
      </div>
    )
  }
  if (!profile) return <Onboarding user={session.user} onDone={setProfile} />
  return <Chat me={profile} setMe={setProfile} />
}
