import { useEffect, useMemo, useState } from 'react'
import { I } from './ui.jsx'
import { supabase } from './lib.js'
import { locale, tr } from './i18n.js'

/* The calendar under Tasks (Alex, 18 Oct): at the foot of the Tasks panel, on the same page, a month with a dot on each day for its tasks
   (by due date), scheduled calls (the cards sent in chats) and your scheduled messages (repeats included). A day
   lists them below: a task opens its window, a call goes to its card in the chat, a message to its chat. */

const DOT = { task: 'var(--accent)', call: '#30d158', msg: '#64d2ff' }
const STEP = { day: [0, 1], week: [0, 7], '2weeks': [0, 14], month: [1, 0], '3months': [3, 0], '6months': [6, 0], year: [12, 0] }
const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hm = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
// the n-th time of a repeating message, counted from the first (as the server does)
const nth = (first, repeat, n) => {
  const [m, days] = STEP[repeat] || [0, 0]
  const d = new Date(first)
  if (m) d.setMonth(d.getMonth() + m * n)
  if (days) d.setDate(d.getDate() + days * n)
  return d
}

export function TasksCalendar({ me, tasks, titleOf, rooms, onTask, onNewTask, onOpenChat }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [day, setDay] = useState(() => keyOf(new Date()))
  const [calls, setCalls] = useState([])
  const [sched, setSched] = useState([])
  // the six weeks shown, Monday first
  const cells = useMemo(() => {
    const start = new Date(month)
    start.setDate(1 - ((start.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [month])
  const from = cells[0], to = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate() + 1)

  // looked up again when a call or a message is scheduled here, when RoarMe comes back to the front, and every
  // minute (a call someone else schedules arrives that way)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const again = () => setTick((n) => n + 1)
    const back = () => { if (!document.hidden) again() }
    window.addEventListener('roarme-cal', again)
    document.addEventListener('visibilitychange', back)
    const id = setInterval(again, 60e3)
    return () => { window.removeEventListener('roarme-cal', again); document.removeEventListener('visibilitychange', back); clearInterval(id) }
  }, [])
  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('roar_messages').select('id, room_id, body, file').not('file->event', 'is', null).is('deleted_at', null)
        .gte('file->event->>start', from.toISOString()).lt('file->event->>start', to.toISOString()).limit(500),
      supabase.from('roar_scheduled').select('id, room_id, body, first_at, send_at, repeat, times').eq('user_id', me.id).limit(300),
    ]).then(([a, b]) => {
      if (!alive) return
      setCalls(a.data || [])
      setSched(b.data || [])
    })
    return () => { alive = false }
  }, [month, me.id, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  // everything by day
  const byDay = useMemo(() => {
    const out = {}
    const put = (k, item) => { (out[k] = out[k] || []).push(item) }
    tasks.forEach((t) => { if (t.due && t.status !== 'declined') put(t.due, { kind: 'task', id: `t-${t.id}`, t, at: null, title: t.title, done: t.status === 'done' }) })
    calls.forEach((m) => {
      const ev = m.file?.event
      const at = ev?.start && new Date(ev.start)
      if (at && !Number.isNaN(at.getTime())) put(keyOf(at), { kind: 'call', id: `c-${m.id}`, m, at, title: ev.title || m.body, video: !!ev.video })
    })
    sched.forEach((s) => {
      if (s.repeat === 'never' || !STEP[s.repeat]) { const at = new Date(s.send_at); put(keyOf(at), { kind: 'msg', id: `s-${s.id}`, s, at, title: s.body }); return }
      for (let n = s.times || 0, i = 0; i < 400; n++, i++) {
        const at = nth(s.first_at, s.repeat, n)
        if (at >= to) break
        if (at >= from && at >= new Date(s.send_at)) put(keyOf(at), { kind: 'msg', id: `s-${s.id}-${n}`, s, at, title: s.body })
      }
    })
    Object.values(out).forEach((l) => l.sort((x, y) => (x.at ? x.at.getTime() : 0) - (y.at ? y.at.getTime() : 0)))
    return out
  }, [tasks, calls, sched]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = keyOf(new Date())
  const chatName = (roomId) => { const r = rooms.find((x) => x.room_id === roomId); return r ? titleOf(r) : '' }
  const list = byDay[day] || []
  const shift = (n) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1))
  const goToday = () => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setDay(keyOf(d)) }
  const dayDate = new Date(`${day}T12:00:00`)

  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="round" onClick={() => shift(-1)} aria-label="Previous month" title="Previous month">{I.left}</button>
        <strong>{month.toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="round" onClick={() => shift(1)} aria-label="Next month" title="Next month">{I.right}</button>
        <button type="button" className="btn btn-sm cal-today" onClick={goToday}>{tr('Today')}</button>
      </div>
      <div className="cal-grid">
        {cells.slice(0, 7).map((d) => <span key={`w${d.getDay()}`} className="cal-wd">{d.toLocaleDateString(locale(), { weekday: 'narrow' })}</span>)}
        {cells.map((d) => {
          const k = keyOf(d)
          const items = byDay[k] || []
          const kinds = [...new Set(items.map((x) => x.kind))]
          return (
            <button key={k} type="button" className={`cal-day${d.getMonth() !== month.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}${k === day ? ' on' : ''}`} onClick={() => setDay(k)}>
              <span>{d.getDate()}</span>
              <span className="cal-dots">{kinds.map((x) => <i key={x} style={{ background: DOT[x] }} />)}</span>
            </button>
          )
        })}
      </div>
      <div className="cal-legend">
        <span><i style={{ background: DOT.task }} />{tr('Tasks')}</span>
        <span><i style={{ background: DOT.call }} />{tr('Calls')}</span>
        <span><i style={{ background: DOT.msg }} />{tr('Scheduled messages')}</span>
      </div>
      <p className="tasks-label">{dayDate.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <div className="cal-list">
        {!list.length && <p className="tasks-empty muted">{tr('Nothing on this day.')}</p>}
        {list.map((x) => (
          <button key={x.id} type="button" className={`cal-item k-${x.kind}${x.done ? ' done' : ''}`}
            onClick={() => (x.kind === 'task' ? onTask(x.t.id) : x.kind === 'call' ? onOpenChat(x.m.room_id, x.m.id) : onOpenChat(x.s.room_id))}>
            <span className="cal-ico" style={{ '--c': DOT[x.kind] }}>{x.kind === 'task' ? I.tasks : x.kind === 'call' ? (x.video ? I.video : I.phone) : I.timer}</span>
            <span className="cal-text">
              <b>{x.title}</b>
              <small>{x.at ? hm(x.at) : tr(x.done ? 'Done' : 'Task')}{x.kind !== 'task' && chatName((x.m || x.s).room_id) ? ` · ${chatName((x.m || x.s).room_id)}` : ''}</small>
            </span>
          </button>
        ))}
      </div>
      {onNewTask && <button type="button" className="tasks-new" onClick={() => onNewTask(day)}>{I.plus}<span>{tr('New task on this day…')}</span></button>}
    </div>
  )
}
