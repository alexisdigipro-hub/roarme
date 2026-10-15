import { useEffect, useState } from 'react'
import { supabase } from './lib.js'
import { applyMode, usePrefs } from './prefs.js'
import { Auth, NewPassword, Onboarding } from './Auth.jsx'
import Chat from './Chat.jsx'

// The order of things: sign in (or sign up) with email, then pick a @username once, then the chat.
export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(undefined)
  const [recovering, setRecovering] = useState(false)
  const { mode, lite } = usePrefs()
  useEffect(() => applyMode(mode), [mode])
  useEffect(() => { if (lite) document.documentElement.dataset.lite = '1'; else delete document.documentElement.dataset.lite }, [lite])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      setSession(s || null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id
  useEffect(() => {
    if (!uid) { setProfile(undefined); return }
    let alive = true
    supabase.from('roar_profiles').select('*').eq('id', uid).maybeSingle().then(({ data }) => { if (alive) setProfile(data || null) })
    return () => { alive = false }
  }, [uid])

  if (session === undefined || (uid && profile === undefined)) return <div className="boot"><span className="boot-mark" /></div>
  if (!session) return <Auth />
  if (recovering) return <NewPassword onDone={() => setRecovering(false)} />
  if (!profile) return <Onboarding user={session.user} onDone={setProfile} />
  return <Chat me={profile} setMe={setProfile} />
}
