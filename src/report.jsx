import { useEffect, useState } from 'react'
import { I, Modal } from './ui.jsx'
import { errText, nameOf, supabase } from './lib.js'
import { plainText } from './format.jsx'
import { tr } from './i18n.js'

/* Report a message or a person (Alex, 14 Nov, for the App Store: people must be able to report what is objectionable).
   Anything can ask for the window with report({ message, person }); ReportHost, mounted once in Chat.jsx, shows it.
   The report goes to RoarMe's admins (supabase/reports.sql roar_report; Settings > Admin > Reports) with the reason, a
   note, and the message's words as they are now. Nothing is told to the person reported. */

export const REPORT_REASONS = [
  ['spam', 'Spam or a scam'],
  ['abuse', 'Harassment or hate'],
  ['violence', 'Violence or threats'],
  ['sexual', 'Sexual content'],
  ['illegal', 'Something illegal'],
  ['other', 'Something else'],
]

export const report = (what) => window.dispatchEvent(new CustomEvent('roarme-report', { detail: what }))

export function ReportHost({ me, people, blocks, onBlocks, toast }) {
  const [what, setWhat] = useState(null)
  useEffect(() => {
    const on = (e) => setWhat(e.detail || null)
    window.addEventListener('roarme-report', on)
    return () => window.removeEventListener('roarme-report', on)
  }, [])
  if (!what) return null
  const person = what.person || people?.[what.message?.user_id] || null
  return <ReportSheet me={me} message={what.message} person={person} blocked={!!person && (blocks || []).includes(person.id)} onBlocks={onBlocks} toast={toast} onClose={() => setWhat(null)} />
}

function ReportSheet({ me, message, person, blocked, onBlocks, toast, onClose }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const name = person ? nameOf(person) : tr('this person')
  const locked = String(message?.body || '').startsWith('e2e1.') || !!message?.sealed
  const words = message ? plainText(message.body || '').replace(/\s+/g, ' ').slice(0, 200) : ''
  const send = async () => {
    if (!reason || busy) return
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('roar_report', { p_user: person?.id || null, p_message: message?.id || null, p_reason: reason, p_note: note.trim() })
    if (error) { setBusy(false); setErr(errText(error)); return }
    if (alsoBlock && person && !blocked) {
      const b = await supabase.from('roar_blocks').insert({ blocker: me.id, blocked: person.id })
      if (!b.error) onBlocks?.()
    }
    setBusy(false)
    toast?.('Reported. Thank you, we will look at it.')
    onClose()
  }
  return (
    <Modal title={message ? 'Report Message' : 'Report'} onClose={onClose}
      foot={<button type="button" className="btn btn-main rep-go" disabled={!reason || busy} onClick={send}>{I.flag}<span>{busy ? 'Sending…' : 'Send Report'}</span></button>}>
      <div className="rep">
        <p className="rep-about">{message ? <>You are reporting a message from <b data-raw="">{name}</b>.</> : <>You are reporting <b data-raw="">{name}</b>.</>}</p>
        {message && !locked && words && <p className="rep-words" data-raw="">{words}</p>}
        {message && locked && <p className="rep-words">Encrypted message: its words stay locked, only the report is sent.</p>}
        <div className="rep-reasons" role="radiogroup" aria-label="Reason">
          {REPORT_REASONS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={reason === k} className={`rep-reason${reason === k ? ' on' : ''}`} onClick={() => setReason(k)}><span>{l}</span>{reason === k && <i>{I.check}</i>}</button>
          ))}
        </div>
        <textarea className="input rep-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything we should know (optional)" />
        {person && !blocked && person.id !== me.id && (
          <button type="button" role="switch" aria-checked={alsoBlock} className={`rep-block${alsoBlock ? ' on' : ''}`} onClick={() => setAlsoBlock((v) => !v)}><span>Also block {name}<small>They will not be able to message or call you</small></span><i className="rep-box">{alsoBlock && I.check}</i></button>
        )}
        <p className="muted rep-fine">{message && !locked ? "The report goes to RoarMe's moderators with this message's words. " : "The report goes to RoarMe's moderators. "}The person is not told. We look at reports within 24 hours and remove what breaks the Terms.</p>
        {err && <p className="auth-err">{err}</p>}
      </div>
    </Modal>
  )
}
