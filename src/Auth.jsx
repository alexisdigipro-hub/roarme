import { useEffect, useState } from 'react'
import { USERNAME_RE, appUrl, cleanUsername, errText, supabase } from './lib.js'
import { Wordmark } from './ui.jsx'
import { pendingInvite } from './invite.jsx'
import { PhoneField, showPhone, toE164, usePhoneAuth } from './phone.jsx'

function Brand() {
  return (
    <div className="brand">
      <Wordmark by />
    </div>
  )
}

/* Sign in with a phone number (Alex, 14 Nov: "the main way, with email only an option for some"): the number, then the
   6-digit code from the SMS; the same two steps sign in and sign up. Shown first only while Supabase's phone sign-in is on. */
function PhoneSignIn({ invitedBy, onEmail }) {
  const [cc, setCc] = useState('30')
  const [num, setNum] = useState('')
  const [sent, setSent] = useState('') // the number the code went to
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(0) // seconds before Send Again
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t) }, [wait])
  const send = async (e) => {
    e?.preventDefault()
    const phone = toE164(cc, num)
    if (phone.replace(/\D/g, '').length < 8) { setErr('Type your mobile number.'); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ phone })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setSent(phone); setCode(''); setWait(30)
  }
  const verify = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ phone: sent, token: code, type: 'sms' })
    setBusy(false)
    if (error) { setErr(errText(error)); setCode('') }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={sent ? verify : send}>
        <Brand />
        {invitedBy && <p className="auth-invite"><b>@{invitedBy}</b> invited you to RoarMe. Sign in and your chat opens.</p>}
        <h1>{sent ? 'Type the code' : 'Your phone number'}</h1>
        <p className="auth-sub">{sent ? `We sent a 6-digit code by SMS to ${showPhone(sent)}.` : 'We send you a code by SMS. Your friends who have your number find you on RoarMe.'}</p>
        {!sent
          ? <label className="field"><span>Mobile</span><PhoneField cc={cc} setCc={setCc} num={num} setNum={setNum} autoFocus /></label>
          : <label className="field"><span>Code</span><input className="input mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" /></label>}
        {err && <p className="auth-err">{err}</p>}
        <button className="btn btn-main" disabled={busy || (sent && code.length !== 6)}>{busy ? '…' : sent ? 'Continue' : 'Send the Code'}</button>
        {!sent && <p className="auth-legal">By continuing you accept the <a href="?legal=terms" target="_blank" rel="noreferrer">Terms of Service</a> and the <a href="?legal=privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>}
        <div className="auth-links">
          {sent
            ? <><button type="button" onClick={() => { setSent(''); setErr('') }}>Change Number</button><button type="button" disabled={wait > 0 || busy} onClick={() => send()}>{wait > 0 ? `Send Again in ${wait}s` : 'Send Again'}</button></>
            : <button type="button" onClick={onEmail}>Use Email Instead</button>}
        </div>
      </form>
    </div>
  )
}

/* Sign in with an email and a 6-digit code, no password (Alex, 14 Nov, as Wire does): the same two steps sign in and
   sign up. The code is the {{ .Token }} in Supabase's Magic Link and Confirm signup emails; the link in them works too. */
function EmailCode({ invitedBy, phoneOn, onPhone, onPassword }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [wait, setWait] = useState(0)
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t) }, [wait])
  const send = async (e) => {
    e?.preventDefault()
    const to = (sent || email).trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { setErr('Type your email.'); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email: to, options: { shouldCreateUser: true, emailRedirectTo: appUrl() } })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setSent(to); setCode(''); setWait(30)
  }
  const verify = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: sent, token: code, type: 'email' })
    setBusy(false)
    if (error) { setErr(errText(error)); setCode('') }
  }
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={sent ? verify : send}>
        <Brand />
        {invitedBy && <p className="auth-invite"><b>@{invitedBy}</b> invited you to RoarMe. Sign in and your chat opens.</p>}
        <h1>{sent ? 'Type the code' : 'Your email'}</h1>
        <p className="auth-sub">{sent ? `We sent a code to ${sent}. Type it here, or tap the link in the email.` : 'We send you a code by email. No password to remember.'}</p>
        {!sent
          ? <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          : <label className="field"><span>Code</span><input className="input mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="123456" /></label>}
        {err && <p className="auth-err">{err}</p>}
        <button className="btn btn-main" disabled={busy || (sent && code.length < 6)}>{busy ? '…' : sent ? 'Continue' : 'Send the Code'}</button>
        {!sent && <p className="auth-legal">By continuing you accept the <a href="?legal=terms" target="_blank" rel="noreferrer">Terms of Service</a> and the <a href="?legal=privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>}
        <div className="auth-links">
          {sent
            ? <><button type="button" onClick={() => { setSent(''); setErr('') }}>Change Email</button><button type="button" disabled={wait > 0 || busy} onClick={() => send()}>{wait > 0 ? `Send Again in ${wait}s` : 'Send Again'}</button></>
            : <><button type="button" onClick={onPassword}>Sign in with Password</button>{phoneOn && <button type="button" onClick={onPhone}>Use Phone Number</button>}</>}
        </div>
      </form>
    </div>
  )
}

/* Sign in, sign up, forgotten password: one card, one form at a time. */
export function Auth() {
  const invitedBy = pendingInvite()
  const phoneOn = usePhoneAuth()
  const [way, setWay] = useState('') // '' the first way (phone while it is on, else the email code) · code · password
  const [mode, setMode] = useState('in') // in | up | forgot (the password form)
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

  if (!way && phoneOn) return <PhoneSignIn invitedBy={invitedBy} onEmail={() => setWay('code')} />
  if (way !== 'password') return <EmailCode invitedBy={invitedBy} phoneOn={phoneOn} onPhone={() => setWay('')} onPassword={() => setWay('password')} />
  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        {invitedBy && mode !== 'forgot' && <p className="auth-invite"><b>@{invitedBy}</b> invited you to RoarMe. {mode === 'up' ? 'Create your account and your chat opens.' : 'Sign in and your chat opens.'}</p>}
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
        {mode === 'up' && <p className="auth-legal">By signing up you accept the <a href="?legal=terms" target="_blank" rel="noreferrer">Terms of Service</a> and the <a href="?legal=privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>}
        <div className="auth-links">
          {mode === 'in' && <><button type="button" onClick={() => setMode('up')}>Create an account</button><button type="button" onClick={() => setMode('forgot')}>Forgot password?</button></>}
          {mode !== 'in' && <button type="button" onClick={() => setMode('in')}>I have an account, sign in</button>}
        </div>
        <div className="auth-links"><button type="button" onClick={() => setWay('code')}>Sign in with a Code Instead</button></div>
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

/* The first time (Alex, 14 Nov, after Wire's): two quiet steps, one field each, the arrow inside the field.
   First the @username people find you by (checked as you type), then the name they see. */
const GO = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>

export function Onboarding({ user, onDone }) {
  const [step, setStep] = useState('user') // user | name
  const [username, setUsername] = useState(() => cleanUsername((user.email || '').split('@')[0]))
  const [free, setFree] = useState(null) // null not checked · true · false (taken)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const okShape = USERNAME_RE.test(username)
  // is it free? asked a moment after typing stops
  useEffect(() => {
    setFree(null)
    if (!okShape) return undefined
    const t = setTimeout(async () => {
      const { data } = await supabase.from('roar_people').select('id').eq('username', username).maybeSingle()
      setFree(!data)
    }, 350)
    return () => clearTimeout(t)
  }, [username, okShape])
  const next = (e) => {
    e.preventDefault()
    setErr('')
    if (!okShape) { setErr('3 to 24 characters: small letters, numbers and _.'); return }
    if (free === false) { setErr('That username is taken. Try another.'); return }
    setStep('name')
  }
  const finish = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.from('roar_profiles').insert({ id: user.id, username, display_name: name.trim() })
    const { data } = error ? {} : await supabase.from('roar_people').select('*').eq('id', user.id).single()
    setBusy(false)
    if (error) { setErr(/duplicate|unique/i.test(error.message || '') ? 'That username was just taken. Pick another.' : errText(error)); if (/duplicate|unique/i.test(error.message || '')) setStep('user') }
    else onDone(data)
  }
  return (
    <div className="auth ob">
      {step === 'user' ? (
        <form className="ob-step" onSubmit={next}>
          <h1>Your username</h1>
          <p className="ob-sub">Pick your username. It helps others find you on RoarMe and start a chat with you.</p>
          <div className={`ob-field${free === false ? ' bad' : ''}`}>
            <i>@</i>
            <input value={username} onChange={(e) => setUsername(cleanUsername(e.target.value))} placeholder="username" autoFocus autoCapitalize="none" autoCorrect="off" spellCheck="false" aria-label="Username" />
            <button type="submit" className={`ob-go${okShape && free !== false ? ' on' : ''}`} aria-label="Continue">{GO}</button>
          </div>
          <p className={`ob-hint${free === false || err ? ' bad' : free ? ' good' : ''}`}>{err || (free === false ? 'That username is taken. Try another.' : free && okShape ? 'Free ✓' : '3 to 24 characters. a to z, 0 to 9 and _ only.')}</p>
          <div className="ob-links"><button type="button" className="btn btn-sm" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
        </form>
      ) : (
        <form className="ob-step" onSubmit={finish}>
          <h1>Your name</h1>
          <p className="ob-sub">Shown on your messages, next to <b>@{username}</b>. You can change it later.</p>
          <div className="ob-field">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus aria-label="Your name" />
            <button type="submit" className="ob-go on" disabled={busy} aria-label="Continue">{busy ? '…' : GO}</button>
          </div>
          <p className={`ob-hint${err ? ' bad' : ''}`}>{err || 'You can leave it empty and your @username shows instead.'}</p>
          <div className="ob-links"><button type="button" className="btn btn-sm" onClick={() => { setErr(''); setStep('user') }}>Back</button></div>
        </form>
      )}
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
