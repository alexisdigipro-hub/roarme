import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar, I, Modal } from './ui.jsx'
import { errText, listTime, nameOf, supabase, timeOf } from './lib.js'
import { formatText } from './format.jsx'

/* RoarMe Inbox (Alex, 19 Oct: "where do I see who writes to the RoarMe chat"): for the admins only, every chat of the
   official RoarMe account. Pick one, read it, answer: the answer goes as RoarMe, from your own login
   (supabase/official-inbox.sql). Opening a chat marks it read for RoarMe. */

export function useInboxCount(on) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on) return undefined
    let alive = true
    const load = () => supabase.rpc('roar_official_inbox').then(({ data }) => { if (alive) setN((data || []).reduce((a, x) => a + (x.unread || 0), 0)) })
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 60e3)
    return () => { alive = false; clearInterval(id) }
  }, [on])
  return n
}

export function RoarMeInbox({ onClose }) {
  const [list, setList] = useState(null)
  const [room, setRoom] = useState(null)
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [editId, setEditId] = useState('') // a RoarMe message being corrected (Alex, 8 Nov): no "edited" mark, they are RoarMe's own words
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [all, setAll] = useState(false) // every chat of RoarMe's, or only the ones where somebody wrote and waits
  const end = useRef(null)
  const loadList = useCallback(async () => {
    const { data, error } = await supabase.rpc('roar_official_inbox')
    if (error) setErr(errText(error)); else setList(data || [])
  }, [])
  const loadRoom = useCallback(async (r) => {
    const { data, error } = await supabase.rpc('roar_official_messages', { r })
    if (error) setErr(errText(error)); else setMsgs(data || [])
  }, [])
  useEffect(() => { loadList() }, [loadList])
  // what comes in while it is open
  useEffect(() => {
    const id = setInterval(() => { if (document.hidden) return; loadList(); if (room) loadRoom(room.room_id) }, 15e3)
    return () => clearInterval(id)
  }, [room, loadList, loadRoom])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  const open = async (x) => { setRoom(x); setMsgs([]); setErr(''); setEditId(''); setText(''); await loadRoom(x.room_id); loadList() }
  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true); setErr('')
    const { error } = editId
      ? await supabase.rpc('roar_official_edit', { m: editId, body })
      : await supabase.rpc('roar_official_send', { r: room.room_id, body })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setText(''); setEditId('')
    loadRoom(room.room_id); loadList()
  }
  // any message in a RoarMe chat can be deleted for everyone (spam, insults)
  const drop = async (m) => {
    if (!window.confirm('Delete this message for everyone?')) return
    const { error } = await supabase.rpc('roar_admin_delete_message', { m: m.id })
    if (error) { setErr(errText(error)); return }
    if (editId === m.id) { setEditId(''); setText('') }
    loadRoom(room.room_id); loadList()
  }
  const name = (x) => x.display_name || `@${x.username}`
  const what = (x) => (x.last_kind === 'image' ? 'Photo' : x.last_kind === 'voice' ? 'Voice message' : x.last_kind === 'file' ? 'File' : x.last_body || '')

  const waiting = (list || []).filter((x) => x.last_from_them || x.unread > 0)
  const shown = all ? (list || []) : waiting.concat(room && !waiting.some((x) => x.room_id === room.room_id) ? (list || []).filter((x) => x.room_id === room.room_id) : [])
  return (
    <Modal title="RoarMe Inbox" onClose={onClose} wide>
      <div className={`inbox${room ? ' has-room' : ''}`}>
        <div className="inbox-list">
          {list === null && <p className="muted pf-empty">Loading…</p>}
          {/* only the ones that want an answer (Alex, 12 Nov: "empty it, so that I notice when somebody writes"): a chat
              whose last word is RoarMe's own (the welcome, an answer already given) is under Everyone; nothing is deleted */}
          {list && (
            <span className="seg inbox-seg">
              <button type="button" className={!all ? 'on' : ''} onClick={() => setAll(false)}>Waiting{waiting.length > 0 ? ` · ${waiting.length}` : ''}</button>
              <button type="button" className={all ? 'on' : ''} onClick={() => setAll(true)}>Everyone</button>
            </span>
          )}
          {list && !shown.length && <p className="muted pf-empty">{all ? 'Nobody has written to RoarMe yet.' : 'Nobody is waiting for an answer.'}</p>}
          {shown.map((x) => (
            <button key={x.room_id} type="button" className={`inbox-row${room?.room_id === x.room_id ? ' on' : ''}${x.unread ? ' new' : ''}`} onClick={() => open(x)}>
              <Avatar src={x.avatar_url} name={name(x)} size={40} />
              <span className="inbox-text">
                <span className="inbox-top"><b>{name(x)}</b><small>{listTime(x.last_at)}</small></span>
                <span className="inbox-prev">{x.last_from_them ? '' : 'RoarMe: '}{what(x)}</span>
              </span>
              {x.unread > 0 && <i className="inbox-n">{x.unread}</i>}
            </button>
          ))}
        </div>
        <div className="inbox-room">
          {!room && <p className="muted pf-empty">Pick a chat to read and answer as RoarMe.</p>}
          {room && (
            <>
              <div className="inbox-head">
                <button type="button" className="round inbox-back" onClick={() => setRoom(null)} aria-label="Back" data-back="">{I.left}</button>
                <Avatar src={room.avatar_url} name={name(room)} size={34} />
                <span><b>{name(room)}</b><small>@{room.username}</small></span>
              </div>
              <div className="inbox-msgs">
                {msgs.map((m) => {
                  const mine = m.user_id !== room.person
                  return (
                    <div key={m.id} className={`inbox-msg${mine ? ' mine' : ''}`}>
                      <span className="inbox-bubble">
                        {m.kind === 'text' ? formatText(m.body || '') : <i>{m.kind === 'image' ? 'Photo' : m.kind === 'voice' ? 'Voice message' : m.kind === 'file' ? `File: ${m.file?.name || ''}` : m.body}</i>}
                        <small>{mine ? 'RoarMe · ' : ''}{timeOf(m.created_at)}</small>
                      </span>
                      <span className="inbox-acts">
                        {mine && m.kind === 'text' && <button type="button" className="round tiny" onClick={() => { setEditId(m.id); setText(m.body || '') }} aria-label="Correct" title="Correct (no edited mark)">{I.edit}</button>}
                        <button type="button" className="round tiny danger" onClick={() => drop(m)} aria-label="Delete for everyone" title="Delete for everyone">{I.trash}</button>
                      </span>
                    </div>
                  )
                })}
                <span ref={end} />
              </div>
              {err && <p className="sch-err">{err}</p>}
              {editId && <div className="inbox-editing"><span>{I.edit}<b>Correcting a RoarMe message</b></span><button type="button" className="round tiny" onClick={() => { setEditId(''); setText('') }} aria-label="Cancel" title="Cancel">{I.x}</button></div>}
              <div className="inbox-compose">
                <textarea rows={1} value={text} onChange={(e) => setText(e.target.value.slice(0, 8000))} placeholder={`Answer ${nameOf(room)} as RoarMe…`}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
                <button type="button" className={`round send${text.trim() ? ' ready' : ''}`} disabled={busy || !text.trim()} onClick={send} aria-label="Send" title="Send as RoarMe">{I.send}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
