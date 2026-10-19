import { useEffect, useState } from 'react'
import { supabase } from './lib.js'
import { applyLook, applyMode, setPrefs, themeFor, usePrefs } from './prefs.js'
import { Auth, MfaGate, NewPassword, Onboarding } from './Auth.jsx'
import Chat from './Chat.jsx'
import { LockScreen, clearLock, useAutoLock } from './lock.jsx'

// The order of things: sign in (or sign up) with email, then pick a @username once, then the chat.
export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [recovering, setRecovering] = useState(false)
  const prefs = usePrefs()
  const { mode, lite, theme } = prefs
  useEffect(() => applyLook(prefs), [prefs.accent, prefs.font, prefs.density, prefs.radius, prefs.motion, prefs.focusRings, prefs.glassBubbles]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => applyMode(mode), [mode])
  // the colour of the band under the clock on a phone follows day and night (Alex, 19 Oct: no black at the top)
  useEffect(() => {
    const m = document.querySelector('meta[name="theme-color"]')
    const set = () => m?.setAttribute('content', document.documentElement.dataset.mode === 'light' ? '#eef2f7' : '#383d46')
    set()
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    mq?.addEventListener?.('change', set)
    return () => mq?.removeEventListener?.('change', set)
  }, [mode])
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
  // a theme still in Alex's lab shows only for him; anyone else sees Simba
  useEffect(() => {
    const t = themeFor(theme, profile)
    document.documentElement.dataset.theme = t
    // once signed in, someone left on a lab theme moves to Simba for good
    if (profile && t !== (theme || 'ember')) setPrefs({ theme: t })
  }, [theme, profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (uid && profile === undefined)) return <div className="splash"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></div>
  if (!session) return <Auth />
  if (!aal) return <div className="splash"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /></div>
  if (aal === 'need') return <MfaGate onDone={() => setAal('ok')} />
  if (locked) return <LockScreen onUnlock={unlock} onSignOut={() => { clearLock(); supabase.auth.signOut() }} />
  if (recovering) return <NewPassword onDone={() => setRecovering(false)} />
  if (!profile) return <Onboarding user={session.user} onDone={setProfile} />
  return <Chat me={profile} setMe={setProfile} />
}
