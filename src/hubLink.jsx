import { useEffect, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, errText, nameOf, supabase } from './lib.js'
import { Avatar, Wordmark } from './ui.jsx'

/* Linking a RoarMe account to the THEMADLIONS hub (Alex, 20 Oct: phase 1 of the hub's chat moving onto RoarMe).
   The hub opens RoarMe in a small window at ?link=hub&state=…; the person signs in as usual and sees this page.
   Approve makes a one-time code (supabase/hub-link.sql) and hands only that code back to the window that opened
   us, and only if that window is the hub's own address. No sign-in token ever leaves RoarMe. */

export const HUB_ORIGIN = 'https://hub.themadlions.com'
const KEY = 'roarme-hub-link'
const STATE = /^[A-Za-z0-9_-]{24,64}$/

/* on load: ?link=hub&state=… is kept for this window until the person is signed in, then taken out of the address */
export function takeHubLink() {
  try {
    const q = new window.URLSearchParams(window.location.search)
    if (q.get('link') !== 'hub') return
    const state = q.get('state') || ''
    if (STATE.test(state)) sessionStorage.setItem(KEY, state)
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
  } catch { /* private window */ }
}
export const pendingHubLink = () => { try { const s = sessionStorage.getItem(KEY); return s && STATE.test(s) ? s : '' } catch { return '' } }
const clearHubLink = () => { try { sessionStorage.removeItem(KEY) } catch { /* private window */ } }

const tellHub = (msg) => {
  try { window.opener?.postMessage(msg, HUB_ORIGIN) } catch { /* the hub window is gone */ }
}

export function HubLinkPage({ me, onDone }) {
  const [state] = useState(pendingHubLink)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const fromHub = !!window.opener

  const close = () => { clearHubLink(); try { window.close() } catch { /* not our window */ } onDone() }
  const cancel = () => { tellHub({ type: 'roarme:link', state, cancelled: true }); close() }
  const approve = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('roar_hub_link_code', { link_state: state })
    if (error || !data) { setBusy(false); setErr(errText(error) || 'Could not make the link. Try again.'); return }
    tellHub({ type: 'roarme:link', state, code: data })
    setDone(true)
    clearHubLink()
    setTimeout(() => { try { window.close() } catch { /* not our window */ } onDone() }, 1200)
  }

  return (
    <div className="hub-link">
      <div className="hub-link-card">
        <Wordmark />
        <h1>Link to THEMADLIONS Hub</h1>
        <span className="hub-link-who"><Avatar src={me.avatar_url} name={nameOf(me)} size={44} /><span><b>{nameOf(me)}</b><small>@{me.username}</small></span></span>
        {!fromHub ? (
          <p className="hub-link-note">Open this from the hub: Settings, My profile, Connect RoarMe.</p>
        ) : done ? (
          <p className="hub-link-note">Linked. You can close this window.</p>
        ) : (
          <>
            <ul className="hub-link-list">
              <li>The hub knows this RoarMe account is yours.</li>
              <li>Later, the hub can add you to the group chats of the projects you work on, and take you out when you leave one.</li>
              <li>The hub never reads your chats and never gets your password.</li>
              <li>You can remove the link any time: Settings, Privacy and Security, Linked apps.</li>
            </ul>
            {err && <p className="auth-err">{err}</p>}
            <span className="hub-link-acts">
              <button type="button" className="btn" onClick={cancel} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-main" onClick={approve} disabled={busy}>{busy ? '…' : 'Approve'}</button>
            </span>
          </>
        )}
        {(!fromHub || done) && <button type="button" className="btn" onClick={close}>Continue to RoarMe</button>}
      </div>
    </div>
  )
}

/* Settings > Privacy and Security > Linked apps: the person sees the link. Since 20 Oct it is the team's (one account,
   signed in through the hub), so only a hub administrator removes it. */
export function LinkedApps({ Box }) {
  const [links, setLinks] = useState(null)
  useEffect(() => {
    supabase.from('roar_hub_links').select('hub, hub_name, linked_at').then(({ data }) => setLinks(data || []))
  }, [])
  if (!links || !links.length) return null
  return (
    <Box title="Linked apps" note="Your team's hub puts you in its project chats and takes you out. It never reads your chats. Only your team's administrator can remove this link.">
      {links.map((l) => (
        <div key={l.hub} className="set-row">
          <span className="set-text">THEMADLIONS Hub<small>{l.hub_name ? `${l.hub_name} · ` : ''}since {new Date(l.linked_at).toLocaleDateString()}</small></span>
        </div>
      ))}
    </Box>
  )
}

/* "Sign in with THEMADLIONS Hub" (Alex, 20 Oct: one account for the team, the hub's email and password).
   The button sends this tab to the hub with a random state kept here; the hub sends it back with a one-time code in the
   # part of the address; RoarMe's server checks the code with the hub's server and answers with a one-time sign-in for
   the team member's RoarMe account (made the first time). No password ever passes through RoarMe. */
const HUB_SIGNIN_KEY = 'roarme-hub-signin'
const HUB_APP = 'https://hub.themadlions.com/'

export function startHubSignin() {
  const b = crypto.getRandomValues(new Uint8Array(32))
  const state = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  try { sessionStorage.setItem(HUB_SIGNIN_KEY, JSON.stringify({ state })) } catch { /* private window */ }
  window.location.assign(`${HUB_APP}#/roarme-signin?state=${encodeURIComponent(state)}`)
}

/* on load: #hub_code=…&state=… from the hub is kept for this tab (only if the state is the one this tab made) and
   taken out of the address at once */
export function takeHubSignin() {
  try {
    const h = new window.URLSearchParams(window.location.hash.replace(/^#/, ''))
    const code = h.get('hub_code')
    if (!code) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    const kept = JSON.parse(sessionStorage.getItem(HUB_SIGNIN_KEY) || 'null')
    if (kept?.state && h.get('state') === kept.state && /^[0-9a-f]{48}$/.test(code)) {
      sessionStorage.setItem(HUB_SIGNIN_KEY, JSON.stringify({ state: kept.state, code }))
    } else {
      sessionStorage.removeItem(HUB_SIGNIN_KEY)
    }
  } catch { /* private window */ }
}
export const pendingHubSignin = () => { try { const k = JSON.parse(sessionStorage.getItem(HUB_SIGNIN_KEY) || 'null'); return k?.code ? k : null } catch { return null } }

export async function finishHubSignin() {
  const k = pendingHubSignin()
  try { sessionStorage.removeItem(HUB_SIGNIN_KEY) } catch { /* private window */ }
  if (!k) return
  const res = await fetch(`${SUPABASE_URL}/functions/v1/roar-hub-signin`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'signin', code: k.code, state: k.state }),
  })
  const out = await res.json().catch(() => null)
  if (!res.ok || !out?.token_hash) throw new Error(out?.error || 'Could not sign you in with the hub. Try again.')
  const { error } = await supabase.auth.verifyOtp({ token_hash: out.token_hash, type: 'magiclink' })
  if (error) throw new Error(errText(error))
}
