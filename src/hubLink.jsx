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

/* RoarMe inside the hub (Alex, 20 Oct: phase 4). The hub's RoarMe page shows this app in a frame at ?embed=hub.
   Signing in needs no click: this frame makes a state and asks the hub page around it (only https://hub.themadlions.com)
   for a one-time code; the hub page gets one from its own server for its signed-in member and hands it back to this
   frame only (it checks the frame's address). Then the usual sign-in with the code runs (finishHubSignin).
   The hub page also says which hub member it is; a frame signed in as someone else signs out and starts again. */
const EMBED_KEY = 'roarme-embed'
export function takeEmbed() {
  try {
    const q = new window.URLSearchParams(window.location.search)
    if (q.get('embed') === 'hub' && window.parent !== window) sessionStorage.setItem(EMBED_KEY, 'hub')
    if (sessionStorage.getItem(EMBED_KEY) === 'hub' && window.parent !== window) { document.documentElement.dataset.embed = 'hub'; followHubLook() }
  } catch { /* private window */ }
}
export const isHubEmbed = () => { try { return window.parent !== window && sessionStorage.getItem(EMBED_KEY) === 'hub' } catch { return false } }

const askHub = (msg) => { try { window.parent.postMessage(msg, HUB_ORIGIN) } catch { /* no hub around us */ } }

export function embeddedHubSignin() {
  return new Promise((resolve, reject) => {
    const b = crypto.getRandomValues(new Uint8Array(32))
    const state = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const done = (fn) => { window.removeEventListener('message', onMsg); clearTimeout(t); fn() }
    const onMsg = (e) => {
      if (e.origin !== HUB_ORIGIN || e.source !== window.parent) return
      const m = e.data
      if (!m || m.type !== 'roarme:hub-code' || m.state !== state) return
      if (m.error || !/^[0-9a-f]{48}$/.test(String(m.code || ''))) { done(() => reject(new Error(m.error || 'The hub could not sign you in.'))); return }
      try { sessionStorage.setItem(HUB_SIGNIN_KEY, JSON.stringify({ state, code: m.code })) } catch { /* private window */ }
      done(() => finishHubSignin().then(resolve, reject))
    }
    const t = setTimeout(() => done(() => reject(new Error('The hub did not answer. Reload the page.'))), 20000)
    window.addEventListener('message', onMsg)
    askHub({ type: 'roarme:need-signin', state })
  })
}

/* The hub's look inside the hub (Alex, 27 Oct: "now it looks foreign"): the hub page sends its colours, light or dark,
   backdrop and typeface (roarme:hub-look, only from https://hub.themadlions.com) and sends them again when Settings >
   Display changes. RoarMe wears them as the 'hub' theme: its plain glass look (no Stone) with the hub's colours on
   top, written as one style sheet so a person's own accent or mode cannot override them here. The last look is kept
   on this device, so the next start shows it from the first frame. Outside the hub nothing changes. */
const LOOK_KEY = 'roarme-hub-look'
const cssOk = (s) => typeof s === 'string' && s.length < 1500 && !/url\(|@import|expression|[;{}<>\\]/i.test(s)
const FONT_CSS = /^https:\/\/fonts\.googleapis\.com\/css2?\?[^"'<>\s]+$/

function wearHubLook(l) {
  if (!l || typeof l !== 'object') return
  const v = (k) => (cssOk(l[k]) ? l[k].trim() : '')
  const light = l.light === true
  const text = v('text') || (light ? '#1f2430' : '#eef3fa')
  const accent = v('accent'), panel = v('panel'), mix = (c, p, w = 'transparent') => `color-mix(in srgb, ${c} ${p}%, ${w})`
  const vars = {
    '--bg': v('bg'), '--panel': panel, '--text': text, '--muted': v('muted'),
    '--glass': v('glFill') || mix(text, light ? 5 : 6), '--glass-2': v('glFill2') || mix(text, light ? 9 : 11),
    '--edge': v('glEdge') || mix(text, light ? 12 : 10), '--edge-2': mix(text, 22),
    '--accent': accent, '--accent-2': accent, '--accent-ink': v('accentInk'),
    '--mine': accent && (light ? accent : mix(accent, 55, panel || '#141b27')), '--mine-ink': light ? v('accentInk') : '',
    '--theirs': light ? panel : v('glFill2') || v('raised'),
    '--float': panel && mix(panel, 96), '--danger': v('danger'), '--ok': v('ok'),
  }
  const decl = Object.entries(vars).filter(([, x]) => x).map(([k, x]) => `${k}: ${x} !important;`).join(' ')
  const font = v('font')
  let css = `html[data-theme='hub'] { ${decl} color-scheme: ${light ? 'light' : 'dark'}; }`
  // see-through: the hub's own backdrop shows behind RoarMe, so it sits on the page like the hub's other pages
  // (Alex, 27 Oct). It needs the same color-scheme on both sides; the hub's frame and this root both take it from the look.
  css += ` html[data-theme='hub'], html[data-theme='hub'] body { background: transparent !important; }`
  // the hub's way with words: buttons and tabs in sentence case, not capitals
  css += ` html[data-theme='hub'] :is(.btn, .tabs button, .pill-btn) { text-transform: none !important; letter-spacing: 0 !important; font-size: 13.5px; font-weight: 600; }`
  if (font) css += ` html[data-theme='hub'] body, html[data-theme='hub'] :is(button, input, textarea, select) { font-family: ${font} !important; }`
  let tag = document.getElementById('roar-hub-look')
  if (!tag) { tag = document.createElement('style'); tag.id = 'roar-hub-look'; document.head.append(tag) }
  tag.textContent = css
  const r = document.documentElement
  r.dataset.theme = 'hub'
  r.dataset.hubMode = light ? 'light' : 'dark'
  r.dataset.mode = r.dataset.hubMode
  ;(Array.isArray(l.fonts) ? l.fonts : []).slice(0, 4).forEach((href) => {
    if (!FONT_CSS.test(String(href)) || document.querySelector(`link[href="${CSS.escape(href)}"]`)) return
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }))
  })
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', v('bg') || (light ? '#eef1f8' : '#0b1018'))
}

function followHubLook() {
  document.documentElement.dataset.theme = 'hub'
  try { wearHubLook(JSON.parse(localStorage.getItem(LOOK_KEY) || 'null')) } catch { /* nothing kept yet */ }
  window.addEventListener('message', (e) => {
    if (e.origin !== HUB_ORIGIN || e.source !== window.parent) return
    const m = e.data
    if (!m || m.type !== 'roarme:hub-look' || !m.look) return
    wearHubLook(m.look)
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(m.look)) } catch { /* private window */ }
  })
  askHub({ type: 'roarme:want-look' })
}

/* signed in inside the hub: make sure it is the same person as the hub's member, else sign out (and sign in again) */
export function watchHubMember(uid) {
  if (!isHubEmbed() || !uid) return () => {}
  const onMsg = async (e) => {
    if (e.origin !== HUB_ORIGIN || e.source !== window.parent) return
    const m = e.data
    if (!m || m.type !== 'roarme:hub-member' || !m.id) return
    const { data } = await supabase.from('roar_hub_links').select('hub_user_id').maybeSingle()
    if (!data || data.hub_user_id !== m.id) supabase.auth.signOut()
  }
  window.addEventListener('message', onMsg)
  askHub({ type: 'roarme:ready' })
  return () => window.removeEventListener('message', onMsg)
}

/* The person's THEMADLIONS hub tasks and calendar, shown in Tasks and its calendar (Alex, 20 Oct: phase 6). The hub
   stays the one source: RoarMe only shows them, and a tap opens the hub. Read through the Edge Function
   roar-hub-work, which asks the hub with the shared secret, for this person's own hub member only and with the
   hub's own rules (Tasks / Calendar permission, their projects, the calendar types they may see). */
const HUB_URL = 'https://hub.themadlions.com/'
export const hubLinkFor = (x) => `${HUB_URL}#/${x.kind === 'event' ? 'calendar' : x.projectId ? `p/${x.projectId}` : 'tasks'}`

export function useHubWork() {
  const [work, setWork] = useState({ linked: false, tasks: [], events: [], canTasks: false, canCalendar: false })
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('roar-hub-work', { body: {} })
        if (!alive || error || !data) return
        setWork({ linked: !!data.linked, tasks: data.tasks || [], events: data.events || [], canTasks: !!data.canTasks, canCalendar: !!data.canCalendar })
      } catch { /* the hub is away: keep what we had */ }
    }
    load()
    const back = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', back)
    const id = setInterval(load, 5 * 60e3)
    return () => { alive = false; document.removeEventListener('visibilitychange', back); clearInterval(id) }
  }, [])
  return work
}
