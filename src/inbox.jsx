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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
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
  const open = async (x) => { setRoom(x); setMsgs([]); setErr(''); await loadRoom(x.room_id); loadList() }
  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('roar_official_send', { r: room.room_id, body })
    setBusy(false)
    if (error) { setErr(errText(error)); return }
    setText('')
    loadRoom(room.room_id); loadList()
  }
  const name = (x) => x.display_name || `@${x.username}`
  const what = (x) => (x.last_kind === 'image' ? 'Photo' : x.last_kind === 'voice' ? 'Voice message' : x.last_kind === 'file' ? 'File' : x.last_body || '')

  return (
    <Modal title="RoarMe Inbox" onClose={onClose} wide>
      <div className={`inbox${room ? ' has-room' : ''}`}>
        <div className="inbox-list">
          {list === null && <p className="muted pf-empty">Loading…</p>}
          {list && !list.length && <p className="muted pf-empty">Nobody has written to RoarMe yet.</p>}
          {(list || []).map((x) => (
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
                    </div>
                  )
                })}
                <span ref={end} />
              </div>
              {err && <p className="sch-err">{err}</p>}
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
