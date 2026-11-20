import { Suspense, lazy, useEffect, useState } from 'react'
import { Modal, I } from './ui.jsx'
import { supabase, errText } from './lib.js'

const LocationPicker = lazy(() => import('./share.jsx').then((m) => ({ default: m.LocationPicker })))

/* Locked Message (Alex, 20 Nov: "a message that opens when it should: locked until a time, or until you reach a place").
   The message carries only '🔒 Locked message' and file.capsule { at } or { place: { name, lat, lng, r } }; the words go to
   roar_capsules (supabase/capsules.sql) and come back through roar_capsule_open only when the time has come or the phone
   is inside the place's circle. The sender always reads their own. */
export const CAPSULE_BODY = '🔒 Locked message'
const RADII = [[100, '100 m'], [300, '300 m'], [1000, '1 km'], [5000, '5 km']]
const pad = (n) => String(n).padStart(2, '0')
const localValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const whenOf = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const left = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}

export function CapsuleWindow({ text, onClose, onSend }) {
  const [words, setWords] = useState(text || '')
  const [how, setHow] = useState('time')
  const [at, setAt] = useState(() => localValue(new Date(Date.now() + 3600e3)))
  const [place, setPlace] = useState(null)
  const [r, setR] = useState(300)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const when = new Date(at)
  const ok = words.trim() && (how === 'time' ? when > new Date() : !!place)
  const go = async () => {
    setBusy(true); setErr('')
    const e = await onSend({ words: words.trim(), at: how === 'time' ? when.toISOString() : null, place: how === 'place' ? { ...place, r } : null })
    setBusy(false)
    if (e) setErr(e)
  }
  return (
    <Modal title="Locked Message" onClose={onClose}>
      <div className="cap-new">
        <p className="cap-hint">The message stays locked until the time comes or they reach the place you choose.</p>
        <textarea className="cap-words" rows={4} maxLength={4000} value={words} onChange={(e) => setWords(e.target.value)} placeholder="Write the message…" autoFocus={!text} />
        <div className="seg cap-seg">
          <button type="button" className={how === 'time' ? 'on' : ''} onClick={() => setHow('time')}>{I.timer}<span>At a Time</span></button>
          <button type="button" className={how === 'place' ? 'on' : ''} onClick={() => setHow('place')}>{I.place}<span>At a Place</span></button>
        </div>
        {how === 'time' ? (
          <label className="cap-field"><span>Opens</span><input type="datetime-local" value={at} min={localValue(new Date())} onChange={(e) => setAt(e.target.value)} /></label>
        ) : (
          <>
            <button type="button" className="pill-btn cap-place" onClick={() => setPicking(true)}>{I.place}<span>{place ? (place.name || 'Chosen place') : 'Choose a Place'}</span></button>
            <div className="cap-radius"><span>Opens within</span><div className="st-pills">{RADII.map(([v, l]) => <button key={v} type="button" className={`pill-btn${r === v ? ' on' : ''}`} onClick={() => setR(v)}>{l}</button>)}</div></div>
          </>
        )}
        {err && <p className="auth-err">{err}</p>}
        <button type="button" className="pill-btn cap-go" disabled={!ok || busy} onClick={go}>{I.lock}<span>Send Locked Message</span></button>
      </div>
      {picking && <Suspense fallback={null}><LocationPicker title="Where It Opens" sendLabel="Choose This Place" onClose={() => setPicking(false)} onSend={(loc) => { setPlace(loc); setPicking(false) }} /></Suspense>}
    </Modal>
  )
}

/* the card in the chat: locked (with the time left, or the place and an I'm Here), then the words, opened with a small pop */
export function CapsuleCard({ id, cap, mine }) {
  const [body, setBody] = useState(null)
  const [why, setWhy] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [popped, setPopped] = useState(false)
  const due = cap?.at ? new Date(cap.at).getTime() : null
  const ask = async (la = null, lo = null) => {
    const { data, error } = await supabase.rpc('roar_capsule_open', { msg: id, la, lo })
    if (error) { setWhy(errText(error)); return }
    const row = Array.isArray(data) ? data[0] : data
    if (row?.body) { setBody(row.body); setPopped(row.why !== 'mine') } else setWhy(row?.why || '')
  }
  useEffect(() => { if (mine || (due && due <= Date.now())) ask() }, [id])
  useEffect(() => {
    if (body !== null || !due) return
    const t = setInterval(() => { const n = Date.now(); setNow(n); if (n >= due) { clearInterval(t); ask() } }, 1000)
    return () => clearInterval(t)
  }, [due, body])
  const here = () => {
    if (!navigator.geolocation) { setWhy('Your location is not available here.'); return }
    setBusy(true); setWhy('')
    navigator.geolocation.getCurrentPosition(async (p) => { await ask(p.coords.latitude, p.coords.longitude); setBusy(false) },
      () => { setBusy(false); setWhy('Allow RoarMe to use your location to open it.') }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 })
  }
  const far = /^far:(\d+)/.exec(why)
  const sub = cap?.at ? (body !== null ? `Opened · ${whenOf(cap.at)}` : `Opens ${whenOf(cap.at)}`) : cap?.place ? `${body !== null ? 'Opened at' : 'Opens at'} ${cap.place.name || 'a place'} · within ${cap.place.r >= 1000 ? `${cap.place.r / 1000} km` : `${cap.place.r} m`}` : ''
  return (
    <div className={`cap-card${body !== null ? ' open' : ''}${popped ? ' popped' : ''}`}>
      <div className="cap-top"><i className="cap-ico">{body !== null ? CAP_OPEN : I.lock}</i><span><b>{body !== null ? (mine && !popped ? 'Locked Message' : 'Unlocked') : 'Locked Message'}</b><small>{sub}</small></span></div>
      {body !== null ? <p className="cap-body">{body}</p>
        : due ? <p className="cap-count">{left(due - now)}</p>
          : <button type="button" className="pill-btn cap-here" disabled={busy} onClick={here}>{I.place}<span>{busy ? 'Checking…' : "I'm Here"}</span></button>}
      {far && <small className="cap-far">You are {Number(far[1]) >= 1000 ? `${(Number(far[1]) / 1000).toFixed(1)} km` : `${far[1]} m`} away.</small>}
      {why && !far && why !== 'locked' && <small className="cap-far">{why}</small>}
    </div>
  )
}
const CAP_OPEN = <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.6" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" /></svg>
