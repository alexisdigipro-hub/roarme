import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Avatar, I, Lens, Modal } from './ui.jsx'
import { errText, nameOf, supabase } from './lib.js'
import { chime } from './prefs.js'
import { locale, tr } from './i18n.js'

/* Tasks (Alex, 18 Oct): a small task manager beside the chats, after the hub's Tasks. Never posted into a
   conversation (it would fill the chats): the Tasks button opens a panel that stays open while you move between
   chats. A task goes to you or to someone in your Contacts (anyone you share a chat with); for someone else it
   waits until they accept or decline it. The rules live in the database too (supabase/tasks.sql). */

const COLS = 'id,created_by,assignee,title,notes,due,priority,status,subtasks,decline_note,created_at,updated_at,done_at'
const STATUS = { pending: 'Waiting', open: 'To do', doing: 'In progress', done: 'Done', declined: 'Declined' }
const PRIORITY = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']]
const active = (t) => t.status === 'pending' || t.status === 'open' || t.status === 'doing'

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

const dueText = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`), today = new Date(); today.setHours(12, 0, 0, 0)
  const days = Math.round((d - today) / 864e5)
  if (days === 0) return tr('Today')
  if (days === 1) return tr('Tomorrow')
  if (days === -1) return tr('Yesterday')
  return d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
}
const overdue = (t) => t.due && active(t) && new Date(`${t.due}T23:59:59`) < new Date()
const byDue = (a, b) => (a.due || '9999') .localeCompare(b.due || '9999') || (b.priority === 'high') - (a.priority === 'high') || b.created_at.localeCompare(a.created_at)

/* the panel: For me (with what waits for an answer on top), Given, Done */
export function TasksPanel({ me, people, contacts, kit, onClose, toast }) {
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('roarme-tasks-tab') || 'all' } catch { return 'all' } })
  const pickTab = (v) => { setTab(v); try { localStorage.setItem('roarme-tasks-tab', v) } catch { /* private window */ } }
  const [edit, setEdit] = useState(null) // true for a new task, or the task being changed
  const [view, setView] = useState(null) // the id of the task open in its window
  const { tasks, setTasks } = kit
  const person = (id) => (id === me.id ? me : people[id])
  const forMe = tasks.filter((t) => t.assignee === me.id && active(t)).sort(byDue)
  const asks = forMe.filter((t) => t.status === 'pending')
  const todo = forMe.filter((t) => t.status !== 'pending')
  const given = tasks.filter((t) => t.created_by === me.id && t.assignee !== me.id && t.status !== 'done').sort(byDue)
  const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 60)
  // All (Alex, 18 Oct): everything together, what waits for your answer first, then the open ones by date, then done
  const open = tasks.filter((t) => t.status !== 'done' && !(t.assignee === me.id && t.status === 'pending')).sort(byDue)
  const shown = view && tasks.find((t) => t.id === view)
  // as wide as you dragged it, like the chat list (Alex, 18 Oct): drag its left edge, double-click to reset
  const TW = 360
  const [tw, setTw] = useState(() => { try { return Math.max(320, Number(localStorage.getItem('roarme-tasks-w')) || TW) } catch { return TW } })
  const maxW = () => {
    const side = document.querySelector('.app > .side')
    const left = side ? side.getBoundingClientRect().right : 0
    return Math.max(320, Math.min(720, window.innerWidth - left - 440)) // the chat keeps room to breathe
  }
  const keepW = (w) => { try { localStorage.setItem('roarme-tasks-w', String(w)) } catch { /* private window */ } }
  const drag = (e) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = box.current?.offsetWidth || tw
    let w = w0
    const move = (ev) => { w = Math.round(Math.min(maxW(), Math.max(320, w0 - (ev.clientX - x0)))); setTw(w) }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      keepW(w)
    }
    document.body.classList.add('resizing')
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  // the same glass, corners, shadow and height as the chat beside it, whatever the theme (Alex, 18 Oct)
  const box = useRef(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const fit = () => {
      const main = document.querySelector('.app > .main')
      const phone = window.matchMedia('(max-width: 760px)').matches
      const keys = ['background', 'backgroundColor', 'border', 'borderRadius', 'boxShadow', 'backdropFilter', 'webkitBackdropFilter', 'top', 'bottom', 'right']
      const app = document.querySelector('.app')
      if (phone || !main) { keys.forEach((k) => { el.style[k] = '' }); app?.style.removeProperty('--tasks-pad'); return }
      const cs = getComputedStyle(main), r = main.getBoundingClientRect()
      el.style.background = cs.background
      el.style.backgroundColor = cs.backgroundColor
      el.style.border = cs.border
      el.style.borderRadius = cs.borderRadius
      el.style.boxShadow = cs.boxShadow
      el.style.backdropFilter = cs.backdropFilter
      el.style.webkitBackdropFilter = cs.webkitBackdropFilter || cs.backdropFilter
      el.style.top = `${Math.round(r.top)}px`
      el.style.bottom = `${Math.round(window.innerHeight - r.bottom)}px`
      // the gaps come from the columns on the left, not from the top (the Mac app keeps room up there for the
      // window's buttons): the outer margin as on the left edge, the gap as between the chat list and the chat
      const side = document.querySelector('.app > .side')
      const sr = side ? side.getBoundingClientRect() : null
      const edge = sr ? Math.max(0, Math.round(sr.left)) : Math.round(r.top)
      const gap = sr ? Math.max(0, Math.round(r.left - sr.right)) : edge
      el.style.right = `${edge}px`
      app?.style.setProperty('--tasks-pad', `${Math.round(el.offsetWidth + edge + gap)}px`)
    }
    fit()
    const later = () => requestAnimationFrame(() => requestAnimationFrame(fit))
    const main = document.querySelector('.app > .main')
    const ro = new ResizeObserver(fit)
    if (main) ro.observe(main)
    ro.observe(el)
    window.addEventListener('resize', fit)
    window.addEventListener('roarme-prefs', later)
    const mo = new MutationObserver(later)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'data-bubbles', 'class', 'style'] })
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', fit); window.removeEventListener('roarme-prefs', later); document.querySelector('.app')?.style.removeProperty('--tasks-pad') }
  }, [])

  const patch = async (t, change, ok) => {
    const before = tasks
    setTasks((list) => list.map((x) => (x.id === t.id ? { ...x, ...change } : x)))
    const { data, error } = await supabase.from('roar_tasks').update(change).eq('id', t.id).select(COLS).single()
    if (error) { setTasks(before); toast(errText(error)); return false }
    setTasks((list) => list.map((x) => (x.id === t.id ? data : x)))
    if (ok) toast(ok)
    return true
  }
  const tick = (t) => patch(t, { status: t.status === 'done' ? 'open' : 'done' }, t.status === 'done' ? '' : 'Done')

  const row = (t) => {
    const mineToDo = t.assignee === me.id
    const other = person(mineToDo ? t.created_by : t.assignee)
    const subs = Array.isArray(t.subtasks) ? t.subtasks : []
    const canTick = (t.status === 'open' || t.status === 'doing' || t.status === 'done') && (t.assignee === me.id || t.created_by === me.id)
    return (
      <div key={t.id} className={`task${t.status === 'done' ? ' done' : ''}${t.status === 'pending' && t.assignee === me.id ? ' asks' : ''}`}>
        <button type="button" className={`task-check${t.status === 'done' ? ' on' : ''}`} disabled={!canTick} onClick={() => tick(t)}
          aria-label={t.status === 'done' ? 'Not done' : 'Done'} title={canTick ? (t.status === 'done' ? 'Not done' : 'Done') : STATUS[t.status]} />
        <button type="button" className="task-main" onClick={() => setView(t.id)}>
          <b>{t.priority === 'high' && <i className="task-hi" title="High priority">!</i>}{t.title}</b>
          <span className="task-meta">
            {t.created_by === t.assignee ? <span>{tr('For you')}</span>
              : <span className="task-who"><Avatar src={other?.avatar_url} name={nameOf(other)} size={18} />{tr(mineToDo ? 'From' : 'To')} {nameOf(other)}</span>}
            {t.due && <span className={`task-due${overdue(t) ? ' late' : ''}`}>{I.calendar}{overdue(t) ? tr('Overdue') : dueText(t.due)}</span>}
            {subs.length > 0 && <span>☑ {subs.filter((s) => s.done).length}/{subs.length}</span>}
            {t.created_by === me.id && t.assignee !== me.id && t.status !== 'open' && <span className={`task-state s-${t.status}`}>{tr(STATUS[t.status])}</span>}
            {t.status === 'doing' && t.assignee === me.id && <span className="task-state s-doing">{tr('In progress')}</span>}
          </span>
        </button>
        {t.status === 'pending' && t.assignee === me.id && (
          <span className="task-answer">
            <button type="button" className="btn btn-main" onClick={() => patch(t, { status: 'open' }, 'Accepted')}>{tr('Accept')}</button>
            <button type="button" className="btn" onClick={() => setView(t.id)}>{tr('Decline')}</button>
          </span>
        )}
      </div>
    )
  }

  return (
    <aside ref={box} className="tasks-panel" aria-label="Tasks" style={{ '--tasks-w': `${Math.min(tw, 720)}px` }}>
      <span className="tasks-grip" onPointerDown={drag} onDoubleClick={() => { setTw(TW); keepW(TW) }} title="Drag to widen, double-click to reset" />
      <div className="tasks-head">
        <strong>{tr('Tasks')}</strong>
        <button type="button" className="round" onClick={() => setEdit(true)} aria-label="New task" title="New task">{I.plus}</button>
        <button type="button" className="round" onClick={onClose} aria-label="Close" title="Close">{I.x}</button>
      </div>
      <Lens as="nav" className="tabs tasks-tabs" dep={tab}>
        <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => pickTab('all')}>{tr('All')}</button>
        <button type="button" className={tab === 'mine' ? 'on' : ''} onClick={() => pickTab('mine')}>{tr('For me')}{forMe.length > 0 && <small>{forMe.length}</small>}</button>
        <button type="button" className={tab === 'given' ? 'on' : ''} onClick={() => pickTab('given')}>{tr('Given')}</button>
        <button type="button" className={tab === 'done' ? 'on' : ''} onClick={() => pickTab('done')}>{tr('Done')}</button>
      </Lens>
      <div className="tasks-list">
        {tab === 'all' && (
          <>
            {asks.length > 0 && <p className="tasks-label">{tr('Waiting for your answer')}</p>}
            {asks.map(row)}
            {asks.length > 0 && open.length > 0 && <p className="tasks-label">{tr('Open')}</p>}
            {open.map(row)}
            {done.length > 0 && <p className="tasks-label">{tr('Done')}</p>}
            {done.map(row)}
            {!tasks.length && <Empty text="Nothing on your list." onNew={() => setEdit(true)} />}
          </>
        )}
        {tab === 'mine' && (
          <>
            {asks.length > 0 && <p className="tasks-label">{tr('Waiting for your answer')}</p>}
            {asks.map(row)}
            {asks.length > 0 && todo.length > 0 && <p className="tasks-label">{tr('To do')}</p>}
            {todo.map(row)}
            {!forMe.length && <Empty text="Nothing on your list." onNew={() => setEdit(true)} />}
          </>
        )}
        {tab === 'given' && (given.length ? given.map(row) : <Empty text="Tasks you give to others show here, with their answer." onNew={() => setEdit(true)} />)}
        {tab === 'done' && (done.length ? done.map(row) : <p className="tasks-empty muted">{tr('Finished tasks show here.')}</p>)}
      </div>
      <button type="button" className="tasks-new" onClick={() => setEdit(true)}>{I.plus}<span>{tr('New task…')}</span></button>

      {edit && <TaskForm me={me} contacts={contacts} people={people} initial={edit === true ? null : edit} toast={toast}
        onClose={() => setEdit(null)} onSaved={(t) => { setTasks((list) => [t, ...list.filter((x) => x.id !== t.id)]); setEdit(null); if (tab !== 'all') pickTab(t.assignee === me.id ? 'mine' : 'given') }} />}
      {shown && <TaskView t={shown} me={me} person={person} onClose={() => setView(null)} patch={patch} toast={toast}
        onEdit={() => { setEdit(shown); setView(null) }}
        onDelete={async () => {
          if (!window.confirm(tr('Delete this task?'))) return
          const { error } = await supabase.from('roar_tasks').delete().eq('id', shown.id)
          if (error) { toast(errText(error)); return }
          setTasks((list) => list.filter((x) => x.id !== shown.id)); setView(null); toast('Deleted')
        }} />}
    </aside>
  )
}

function Empty({ text, onNew }) {
  return (
    <div className="tasks-empty">
      <span className="tasks-empty-ico">{I.tasks}</span>
      <p className="muted">{tr(text)}</p>
      <button type="button" className="btn btn-main" onClick={onNew}>{I.plus} {tr('New task')}</button>
    </div>
  )
}

/* new task, or changing one you gave: title, who it is for (you or a contact), date, priority, notes */
function TaskForm({ me, contacts, people, initial, onClose, onSaved, toast }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [who, setWho] = useState(initial?.assignee || me.id)
  const [due, setDue] = useState(initial?.due || '')
  const [priority, setPriority] = useState(initial?.priority || 'normal')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return contacts.filter((p) => !s || nameOf(p).toLowerCase().includes(s) || (p.username || '').toLowerCase().includes(s))
  }, [contacts, q])
  const picked = who === me.id ? me : people[who] || contacts.find((p) => p.id === who)
  const save = async () => {
    if (!title.trim()) { setErr(tr('Give the task a title.')); return }
    setBusy(true); setErr('')
    const row = { title: title.trim(), assignee: who, due: due || null, priority, notes: notes.trim() }
    const { data, error } = initial
      ? await supabase.from('roar_tasks').update(row).eq('id', initial.id).select(COLS).single()
      : await supabase.from('roar_tasks').insert(row).select(COLS).single()
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    toast(initial ? 'Saved' : who === me.id ? 'Added to your tasks' : `Sent to ${nameOf(picked)}: waiting for an answer`)
    onSaved(data)
  }
  return (
    <Modal title={initial ? 'Change task' : 'New task'} onClose={onClose}
      foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" onClick={save} disabled={busy}>{busy ? '…' : initial ? 'Save' : who === me.id ? 'Add task' : 'Send task'}</button></>}>
      <label className="field"><span>Task</span><input className="input" autoFocus value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save() }} placeholder="e.g. Book the lens for Friday" /></label>
      <div className="field">
        <span>For</span>
        <div className="task-for">
          <button type="button" className={`task-pick${who === me.id ? ' on' : ''}`} onClick={() => setWho(me.id)}><Avatar src={me.avatar_url} name={nameOf(me)} size={26} /><span>{tr('Me')}</span></button>
          {picked && who !== me.id && <button type="button" className="task-pick on"><Avatar src={picked.avatar_url} name={nameOf(picked)} size={26} /><span>{nameOf(picked)}</span></button>}
        </div>
        {contacts.length > 6 && <label className="search task-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in your contacts" /></label>}
        <div className="people task-people">
          {list.map((p) => (
            <button key={p.id} type="button" className="person" onClick={() => setWho(p.id)}>
              <Avatar src={p.avatar_url} name={nameOf(p)} size={34} />
              <span className="person-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
              <span className={`tick${who === p.id ? ' on' : ''}`} />
            </button>
          ))}
          {!contacts.length && <p className="muted small-note">{tr('Your contacts are the people you share a chat with. Start a chat to give someone a task.')}</p>}
        </div>
        {who !== me.id && <small className="muted small-note">{tr('They get it as a request and can accept or decline it.')}</small>}
      </div>
      <div className="task-row2">
        <label className="field"><span>Due</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <div className="field"><span>Priority</span>
          <Lens className="tabs" dep={priority}>{PRIORITY.map(([v, l]) => <button key={v} type="button" className={priority === v ? 'on' : ''} onClick={() => setPriority(v)}>{tr(l)}</button>)}</Lens>
        </div>
      </div>
      <label className="field"><span>Notes</span><textarea className="input task-notes" value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} placeholder="Anything they should know" /></label>
      {err && <p className="auth-err">{err}</p>}
    </Modal>
  )
}

/* one task: who to whom, its answer and progress, the checklist, and what each side may do */
function TaskView({ t, me, person, onClose, patch, onEdit, onDelete, toast }) {
  const giver = t.created_by === me.id
  const taker = t.assignee === me.id
  const from = person(t.created_by), to = person(t.assignee)
  const subs = Array.isArray(t.subtasks) ? t.subtasks : []
  const [sub, setSub] = useState('')
  const [declining, setDeclining] = useState(false)
  const [why, setWhy] = useState('')
  const setSubs = (next) => patch(t, { subtasks: next })
  const canWork = (giver || taker) && (t.status === 'open' || t.status === 'doing' || t.status === 'done')
  return (
    <Modal title={tr('Task')} onClose={onClose}
      foot={giver ? <><button type="button" className="btn btn-danger" onClick={onDelete}>{I.trash} {tr('Delete')}</button><button type="button" className="btn" onClick={onEdit}>{I.edit} {tr(t.status === 'declined' ? 'Give to someone else' : 'Change')}</button></> : null}>
      <div className="task-view">
        <h3 className={t.status === 'done' ? 'done' : ''}>{t.priority === 'high' && <i className="task-hi">!</i>}{t.title}</h3>
        <p className="task-people-line">
          <span className="task-who"><Avatar src={from?.avatar_url} name={nameOf(from)} size={22} />{giver ? tr('You') : nameOf(from)}</span>
          <span className="muted">→</span>
          <span className="task-who"><Avatar src={to?.avatar_url} name={nameOf(to)} size={22} />{taker ? tr('You') : nameOf(to)}</span>
          <span className={`task-state s-${t.status}`}>{tr(STATUS[t.status])}</span>
        </p>
        {(t.due || t.priority !== 'normal') && (
          <p className="task-meta">
            {t.due && <span className={`task-due${overdue(t) ? ' late' : ''}`}>{I.calendar}{dueText(t.due)}</span>}
            {t.priority !== 'normal' && <span>{tr(t.priority === 'high' ? 'High priority' : 'Low priority')}</span>}
          </p>
        )}
        {t.notes && <p className="task-notes-text">{t.notes}</p>}
        {t.status === 'declined' && t.decline_note && <p className="task-declined">“{t.decline_note}”</p>}

        {t.status === 'pending' && taker && !declining && (
          <div className="task-acts">
            <button type="button" className="btn btn-main" onClick={() => patch(t, { status: 'open' }, 'Accepted')}>{tr('Accept')}</button>
            <button type="button" className="btn" onClick={() => setDeclining(true)}>{tr('Decline')}</button>
          </div>
        )}
        {declining && (
          <div className="task-decline">
            <textarea className="input" autoFocus value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} placeholder={tr('Why, if you like (they will see it)')} />
            <div className="task-acts">
              <button type="button" className="btn" onClick={() => setDeclining(false)}>{tr('Back')}</button>
              <button type="button" className="btn btn-danger" onClick={async () => { if (await patch(t, { status: 'declined', decline_note: why.trim() }, 'Declined')) onClose() }}>{tr('Decline task')}</button>
            </div>
          </div>
        )}
        {t.status === 'pending' && giver && !taker && <p className="muted">{tr('Waiting for them to accept it.')}</p>}

        {canWork && (
          <Lens className="tabs task-status" dep={t.status}>
            {['open', 'doing', 'done'].map((s) => <button key={s} type="button" className={t.status === s ? 'on' : ''} onClick={() => t.status !== s && patch(t, { status: s })}>{tr(STATUS[s])}</button>)}
          </Lens>
        )}

        {(canWork || subs.length > 0) && (
          <div className="task-subs">
            <span className="tasks-label">{tr('Checklist')}</span>
            {subs.map((s, i) => (
              <div key={i} className={`task-sub${s.done ? ' done' : ''}`}>
                <button type="button" className={`task-check small${s.done ? ' on' : ''}`} disabled={!canWork} onClick={() => setSubs(subs.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label="Tick" />
                <span>{s.text}</span>
                {canWork && <button type="button" className="round tiny" onClick={() => setSubs(subs.filter((_, j) => j !== i))} aria-label="Remove">{I.x}</button>}
              </div>
            ))}
            {canWork && (
              <input className="input task-sub-in" value={sub} maxLength={200} placeholder={tr('Add a step and press Enter')} onChange={(e) => setSub(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { if (subs.length >= 50) { toast('That is a long list already'); return } setSubs([...subs, { text: sub.trim(), done: false }]); setSub('') } }} />
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
