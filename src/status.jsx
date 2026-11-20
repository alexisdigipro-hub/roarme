import { useState } from 'react'
import { Modal } from './ui.jsx'
import { supabase } from './lib.js'

/* Status (Alex, 20 Nov, from Discord's "Change online status"): how I show to others.
   presence: Online, Away (a moon on my picture), Do Not Disturb (a red sign; my notifications come with no sound and
   no banner on every device), Invisible (I look offline: no dot, no last seen). A custom status: an emoji and a few words,
   cleared after a while or never. Kept in roar_profiles (supabase/status.sql); others read it through roar_people. */
export const PRESENCE = [
  ['online', 'Online', 'Others see you as usual'],
  ['away', 'Away', 'A moon on your picture'],
  ['dnd', 'Do Not Disturb', 'No sound or banner for new messages'],
  ['invisible', 'Invisible', 'You look offline, with no last seen'],
]
const CLEAR = [['never', 'Never'], ['1h', '1 hour'], ['4h', '4 hours'], ['today', 'Today']]
const untilOf = (k) => {
  if (k === '1h') return new Date(Date.now() + 3600e3).toISOString()
  if (k === '4h') return new Date(Date.now() + 4 * 3600e3).toISOString()
  if (k === 'today') { const d = new Date(); d.setHours(23, 59, 59, 0); return d.toISOString() }
  return null
}

/* the little sign for a presence, the same one the picture wears (ui.jsx Avatar, .av-on) */
export const PresenceDot = ({ k }) => <i className={`st-dot st-${k}`} aria-hidden="true" />

export function StatusSheet({ me, setMe, onClose }) {
  const [emoji, setEmoji] = useState(me.status_emoji || '')
  const [text, setText] = useState(me.status_text || '')
  const [clear, setClear] = useState('never')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async (patch, close) => {
    setBusy(true); setErr('')
    const { error } = await supabase.from('roar_profiles').update(patch).eq('id', me.id)
    setBusy(false)
    if (error) { setErr(/presence|status_/.test(error.message) ? 'Status is not ready yet (supabase/status.sql).' : error.message); return }
    setMe({ ...me, ...patch })
    if (close) onClose()
  }
  const now = me.presence || 'online'
  const hasCustom = !!(me.status_emoji || me.status_text)
  return (
    <Modal title="Status" onClose={onClose}>
      <div className="st">
        <div className="set-box st-box">
          {PRESENCE.map(([k, label, hint]) => (
            <button key={k} type="button" className={`set-row set-pick st-row${now === k ? ' on' : ''}`} disabled={busy} onClick={() => save({ presence: k })}>
              <PresenceDot k={k} />
              <span className="set-text">{label}<small>{hint}</small></span>
              <i className={`st-radio${now === k ? ' on' : ''}`} />
            </button>
          ))}
        </div>
        <p className="st-h">Custom Status</p>
        <div className="set-box st-box st-custom">
          <div className="st-line">
            <input className="st-emoji" value={emoji} maxLength={4} placeholder="🙂" aria-label="Emoji" onChange={(e) => setEmoji(e.target.value)} />
            <input className="st-text" value={text} maxLength={80} placeholder="What are you up to?" aria-label="Status" onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="st-clear">
            <span>Clear after</span>
            <div className="st-pills">{CLEAR.map(([k, l]) => <button key={k} type="button" className={`pill-btn${clear === k ? ' on' : ''}`} onClick={() => setClear(k)}>{l}</button>)}</div>
          </div>
          <div className="st-acts">
            {hasCustom && <button type="button" className="pill-btn" disabled={busy} onClick={() => { setEmoji(''); setText(''); save({ status_emoji: '', status_text: '', status_until: null }) }}>Clear Status</button>}
            <button type="button" className="pill-btn st-save" disabled={busy || (!emoji.trim() && !text.trim())} onClick={() => save({ status_emoji: emoji.trim(), status_text: text.trim(), status_until: untilOf(clear) }, true)}>Save</button>
          </div>
        </div>
        {err && <p className="auth-err">{err}</p>}
      </div>
    </Modal>
  )
}
