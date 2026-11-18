import { useEffect, useMemo, useRef, useState } from 'react'
import { errText, supabase } from './lib.js'
import { Avatar, I } from './ui.jsx'

/* Polls (Alex, 15 Nov, from Telegram's New Poll). PollEditor is a tab of the attach sheet: the question and a line
   under it, up to 12 options (a new empty one appears as the last is filled), and the settings with their coloured
   signs. PollCard is the poll in a chat: tap an option to vote (several, then Vote, when more than one answer is
   allowed), then the results as bars with the share of votes, who voted when the poll shows it, the right answer of a
   quiz, Retract Vote, Add an Option, Stop Poll and the time left. Data: supabase/polls.sql. */

const MAX = 12
const newId = () => Math.random().toString(36).slice(2, 10)
const tile = (bg, d) => <i className="pl-ico" style={{ background: bg }}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg></i>
const SET_I = {
  voters: tile('linear-gradient(180deg,#4aa3ff,#2a7cf6)', <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>),
  multiple: tile('linear-gradient(180deg,#ffbe3d,#ff9500)', <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /><path d="m14 7.5 2 2 4-4.5" /></>),
  add: tile('linear-gradient(180deg,#6cc8ff,#34aadc)', <><circle cx="12" cy="12" r="8" /><path d="M12 8v8M8 12h8" /></>),
  revote: tile('linear-gradient(180deg,#7d7dff,#5856d6)', <><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1M19.5 12a7.5 7.5 0 0 1-13 5.1" /><path d="M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6" /></>),
  shuffle: tile('linear-gradient(180deg,#d07bff,#af52de)', <><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /><path d="M12 6h4.5a2 2 0 0 1 2 2v2M12 18H7.5a2 2 0 0 1-2-2v-2" /></>),
  correct: tile('linear-gradient(180deg,#5ee07a,#34c759)', <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="m8 12.5 3 3 5-6" /></>),
  limit: tile('linear-gradient(180deg,#ff6b5e,#ff3b30)', <><circle cx="12" cy="13" r="7" /><path d="M12 13V9.5M10 3.5h4" /></>),
}
const SETTINGS = [
  ['voters', 'Show Who Voted', 'Display voter names on each option'],
  ['multiple', 'Allow Multiple Answers', 'Voters can select more than one option'],
  ['add', 'Allow Adding Options', 'Participants can suggest new options'],
  ['revote', 'Allow Revoting', 'Voters can change their vote'],
  ['shuffle', 'Shuffle Options', 'Answers appear in a random order for each voter'],
  ['correct', 'Set Correct Answer', 'Mark one or more options as the right answer'],
  ['limit', 'Limit Duration', 'Automatically close the poll at a set time'],
]
const GRIP_I = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 9h14M5 15h14" /></svg>
const DURATIONS = [[1, '1 hour'], [3, '3 hours'], [8, '8 hours'], [24, '1 day'], [72, '3 days'], [168, '1 week']]

/* the editor; onReady(fn | null) hands the sheet the Send it shows in its head, null while the poll is not complete */
export function PollEditor({ onReady }) {
  const [q, setQ] = useState('')
  const [desc, setDesc] = useState('')
  const [opts, setOpts] = useState([{ id: newId(), text: '' }, { id: newId(), text: '' }])
  const [set, setSet] = useState({ voters: true, multiple: false, add: false, revote: true, shuffle: false, correct: false, limit: false })
  const [right, setRight] = useState([])
  const [hours, setHours] = useState(24)
  const filled = opts.filter((o) => o.text.trim())
  const left = MAX - filled.length
  const ready = q.trim() && filled.length >= 2 && (!set.correct || right.some((id) => filled.some((o) => o.id === id)))
  useEffect(() => {
    onReady(ready ? () => ({
      question: q.trim().slice(0, 255),
      description: desc.trim().slice(0, 500),
      options: filled.map((o) => ({ id: o.id, text: o.text.trim().slice(0, 100) })),
      show_voters: set.voters, multiple: set.multiple, add_options: set.add, revote: set.revote, shuffle: set.shuffle,
      correct: set.correct ? right.filter((id) => filled.some((o) => o.id === id)) : null,
      closes_at: set.limit ? new Date(Date.now() + hours * 3600e3).toISOString() : null,
    }) : null)
  }, [ready, q, desc, opts, set, right, hours]) // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (id, text) => setOpts((l) => {
    const next = l.map((o) => (o.id === id ? { ...o, text } : o))
    // a new empty line appears as the last one is written in, up to 12
    if (next[next.length - 1].text.trim() && next.length < MAX) next.push({ id: newId(), text: '' })
    return next
  })
  const drop = (id) => { setOpts((l) => (l.length > 2 ? l.filter((o) => o.id !== id) : l.map((o) => (o.id === id ? { ...o, text: '' } : o)))); setRight((r) => r.filter((x) => x !== id)) }
  const mark = (id) => setRight((r) => (r.includes(id) ? r.filter((x) => x !== id) : set.multiple ? [...r, id] : [id]))
  // the options are put in order by their grip (Alex, 18 Nov: "reorder them, up and down"): the held one follows the
  // finger, changing places with the option it passes; the empty line at the end stays last
  const [dragId, setDragId] = useState(null)
  const listRef = useRef(null)
  const dragMove = (e) => {
    if (!dragId) return
    const rows = [...(listRef.current?.querySelectorAll('.pl-opt[data-fill]') || [])]
    const to = rows.findIndex((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom })
    if (to < 0) return
    setOpts((l) => {
      const from = l.findIndex((o) => o.id === dragId)
      const target = l.findIndex((o) => o.id === rows[to].dataset.id)
      if (from < 0 || target < 0 || from === target) return l
      const next = [...l]; const [it] = next.splice(from, 1); next.splice(target, 0, it)
      return next
    })
  }
  const grip = (id) => ({
    onPointerDown: (e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setDragId(id) },
    onPointerMove: dragMove,
    onPointerUp: () => setDragId(null),
    onPointerCancel: () => setDragId(null),
    onTouchStart: (e) => e.stopPropagation(), // the sheet's own slides stay out of it
  })
  const flip = (k) => setSet((s) => {
    const n = { ...s, [k]: !s[k] }
    if (k === 'multiple' && !n.multiple) setRight((r) => r.slice(0, 1))
    return n
  })
  return (
    <div className="pl-ed">
      <small className="as-label">Question</small>
      <div className="as-card pl-card">
        <input className="pl-in pl-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a Question" maxLength={255} />
        <input className="pl-in" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Add Description (optional)" maxLength={500} />
      </div>
      <small className="as-label">{set.correct ? 'Options · tap the circle of the right answer' : 'Options'}</small>
      <div className="as-card pl-card" ref={listRef}>
        {opts.map((o, n) => (
          // the whole row is the field's own label (Alex, 18 Nov: "Add an Option does not take the tap easily"): a touch on
          // the circle or on the empty end of the row puts the cursor in it too
          <label key={o.id} htmlFor={`plo-${o.id}`} className={`pl-opt${dragId === o.id ? ' drag' : ''}`} data-id={o.id} data-fill={o.text.trim() ? '' : undefined}>
            {set.correct
              ? <button type="button" className={`pl-mark${right.includes(o.id) ? ' on' : ''}`} onClick={() => mark(o.id)} aria-label="Right answer" disabled={!o.text.trim()}>{right.includes(o.id) ? I.check : null}</button>
              : <span className="pl-dot" />}
            <input id={`plo-${o.id}`} className="pl-in" value={o.text} onChange={(e) => edit(o.id, e.target.value)} placeholder={n === opts.length - 1 && n >= 2 ? 'Add an Option' : 'Option'} maxLength={100} />
            {o.text && <button type="button" className="round pl-del" onClick={() => drop(o.id)} aria-label="Remove option">{I.x}</button>}
            {o.text.trim() && filled.length > 1 && <span className="pl-grip" role="button" aria-label="Move option" title="Hold and move" {...grip(o.id)} onClick={(e) => e.preventDefault()}>{GRIP_I}</span>}
          </label>
        ))}
      </div>
      <small className="pl-note">{left > 0 ? `You can add ${left} more option${left === 1 ? '' : 's'}.` : 'You have added the most options a poll can have.'}</small>
      <small className="as-label">Settings</small>
      <div className="as-card pl-card">
        {SETTINGS.map(([k, title, sub]) => (
          <label key={k} className="pl-set">
            {SET_I[k]}
            <span className="pl-set-t"><b>{title}</b><small>{sub}</small></span>
            <span className="switch"><input type="checkbox" checked={!!set[k]} onChange={() => flip(k)} /><span /></span>
          </label>
        ))}
        {set.limit && (
          <div className="pl-dur">
            {DURATIONS.map(([h, label]) => <button key={h} type="button" className={`pill-btn${hours === h ? ' on' : ''}`} onClick={() => setHours(h)}>{label}</button>)}
          </div>
        )}
      </div>
    </div>
  )
}

// the same order every time for the same person, different for each (Shuffle Options)
const seeded = (list, seed) => {
  const h = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) } return x >>> 0 }
  return [...list].sort((a, b) => h(seed + a.id) - h(seed + b.id))
}
const leftText = (at) => {
  const ms = new Date(at).getTime() - Date.now()
  if (ms <= 0) return ''
  const h = ms / 3600e3
  return h >= 48 ? `Ends in ${Math.round(h / 24)} days` : h >= 1 ? `Ends in ${Math.round(h)} h` : `Ends in ${Math.max(1, Math.round(ms / 60e3))} min`
}

/* the poll in a chat */
export function PollCard({ id, me, people = {}, canStop = false, onError }) {
  const [st, setSt] = useState(null)
  const [pick, setPick] = useState([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(null)
  const load = () => supabase.rpc('roar_poll_state', { m: id }).then(({ data }) => { if (data) setSt(data) })
  useEffect(() => {
    load()
    const ch = supabase.channel(`poll-${id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'roar_polls', filter: `message_id=eq.${id}` }, () => load())
      .subscribe()
    const t = setInterval(load, 60000) // the time left, and a poll that closes by itself
    return () => { supabase.removeChannel(ch); clearInterval(t) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const p = st?.poll
  const order = useMemo(() => (p ? (p.shuffle ? seeded(p.options || [], me || '') : p.options || []) : []), [p, me])
  if (!st || !p) return <div className="poll pl-wait"><b>Poll</b><small>Loading…</small></div>
  const mine = st.mine || []
  const voted = mine.length > 0
  const closed = !!st.closed
  const showRes = voted || closed
  const total = st.voters_total || 0
  const quiz = Array.isArray(p.correct) && p.correct.length > 0
  const run = async (fn) => { if (busy) return; setBusy(true); const { error } = await fn(); setBusy(false); if (error) onError?.(errText(error)); else load() }
  const vote = (ids) => run(() => supabase.rpc('roar_poll_vote', { m: id, opts: ids })).then(() => setPick([]))
  const tap = (oid) => {
    if (showRes || closed) return
    if (p.multiple) setPick((l) => (l.includes(oid) ? l.filter((x) => x !== oid) : [...l, oid]))
    else vote([oid])
  }
  const kind = quiz ? (p.show_voters ? 'Quiz' : 'Anonymous Quiz') : p.show_voters ? 'Public Poll' : 'Anonymous Poll'
  return (
    <div className={`poll${showRes ? ' res' : ''}${closed ? ' closed' : ''}`} onClick={(e) => e.stopPropagation()}>
      <b className="poll-q">{p.question}</b>
      {p.description && <span className="poll-d">{p.description}</span>}
      <small className="poll-kind">{kind}{p.multiple ? ' · Multiple answers' : ''}{closed ? ' · Final results' : p.closes_at ? ` · ${leftText(p.closes_at)}` : ''}</small>
      <div className="poll-opts">
        {order.map((o) => {
          const n = st.counts?.[o.id] || 0
          const share = total ? Math.round((n / total) * 100) : 0
          const isMine = mine.includes(o.id)
          const isRight = quiz && p.correct.includes(o.id)
          const who = (st.voters?.[o.id] || []).slice(0, 3)
          return (
            <button key={o.id} type="button" className={`poll-opt${isMine ? ' mine' : ''}${pick.includes(o.id) ? ' picked' : ''}${showRes && quiz ? (isRight ? ' right' : isMine ? ' wrong' : '') : ''}`} disabled={busy || showRes} onClick={() => tap(o.id)}>
              {showRes
                ? <span className="poll-pc">{share}%{isMine && <i className="poll-me" title="Your vote">{I.check}</i>}</span>
                : <i className={`poll-box${p.multiple ? ' sq' : ''}`}>{pick.includes(o.id) ? I.check : null}</i>}
              <span className="poll-txt">
                <span className="poll-line"><span className="poll-label">{o.text}</span>{showRes && quiz && (isMine || isRight) && <i className="poll-tick">{isRight ? I.check : I.x}</i>}
                  {showRes && n > 0 && <span className="poll-n">{n}</span>}
                  {showRes && who.length > 0 && <span className="poll-faces">{who.map((u) => <Avatar key={u} src={people[u]?.avatar_url} name={people[u]?.display_name || people[u]?.username || ''} size={18} />)}</span>}
                </span>
                {showRes && <span className="poll-bar"><i style={{ width: `${Math.max(share, n ? 3 : 0)}%` }} /></span>}
              </span>
            </button>
          )
        })}
      </div>
      {adding !== null && (
        <form className="poll-add" onSubmit={(e) => { e.preventDefault(); const t = adding.trim(); if (t) run(() => supabase.rpc('roar_poll_add_option', { m: id, t })).then(() => setAdding(null)) }}>
          <input className="pl-in" autoFocus value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add an Option" maxLength={100} />
          <button type="submit" className="pill-btn on" disabled={busy || !adding.trim()}>Add</button>
        </form>
      )}
      <div className="poll-foot">
        <small>{total === 0 ? 'No votes yet' : `${total} vote${total === 1 ? '' : 's'}`}</small>
        <span className="poll-acts">
          {!showRes && p.multiple && <button type="button" className="pill-btn on" disabled={busy || !pick.length} onClick={() => vote(pick)}>Vote</button>}
          {voted && !closed && p.revote && <button type="button" className="pill-btn" disabled={busy} onClick={() => vote([])}>Revote</button>}
          {!closed && p.add_options && adding === null && (p.options || []).length < MAX && <button type="button" className="pill-btn" onClick={() => setAdding('')}>Add an Option</button>}
          {!closed && (canStop || p.created_by === me) && <button type="button" className="pill-btn danger" disabled={busy} onClick={() => { if (window.confirm('Stop this poll? Nobody can vote after this.')) run(() => supabase.rpc('roar_poll_stop', { m: id })) }}>Stop Poll</button>}
        </span>
      </div>
    </div>
  )
}
