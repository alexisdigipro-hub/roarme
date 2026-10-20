import { useCallback, useEffect, useRef, useState } from 'react'
import { I, Modal, OnTop } from './ui.jsx'
import { errText, supabase } from './lib.js'
import { locale, tr } from './i18n.js'
import { plainText } from './format.jsx'
import { DayStrip, Wheel, whenText } from './scheduled.jsx'

/* Remind me about a message, as in Slack (Alex, 20 Oct): a message's menu > Remind Me, then a time. Only you see it;
   nothing goes into the chat. At that time it comes back here as a card (Open, Later, Done) and, with RoarMe closed,
   as a notification from the server (supabase/reminders.sql, Edge Function roar-push). The list is under Tasks >
   Reminders. Anything that adds or changes one says so with the window event 'roarme-reminders'. */

const changed = () => window.dispatchEvent(new Event('roarme-reminders'))
const pad = (n) => String(n).padStart(2, '0')
const dateIn = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const timeIn = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

// what a reminder shows of its message
export const reminderText = (m) => {
  if (!m) return tr('A message')
  if (m.deleted_at) return tr('Message deleted')
  if (String(m.body || '').startsWith('e2e1.')) return tr('Encrypted message')
  if (m.kind === 'image') return m.body ? `📷 ${plainText(m.body)}` : `📷 ${tr('Photo')}`
  if (m.kind === 'voice') return `🎤 ${tr('Voice message')}`
  if (m.kind === 'file') return `📎 ${m.file?.name || tr('File')}`
  return plainText(m.body || '').replace(/\s+/g, ' ').slice(0, 160)
}

// the usual moments, one tap each
export function remindQuick() {
  const now = new Date()
  const in20 = new Date(Math.ceil((now.getTime() + 20 * 60e3) / 60e3) * 60e3)
  const hour = new Date(Math.ceil((now.getTime() + 60 * 60e3) / 60e3) * 60e3)
  const three = new Date(Math.ceil((now.getTime() + 3 * 60 * 60e3) / 60e3) * 60e3)
  const morning = new Date(now); morning.setDate(now.getDate() + 1); morning.setHours(9, 0, 0, 0)
  const monday = new Date(now); monday.setDate(now.getDate() + (((8 - now.getDay()) % 7) || 7)); monday.setHours(9, 0, 0, 0)
  return [['In 20 minutes', in20], ['In 1 hour', hour], ['In 3 hours', three], ['Tomorrow 09:00', morning], ['Monday 09:00', monday]]
}

export async function addReminder(roomId, messageId, at) {
  const { error } = await supabase.from('roar_reminders').insert({ room_id: roomId, message_id: messageId, remind_at: at.toISOString() })
  if (error) return errText(error)
  changed()
  return ''
}

/* the window: a quick time, or a day and an hour */
export function RemindMe({ preview, onSave, onClose }) {
  const quick = remindQuick()
  const [d, setD] = useState(dateIn(quick[1][1]))
  const [t, setT] = useState(timeIn(quick[1][1]))
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const at = new Date(`${d}T${t}`)
  const [hh, mm] = t.split(':').map(Number)
  const err = Number.isNaN(at.getTime()) ? 'Pick a day and a time.'
    : at.getTime() < Date.now() + 30e3 ? 'Pick a time later than now.'
    : at.getTime() > Date.now() + 365 * 864e5 ? 'At most a year ahead.' : ''
  const save = async () => {
    if (err || busy) return
    setBusy(true); setFail('')
    const e = await onSave(at)
    setBusy(false)
    if (e) setFail(e)
  }
  return (
    <Modal title="Remind Me" onClose={onClose}
      foot={<button type="button" className="btn btn-main sch-send smsg-go" disabled={!!err || busy} onClick={save}>{I.bell}<span>{err || `Remind me on ${whenText(at)}`}</span></button>}>
      <div className="sch smsg">
        {preview && <p className="rmd-about">{preview}</p>}
        <div className="squick">
          {quick.map(([label, when]) => <button key={label} type="button" className={dateIn(when) === d && timeIn(when) === t ? 'on' : ''} onClick={() => { setD(dateIn(when)); setT(timeIn(when)) }}>{tr(label)}</button>)}
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
        {fail && <p className="sch-err">{fail}</p>}
        <p className="sch-hint">{tr('Only you see it. It comes back at that time, even with RoarMe closed.')}</p>
      </div>
    </Modal>
  )
}

/* one's reminders with their messages: the ones waiting, then the ones gone off (kept 30 days) */
export function useReminders(meId) {
  const [list, setList] = useState([])
  const [msgs, setMsgs] = useState({})
  const load = useCallback(async () => {
    const { data } = await supabase.from('roar_reminders').select('id, room_id, message_id, remind_at, fired_at').eq('user_id', meId).order('remind_at').limit(300)
    const rows = data || []
    setList(rows)
    const ids = [...new Set(rows.map((r) => r.message_id))]
    if (ids.length) {
      const { data: ms } = await supabase.from('roar_messages').select('id, user_id, kind, body, file, deleted_at').in('id', ids)
      setMsgs(Object.fromEntries((ms || []).map((m) => [m.id, m])))
    }
  }, [meId])
  useEffect(() => {
    load()
    window.addEventListener('roarme-reminders', load)
    const back = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', back)
    return () => { window.removeEventListener('roarme-reminders', load); document.removeEventListener('visibilitychange', back) }
  }, [load])
  const later = async (id, at) => {
    const { error } = await supabase.from('roar_reminders').update({ remind_at: at.toISOString(), fired_at: null }).eq('id', id)
    changed()
    return error ? errText(error) : ''
  }
  const done = async (id) => {
    const { error } = await supabase.from('roar_reminders').update({ fired_at: new Date().toISOString() }).eq('id', id)
    changed()
    return error ? errText(error) : ''
  }
  const remove = async (id) => {
    setList((l) => l.filter((x) => x.id !== id))
    const { error } = await supabase.from('roar_reminders').delete().eq('id', id)
    changed()
    return error ? errText(error) : ''
  }
  return { list, msgs, load, later, done, remove }
}

/* while RoarMe is open: at each reminder's time, a card that stays until it is answered */
export function ReminderCards({ me, titleOf, rooms, onOpen, onDue }) {
  const rem = useReminders(me.id)
  const [due, setDue] = useState([])
  const shown = useRef(new Set())
  const onDueRef = useRef(onDue)
  onDueRef.current = onDue
  useEffect(() => {
    const check = () => {
      const now = Date.now()
      // due, and not gone off on the server more than two minutes ago (then it went to the phone already)
      const fresh = rem.list.filter((r) => new Date(r.remind_at).getTime() <= now && (!r.fired_at || now - new Date(r.fired_at).getTime() < 120e3) && !shown.current.has(r.id))
      if (!fresh.length) return
      fresh.forEach((r) => shown.current.add(r.id))
      setDue((d) => [...d, ...fresh])
      // marked as gone off, so the server does not send it to this person's phone as well
      supabase.from('roar_reminders').update({ fired_at: new Date().toISOString() }).in('id', fresh.map((r) => r.id)).then(() => {})
      fresh.forEach((r) => onDueRef.current?.(r, rem.msgs[r.message_id]))
    }
    check()
    const id = setInterval(check, 15e3)
    return () => clearInterval(id)
  }, [rem.list, rem.msgs])
  if (!due.length) return null
  const roomOf = (id) => rooms.find((r) => r.room_id === id)
  const close = (id) => setDue((d) => d.filter((x) => x.id !== id))
  return (
    <OnTop>
      <div className="rmd-cards" role="status">
        {due.map((r) => {
          const room = roomOf(r.room_id)
          return (
            <div key={r.id} className="rmd-card">
              <span className="rmd-ico">{I.bell}</span>
              <span className="rmd-text">
                <b>{tr('Reminder')}{room ? ` · ${titleOf(room)}` : ''}</b>
                <span>{reminderText(rem.msgs[r.message_id])}</span>
              </span>
              <span className="rmd-acts">
                <button type="button" className="btn btn-main" onClick={() => { close(r.id); onOpen(r.room_id, r.message_id) }}>{tr('Open')}</button>
                <button type="button" className="btn" onClick={() => { close(r.id); shown.current.delete(r.id); rem.later(r.id, new Date(Date.now() + 60 * 60e3)) }}>{tr('In 1 hour')}</button>
                <button type="button" className="btn" onClick={() => close(r.id)}>{tr('Done')}</button>
              </span>
            </div>
          )
        })}
      </div>
    </OnTop>
  )
}

const whenShort = (iso) => {
  const d = new Date(iso)
  const today = new Date()
  const time = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === today.toDateString()) return `${tr('Today')} ${time}`
  const tmr = new Date(today); tmr.setDate(today.getDate() + 1)
  if (d.toDateString() === tmr.toDateString()) return `${tr('Tomorrow')} ${time}`
  return `${d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

/* Tasks > Reminders */
export function RemindersList({ me, rooms, titleOf, onOpen, toast }) {
  const rem = useReminders(me.id)
  const [edit, setEdit] = useState(null)
  const waiting = rem.list.filter((r) => !r.fired_at)
  const past = rem.list.filter((r) => r.fired_at).reverse()
  const roomOf = (id) => rooms.find((r) => r.room_id === id)
  const row = (r) => {
    const room = roomOf(r.room_id)
    return (
      <div key={r.id} className={`rmd-row${r.fired_at ? ' past' : ''}`} role="button" tabIndex={0} onClick={() => onOpen(r.room_id, r.message_id)}>
        <span className="rmd-ico">{I.bell}</span>
        <span className="rmd-text">
          <span className="rmd-top"><b>{whenShort(r.remind_at)}</b>{room && <small>{titleOf(room)}</small>}</span>
          <span>{reminderText(rem.msgs[r.message_id])}</span>
        </span>
        <span className="rmd-acts" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="round" onClick={() => setEdit(r)} aria-label="Change the time" title={tr('Change the time')}>{I.timer}</button>
          <button type="button" className="round danger" onClick={async () => { const e = await rem.remove(r.id); if (e) toast(e) }} aria-label="Delete" title={tr('Delete')}>{I.trash}</button>
        </span>
      </div>
    )
  }
  return (
    <div className="rmd-list">
      {!rem.list.length && <p className="tasks-empty muted">{tr('No reminders. In a message\'s menu, Remind Me brings it back to you at the time you pick.')}</p>}
      {waiting.length > 0 && <p className="tasks-label">{tr('Coming up')}</p>}
      {waiting.map(row)}
      {past.length > 0 && <p className="tasks-label">{tr('Gone off')}</p>}
      {past.map(row)}
      {edit && <RemindMe preview={reminderText(rem.msgs[edit.message_id])} onClose={() => setEdit(null)} onSave={async (at) => { const e = await rem.later(edit.id, at); if (!e) { setEdit(null); toast(`Reminder set for ${whenText(at.toISOString())}`) } return e }} />}
    </div>
  )
}
