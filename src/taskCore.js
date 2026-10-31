import { useCallback, useEffect, useRef, useState } from 'react'
import { nameOf, supabase } from './lib.js'
import { chime } from './prefs.js'
import { tr } from './i18n.js'

/* What RoarMe needs of Tasks from the start: the live list, the count on the button and the notices. The panel
   itself (tasks.jsx, with the calendar) comes only when Tasks is opened (Alex, 31 Oct: RoarMe lighter). */

export const COLS = 'id,created_by,assignee,title,notes,due,priority,status,subtasks,decline_note,created_at,updated_at,done_at'
export const STATUS = { pending: 'Waiting', open: 'To do', doing: 'In progress', done: 'Done', declined: 'Declined' }
export const PRIORITY = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]
export const active = (t) => t.status === 'pending' || t.status === 'open' || t.status === 'doing'

/* the tasks you can see, live: new ones, answers and ticks arrive as they happen, with a notice */
export function useTasks(me, loadPeople, onNotice) {
  const [tasks, setTasks] = useState([])
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('roar_tasks').select(COLS).order('created_at', { ascending: false }).limit(500)
    if (error) return
    setTasks(data)
    loadPeople([...new Set(data.flatMap((t) => [t.created_by, t.assignee]))].filter((id) => id !== me.id))
  }, [me.id, loadPeople])
  useEffect(() => {
    load()
    const ch = supabase.channel(`roar-tasks-${me.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_tasks' }, (ev) => {
        const t = ev.new && ev.new.id ? ev.new : null
        if (ev.eventType === 'DELETE') { setTasks((list) => list.filter((x) => x.id !== ev.old.id)); return }
        if (!t || (t.created_by !== me.id && t.assignee !== me.id)) return
        setTasks((list) => [t, ...list.filter((x) => x.id !== t.id)])
        loadPeople([t.created_by, t.assignee].filter((id) => id !== me.id))
        const old = ev.old || {}
        if (ev.eventType === 'INSERT' && t.assignee === me.id && t.created_by !== me.id) noticeRef.current?.('new', t)
        else if (ev.eventType === 'UPDATE' && t.created_by === me.id && t.assignee !== me.id && old.status !== undefined && old.status !== t.status) noticeRef.current?.(t.status, t)
        else if (ev.eventType === 'UPDATE' && t.assignee === me.id && t.created_by !== me.id && old.assignee !== undefined && old.assignee !== me.id) noticeRef.current?.('new', t)
      })
      .subscribe()
    const back = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', back)
    return () => { supabase.removeChannel(ch); document.removeEventListener('visibilitychange', back) }
  }, [me.id, load, loadPeople])
  const mine = tasks.filter((t) => t.assignee === me.id && active(t))
  return { tasks, setTasks, reload: load, count: mine.length, waiting: mine.filter((t) => t.status === 'pending').length }
}

// a notice for a task, the same way RoarMe tells you about a message
export function taskNotice(kind, t, people, open) {
  const who = nameOf(people[kind === 'new' ? t.created_by : t.assignee])
  const head = { new: `${who} gave you a task`, open: `${who} accepted your task`, declined: `${who} declined your task`, done: `${who} finished your task`, doing: `${who} started your task` }[kind]
  if (!head) return null
  try { chime() } catch { /* no sound here */ }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
    try { const n = new Notification(tr(head), { body: t.title, icon: './icon.svg', tag: `task-${t.id}` }); n.onclick = () => { window.focus(); open(); n.close() } } catch { /* not allowed here */ }
  }
  return `${tr(head)}: ${t.title}`
}

