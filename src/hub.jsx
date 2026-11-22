// Production Hub (Alex, 22 Nov 2026: "the key goes in RoarMe's Settings, Production Hub; every group in PROJECTS is a
// project of the hub, both ways"). The account's key and every sync live in the Edge Function roar-hub; this file is
// what the app asks of it, and Settings > Production Hub.
import { useEffect, useState } from 'react'
import { supabase } from './lib.js'

const roomCache = {} // room -> roar_hub_state (null = not tied)
let meCache // undefined = not asked yet, null = no Production Hub

export async function hubMe(fresh = false) {
  if (!fresh && meCache !== undefined) return meCache
  const { data } = await supabase.rpc('roar_hub_me')
  meCache = data || null
  return meCache
}
export async function hubState(roomId, fresh = false) {
  if (!fresh && roomId in roomCache) return roomCache[roomId]
  const { data } = await supabase.rpc('roar_hub_state', { r: roomId })
  roomCache[roomId] = data || null
  return roomCache[roomId]
}
export async function hubCall(body) {
  const { data, error } = await supabase.functions.invoke('roar-hub', { body })
  if (error) { let m = error.message; try { m = (await error.context.json()).error || m } catch { /* keep */ } throw new Error(m) }
  if (body.room) delete roomCache[body.room]
  if (body.action === 'connect' || body.action === 'disconnect' || body.action === 'linkall') { meCache = undefined; for (const k of Object.keys(roomCache)) delete roomCache[k] }
  return data
}

// after a save that touches what the hub keeps (tasks, locations, stage, shoot day, details), a sync 1.2 s later
const timers = {}
export function hubSoon(roomId) {
  clearTimeout(timers[roomId])
  timers[roomId] = setTimeout(async () => { try { if (await hubState(roomId)) await hubCall({ action: 'sync', room: roomId }) } catch { /* shown in Project Settings > Production Hub */ } }, 1200)
}
// a group just made a project: tie it to the hub, if I have one
export async function hubLink(roomId) {
  try { if (await hubMe()) await hubCall({ action: 'link', room: roomId }) } catch { /* tried again by linkall */ }
}
// opening a project's workspace pulls what changed in the hub, at most every 30 s
const lastPull = {}
export function hubPull(roomId) {
  if (Date.now() - (lastPull[roomId] || 0) < 30000) return
  lastPull[roomId] = Date.now()
  hubState(roomId).then((s) => (s?.project ? hubCall({ action: 'sync', room: roomId }) : null)).catch(() => {})
}
// on starting, every 10 minutes at most: tie my project groups and make groups for the hub's new projects
export function hubStart() {
  let last = 0
  try { last = Number(localStorage.getItem('roarme-hub-pull') || 0) } catch { /* private window */ }
  if (Date.now() - last < 600000) return
  try { localStorage.setItem('roarme-hub-pull', String(Date.now())) } catch { /* private window */ }
  hubMe().then((m) => (m ? hubCall({ action: 'linkall' }) : null)).catch(() => {})
}

// Settings > PROJECTS (Alex, 22 Nov: "the gold Projects in Settings, and inside it the hub you join, and the subscription"):
// the plan (free for now, Subscribe "Coming soon") and the Production Hub
export function ProjectsPage({ toast = () => {} }) {
  return (
    <div className="hb-page">
      {/* the plan (Alex, 22 Nov: "make it free for now, subscribe Coming soon, we see the subscription later") */}
      <small className="hb-cap hb-sec">Plan</small>
      <div className="set-box hb-on hb-plan">
        <span className="hb-t"><b>PROject is free for now</b><small>Every group can be a project, with its Workspace, tasks, locations and the Production Hub.</small></span>
        <button type="button" className="pill-btn hb-soon" disabled>Coming soon</button>
      </div>
      <small className="hb-cap hb-sec">Production Hub</small>
      <HubPage toast={toast} />
    </div>
  )
}

// the Production Hub part of Settings > PROJECTS
export function HubPage({ toast = () => {} }) {
  const [me, setMe] = useState(undefined)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let gone = false; hubMe(true).then((m) => { if (!gone) setMe(m) }, () => { if (!gone) setMe(null) }); return () => { gone = true } }, [])
  const run = async (body, ok) => {
    setBusy(true)
    try {
      const r = await hubCall(body)
      setMe(await hubMe(true))
      if (r?.error) toast(r.error)
      else if (body.action === 'connect' || body.action === 'linkall') toast(r?.made || r?.joined ? `${ok} ${[r.joined && `${r.joined} project${r.joined === 1 ? '' : 's'} tied`, r.made && `${r.made} new group${r.made === 1 ? '' : 's'}`].filter(Boolean).join(', ')}.` : ok)
      else if (ok) toast(ok)
      if (body.action === 'connect') setKey('')
    } catch (e) { toast(e.message || 'The hub did not answer') }
    setBusy(false)
  }
  if (me === undefined) return <p className="hb-hint">Loading…</p>
  return (
    <div className="hb">
      {me ? (
        <>
          <div className="set-box hb-on">
            <i className="hb-dot" />
            <span className="hb-t"><b>Linked to {me.hub}</b><small>{me.projects ? `${me.projects} project${me.projects === 1 ? '' : 's'} tied` : 'No projects tied yet'} · since {new Date(me.at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
          </div>
          <p className="hb-hint">Every group in PROject is a project of {me.hub}: its name, stage, shoot day, category, tasks and locations stay the same on both sides. A project made in the hub brings a new group here, and a group made a project here makes one there.</p>
          <div className="hb-acts">
            <button type="button" className="pill-btn" disabled={busy} onClick={() => run({ action: 'linkall' }, 'Up to date.')}>{busy ? 'Working…' : 'Sync Now'}</button>
            <button type="button" className="pill-btn hb-off" disabled={busy} onClick={() => { if (window.confirm(`Unlink RoarMe from ${me.hub}? Your groups and the hub's projects both stay; they just stop following each other.`)) run({ action: 'disconnect' }, 'Unlinked') }}>Unlink</button>
          </div>
        </>
      ) : (
        <>
          <p className="hb-hint">Link RoarMe to your production hub. Every group in PROject becomes a project there, and every project there a group here, with tasks, locations, stage and shoot day kept the same on both sides.</p>
          <small className="hb-cap">Hub key</small>
          <div className="set-box hb-pad">
            <input className="hb-key" value={key} onChange={(e) => setKey(e.target.value.trim())} placeholder="tmlhub_…" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          </div>
          <p className="hb-hint">In the hub: Settings, Integrations, Connected Apps, Make a Key. Paste it here.</p>
          <button type="button" className="btn btn-main hb-go" disabled={busy || !/^tmlhub_[0-9a-f]{48}$/.test(key)} onClick={() => run({ action: 'connect', key }, 'Linked.')}>{busy ? 'Linking…' : 'Link'}</button>
        </>
      )}
    </div>
  )
}
