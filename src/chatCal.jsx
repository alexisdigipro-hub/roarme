// The chat's calendar (Alex, 25 Nov, sample https://claude.ai/artifact/PQ57XutzNJ5LWw6HLJ7bDc, "βάλ' το", the dot for
// days of words): a tap on a day's chip in a chat opens it. Every month from the chat's first message to now; a day
// with a photo or video shows its newest one in its circle, a day with only words is bold with a small dot, a day with
// nothing is faint. A tap on a day goes to its first message. Select picks days; Clear History For This Day asks Clear
// for Me (hidden for me) or Clear for Me and <name> (my own messages of those days also deleted for everyone).
// supabase/chat-calendar.sql: roar_chat_days, roar_clear_days.
import { useEffect, useMemo, useState } from 'react'
import { Modal, I } from './ui.jsx'
import { errText, picLink, supabase, thumbOf } from './lib.js'

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } })()
const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function DayPic({ file, children, ...rest }) {
  const [url, setUrl] = useState('')
  useEffect(() => { let on = true; picLink(thumbOf(file)).then((u) => { if (on && u) setUrl(u) }, () => {}); return () => { on = false } }, [file])
  return <button type="button" {...rest} style={url ? { backgroundImage: `url("${url}")` } : undefined}>{children}</button>
}

export default function ChatCalendar({ room, other, onGo, onClose, onCleared }) {
  const [days, setDays] = useState(null) // key -> { n, first, pic }
  const [err, setErr] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let on = true
    supabase.rpc('roar_chat_days', { r: room.room_id, tz: TZ }).then(({ data, error }) => {
      if (!on) return
      if (error) { setErr(errText(error)); setDays({}); return }
      setDays(Object.fromEntries((data || []).map((x) => [x.day, { n: x.n, first: x.first_id, pic: x.pic }])))
    })
    return () => { on = false }
  }, [room.room_id])
  const today = new Date(); today.setHours(0, 0, 0, 0)
  // the months to show: from the chat's first day (at least the last three months) to this one
  const months = useMemo(() => {
    const keys = Object.keys(days || {}).sort()
    const start = keys.length ? new Date(`${keys[0]}T12:00:00`) : new Date()
    const from = new Date(Math.min(start.getTime(), new Date(today.getFullYear(), today.getMonth() - 2, 1).getTime()))
    const out = []
    for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(d)
    return out
  }, [days]) // eslint-disable-line react-hooks/exhaustive-deps
  // the calendar opens at its newest month, at the foot
  const [box, setBox] = useState(null)
  useEffect(() => { if (box && days) box.scrollTop = box.scrollHeight }, [box, days])
  const n = picked.size
  const tap = (k) => {
    const d = days?.[k]; if (!d) return
    if (selecting) { setPicked((s) => { const x = new Set(s); if (x.has(k)) x.delete(k); else x.add(k); return x }); return }
    onClose(); onGo(d.first)
  }
  const clear = async (everyone) => {
    setBusy(true)
    const { error } = await supabase.rpc('roar_clear_days', { r: room.room_id, days: [...picked], everyone, tz: TZ })
    setBusy(false)
    if (error) { setErr(errText(error)); setAsking(false); return }
    onCleared(n, everyone)
    onClose()
  }
  const isDirect = room.kind !== 'group'
  return (
    <Modal title="Calendar" onClose={onClose}>
      <div className="ccal">
        <div className="ccal-head">
          <button type="button" className="round" onClick={onClose} aria-label="Close">{I.x}</button>
          <b>{selecting ? (n ? `${n} ${n > 1 ? 'days' : 'day'} selected` : 'Select Days') : 'Calendar'}</b>
          {selecting
            ? <button type="button" className="round ccal-ok" onClick={() => { setSelecting(false); setPicked(new Set()) }} aria-label="Done">{I.check}</button>
            : <button type="button" className="pill-btn ccal-sel" onClick={() => setSelecting(true)}>Select</button>}
        </div>
        <div className="ccal-body" ref={setBox}>
          {days === null && <p className="ccal-note">Getting the days…</p>}
          {err && <p className="ccal-note">{err}</p>}
          {days && months.map((m) => {
            const lead = (m.getDay() + 6) % 7, count = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
            const cells = []
            for (let i = 0; i < lead; i++) cells.push(<span key={`e${i}`} />)
            for (let d = 1; d <= count; d++) {
              const date = new Date(m.getFullYear(), m.getMonth(), d), k = keyOf(date), v = days[k]
              const isToday = date.getTime() === today.getTime()
              const cls = `ccal-d${v ? (v.pic ? ' pic' : ' text') : ' none'}${isToday ? ' today' : ''}${picked.has(k) ? ' picked' : ''}`
              cells.push(v?.pic
                ? <DayPic key={k} file={v.pic} className={cls} onClick={() => tap(k)} aria-label={date.toDateString()}>{d}</DayPic>
                : <button key={k} type="button" className={cls} disabled={!v} onClick={() => tap(k)} aria-label={date.toDateString()}>{d}</button>)
            }
            return (
              <section key={m.toISOString()} className="ccal-m">
                <h3>{m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
                <div className="ccal-wd">{WD.map((w, i) => <span key={i}>{w}</span>)}</div>
                <div className="ccal-grid">{cells}</div>
              </section>
            )
          })}
        </div>
        {selecting && <button type="button" className="ccal-clear" disabled={!n || busy} onClick={() => setAsking(true)}>Clear History For {n > 1 ? 'These Days' : 'This Day'}</button>}
        {asking && (
          <div className="ccal-ask">
            <p>Clear every message of {n > 1 ? `these ${n} days` : 'this day'}?</p>
            <button type="button" className="danger" disabled={busy} onClick={() => clear(false)}>Clear for Me</button>
            <button type="button" className="danger" disabled={busy} onClick={() => clear(true)}>{isDirect && other ? `Clear for Me and ${other}` : 'Clear for Me and Everyone'}</button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
          </div>
        )}
      </div>
    </Modal>
  )
}
