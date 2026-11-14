import { useEffect, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, errText, nameOf, supabase } from './lib.js'
import { Avatar, I, Modal } from './ui.jsx'

/* Sign in with a phone number and find friends from the phone's contacts (Alex, 14 Nov, before the App Store;
   supabase/contacts-find.sql). The phone number is the first way in once Supabase's phone sign-in is on (phoneAuthOn reads
   Supabase's public auth settings); until then RoarMe stays as it was, email only. The contacts are read only inside
   the iPhone app (Capacitor's contacts plugin); their emails and numbers never leave the phone: each is turned into a
   SHA-256 (the email in small letters, the number's digits with the country code first) and only those go to
   roar_find_contacts. */

// the countries offered at sign-up; Greece first
export const COUNTRIES = [
  ['30', 'Greece'], ['357', 'Cyprus'], ['44', 'United Kingdom'], ['1', 'USA / Canada'], ['49', 'Germany'],
  ['33', 'France'], ['39', 'Italy'], ['34', 'Spain'], ['31', 'Netherlands'], ['32', 'Belgium'], ['41', 'Switzerland'],
  ['43', 'Austria'], ['46', 'Sweden'], ['45', 'Denmark'], ['47', 'Norway'], ['351', 'Portugal'], ['353', 'Ireland'],
  ['359', 'Bulgaria'], ['40', 'Romania'], ['355', 'Albania'], ['389', 'North Macedonia'], ['381', 'Serbia'],
  ['90', 'Turkey'], ['7', 'Russia'], ['380', 'Ukraine'], ['48', 'Poland'], ['420', 'Czechia'], ['36', 'Hungary'],
  ['972', 'Israel'], ['971', 'United Arab Emirates'], ['20', 'Egypt'], ['61', 'Australia'], ['64', 'New Zealand'],
  ['55', 'Brazil'], ['52', 'Mexico'], ['54', 'Argentina'], ['91', 'India'], ['86', 'China'], ['81', 'Japan'], ['82', 'South Korea'],
]

const digits = (s) => String(s || '').replace(/\D/g, '')
// a number typed with the country picked: +<code><number>, the first 0 of a national number dropped (not in Italy)
export const toE164 = (cc, local) => {
  let d = digits(local)
  if (String(local).trim().startsWith('+')) return `+${d}`
  if (d.startsWith('00')) return `+${d.slice(2)}`
  if (cc !== '39') d = d.replace(/^0+/, '')
  return `+${cc}${d}`
}
// a number from the address book, as auth.users keeps numbers: digits only, country code first
export const contactDigits = (raw, cc) => {
  const s = String(raw || '').trim()
  const d = digits(s)
  if (!d) return ''
  if (s.startsWith('+')) return d
  if (d.startsWith('00')) return d.slice(2)
  if (d.startsWith(cc) && d.length > 10) return d
  return cc + (cc === '39' ? d : d.replace(/^0+/, ''))
}
// the country code of a full number (the longest one in the list that fits)
export const countryOf = (full) => {
  const d = digits(full)
  return COUNTRIES.map(([c]) => c).filter((c) => d.startsWith(c)).sort((a, b) => b.length - a.length)[0] || '30'
}
export const showPhone = (full) => { const d = digits(full); const c = countryOf(d); return d ? `+${c} ${d.slice(c.length)}` : '' }

export async function sha256hex(s) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// is Supabase's phone sign-in on? (its public settings; asked once)
let phoneOn = null
export function phoneAuthOn() {
  if (!phoneOn) {
    phoneOn = fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } })
      .then((r) => r.json()).then((s) => !!s?.external?.phone).catch(() => false)
  }
  return phoneOn
}
export function usePhoneAuth() {
  const [on, setOn] = useState(false)
  useEffect(() => { let live = true; phoneAuthOn().then((v) => { if (live) setOn(v) }); return () => { live = false } }, [])
  return on
}

/* the country and the number, side by side */
export function PhoneField({ cc, setCc, num, setNum, autoFocus }) {
  return (
    <div className="phone-field">
      <select className="input phone-cc" value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Country">
        {COUNTRIES.map(([c, n]) => <option key={c + n} value={c}>{`+${c} ${n}`}</option>)}
      </select>
      <input className="input" type="tel" inputMode="tel" autoComplete="tel-national" autoFocus={autoFocus} value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d\s+()-]/g, ''))} placeholder="Mobile number" />
    </div>
  )
}

// the plugin inside the iPhone app; the site does not carry @capacitor/core, so it is reached through the native bridge if need be
const contactsPlugin = () => {
  const C = typeof window !== 'undefined' ? window.Capacitor : null
  if (!C?.isNativePlatform?.()) return null
  const ready = C.Plugins?.Contacts || C.registerPlugin?.('Contacts')
  if (ready) return ready
  if (!C.nativePromise) return null
  return { requestPermissions: (o = {}) => C.nativePromise('Contacts', 'requestPermissions', o), getContacts: (o = {}) => C.nativePromise('Contacts', 'getContacts', o) }
}
export const contactsAvailable = () => !!contactsPlugin()

// reads the address book, asks which emails and numbers are on RoarMe; returns who is and who could be invited
export async function friendsFromContacts() {
  const P = contactsPlugin()
  if (!P) throw new Error('Your contacts can be read only in the RoarMe app for iPhone.')
  const perm = await P.requestPermissions()
  if (perm?.contacts !== 'granted' && perm?.contacts !== 'limited') throw new Error('RoarMe may not read your contacts. Allow it in the iPhone\'s Settings > RoarMe > Contacts.')
  const { data: { user } } = await supabase.auth.getUser()
  const cc = user?.phone ? countryOf(user.phone) : '30'
  const { contacts = [] } = await P.getContacts({ projection: { name: true, phones: true, emails: true } })
  const byHash = new Map()
  const people = []
  for (const c of contacts) {
    const nums = [...new Set((c.phones || []).map((p) => contactDigits(p.number, cc)).filter((d) => d.length >= 8 && d.length <= 15))]
    const mails = [...new Set((c.emails || []).map((e) => String(e.address || '').trim().toLowerCase()).filter((e) => e.includes('@')))]
    if (!nums.length && !mails.length) continue
    const name = c.name?.display || [c.name?.given, c.name?.family].filter(Boolean).join(' ') || (nums[0] ? `+${nums[0]}` : mails[0])
    const entry = { name, number: nums[0] ? `+${nums[0]}` : '' }
    for (const k of [...nums, ...mails]) byHash.set(await sha256hex(k), entry)
    people.push(entry)
  }
  const hashes = [...byHash.keys()]
  const found = new Map()
  for (let i = 0; i < hashes.length; i += 5000) {
    const { data, error } = await supabase.rpc('roar_find_contacts', { hashes: hashes.slice(i, i + 5000) })
    if (error) throw error
    for (const r of data || []) if (!found.has(r.id)) found.set(r.id, { ...r, contactName: byHash.get(r.hash)?.name || '' })
  }
  const onRoar = new Set([...found.values()].map((r) => byHash.get(r.hash)))
  return {
    found: [...found.values()].sort((a, b) => (a.contactName || nameOf(a)).localeCompare(b.contactName || nameOf(b))),
    // the rest who have a number, to invite by SMS
    invite: people.filter((p) => p.number && !onRoar.has(p)).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

const INVITE_TEXT = 'Join me on RoarMe: https://alexisdigipro-hub.github.io/roarme/'

/* Contacts > Find Friends: who of your contacts is on RoarMe (Message), and the rest to invite by SMS */
export function PhoneFriends({ onClose, onOpen }) {
  const [state, setState] = useState({ busy: true, err: '', found: [], invite: [] })
  const [q, setQ] = useState('')
  useEffect(() => {
    friendsFromContacts().then((r) => setState({ busy: false, err: '', ...r })).catch((e) => setState({ busy: false, err: errText(e), found: [], invite: [] }))
  }, [])
  const message = async (p) => {
    const { data, error } = await supabase.rpc('roar_open_direct', { other: p.id })
    if (error) setState((s) => ({ ...s, err: errText(error) })); else onOpen(data)
  }
  const has = (s) => !q.trim() || String(s).toLowerCase().includes(q.trim().toLowerCase())
  return (
    <Modal title="Friends From Your Contacts" onClose={onClose}>
      {state.busy && <p className="muted">Looking through your contacts…</p>}
      {state.err && <p className="auth-err">{state.err}</p>}
      {!state.busy && !state.err && (
        <>
          <label className="search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label>
          <p className="phone-sec">{state.found.length ? 'On RoarMe' : 'None of your contacts is on RoarMe yet'}</p>
          <div className="people">
            {state.found.filter((p) => has(`${p.contactName} ${nameOf(p)} ${p.username}`)).map((p) => (
              <div key={p.id} className="person phone-person">
                <Avatar src={p.avatar_url} name={nameOf(p)} size={40} />
                <span className="person-text"><b>{p.contactName || nameOf(p)}</b><small>@{p.username}</small></span>
                <button type="button" className="btn btn-sm btn-main" onClick={() => message(p)}>Message</button>
              </div>
            ))}
          </div>
          {state.invite.length > 0 && <p className="phone-sec">Invite to RoarMe</p>}
          <div className="people">
            {state.invite.filter((p) => has(`${p.name} ${p.number}`)).slice(0, 300).map((p) => (
              <div key={p.number} className="person phone-person">
                <Avatar name={p.name} size={40} />
                <span className="person-text"><b>{p.name}</b><small data-raw="">{p.number}</small></span>
                <a className="btn btn-sm" href={`sms:${p.number}&body=${encodeURIComponent(INVITE_TEXT)}`}>Invite</a>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}
