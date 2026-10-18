import { useCallback, useEffect, useRef, useState } from 'react'
import { I, Modal } from './ui.jsx'
import { errText, supabase } from './lib.js'
import { locale } from './i18n.js'
import { formatText } from './format.jsx'

/* Scheduled messages, as in Telegram (Alex, 18 Oct): hold Send (or right click it) and the message waits for a day
   and a time, once or again and again. The text sits in roar_scheduled until a job on the server sends it, in your
   name, within the minute (supabase/scheduled.sql), so the app can be closed. The clock in the writing box shows how
   many wait in this chat; there each can be sent now, moved or deleted. */

export const REPEATS = [
  ['never', 'Never'], ['day', 'Daily'], ['week', 'Weekly'], ['2weeks', 'Biweekly'],
  ['month', 'Monthly'], ['3months', 'Every 3 Months'], ['6months', 'Every 6 Months'], ['year', 'Yearly'],
]
const repeatName = (k) => (REPEATS.find((r) => r[0] === k) || REPEATS[0])[1]

const pad = (n) => String(n).padStart(2, '0')
const dateIn = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeIn = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const dayText = (d) => d.toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
const hourText = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
export const whenText = (iso) => { const d = new Date(iso); return `${dayText(d)} at ${hourText(d)}` }

/* the chat's scheduled messages: what waits, and adding, moving, sending now, deleting */
export function useScheduled(roomId, meId) {
  const [list, setList] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('roar_scheduled').select('id, body, reply_to, first_at, send_at, repeat, times').eq('room_id', roomId).eq('user_id', meId).order('send_at')
    setList(data || [])
    window.dispatchEvent(new Event('roarme-cal')) // the calendar under Tasks follows
  }, [roomId, meId])
  useEffect(() => { setList([]); load() }, [load])
  // the server sends them; look again around the time the next one is due
  useEffect(() => {
    if (!list.length) return undefined
    const wait = Math.max(5e3, Math.min(60e3, new Date(list[0].send_at).getTime() - Date.now() + 65e3))
    const id = setTimeout(load, wait)
    return () => clearTimeout(id)
  }, [list, load])
  const add = async ({ body, replyTo, at, repeat }) => {
    const iso = at.toISOString()
    const { error } = await supabase.from('roar_scheduled').insert({ room_id: roomId, user_id: meId, body, reply_to: replyTo || null, first_at: iso, send_at: iso, repeat })
    if (error) return errText(error)
    load()
    return ''
  }
  const move = async (id, { body, at, repeat }) => {
    const iso = at.toISOString()
    const { error } = await supabase.from('roar_scheduled').update({ body, first_at: iso, send_at: iso, repeat, times: 0 }).eq('id', id)
    if (error) return errText(error)
    load()
    return ''
  }
  const remove = async (id) => {
    const { error } = await supabase.from('roar_scheduled').delete().eq('id', id)
    if (error) return errText(error)
    setList((l) => l.filter((x) => x.id !== id))
    window.dispatchEvent(new Event('roarme-cal'))
    return ''
  }
  // sent now as a normal message; a repeating one keeps its next times
  const sendNow = async (s) => {
    const { error } = await supabase.from('roar_messages').insert({ room_id: roomId, user_id: meId, body: s.body, reply_to: s.reply_to || null })
    if (error) return errText(error)
    if (s.repeat === 'never') return remove(s.id)
    return ''
  }
  return { list, load, add, move, remove, sendNow }
}

/* RoarMe's own day and time pickers (Alex, 18 Oct: the browser's clock list was not beautiful): the days as tiles in a
   row you slide, the time as two wheels as on an iPhone, with the chosen line under a glass lens */
const ROW = 40
function Wheel({ count, value, onChange, label }) {
  const ref = useRef(null)
  const timer = useRef(0)
  const quiet = useRef(false)
  // to the chosen number, at the start and when a quick choice moves it
  useEffect(() => {
    const el = ref.current
    if (!el || Math.round(el.scrollTop / ROW) === value) return
    quiet.current = true
    el.scrollTo({ top: value * ROW, behavior: el.dataset.ready ? 'smooth' : 'auto' })
    el.dataset.ready = '1'
    setTimeout(() => { quiet.current = false }, 400)
  }, [value])
  const onScroll = () => {
    if (quiet.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const n = Math.max(0, Math.min(count - 1, Math.round(ref.current.scrollTop / ROW)))
      if (n !== value) onChange(n)
    }, 90)
  }
  return (
    <div ref={ref} className="wheel" onScroll={onScroll} role="listbox" aria-label={label}>
      <div className="wheel-pad" />
      {Array.from({ length: count }, (_, n) => (
        <button key={n} type="button" role="option" aria-selected={n === value} className={n === value ? 'on' : ''} onClick={() => onChange(n)}>{String(n).padStart(2, '0')}</button>
      ))}
      <div className="wheel-pad" />
    </div>
  )
}

function DayStrip({ value, onChange }) {
  const ref = useRef(null)
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const days = Array.from({ length: 120 }, (_, n) => { const x = new Date(today); x.setDate(today.getDate() + n); return x })
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }) }, [value])
  return (
    <div ref={ref} className="dpick">
      {days.map((x, n) => {
        const k = dateIn(x)
        return (
          <button key={k} type="button" className={k === value ? 'on' : ''} onClick={() => onChange(k)}>
            <small>{n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : x.toLocaleDateString(locale(), { weekday: 'short' })}</small>
            <b>{x.getDate()}</b>
            <small>{x.toLocaleDateString(locale(), { month: 'short' })}</small>
          </button>
        )
      })}
    </div>
  )
}

const SHORT = { '3months': '3 Months', '6months': '6 Months' }

/* the window: day, time, repeat, and the button that says when it goes */
export function ScheduleMessage({ item, body: firstBody = '', onSave, onClose }) {
  const start = item ? new Date(item.send_at) : new Date(Math.ceil((Date.now() + 2 * 60e3) / 60e3) * 60e3 + 60 * 60e3)
  const [d, setD] = useState(dateIn(start))
  const [t, setT] = useState(timeIn(start))
  const [repeat, setRepeat] = useState(item?.repeat || 'never')
  const [body, setBody] = useState(item?.body || firstBody)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const at = new Date(`${d}T${t}`)
  const [hh, mm] = t.split(':').map(Number)
  // the usual moments, one tap each
  const quick = (() => {
    const now = new Date()
    const hour = new Date(Math.ceil((now.getTime() + 60 * 60e3) / (5 * 60e3)) * 5 * 60e3)
    const tonight = new Date(now); tonight.setHours(20, 0, 0, 0)
    const morning = new Date(now); morning.setDate(now.getDate() + 1); morning.setHours(9, 0, 0, 0)
    const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7)); monday.setHours(9, 0, 0, 0)
    return [['In 1 hour', hour], ...(tonight > now ? [['Tonight 20:00', tonight]] : []), ['Tomorrow 09:00', morning], ['Monday 09:00', monday]]
  })()
  const err = Number.isNaN(at.getTime()) ? 'Pick a day and a time.'
    : at.getTime() < Date.now() + 30e3 ? 'Pick a time later than now.'
    : at.getTime() > Date.now() + 366 * 864e5 ? 'At most a year ahead.'
    : !body.trim() ? 'Write the message.' : ''
  const save = async () => {
    if (err || busy) return
    setBusy(true); setFail('')
    const e = await onSave({ body: body.trim(), at, repeat })
    setBusy(false)
    if (e) setFail(e)
  }
  return (
    <Modal title={item ? 'Edit Scheduled Message' : 'Schedule Message'} onClose={onClose}
      foot={<button type="button" className="btn btn-main sch-send smsg-go" disabled={!!err || busy} onClick={save}>{I.timer}<span>{err || (item ? `Save for ${whenText(at)}` : `Send on ${whenText(at)}`)}</span></button>}>
      <div className="sch smsg">
        {item && (
          <div className="sch-box">
            <label className="sch-note"><textarea value={body} onChange={(e) => setBody(e.target.value.slice(0, 8000))} rows={3} placeholder="Message" /></label>
          </div>
        )}
        <div className="squick">
          {quick.map(([label, when]) => <button key={label} type="button" className={dateIn(when) === d && timeIn(when) === t ? 'on' : ''} onClick={() => { setD(dateIn(when)); setT(timeIn(when)) }}>{label}</button>)}
        </div>
        <div className="sch-box">
          <DayStrip value={d} onChange={setD} />
          <div className="tpick">
            <span className="tpick-lens" />
            <Wheel label="Hour" count={24} value={hh} onChange={(n) => setT(`${pad(n)}:${pad(mm)}`)} />
            <b className="tpick-colon">:</b>
            <Wheel label="Minute" count={60} value={mm} onChange={(n) => setT(`${pad(hh)}:${pad(n)}`)} />
          </div>
        </div>
        <div className="sch-box">
          <div className="sch-row srep-head"><span>Repeat</span></div>
          <div className="squick srep">
            {REPEATS.map(([k, n]) => <button key={k} type="button" className={repeat === k ? 'on' : ''} onClick={() => setRepeat(k)}>{SHORT[k] || n}</button>)}
          </div>
        </div>
        {fail && <p className="sch-err">{fail}</p>}
        <p className="sch-hint">It goes out by itself at that time, even with RoarMe closed.</p>
      </div>
    </Modal>
  )
}

/* everything waiting in this chat */
export function ScheduledList({ sched, onEdit, onClose, toast }) {
  const act = async (fn, done) => { const e = await fn(); if (e) toast(e); else if (done) toast(done) }
  return (
    <Modal title="Scheduled Messages" onClose={onClose}>
      <div className="smsg-list">
        {!sched.list.length && <p className="muted pf-empty">Nothing scheduled in this chat.</p>}
        {sched.list.map((s) => (
          <div key={s.id} className="smsg-row">
            <div className="smsg-text">
              <span className="smsg-when">{I.timer}<b>{whenText(s.send_at)}</b>{s.repeat !== 'never' && <i>{repeatName(s.repeat)}</i>}</span>
              <span className="smsg-body">{formatText(s.body)}</span>
            </div>
            <div className="smsg-acts">
              <button type="button" className="round" onClick={() => act(() => sched.sendNow(s), 'Sent')} aria-label="Send Now" title="Send Now">{I.send}</button>
              <button type="button" className="round" onClick={() => onEdit(s)} aria-label="Edit" title="Edit">{I.edit}</button>
              <button type="button" className="round danger" onClick={() => { if (window.confirm('Delete this scheduled message?')) act(() => sched.remove(s.id), 'Deleted') }} aria-label="Delete" title="Delete">{I.trash}</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
