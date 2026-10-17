import { useEffect, useState } from 'react'
import { locale } from './i18n.js'
import { I, Lens, Modal } from './ui.jsx'

/* Scheduled calls (Alex, 17 Oct, after WhatsApp's): a title, a note, when it starts and (if wanted) ends, voice or
   video. It goes into the chat as a card (a text message whose `file.event` holds the details, its body the title,
   so list previews and search read it). The card counts down, lets you join from 10 minutes before, and saves the
   call to your calendar (.ics). */

const pad = (n) => String(n).padStart(2, '0')
const dateIn = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeIn = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const join = (date, time) => new Date(`${date}T${time}`)
const MAX_NOTE = 2048

export function ScheduleCall({ who, onSend, onClose }) {
  const first = new Date(Math.ceil((Date.now() + 5 * 60e3) / (30 * 60e3)) * 30 * 60e3)
  const later = new Date(first.getTime() + 30 * 60e3)
  const [title, setTitle] = useState(`Call with ${who}`)
  const [note, setNote] = useState('')
  const [sd, setSd] = useState(dateIn(first))
  const [st, setSt] = useState(timeIn(first))
  const [ed, setEd] = useState(dateIn(later))
  const [et, setEt] = useState(timeIn(later))
  const [withEnd, setWithEnd] = useState(true)
  const [video, setVideo] = useState(true)
  const [busy, setBusy] = useState(false)
  const start = join(sd, st)
  const end = join(ed, et)
  const err = !title.trim() ? 'Give the call a title.'
    : Number.isNaN(start.getTime()) ? 'Pick a start date and time.'
    : start.getTime() < Date.now() - 60e3 ? 'The start is in the past.'
    : start.getTime() > Date.now() + 365 * 864e5 ? 'A call can be at most a year ahead.'
    : withEnd && !(end > start) ? 'The end must come after the start.' : ''
  // moving the start keeps the length the same
  const moveStart = (d, t) => {
    const len = Math.max(15 * 60e3, end - start || 30 * 60e3)
    const s = join(d, t)
    if (!Number.isNaN(s.getTime())) { const e = new Date(s.getTime() + len); setEd(dateIn(e)); setEt(timeIn(e)) }
    setSd(d); setSt(t)
  }
  const send = async () => {
    if (err) return
    setBusy(true)
    await onSend({ title: title.trim(), note: note.trim(), start: start.toISOString(), end: withEnd ? end.toISOString() : null, video })
    setBusy(false)
  }
  return (
    <Modal title="Schedule call" onClose={onClose}
      foot={<><span className="sch-err">{err}</span><button type="button" className="btn btn-main sch-send" disabled={!!err || busy} onClick={send}>{I.send}<span>Send</span></button></>}>
      <div className="sch">
        <div className="sch-box">
          <label className="sch-title">
            <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="Title" autoFocus />
            {title && <button type="button" onClick={() => setTitle('')} aria-label="Clear">{I.x}</button>}
          </label>
          <label className="sch-note">
            <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))} placeholder="Add description (optional)" rows={3} />
            <small>{MAX_NOTE - note.length}</small>
          </label>
        </div>
        <div className="sch-box">
          <div className="sch-row"><span>Starts</span><span className="sch-when"><input type="date" value={sd} onChange={(e) => moveStart(e.target.value, st)} /><input type="time" value={st} onChange={(e) => moveStart(sd, e.target.value)} /></span></div>
          {withEnd && <div className="sch-row"><span>Ends</span><span className="sch-when"><input type="date" value={ed} onChange={(e) => setEd(e.target.value)} /><input type="time" value={et} onChange={(e) => setEt(e.target.value)} /></span></div>}
          <label className="sch-row"><span>Include end time</span><span className="switch"><input type="checkbox" checked={withEnd} onChange={(e) => setWithEnd(e.target.checked)} /><span /></span></label>
        </div>
        <div className="sch-box">
          <div className="sch-row"><span>Call type</span>
            <Lens className="seg sch-type" dep={video}>
              <button type="button" className={!video ? 'on' : ''} onClick={() => setVideo(false)}>{I.phone}<span>Voice</span></button>
              <button type="button" className={video ? 'on' : ''} onClick={() => setVideo(true)}>{I.video}<span>Video</span></button>
            </Lens>
          </div>
        </div>
        <p className="sch-hint">It goes into the chat as a card: both of you can join from 10 minutes before, and add it to your calendar.</p>
      </div>
    </Modal>
  )
}

const fmtDay = (d) => d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
const fmtTime = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
const ics = (ev, who) => {
  const z = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s) => String(s || '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n')
  const end = ev.end || new Date(new Date(ev.start).getTime() + 30 * 60e3).toISOString()
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//THE MAD LIONS//RoarMe//EN', 'BEGIN:VEVENT',
    `UID:${z(ev.start)}-${Math.random().toString(36).slice(2)}@roarme`, `DTSTAMP:${z(new Date().toISOString())}`,
    `DTSTART:${z(ev.start)}`, `DTEND:${z(end)}`, `SUMMARY:${esc(ev.title)}`,
    `DESCRIPTION:${esc(`${ev.video ? 'Video' : 'Voice'} call on RoarMe with ${who}${ev.note ? `\n\n${ev.note}` : ''}`)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT10M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
}

/* the card, like the RoarTransfer one (Alex, 17 Oct): a mark on top, the title as the headline beside a date tile,
   a line that fills up to the start (and through the call while it runs) with the time left beside it, a Join pill
   and a round button that saves it to the calendar */
export function EventCard({ ev, who, sent, onJoin, canJoin = true }) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30e3); return () => clearInterval(id) }, [])
  const s = new Date(ev.start)
  const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 2 * 3600e3)
  const now = Date.now()
  const opens = s.getTime() - 10 * 60e3
  const open = now >= opens && now <= e.getTime()
  const live = now >= s.getTime() && now <= e.getTime()
  const over = now > e.getTime()
  const left = s.getTime() - now
  const when = over ? 'Ended' : live ? 'Live now'
    : left < 3600e3 ? `In ${Math.max(1, Math.round(left / 60e3))} min`
    : left < 864e5 ? `In ${Math.floor(left / 3600e3)} h ${Math.round((left % 3600e3) / 60e3)} min` : `In ${Math.ceil(left / 864e5)} days`
  const from = sent ? new Date(sent).getTime() : s.getTime() - 864e5
  const share = over ? 1 : live ? (now - s.getTime()) / Math.max(1, e.getTime() - s.getTime())
    : Math.min(1, Math.max(0.03, (now - from) / Math.max(1, s.getTime() - from)))
  const save = (x) => {
    x.stopPropagation()
    const url = URL.createObjectURL(new Blob([ics(ev, who)], { type: 'text/calendar' }))
    const a = document.createElement('a'); a.href = url; a.download = `${(ev.title || 'call').replace(/[^\w\- ]+/g, '').trim() || 'call'}.ics`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const icon = ev.video ? I.video : I.phone
  return (
    <span className={`trx evc${over ? ' gone' : live ? ' live' : open || left < 3600e3 ? ' soon' : ''}`} onClick={(x) => x.stopPropagation()}>
      <span className="trx-head"><span className="rt-mark"><i>{icon}</i><b>{ev.video ? 'Video' : 'Voice'}<span>Call</span></b></span></span>
      <span className="trx-hero">
        <i className="trx-type evc-cal"><small>{s.toLocaleDateString(locale(), { month: 'short' })}</small><b>{s.getDate()}</b></i>
        <span className="trx-size evc-text"><b>{ev.title}</b><small>{fmtDay(s)} · {fmtTime(s)}{ev.end ? ` – ${fmtTime(e)}` : ''}</small></span>
      </span>
      {ev.note && <span className="evc-note">{ev.note}</span>}
      <span className="trx-timeline">
        <span className="trx-time"><i style={{ width: `${share * 100}%` }} /></span>
        <span className="trx-left">{I.timer}<span>{when}</span></span>
      </span>
      {!over && (
        <span className="trx-acts">
          {canJoin
            ? <button type="button" className="trx-get evc-join" disabled={!open} onClick={() => onJoin(ev.video)} title={open ? 'Join' : 'You can join from 10 minutes before'}>{icon}<span>{open ? 'Join' : `Join from ${fmtTime(new Date(opens))}`}</span></button>
            : <button type="button" className="trx-get" onClick={save}>{I.calendar}<span>Add to calendar</span></button>}
          {canJoin && <button type="button" className="trx-round" onClick={save} title="Add to calendar" aria-label="Add to calendar">{I.calendar}</button>}
        </span>
      )}
    </span>
  )
}
