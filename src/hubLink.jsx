import { useEffect, useState } from 'react'
import { errText, nameOf, supabase } from './lib.js'
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

/* Settings > Privacy and Security > Linked apps: the person sees the link and can remove it */
export function LinkedApps({ Box, toast }) {
  const [links, setLinks] = useState(null)
  const load = async () => {
    const { data } = await supabase.from('roar_hub_links').select('hub, hub_name, linked_at')
    setLinks(data || [])
  }
  useEffect(() => { load() }, [])
  const unlink = async (l) => {
    if (!window.confirm('Remove the link to THEMADLIONS Hub? The hub will no longer be able to add you to project chats.')) return
    const { error } = await supabase.from('roar_hub_links').delete().eq('hub', l.hub)
    if (error) toast(errText(error)); else { toast('Link removed'); load() }
  }
  if (!links) return null
  return (
    <Box title="Linked apps" note={links.length ? 'A linked app can add you to its project chats and take you out. It never reads your chats.' : 'Nothing is linked to your RoarMe account.'}>
      {links.map((l) => (
        <div key={l.hub} className="set-row">
          <span className="set-text">THEMADLIONS Hub<small>{l.hub_name ? `${l.hub_name} · ` : ''}since {new Date(l.linked_at).toLocaleDateString()}</small></span>
          <button type="button" className="btn btn-sm" onClick={() => unlink(l)}>Remove</button>
        </div>
      ))}
    </Box>
  )
}
