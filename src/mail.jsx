// RoarMail inside RoarMe (Alex, 24 Nov, from the sample https://claude.ai/artifact/Yb79GqDnoCkSXzMy7AVyGP: "yes, this;
// start with the hidden switch"). Step 1: a switch only Alex sees (Settings, inThemeLab), kept on this device; on, the
// gold ROARMAIL folder joins the folder bar and shows RoarMail's accounts, read from the Roar Account (roarmail_sync,
// which the RoarMail app on the computer keeps: never mail, never a password). The mail itself comes in the next step
// (a native part in the iPhone app, RoarMail's engine in the Mac app); until then the list says so.
import { useEffect, useState } from 'react'
import { supabase } from './lib.js'

const KEY = 'roarme-mail-on'
export const mailSwitchNow = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export const mailSwitchSet = (v) => {
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private window */ }
  window.dispatchEvent(new CustomEvent('roarme-mail-switch', { detail: !!v }))
}

const s = (d, f) => <svg viewBox="0 0 24 24" width="20" height="20" fill={f ? 'currentColor' : 'none'} stroke={f ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
export const MAIL_I = {
  mail: s(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" /></>),
  inbox: s(<><path d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M4 13h5l1 2h4l1-2h5" /></>),
  down: s(<path d="M6 9l6 6 6-6" />),
  search: s(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>),
  unread: s(<circle cx="12" cy="12" r="5" />, 1),
  star: s(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />),
  clip: s(<path d="M20 11l-8 8a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />),
  thread: s(<path d="M5 17V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8.5z" />),
  funnel: s(<path d="M4 5h16l-6 7v6l-4 2v-8z" />),
}
const FILTERS = [['search', 'Search'], ['unread', 'Unread'], ['star', 'Starred'], ['clip', 'With attachments'], ['thread', 'Conversations'], ['funnel', 'Promotions']]

// the gold word, as PROJECTS: ROAR bold in gold, MAIL thin in the words' colour
export const MailWord = () => <span className="tab-gold"><b>ROAR</b><i>MAIL</i></span>

// RoarMail's accounts from the Roar Account (the setup the computer app keeps there)
async function loadAccounts() {
  const { data, error } = await supabase.from('roarmail_sync').select('data').maybeSingle()
  if (error) throw error
  const list = data?.data?.tables?.accounts || []
  return list.filter((a) => a.enabled !== 0).sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((a) => ({ id: a.id, email: a.email, name: a.description || a.display_name || a.email.split('@')[0], color: a.color || '#3aa7e8', provider: a.provider }))
}

function AccPic({ a, size = 44 }) {
  const c = a.color || '#3aa7e8'
  return <span className="av av-init" style={{ width: size, height: size, fontSize: Math.round(size * .36), '--ia': c, '--ib': c }}><span>{(a.name || '?')[0].toUpperCase()}</span></span>
}

export function MailView() {
  const [accs, setAccs] = useState(null)
  const [pick, setPick] = useState('all')
  const [filter, setFilter] = useState('')
  useEffect(() => { let gone = false; loadAccounts().then((l) => { if (!gone) setAccs(l) }, () => { if (!gone) setAccs([]) }); return () => { gone = true } }, [])
  const all = { id: 'all', name: 'All' }
  return (
    <div className="rmx">
      <div className="rmx-accs">
        {[all, ...(accs || [])].map((a) => (
          <button key={a.id} type="button" className={`rmx-acc${pick === a.id ? ' on' : ''}`} onClick={() => setPick(a.id)} title={a.email || 'All accounts'}>
            <span className="rmx-ring">{a.id === 'all' ? <span className="av av-init rmx-all" style={{ width: 44, height: 44, '--ia': '#5cc0f2', '--ib': '#3aa7e8' }}>{MAIL_I.inbox}</span> : <AccPic a={a} />}</span>
            <span className="rmx-an">{a.name}</span>
          </button>
        ))}
      </div>
      <div className="rmx-fbar">
        <button type="button" className="pill-btn rmx-fold" disabled>Inbox{MAIL_I.down}</button>
        <span className="rmx-filters">
          {FILTERS.map(([k, label]) => <button key={k} type="button" className={`round${filter === k ? ' on' : ''}`} aria-label={label} title={label} onClick={() => setFilter((f) => (f === k ? '' : k))}>{MAIL_I[k]}</button>)}
        </span>
      </div>
      <div className="rmx-wait">
        <span className="rmx-wait-ico">{MAIL_I.mail}</span>
        {accs === null ? <p>Looking for your RoarMail accounts…</p>
          : accs.length ? <><p>{accs.length === 1 ? 'Your RoarMail account is here.' : `Your ${accs.length} RoarMail accounts are here.`}</p><small>Reading and sending mail on this device comes in the next update.</small></>
          : <><p>No RoarMail accounts yet.</p><small>Add your accounts in RoarMail on your computer, signed in with this Roar Account, and they show here.</small></>}
      </div>
    </div>
  )
}

// Settings > RoarMail, only for Alex while it is being built
export function MailPage() {
  const [on, setOn] = useState(mailSwitchNow)
  useEffect(() => { const f = (e) => setOn(!!e.detail); window.addEventListener('roarme-mail-switch', f); return () => window.removeEventListener('roarme-mail-switch', f) }, [])
  return (
    <div className="hb-page">
      <label className="set-box hb-on hb-switch">
        <span className="hb-t"><b><MailWord /></b><small>{on ? 'The ROARMAIL folder is in your folder bar.' : 'Turn on to see your mail in a ROARMAIL folder.'}</small></span>
        <span className="switch"><input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); mailSwitchSet(e.target.checked) }} /><span /></span>
      </label>
      <p className="hb-hint">Only you see this while it is being built. It is kept on this device; nothing else in RoarMe changes.</p>
    </div>
  )
}
