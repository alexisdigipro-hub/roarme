import { useEffect, useState } from 'react'
import { accounts, addingAccount, cancelAdd } from './accounts.js'
import { USERNAME_RE, appUrl, cleanUsername, errText, supabase } from './lib.js'
import { Wordmark } from './ui.jsx'
import { pendingInvite } from './invite.jsx'
import { COUNTRIES, PhoneField, smsErr, toE164, usePhoneAuth } from './phone.jsx'
import { useAuthBg } from './authBg.js'

// the signs inside the fields (Alex, 21 Nov): an envelope, and the eye that shows or hides the password
const MAIL_I = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
const EYE_I = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
const EYE_OFF_I = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3l18 18" /><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.7M6.6 7.6A16.8 16.8 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
function PwField({ label, value, onChange, autoComplete, placeholder = 'Password' }) {
  const [shown, setShown] = useState(false)
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" type={shown ? 'text' : 'password'} autoComplete={autoComplete} required value={value} onChange={onChange} placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="lgx-ico" aria-label={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((v) => !v)}>{shown ? EYE_I : EYE_OFF_I}</button>
    </label>
  )
}

function Brand() {
  return (
    <div className="brand">
      <Wordmark by />
    </div>
  )
}

/* Sign in with a phone number (Alex, 14 Nov: "the main way, with email only an option for some"): the number, then the
   6-digit code from the SMS; the same two steps sign in and sign up. Shown first only while Supabase's phone sign-in is on. */
export function Auth() {
  const bg = useAuthBg()
  const invitedBy = pendingInvite()
  const [mode, setMode] = useState('in') // in | up | forgot (the password form)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  // the two boxes on sign-up (Alex, 24 Nov: "with ticks, to be sure"): the Terms must be ticked, the emails may be
  const [agree, setAgree] = useState(false)
  const [news, setNews] = useState(false)
  const [nudge, setNudge] = useState(false)
  // a Confirm link from the email that could not be used (emailLink.js)
  useEffect(() => {
    const on = () => setErr('This link has expired or was used already. Sign in, or ask for a new email.')
    window.addEventListener('roarme-email-link', on)
    return () => window.removeEventListener('roarme-email-link', on)
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setNote(''); setBusy(true)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'up') {
        if (password.length < 8) throw new Error('The password needs at least 8 characters.')
        if (!agree) { setNudge(true); setTimeout(() => setNudge(false), 700); throw new Error('Please agree to the Terms of Service and the Privacy Policy to continue.') }
        // when the person agreed, and whether they want the emails, kept on the account itself
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: appUrl(), data: { terms_at: new Date().toISOString(), news } } })
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

  // email and password, as RoarMe began (Alex, 14 Nov: the sign-in by a 6-digit email code is gone again)
  return (
    <div className={`auth${bg ? ' auth-own' : ''}`} style={bg ? { '--auth-img': `url("${bg}")` } : undefined}>
      {/* with the keyboard up the whole form stays in sight (Alex, 15 Nov: the keyboard covered Sign in): the whole
          card sits just over the keyboard (styles.css, html.kb .auth), and its last row is scrolled into view once it settles */}
      <form className="auth-card" onSubmit={submit} onFocus={(e) => { const f = e.currentTarget; if (e.target.tagName === 'INPUT') setTimeout(() => f.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 380) }}>
        <Brand />
        <p className="auth-tag">Born to connect. Built to roar.</p>
        {invitedBy && mode !== 'forgot' && <p className="auth-invite"><b>@{invitedBy}</b> invited you to RoarMe. {mode === 'up' ? 'Create your account and your chat opens.' : 'Sign in and your chat opens.'}</p>}
        {/* the sign-in screen is only the fields and the buttons (Alex, 14 Nov: "take out Welcome back and the words under it") */}
        {mode !== 'in' && <h1>{mode === 'up' ? 'Create your account' : 'Forgot your password?'}</h1>}
        {mode === 'forgot' && <p className="auth-sub">Type your email and we will send you a link.</p>}
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <i className="lgx-ico" aria-hidden="true">{MAIL_I}</i>
        </label>
        {mode !== 'forgot' && <PwField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} placeholder={mode === 'up' ? 'Password, at least 8 characters' : 'Password'} />}
        {err && <p className="auth-err">{err}</p>}
        {note && <p className="auth-note">{note}</p>}
        {mode === 'up' && (
          <div className="auth-checks">
            <label className={`auth-check${nudge ? ' nudge' : ''}`}>
              <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); if (e.target.checked) setErr('') }} />
              <span className="auth-box" aria-hidden="true" />
              <span className="auth-check-t">I agree to the <a href={`${appUrl()}?legal=terms`} target="_blank" rel="noreferrer">Terms of Service</a> and the <a href={`${appUrl()}?legal=privacy`} target="_blank" rel="noreferrer">Privacy Policy</a>, with no tolerance for objectionable content or abusive users.</span>
            </label>
            <label className="auth-check">
              <input type="checkbox" checked={news} onChange={(e) => setNews(e.target.checked)} />
              <span className="auth-box" aria-hidden="true" />
              <span className="auth-check-t">Send me news and updates from RoarMe by email.</span>
            </label>
          </div>
        )}
        <button className="btn btn-main" disabled={busy}>{busy ? '…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Sign up' : 'Send the link'}</button>
        <div className="auth-links">
          {mode === 'in' && <><button type="button" onClick={() => { setMode('up'); setErr('') }}>Create an account</button><button type="button" onClick={() => setMode('forgot')}>Forgot password?</button></>}
          {/* adding one more account (accounts.js): the way back to the accounts already here */}
          {addingAccount() && accounts().length > 0 && <button type="button" className="auth-back" onClick={cancelAdd}>Back to Your Account</button>}
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
        <PwField label="New password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="New password, at least 8 characters" />
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
  const [step, setStep] = useState('user') // user | name | phone | code
  // a third step, optional (Alex, 15 Nov, as WhatsApp's): the mobile number, so friends find you from their contacts;
  // shown while Supabase's phone sign-in is on (Twilio Verify), checked with an SMS code, skippable
  const phoneOn = usePhoneAuth()
  const [made, setMade] = useState(null) // the profile, once written
  const [cc, setCc] = useState(COUNTRIES[0][0])
  const [num, setNum] = useState('')
  const [code, setCode] = useState('')
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
    else if (phoneOn) { setMade(data); setStep('phone') }
    else onDone(data)
  }
  const sendCode = async (e) => {
    e.preventDefault()
    const phone = toE164(cc, num)
    if (!phone) { setErr('Check the number.'); return }
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.updateUser({ phone })
    setBusy(false)
    if (error) setErr(smsErr(error))
    else setStep('code')
  }
  const checkCode = async (e) => {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ phone: toE164(cc, num), token: code.trim(), type: 'phone_change' })
    setBusy(false)
    if (error) setErr('That code is not right. Check the SMS and try again.')
    else onDone(made)
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
      ) : step === 'phone' ? (
        <form className="ob-step" onSubmit={sendCode}>
          <h1>Your phone number</h1>
          <p className="ob-sub">Add your number and you will find more of your friends on RoarMe, and they will find you. It stays private: only people who already have your number can find you by it.</p>
          <div className="ob-field ob-phone">
            <PhoneField cc={cc} setCc={setCc} num={num} setNum={setNum} autoFocus />
            <button type="submit" className={`ob-go${num.replace(/\D/g, '').length >= 6 ? ' on' : ''}`} disabled={busy} aria-label="Send code">{busy ? '…' : GO}</button>
          </div>
          <p className={`ob-hint${err ? ' bad' : ''}`}>{err || 'We send a 6-digit code by SMS.'}</p>
          <div className="ob-links"><button type="button" className="btn btn-sm" onClick={() => onDone(made)}>Not now</button></div>
        </form>
      ) : step === 'code' ? (
        <form className="ob-step" onSubmit={checkCode}>
          <h1>The code</h1>
          <p className="ob-sub">Type the 6 digits we sent by SMS to <b>{toE164(cc, num)}</b>.</p>
          <div className="ob-field">
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus aria-label="Code" />
            <button type="submit" className={`ob-go${code.length === 6 ? ' on' : ''}`} disabled={busy || code.length < 6} aria-label="Continue">{busy ? '…' : GO}</button>
          </div>
          <p className={`ob-hint${err ? ' bad' : ''}`}>{err || ' '}</p>
          <div className="ob-links">
            <button type="button" className="btn btn-sm" onClick={() => { setErr(''); setCode(''); setStep('phone') }}>Change Number</button>
            <button type="button" className="btn btn-sm" onClick={() => onDone(made)}>Not now</button>
          </div>
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
