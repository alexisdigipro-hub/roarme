import { useMemo, useRef, useState } from 'react'
import { errText, fold, nameOf, supabase } from './lib.js'
import { Avatar, CropModal, I, Modal, svg } from './ui.jsx'

/* RoarMe's address book (Alex, 22 Nov: "contacts as a real database for each user, in the cloud, to take out or join
   with another app whenever they want; a full contacts suite", from the sample https://claude.ai/artifact/DFB7sDjj3c7TyQhTTWmHnv,
   "βάλ' το", and "not full of buttons, nicely grouped and lean"). Every person keeps their own contacts in roar_book
   (supabase/address-book.sql: only the owner reads or writes), also people who are not on RoarMe; a contact can be
   linked to someone's RoarMe account (person). Import and export are vCard (.vcf), which every contacts app reads;
   inside the iPhone app the phone's own Contacts can be read in too. */

const CACHE = (me) => `roarme-c-book-${me}`
export const LABELS = {
  phones: ['mobile', 'work', 'home', 'other'],
  emails: ['work', 'home', 'other'],
  addresses: ['home', 'work', 'other'],
  websites: ['website', 'work', 'blog'],
  socials: ['instagram', 'linkedin', 'x', 'tiktok', 'facebook', 'youtube', 'other'],
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const emptyEntry = () => ({ first_name: '', last_name: '', nickname: '', company: '', job_title: '', photo_url: '', phones: [], emails: [], addresses: [], websites: [], socials: [], birth_day: null, birth_month: null, birth_year: null, notes: '', groups: [], favourite: false, person: null })
export const entryName = (e) => [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || e.nickname || e.company || e.emails?.[0]?.value || e.phones?.[0]?.value || 'No name'
export const sortKey = (e) => (e.first_name || e.last_name || e.nickname || e.company || '').trim()
export const entryText = (e) => [entryName(e), e.nickname, e.company, e.job_title, e.notes, ...(e.groups || []), ...['phones', 'emails', 'websites', 'socials'].flatMap((k) => (e[k] || []).map((x) => x.value)), ...(e.addresses || []).map((a) => [a.street, a.city, a.country].join(' '))].join(' ')
export const phoneDigits = (s) => String(s || '').replace(/[^\d]/g, '').replace(/^00/, '').slice(-10)

// what is kept: only the columns of roar_book
const COLS = ['first_name', 'last_name', 'nickname', 'company', 'job_title', 'photo_url', 'phones', 'emails', 'addresses', 'websites', 'socials', 'birth_day', 'birth_month', 'birth_year', 'notes', 'groups', 'favourite', 'person']
const clean = (e) => {
  const o = {}
  for (const k of COLS) o[k] = e[k] ?? emptyEntry()[k]
  for (const k of ['phones', 'emails', 'websites', 'socials']) o[k] = (o[k] || []).map((x) => ({ label: x.label || LABELS[k][0], value: String(x.value || '').trim() })).filter((x) => x.value)
  o.addresses = (o.addresses || []).map((a) => ({ label: a.label || 'home', street: (a.street || '').trim(), city: (a.city || '').trim(), postcode: (a.postcode || '').trim(), country: (a.country || '').trim() })).filter((a) => a.street || a.city || a.postcode || a.country)
  o.groups = [...new Set((o.groups || []).map((g) => g.trim()).filter(Boolean))]
  for (const k of ['first_name', 'last_name', 'nickname', 'company', 'job_title', 'notes']) o[k] = String(o[k] || '').trim()
  for (const k of ['birth_day', 'birth_month', 'birth_year']) o[k] = o[k] ? Number(o[k]) || null : null
  return o
}

export const keptBook = (me) => { try { return JSON.parse(localStorage.getItem(CACHE(me))) || [] } catch { return [] } }
const keepBook = (me, list) => { try { localStorage.setItem(CACHE(me), JSON.stringify(list)) } catch { /* full */ } }
export async function loadBook(me) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('roar_book').select('*').eq('owner', me).order('first_name').range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  keepBook(me, out)
  return out
}
export async function saveEntry(me, e) {
  const row = { ...clean(e), updated_at: new Date().toISOString() }
  const q = e.id ? supabase.from('roar_book').update(row).eq('id', e.id).eq('owner', me) : supabase.from('roar_book').insert({ ...row, owner: me })
  const { data, error } = await q.select().single()
  if (error) throw error
  return data
}
export async function deleteEntry(me, id) {
  const { error } = await supabase.from('roar_book').delete().eq('id', id).eq('owner', me)
  if (error) throw error
}

/* vCard 3.0 out, 2.1 / 3.0 / 4.0 in */
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
const unesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
const TYPE_OUT = { mobile: 'CELL', work: 'WORK', home: 'HOME', other: 'OTHER' }
export function toVcf(list) {
  return list.map((e) => {
    const L = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(e.last_name)};${esc(e.first_name)};;;`, `FN:${esc(entryName(e))}`]
    if (e.nickname) L.push(`NICKNAME:${esc(e.nickname)}`)
    if (e.company) L.push(`ORG:${esc(e.company)}`)
    if (e.job_title) L.push(`TITLE:${esc(e.job_title)}`)
    for (const p of e.phones || []) L.push(`TEL;TYPE=${TYPE_OUT[p.label] || 'VOICE'}:${p.value}`)
    for (const m of e.emails || []) L.push(`EMAIL;TYPE=INTERNET,${TYPE_OUT[m.label] || 'OTHER'}:${m.value}`)
    for (const a of e.addresses || []) L.push(`ADR;TYPE=${TYPE_OUT[a.label] || 'OTHER'}:;;${esc(a.street)};${esc(a.city)};;${esc(a.postcode)};${esc(a.country)}`)
    for (const w of e.websites || []) L.push(`URL:${w.value}`)
    for (const s of e.socials || []) L.push(`X-SOCIALPROFILE;TYPE=${s.label}:${s.value}`)
    if (e.birth_month && e.birth_day) L.push(`BDAY:${e.birth_year ? String(e.birth_year) : '--'}${String(e.birth_month).padStart(2, '0')}${String(e.birth_day).padStart(2, '0')}`)
    if (e.groups?.length) L.push(`CATEGORIES:${e.groups.map(esc).join(',')}`)
    if (e.notes) L.push(`NOTE:${esc(e.notes)}`)
    if (e.photo_url) L.push(`PHOTO;VALUE=URI:${e.photo_url}`)
    L.push('END:VCARD')
    return L.join('\r\n')
  }).join('\r\n') + '\r\n'
}
const labelOf = (params, kind) => {
  const t = params.toUpperCase()
  if (kind === 'phones' && /CELL|MOBILE|IPHONE/.test(t)) return 'mobile'
  if (/WORK/.test(t)) return 'work'
  if (/HOME/.test(t)) return 'home'
  return kind === 'phones' ? 'mobile' : kind === 'emails' ? 'other' : kind === 'addresses' ? 'home' : 'other'
}
const qp = (s) => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
export function parseVcf(text) {
  const lines = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/)
  const out = []
  let e = null
  for (const raw of lines) {
    const line = raw.trim()
    if (/^BEGIN:VCARD/i.test(line)) { e = emptyEntry(); continue }
    if (/^END:VCARD/i.test(line)) { if (e && (entryName(e) !== 'No name' || e.phones.length || e.emails.length)) out.push(e); e = null; continue }
    if (!e) continue
    const i = line.indexOf(':')
    if (i < 0) continue
    let head = line.slice(0, i)
    let val = line.slice(i + 1)
    head = head.replace(/^item\d+\./i, '')
    const [name, ...ps] = head.split(';')
    const params = ps.join(';')
    if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) { try { val = decodeURIComponent(escape(qp(val))) } catch { val = qp(val) } }
    const N = name.toUpperCase()
    if (N === 'N') { const [last, first] = val.split(';').map(unesc); e.last_name = last || ''; e.first_name = first || '' }
    else if (N === 'FN') { if (!e.first_name && !e.last_name) { const parts = unesc(val).trim().split(/\s+/); e.first_name = parts.shift() || ''; e.last_name = parts.join(' ') } }
    else if (N === 'NICKNAME') e.nickname = unesc(val)
    else if (N === 'ORG') e.company = unesc(val.split(';')[0])
    else if (N === 'TITLE') e.job_title = unesc(val)
    else if (N === 'TEL') e.phones.push({ label: labelOf(params, 'phones'), value: val.replace(/^tel:/i, '').trim() })
    else if (N === 'EMAIL') e.emails.push({ label: labelOf(params, 'emails'), value: val.trim() })
    else if (N === 'ADR') { const p = val.split(';').map(unesc); e.addresses.push({ label: labelOf(params, 'addresses'), street: [p[1], p[2]].filter(Boolean).join(' '), city: p[3] || '', postcode: p[5] || '', country: p[6] || '' }) }
    else if (N === 'URL') e.websites.push({ label: 'website', value: unesc(val) })
    else if (N === 'X-SOCIALPROFILE') { const t = (params.match(/TYPE=([^;:]+)/i)?.[1] || 'other').toLowerCase(); e.socials.push({ label: LABELS.socials.includes(t) ? t : 'other', value: unesc(val) }) }
    else if (N === 'BDAY') { const d = val.replace(/[^\d-]/g, ''); const m = d.match(/^(?:(\d{4})|--)-?(\d{2})-?(\d{2})/); if (m) { e.birth_year = m[1] ? Number(m[1]) : null; e.birth_month = Number(m[2]); e.birth_day = Number(m[3]) } }
    else if (N === 'CATEGORIES') e.groups = unesc(val).split(',').map((g) => g.trim()).filter(Boolean)
    else if (N === 'NOTE') e.notes = unesc(val)
    else if (N === 'PHOTO' && /^https?:/i.test(val)) e.photo_url = val
  }
  return out
}

/* the same person already in the book: a shared email, a shared phone number (its last 10 digits) or the same name
   with nothing else to tell them apart */
export function findSame(book, e) {
  const mails = new Set((e.emails || []).map((m) => m.value.toLowerCase()))
  const tels = new Set((e.phones || []).map((p) => phoneDigits(p.value)).filter((d) => d.length >= 7))
  return book.find((b) => (b.emails || []).some((m) => mails.has(m.value.toLowerCase())) || (b.phones || []).some((p) => tels.has(phoneDigits(p.value))))
    || (!mails.size && !tels.size ? book.find((b) => fold(entryName(b)) === fold(entryName(e))) : null)
}
const union = (a = [], b = [], key = (x) => x.value.toLowerCase()) => { const seen = new Set(a.map(key)); return [...a, ...b.filter((x) => !seen.has(key(x)))] }
export function mergeEntry(a, b) {
  const o = { ...a }
  for (const k of ['first_name', 'last_name', 'nickname', 'company', 'job_title', 'photo_url', 'notes', 'birth_day', 'birth_month', 'birth_year']) if (!o[k] && b[k]) o[k] = b[k]
  o.phones = union(a.phones, b.phones, (x) => phoneDigits(x.value))
  o.emails = union(a.emails, b.emails)
  o.websites = union(a.websites, b.websites)
  o.socials = union(a.socials, b.socials)
  o.addresses = union(a.addresses, b.addresses, (x) => fold(`${x.street} ${x.city}`))
  o.groups = [...new Set([...(a.groups || []), ...(b.groups || [])])]
  return o
}
export async function importEntries(me, book, incoming, onStep) {
  let added = 0
  let merged = 0
  const now = [...book]
  for (let i = 0; i < incoming.length; i++) {
    const e = incoming[i]
    const same = findSame(now, e)
    if (same) {
      const m = mergeEntry(same, e)
      if (JSON.stringify(clean(m)) !== JSON.stringify(clean(same))) { const saved = await saveEntry(me, m); now[now.indexOf(same)] = saved; merged++ }
    } else { now.push(await saveEntry(me, e)); added++ }
    onStep?.(i + 1, incoming.length)
  }
  keepBook(me, now)
  return { added, merged, book: now }
}

// the phone's own Contacts, inside the iPhone app (the same plugin as Find Friends, phone.jsx)
const phonePlugin = () => {
  const C = typeof window !== 'undefined' ? window.Capacitor : null
  if (!C?.isNativePlatform?.()) return null
  return C.Plugins?.Contacts || C.registerPlugin?.('Contacts') || (C.nativePromise ? { requestPermissions: (o = {}) => C.nativePromise('Contacts', 'requestPermissions', o), getContacts: (o = {}) => C.nativePromise('Contacts', 'getContacts', o), createContact: (o = {}) => C.nativePromise('Contacts', 'createContact', o) } : null)
}
export const phoneBookOn = () => !!phonePlugin()
export async function readPhoneContacts() {
  const P = phonePlugin()
  if (!P) throw new Error('The phone\'s contacts can be read only in the RoarMe app for iPhone.')
  const perm = await P.requestPermissions()
  if (perm?.contacts !== 'granted' && perm?.contacts !== 'limited') throw new Error('RoarMe may not read your contacts. Allow it in the iPhone\'s Settings > RoarMe > Contacts.')
  const { contacts = [] } = await P.getContacts({ projection: { name: true, organization: true, birthday: true, note: true, phones: true, emails: true, urls: true, postalAddresses: true } })
  const lab = (t, kind) => labelOf(String(t || ''), kind)
  return contacts.map((c) => ({
    ...emptyEntry(),
    first_name: c.name?.given || '', last_name: c.name?.family || '', nickname: '',
    company: c.organization?.company || '', job_title: c.organization?.jobTitle || '',
    phones: (c.phones || []).map((p) => ({ label: lab(p.type || p.label, 'phones'), value: p.number || '' })).filter((p) => p.value),
    emails: (c.emails || []).map((m) => ({ label: lab(m.type || m.label, 'emails'), value: m.address || '' })).filter((m) => m.value),
    websites: (c.urls || []).map((u) => ({ label: 'website', value: typeof u === 'string' ? u : u.url || '' })).filter((u) => u.value),
    addresses: (c.postalAddresses || []).map((a) => ({ label: lab(a.type || a.label, 'addresses'), street: a.street || '', city: a.city || '', postcode: a.postcode || '', country: a.country || '' })),
    birth_day: c.birthday?.day || null, birth_month: c.birthday?.month || null, birth_year: c.birthday?.year || null,
    notes: c.note || '',
  })).filter((e) => entryName(e) !== 'No name' || e.phones.length || e.emails.length)
}
// one contact into the phone's own Contacts; elsewhere (or if the plugin cannot) its .vcf goes to the share sheet / a download
export async function toPhone(e) {
  const P = phonePlugin()
  if (P?.createContact) {
    try {
      await P.requestPermissions()
      await P.createContact({ contact: {
        name: { given: e.first_name, family: e.last_name },
        organization: { company: e.company, jobTitle: e.job_title },
        phones: e.phones.map((p) => ({ type: p.label === 'mobile' ? 'mobile' : p.label, label: p.label, number: p.value })),
        emails: e.emails.map((m) => ({ type: m.label, label: m.label, address: m.value })),
        urls: e.websites.map((w) => w.value),
        postalAddresses: e.addresses.map((a) => ({ type: a.label, label: a.label, street: a.street, city: a.city, postcode: a.postcode, country: a.country })),
        birthday: e.birth_month && e.birth_day ? { day: e.birth_day, month: e.birth_month, ...(e.birth_year ? { year: e.birth_year } : {}) } : undefined,
        note: e.notes,
      } })
      return 'phone'
    } catch { /* fall through to the file */ }
  }
  await shareVcf([e], `${entryName(e)}.vcf`)
  return 'file'
}
export async function shareVcf(list, name = 'RoarMe contacts.vcf') {
  const file = new File([toVcf(list)], name.replace(/[\\/:*?"<>|]/g, ''), { type: 'text/vcard' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return } catch (err) { if (err?.name === 'AbortError') return }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file); a.download = file.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

/* small line signs of our own, in the hand of ui.jsx I */
const B = {
  mail: svg(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>),
  pin: svg(<><path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
  cake: svg(<><path d="M4 20h16M5 20v-7h14v7M8 13V9M12 13V9M16 13V9" /><path d="M8 6.5c0-1 1-2 0-3M12 6.5c0-1 1-2 0-3M16 6.5c0-1 1-2 0-3" /></>),
  globe: svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
  tag: svg(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8" r="1.5" /></>),
  note: svg(<><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></>),
  at: svg(<><circle cx="12" cy="12" r="4" /><path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" /></>),
  star: svg(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />),
  share: svg(<><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 13v6h14v-6" /></>),
  down: svg(<><path d="M12 4v12M7 11l5 5 5-5M5 20h14" /></>),
  add: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>),
  del: svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>),
}
const telHref = (v) => `tel:${String(v).replace(/[^\d+]/g, '')}`
const ageOf = (e) => {
  if (!e.birth_year || !e.birth_month || !e.birth_day) return null
  const t = new Date()
  let a = t.getFullYear() - e.birth_year
  if (t.getMonth() + 1 < e.birth_month || (t.getMonth() + 1 === e.birth_month && t.getDate() < e.birth_day)) a--
  return a >= 0 && a < 130 ? a : null
}
const socialHref = (s) => {
  const v = s.value.replace(/^@/, '')
  if (/^https?:/i.test(s.value)) return s.value
  return { instagram: `https://instagram.com/${v}`, x: `https://x.com/${v}`, tiktok: `https://www.tiktok.com/@${v}`, linkedin: `https://www.linkedin.com/in/${v}`, facebook: `https://facebook.com/${v}`, youtube: `https://youtube.com/@${v}` }[s.label] || ''
}
const webHref = (v) => (/^https?:/i.test(v) ? v : `https://${v}`)

function Row({ icon, label, children, href, onCopy }) {
  const body = <><span className="bk-ico">{icon}</span><span className="bk-txt"><small>{label}</small><span>{children}</span></span></>
  if (href) return <a className="bk-row" href={href} target={/^https?:/.test(href) ? '_blank' : undefined} rel="noopener noreferrer">{body}</a>
  return <button type="button" className="bk-row" onClick={onCopy}>{body}</button>
}

/* a contact's card: the picture, the name and what they do; the round actions; then one soft box for each kind of
   detail, no lines inside a box; Share / Save to Phone / Favourite grouped; Delete alone */
export function BookCard({ entry: e, person, onEdit, onClose, onMessage, onCall, onInvite, onFav, onDelete, toast }) {
  const name = entryName(e)
  const sub = [e.job_title, e.company].filter(Boolean).join(' · ')
  const copy = async (v, what) => { try { await navigator.clipboard.writeText(v); toast?.(`${what} copied`) } catch { toast?.(v) } }
  const tel = e.phones?.[0]?.value
  const mail = e.emails?.[0]?.value
  const age = ageOf(e)
  // on RoarMe and with a number: Call asks which (Alex, 22 Nov: "the choice to call through the carrier")
  const [callMenu, setCallMenu] = useState(false)
  return (
    <Modal title="" onClose={onClose}>
      <div className="cc bk">
        <div className="cc-top"><button type="button" className="pill-btn" onClick={onEdit}>Edit</button></div>
        <Avatar src={e.photo_url || person?.avatar_url} name={name} size={96} />
        <h2 className="cc-name">{name}</h2>
        {(sub || e.nickname) && <p className="cc-sub">{sub || e.nickname}</p>}
        {person ? <p className="bk-on"><i />On RoarMe · @{person.username}</p> : null}
        <div className="cc-acts">
          {person && <button type="button" onClick={onMessage} aria-label="Message">{I.chats}</button>}
          {person
            ? <span className="bk-callwrap"><button type="button" className={callMenu ? 'on' : ''} onClick={() => (e.phones?.length ? setCallMenu((v) => !v) : onCall(false))} aria-label="Call">{I.phone}</button>
              {callMenu && (
                <>
                  <button type="button" className="scrim" aria-label="Close" onClick={() => setCallMenu(false)} />
                  <div className="menu bk-callmenu">
                    <button type="button" onClick={() => { setCallMenu(false); onCall(false) }}>{I.chats}<span>RoarMe Call</span></button>
                    {e.phones.map((p, i) => <a key={i} href={telHref(p.value)} onClick={() => setCallMenu(false)}>{I.phone}<span>{`Phone Call · ${p.value}`}</span></a>)}
                  </div>
                </>
              )}</span>
            : tel && <a href={telHref(tel)} aria-label="Call">{I.phone}</a>}
          {person && <button type="button" onClick={() => onCall(true)} aria-label="Video call">{I.video}</button>}
          {!person && tel && <a href={`sms:${tel.replace(/[^\d+]/g, '')}`} aria-label="Message">{I.chats}</a>}
          {mail && <a href={`mailto:${mail}`} aria-label="Email">{B.mail}</a>}
        </div>
        {!person && tel && <div className="bk-invite"><span>{(e.first_name || name).split(' ')[0]} isn't on RoarMe yet</span><button type="button" className="pill-btn" onClick={onInvite}>Invite</button></div>}
        {!!e.phones?.length && <div className="bk-box">{e.phones.map((p, i) => <Row key={i} icon={I.phone} label={p.label} href={telHref(p.value)}>{p.value}</Row>)}</div>}
        {!!e.emails?.length && <div className="bk-box">{e.emails.map((m, i) => <Row key={i} icon={B.mail} label={m.label} href={`mailto:${m.value}`}>{m.value}</Row>)}</div>}
        {!!e.addresses?.length && <div className="bk-box">{e.addresses.map((a, i) => {
          const one = [a.street, [a.postcode, a.city].filter(Boolean).join(' '), a.country].filter(Boolean)
          return <Row key={i} icon={B.pin} label={a.label} href={`https://maps.apple.com/?q=${encodeURIComponent(one.join(', '))}`}>{one.map((l, j) => <span key={j} className="bk-line">{l}</span>)}</Row>
        })}</div>}
        {(e.birth_month || e.websites?.length || e.socials?.length) ? (
          <div className="bk-box">
            {e.birth_month && e.birth_day ? <Row icon={B.cake} label="birthday" onCopy={() => {}}>{`${e.birth_day} ${MONTHS[e.birth_month - 1]}${e.birth_year ? ` ${e.birth_year}` : ''}${age != null ? ` · ${age} years` : ''}`}</Row> : null}
            {(e.websites || []).map((w, i) => <Row key={`w${i}`} icon={B.globe} label={w.label} href={webHref(w.value)}>{w.value}</Row>)}
            {(e.socials || []).map((s, i) => <Row key={`s${i}`} icon={B.at} label={s.label} href={socialHref(s) || undefined} onCopy={() => copy(s.value, s.label)}>{s.value}</Row>)}
          </div>
        ) : null}
        {(e.groups?.length || e.notes) ? (
          <div className="bk-box">
            {!!e.groups?.length && <div className="bk-row bk-still"><span className="bk-ico">{B.tag}</span><span className="bk-txt"><small>groups</small><span className="bk-chips">{e.groups.map((g) => <i key={g} className="bk-chip">{g}</i>)}</span></span></div>}
            {e.notes && <div className="bk-row bk-still"><span className="bk-ico">{B.note}</span><span className="bk-txt"><small>notes</small><span className="bk-notes">{e.notes}</span></span></div>}
          </div>
        ) : null}
        <div className="bk-box bk-links">
          <button type="button" onClick={() => shareVcf([e], `${name}.vcf`)}>{B.share}<span>Share Contact</span></button>
          <button type="button" onClick={async () => { const how = await toPhone(e); if (how === 'phone') toast?.('Saved to your iPhone Contacts') }}>{B.down}<span>{phoneBookOn() ? 'Save to iPhone Contacts' : 'Download Contact'}</span></button>
          <button type="button" onClick={onFav}>{B.star}<span>{e.favourite ? 'Remove from Favourites' : 'Add to Favourites'}</span></button>
        </div>
        <div className="bk-box bk-links"><button type="button" className="danger" onClick={onDelete}><span>Delete Contact</span></button></div>
      </div>
    </Modal>
  )
}

/* New Contact / Edit Contact: the soft boxes of the sample; "add phone" and the rest add a line, the red minus takes
   it away, the blue word in front of a line changes its kind */
function Lines({ kind, items, set, placeholder, inputMode }) {
  const labels = LABELS[kind]
  const put = (i, patch) => set(items.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <>
      {items.map((x, i) => (
        <div key={i} className="bk-line-in">
          <button type="button" className="bk-minus" onClick={() => set(items.filter((_, j) => j !== i))} aria-label="Remove">{B.del}</button>
          <button type="button" className="bk-lab" onClick={() => put(i, { label: labels[(labels.indexOf(x.label) + 1) % labels.length] })}>{x.label}</button>
          <input value={x.value} onChange={(ev) => put(i, { value: ev.target.value })} placeholder={placeholder} inputMode={inputMode} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </div>
      ))}
      <button type="button" className="bk-add" onClick={() => set([...items, { label: labels[Math.min(items.length, labels.length - 1)], value: '' }])}>{B.add}<span>add {kind === 'phones' ? 'phone' : kind === 'emails' ? 'email' : kind === 'websites' ? 'website' : 'social profile'}</span></button>
    </>
  )
}

export function BookEdit({ me, entry, allGroups = [], onSaved, onClose, findPerson }) {
  const [e, setE] = useState(() => ({ ...emptyEntry(), ...(entry || {}) }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [crop, setCrop] = useState(null)
  const [groupIn, setGroupIn] = useState('')
  const [bdayOpen, setBdayOpen] = useState(!!(entry?.birth_month))
  const [linkIn, setLinkIn] = useState('')
  const picRef = useRef(null)
  const set = (patch) => setE((o) => ({ ...o, ...patch }))
  const groupsOffer = useMemo(() => allGroups.filter((g) => !e.groups.includes(g)), [allGroups, e.groups])
  const save = async () => {
    const c = clean(e)
    if (!c.first_name && !c.last_name && !c.company && !c.nickname && !c.phones.length && !c.emails.length) { setErr('Give the contact a name, a phone or an email.'); return }
    setBusy(true); setErr('')
    try { onSaved(await saveEntry(me.id, { ...e, id: entry?.id })) } catch (x) { setErr(errText(x)) } finally { setBusy(false) }
  }
  const pickPic = async (file) => {
    setCrop(null)
    if (!file) return
    try {
      const path = `${me.id}/book-${Date.now()}.jpg`
      const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      set({ photo_url: supabase.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl })
    } catch (x) { setErr(errText(x)) }
  }
  const addGroup = (g) => { const v = (g ?? groupIn).trim(); if (v && !e.groups.includes(v)) set({ groups: [...e.groups, v] }); setGroupIn('') }
  const link = async () => {
    const u = linkIn.trim().replace(/^@/, '').toLowerCase()
    if (!u) return
    const p = await findPerson(u)
    if (!p) { setErr(`No one on RoarMe is @${u}.`); return }
    set({ person: p.id, photo_url: e.photo_url || '' }); setLinkIn(''); setErr('')
  }
  const linked = e.person ? findPerson.byId?.(e.person) : null
  const shown = entryName(e) === 'No name' ? '' : entryName(e)
  return (
    <Modal title="" onClose={onClose}>
      <div className="cc bk bk-form">
        <div className="bk-ftop">
          <button type="button" className="round" onClick={onClose} aria-label="Cancel">{I.x}</button>
          <b>{entry?.id ? 'Edit Contact' : 'New Contact'}</b>
          <button type="button" className="round bk-save" disabled={busy} onClick={save} aria-label="Save">{I.check}</button>
        </div>
        <button type="button" className="bk-pic" onClick={() => picRef.current?.click()}>
          {e.photo_url || shown ? <Avatar src={e.photo_url} name={shown || '?'} size={88} /> : <span className="bk-pic-empty">{I.camera}</span>}
          <span>{e.photo_url ? 'Change Photo' : 'Add Photo'}</span>
        </button>
        <div className="bk-box bk-fields">
          <input value={e.first_name} onChange={(ev) => set({ first_name: ev.target.value })} placeholder="First name" autoComplete="off" />
          <input value={e.last_name} onChange={(ev) => set({ last_name: ev.target.value })} placeholder="Last name" autoComplete="off" />
          <input value={e.company} onChange={(ev) => set({ company: ev.target.value })} placeholder="Company" autoComplete="off" />
          <input value={e.job_title} onChange={(ev) => set({ job_title: ev.target.value })} placeholder="Job title" autoComplete="off" />
        </div>
        <div className="bk-box"><Lines kind="phones" items={e.phones} set={(v) => set({ phones: v })} placeholder="Phone" inputMode="tel" /></div>
        <div className="bk-box"><Lines kind="emails" items={e.emails} set={(v) => set({ emails: v })} placeholder="Email" inputMode="email" /></div>
        <div className="bk-box">
          {e.addresses.map((a, i) => {
            const put = (patch) => set({ addresses: e.addresses.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="bk-addr">
                <div className="bk-line-in">
                  <button type="button" className="bk-minus" onClick={() => set({ addresses: e.addresses.filter((_, j) => j !== i) })} aria-label="Remove">{B.del}</button>
                  <button type="button" className="bk-lab" onClick={() => put({ label: LABELS.addresses[(LABELS.addresses.indexOf(a.label) + 1) % LABELS.addresses.length] })}>{a.label}</button>
                  <input value={a.street} onChange={(ev) => put({ street: ev.target.value })} placeholder="Street" />
                </div>
                <div className="bk-addr-2">
                  <input value={a.postcode} onChange={(ev) => put({ postcode: ev.target.value })} placeholder="Postcode" />
                  <input value={a.city} onChange={(ev) => put({ city: ev.target.value })} placeholder="City" />
                  <input value={a.country} onChange={(ev) => put({ country: ev.target.value })} placeholder="Country" />
                </div>
              </div>
            )
          })}
          <button type="button" className="bk-add" onClick={() => set({ addresses: [...e.addresses, { label: e.addresses.length ? 'work' : 'home', street: '', city: '', postcode: '', country: '' }] })}>{B.add}<span>add address</span></button>
        </div>
        <div className="bk-box">
          {bdayOpen ? (
            <div className="bk-line-in bk-bday">
              <button type="button" className="bk-minus" onClick={() => { setBdayOpen(false); set({ birth_day: null, birth_month: null, birth_year: null }) }} aria-label="Remove">{B.del}</button>
              <span className="bk-lab">birthday</span>
              <select value={e.birth_day || ''} onChange={(ev) => set({ birth_day: Number(ev.target.value) || null })} aria-label="Day"><option value="">Day</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
              <select value={e.birth_month || ''} onChange={(ev) => set({ birth_month: Number(ev.target.value) || null })} aria-label="Month"><option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              <input value={e.birth_year || ''} onChange={(ev) => set({ birth_year: ev.target.value.replace(/\D/g, '').slice(0, 4) || null })} placeholder="Year" inputMode="numeric" />
            </div>
          ) : <button type="button" className="bk-add" onClick={() => setBdayOpen(true)}>{B.add}<span>add birthday</span></button>}
          <Lines kind="websites" items={e.websites} set={(v) => set({ websites: v })} placeholder="Website" inputMode="url" />
          <Lines kind="socials" items={e.socials} set={(v) => set({ socials: v })} placeholder="@username" />
        </div>
        <div className="bk-box bk-groups">
          <span className="bk-lab">groups</span>
          <span className="bk-chips">
            {e.groups.map((g) => <button key={g} type="button" className="bk-chip on" onClick={() => set({ groups: e.groups.filter((x) => x !== g) })}>{g} ×</button>)}
            {groupsOffer.slice(0, 8).map((g) => <button key={g} type="button" className="bk-chip" onClick={() => addGroup(g)}>+ {g}</button>)}
            <input className="bk-chip-in" value={groupIn} onChange={(ev) => setGroupIn(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addGroup() } }} onBlur={() => addGroup()} placeholder="New group" maxLength={40} />
          </span>
        </div>
        <div className="bk-box bk-fields"><textarea rows={3} value={e.notes} onChange={(ev) => set({ notes: ev.target.value })} placeholder="Notes" maxLength={4000} /></div>
        <div className="bk-box bk-fields">
          {e.person ? (
            <div className="bk-linked"><span>On RoarMe{linked ? ` · @${linked.username}` : ''}</span><button type="button" className="pill-btn" onClick={() => set({ person: null })}>Unlink</button></div>
          ) : (
            <div className="bk-linked"><input value={linkIn} onChange={(ev) => setLinkIn(ev.target.value)} onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); link() } }} placeholder="Their RoarMe @username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />{linkIn.trim() && <button type="button" className="pill-btn" onClick={link}>Link</button>}</div>
          )}
        </div>
        {err && <p className="auth-err">{err}</p>}
      </div>
      <input ref={picRef} type="file" accept="image/*" hidden onChange={(ev) => { setCrop(ev.target.files?.[0] || null); ev.target.value = '' }} />
      {crop && <CropModal file={crop} title="Contact photo" onDone={pickPic} onClose={() => setCrop(null)} />}
    </Modal>
  )
}

/* Import: a .vcf file from anywhere, or (in the iPhone app) the phone's own Contacts; the same person already in the
   book is joined, not doubled. Export: everyone, or one group, as one .vcf. One small window for both. */
export function BookIO({ me, book, groups, onDone, onClose, toast }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [group, setGroup] = useState('')
  const fileRef = useRef(null)
  const run = async (list) => {
    if (!list.length) { setErr('No contacts were found there.'); return }
    setBusy(`Adding 0 of ${list.length}`)
    try {
      const r = await importEntries(me.id, book, list, (n, all) => setBusy(`Adding ${n} of ${all}`))
      onDone(r.book); toast?.(`${r.added} added${r.merged ? `, ${r.merged} joined with ones you had` : ''}`); onClose()
    } catch (x) { setErr(errText(x)); setBusy('') }
  }
  const fromFile = async (f) => { if (!f) return; setErr(''); try { run(parseVcf(await f.text())) } catch (x) { setErr(errText(x)) } }
  const fromPhone = async () => { setErr(''); setBusy('Reading your contacts'); try { await run(await readPhoneContacts()) } catch (x) { setErr(errText(x)); setBusy('') } }
  const out = group ? book.filter((e) => e.groups?.includes(group)) : book
  return (
    <Modal title="Import and Export" onClose={onClose}>
      <div className="bk bk-io">
        <small className="bk-cap">Import</small>
        <div className="bk-box bk-links">
          <button type="button" disabled={!!busy} onClick={() => fileRef.current?.click()}>{B.down}<span>From a .vcf File</span></button>
          {phoneBookOn() && <button type="button" disabled={!!busy} onClick={fromPhone}>{I.phone}<span>From iPhone Contacts</span></button>}
        </div>
        <small className="bk-cap">Export</small>
        {groups.length > 0 && (
          <div className="bk-chips bk-io-groups">
            <button type="button" className={`bk-chip${group ? '' : ' on'}`} onClick={() => setGroup('')}>All</button>
            {groups.map((g) => <button key={g} type="button" className={`bk-chip${group === g ? ' on' : ''}`} onClick={() => setGroup(g)}>{g}</button>)}
          </div>
        )}
        <div className="bk-box bk-links">
          <button type="button" disabled={!out.length || !!busy} onClick={() => shareVcf(out, group ? `RoarMe ${group}.vcf` : 'RoarMe contacts.vcf')}>{B.share}<span>{`Export ${out.length} ${out.length === 1 ? 'Contact' : 'Contacts'}`}</span></button>
        </div>
        <p className="bk-hint">A .vcf file opens in every contacts app: iPhone, Mac, Google, Outlook. Contacts already here are joined, not doubled.</p>
        {busy && <p className="bk-hint bk-busy">{busy}…</p>}
        {err && <p className="auth-err">{err}</p>}
      </div>
      <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(ev) => { fromFile(ev.target.files?.[0]); ev.target.value = '' }} />
    </Modal>
  )
}

// a RoarMe person's own picture and name on a contact that is linked to them
export const personOf = (e, people) => (e.person ? people[e.person] || null : null)
export const displayOf = (e, people) => { const p = personOf(e, people); return { name: entryName(e), avatar: e.photo_url || p?.avatar_url || '', p, nameOfP: p ? nameOf(p) : '' } }
