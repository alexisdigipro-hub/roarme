import { useState } from 'react'
import { USERNAME_RE, appUrl, cleanUsername, errText, supabase } from './lib.js'
import { Wordmark } from './ui.jsx'

function Brand() {
  return (
    <div className="brand">
      <Wordmark size={30} />
    </div>
  )
}

/* Sign in, sign up, forgotten password: one card, one form at a time. */
export function Auth() {
  const [mode, setMode] = useState('in') // in | up | forgot
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'up') {
        if (password.length < 8) throw new Error('The password needs at least 8 characters.')
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl() } })
        if (error) throw error
        if (!data.session) setNote('Almost there: open the link we sent to your email, then sign in here.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() })
        if (error) throw error
        setNote('If there is an account with that email, a link to set a new password is on its way.')
      }
    } catch (x) {
      setErr(errText(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>{mode === 'in' ? 'Welcome back' : mode === 'up' ? 'Create your account' : 'Forgot your password?'}</h1>
        <p className="auth-sub">{mode === 'forgot' ? 'Type your email and we will send you a link.' : 'Chats, groups, photos and files, between the people you choose.'}</p>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </label>
        {mode !== 'forgot' && (
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'up' ? 'At least 8 characters' : ''} />
          </label>
        )}
        {err && <p className="auth-err">{err}</p>}
        {note && <p className="auth-note">{note}</p>}
        <button className="btn btn-main" disabled={busy}>{busy ? '…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Sign up' : 'Send the link'}</button>
        <div className="auth-links">
          {mode === 'in' && <><button type="button" onClick={() => setMode('up')}>Create an account</button><button type="button" onClick={() => setMode('forgot')}>Forgot password?</button></>}
          {mode !== 'in' && <button type="button" onClick={() => setMode('in')}>I have an account, sign in</button>}
        </div>
      </form>
    </div>
  )
}

/* After the link in the "new password" email. */
export function NewPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setErr('The password needs at least 8 characters.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setErr(errText(error))
    else onDone()
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>Set a new password</h1>
        <label className="field">
          <span>New password</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </label>
        {err && <p className="auth-err">{err}</p>}
        <button className="btn btn-main" disabled={busy}>{busy ? '…' : 'Save'}</button>
      </form>
    </div>
  )
}

/* The first time: the @username people find you by, and the name they see. */
export function Onboarding({ user, onDone }) {
  const [username, setUsername] = useState(() => cleanUsername((user.email || '').split('@')[0]))
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!USERNAME_RE.test(username)) { setErr('3 to 24 characters: small letters, numbers and _.'); return }
    setBusy(true)
    const { error } = await supabase.from('roar_profiles').insert({ id: user.id, username, display_name: name.trim() })
    const { data } = error ? {} : await supabase.from('roar_people').select('*').eq('id', user.id).single()
    setBusy(false)
    if (error) setErr(errText(error))
    else onDone(data)
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>Pick your username</h1>
        <p className="auth-sub">People find you by it. You can change your name later.</p>
        <label className="field">
          <span>Username</span>
          <div className="input-at"><i>@</i><input className="input" value={username} onChange={(e) => setUsername(cleanUsername(e.target.value))} autoFocus /></div>
        </label>
        <label className="field">
          <span>Your name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on your messages" />
        </label>
        {err && <p className="auth-err">{err}</p>}
        <button className="btn btn-main" disabled={busy}>{busy ? '…' : 'Continue'}</button>
        <div className="auth-links"><button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </form>
    </div>
  )
}

/* the second step: the 6-digit code from the authenticator app (Settings > Privacy and Security) */
export function MfaGate({ onDone }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { data } = await supabase.auth.mfa.listFactors()
    const f = (data?.totp || []).find((x) => x.status === 'verified')
    const { error } = f ? await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.trim() }) : { error: { message: 'No authenticator found for this account.' } }
    setBusy(false)
    if (error) { setErr(errText(error)); setCode('') } else onDone()
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>Two-step verification</h1>
        <p className="auth-sub">Type the 6-digit code from your authenticator app.</p>
        <label className="field"><span>Code</span><input className="input mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" /></label>
        {err && <p className="auth-err">{err}</p>}
        <button type="submit" className="btn btn-main" disabled={busy || code.length !== 6}>{busy ? '…' : 'Continue'}</button>
        <div className="auth-links"><button type="button" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </form>
    </div>
  )
}
