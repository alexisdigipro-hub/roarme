import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errText, shrinkImage, supabase } from './lib.js'
import { Lens, Modal } from './ui.jsx'
import { hubCall } from './hub.jsx'

/* The $ in a project's chat (Alex, 22 Nov, https://claude.ai/artifact/RyFKrxkCHjLmEHfz7hQmhb): only in PROjects. It
   opens two choices, My Payment and Expenses, each a window; what is saved goes straight to the project's Production Hub
   (roar-hub pay.* -> hub-bridge): a payment into the person's My Finance and the project's budget, an expense as a
   receipt of the project with its photo or PDF (a refund owed to them in My Finance when they paid it). The person is
   found in the hub by their RoarMe email; with no account there My Payment is grey and only Expenses work. */

const svg = (d, w = 20) => <svg viewBox="0 0 24 24" width={w} height={w} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const DOLLAR = svg(<path d="M12 3.5v17M16.5 7.5c-.6-1.6-2.4-2.5-4.5-2.5-2.6 0-4.5 1.4-4.5 3.4 0 4.6 9.3 2.5 9.3 7.2 0 2-2 3.5-4.8 3.5-2.4 0-4.3-1-4.9-2.8" />)
const PAY_I = svg(<><rect x="3" y="6" width="18" height="12" rx="3" /><circle cx="12" cy="12" r="2.5" /></>, 18)
const REC_I = svg(<><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></>, 18)
const CAM_I = svg(<><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>, 22)
const FILE_I = svg(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>, 18)
const today = () => new Date().toISOString().slice(0, 10)

let metaCache = {}
async function payMeta(room) {
  if (metaCache[room]) return metaCache[room]
  const m = await hubCall({ action: 'pay.meta', room })
  metaCache[room] = m
  setTimeout(() => { delete metaCache[room] }, 60000)
  return m
}

export function PayButton({ room, toast = () => {} }) {
  const [menu, setMenu] = useState(null)
  const [open, setOpen] = useState('')
  const [meta, setMeta] = useState(null)
  useEffect(() => { setMeta(null) }, [room.room_id])
  const load = () => payMeta(room.room_id).then(setMeta, (e) => setMeta({ error: e.message || 'The hub did not answer' }))
  const onBtn = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ left: Math.max(10, Math.min(window.innerWidth - 220, r.left)), bottom: window.innerHeight - r.top + 8 })
    if (!meta || meta.error) load()
  }
  const noAccount = meta && !meta.error && !meta.member
  return (
    <>
      <button type="button" className="round compose-pay" onClick={onBtn} aria-label="Payments and expenses" title="My Payment · Expenses">{DOLLAR}</button>
      {menu && createPortal(
        <div className="pay-portal" onClick={() => setMenu(null)}>
          <div className="menu pay-menu" style={{ '--pl': `${menu.left}px`, '--pb': `${menu.bottom}px` }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={noAccount ? 'off' : ''} disabled={noAccount} title={noAccount ? 'Your email has no account in this hub' : ''} onClick={() => { setMenu(null); setOpen('pay') }}>{PAY_I}<span>My Payment</span></button>
            <button type="button" onClick={() => { setMenu(null); setOpen('exp') }}>{REC_I}<span>Expenses</span></button>
          </div>
        </div>, document.body)}
      {open === 'pay' && <PaymentWindow room={room} meta={meta} reload={load} toast={toast} onClose={() => setOpen('')} />}
      {open === 'exp' && <ExpenseWindow room={room} meta={meta} reload={load} toast={toast} onClose={() => setOpen('')} />}
    </>
  )
}

function Head({ meta }) {
  if (!meta) return <p className="pay-wait">Asking the hub…</p>
  if (meta.error) return <p className="pay-err">{meta.error}</p>
  const day = meta.project?.startDate ? new Date(`${meta.project.startDate}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''
  return (
    <div className="pay-proj"><i /><span><b>{meta.project?.title || 'Project'}</b><small>{['Linked to the hub', day && `Shoot Day ${day}`].filter(Boolean).join(' · ')}</small></span></div>
  )
}

function Seg({ value, items, onPick, disabled = [] }) {
  return <Lens className="seg pay-seg" dep={value}>{items.map(([k, l]) => <button key={k} type="button" className={value === k ? 'on' : ''} disabled={disabled.includes(k)} onClick={() => onPick(k)}>{l}</button>)}</Lens>
}

function PaymentWindow({ room, meta, reload, toast, onClose }) {
  const [f, setF] = useState({ description: '', role: '', amount: '', status: 'pending', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target ? e.target.value : e }))
  useEffect(() => { if (!meta) reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cats = meta?.categories || []
  const save = async () => {
    if (!f.description.trim() && !(Number(f.amount) > 0)) { toast('Add a description or an amount.'); return }
    if (Number(f.amount) > 0 && !f.role) { toast('Pick your role on this project.'); return }
    setBusy(true)
    try {
      await hubCall({ action: 'pay.job', room: room.room_id, job: { ...f, amount: Number(f.amount) || 0, date: meta?.project?.startDate || today() } })
      toast('Sent to your My Finance in the hub')
      onClose()
    } catch (e) { toast(e.message || 'Could not send it') } finally { setBusy(false) }
  }
  const blocked = !meta || meta.error || !meta.member
  return (
    <Modal title="My Payment" onClose={onClose} foot={<div className="pay-foot"><button type="button" className="pill-btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" disabled={busy || blocked} onClick={save}>{busy ? 'Sending…' : 'Save'}</button></div>}>
      <div className="pay-win">
        <Head meta={meta} />
        {meta && !meta.error && !meta.member && <p className="pay-err">Your email has no account in this hub, so a payment cannot reach a My Finance. Expenses still work.</p>}
        {meta?.paysYou && <p className="pay-note">The production already pays you {meta.paysYou.amount ? `€${meta.paysYou.amount}` : ''} on this project in its budget.</p>}
        <div className="pay-grid">
          <label className="pay-f full"><small>Description</small><input className="input" value={f.description} onChange={set('description')} placeholder="Song title, spot, live, intro…" /></label>
          <label className="pay-f"><small>Your role</small><select className="input" value={f.role} onChange={set('role')}><option value="">Pick your role</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="pay-f"><small>Amount (€)</small><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={set('amount')} placeholder="0" /></label>
          <div className="pay-f full"><small>Status</small><Seg value={f.status} items={[['pending', 'Pending'], ['paid', 'Paid']]} onPick={set('status')} /></div>
          <label className="pay-f full"><small>Notes</small><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} placeholder="Petrol, van, invoice number…" /></label>
        </div>
        <p className="pay-note">Goes to your My Finance and to the project's budget in the hub.</p>
      </div>
    </Modal>
  )
}

function ExpenseWindow({ room, meta, reload, toast, onClose }) {
  const [f, setF] = useState({ total: '', vatPct: '24', description: '', category: '', shop: '', date: today(), payer: 'me', notes: '' })
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState('')
  const cam = useRef(null)
  const pick = useRef(null)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target ? e.target.value : e }))
  useEffect(() => { if (!meta) reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (meta && !meta.error && !meta.member) setF((x) => ({ ...x, payer: 'company' })) }, [meta])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const take = (fl) => { if (!fl) return; setFile(fl); setPreview(/^image\//.test(fl.type) ? URL.createObjectURL(fl) : '') }
  const cats = meta?.categories || []
  const save = async () => {
    if (!(Number(f.total) > 0)) { toast('Type the total paid.'); return }
    if (!f.category) { toast('Pick a category.'); return }
    setBusy('Sending…')
    try {
      let up = null
      if (file) {
        setBusy('Uploading the receipt…')
        const img = /^image\//.test(file.type)
        const body = img ? await shrinkImage(file, 2000, 0.85) : file
        const name = `${img ? `Receipt ${f.date}` : (file.name || 'Receipt').replace(/\.[a-z0-9]+$/i, '')}`.replace(/[^\wͰ-Ͽ .-]+/g, '').trim() || 'Receipt'
        const ext = img ? 'jpg' : ((file.name || '').match(/\.([a-z0-9]+)$/i)?.[1] || 'pdf')
        const path = `${room.room_id}/receipt-${crypto.randomUUID()}.${ext}`
        const { error } = await supabase.storage.from('roar-files').upload(path, body, { contentType: img ? 'image/jpeg' : (file.type || 'application/pdf') })
        if (error) throw error
        up = { path, name: `${name}.${ext}`, type: img ? 'image/jpeg' : (file.type || 'application/pdf') }
      }
      setBusy('Sending…')
      await hubCall({ action: 'pay.receipt', room: room.room_id, receipt: { ...f, total: Number(f.total) || 0, vatPct: Number(f.vatPct) || 0, file: up } })
      toast(f.payer === 'me' ? 'Expense saved in the hub. You are owed it back in My Finance.' : 'Expense saved in the hub.')
      onClose()
    } catch (e) { toast(errText(e) || e.message || 'Could not send it') } finally { setBusy('') }
  }
  const noMember = meta && !meta.error && !meta.member
  return (
    <Modal title="Expense" onClose={onClose} foot={<div className="pay-foot"><button type="button" className="pill-btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" disabled={!!busy || !meta || !!meta.error} onClick={save}>{busy || 'Save Expense'}</button></div>}>
      <div className="pay-win">
        <Head meta={meta} />
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
        <input ref={pick} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }} />
        {file ? (
          <div className="pay-file">
            {preview ? <img src={preview} alt="" /> : <span className="pay-pdf">{FILE_I}<b>{file.name}</b></span>}
            <button type="button" className="pill-btn" onClick={() => { setFile(null); setPreview('') }}>Change</button>
          </div>
        ) : (
          <div className="pay-shots">
            <button type="button" className="pay-shot" onClick={() => cam.current?.click()}>{CAM_I}<span>Take a photo of the receipt</span></button>
            <button type="button" className="pill-btn" onClick={() => pick.current?.click()}>{FILE_I}<span>Choose a photo or PDF</span></button>
          </div>
        )}
        <div className="pay-grid">
          <label className="pay-f"><small>Total paid (€)</small><input className="input" type="number" inputMode="decimal" min="0" step="0.01" value={f.total} onChange={set('total')} placeholder="0.00" /></label>
          <label className="pay-f"><small>VAT %</small><input className="input" type="number" inputMode="decimal" min="0" step="1" value={f.vatPct} onChange={set('vatPct')} /></label>
          <label className="pay-f full"><small>What for</small><input className="input" value={f.description} onChange={set('description')} placeholder="Gaffer tape, fuel, catering" /></label>
          <label className="pay-f"><small>Category</small><select className="input" value={f.category} onChange={set('category')}><option value="">Pick one</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="pay-f"><small>Shop</small><input className="input" value={f.shop} onChange={set('shop')} placeholder="Optional" /></label>
          <label className="pay-f"><small>Date</small><input className="input" type="date" value={f.date} onChange={set('date')} /></label>
          <div className="pay-f"><small>Who paid</small><Seg value={f.payer} items={[['me', 'Me'], ['company', 'The company']]} onPick={set('payer')} disabled={noMember ? ['me'] : []} /></div>
          <label className="pay-f full"><small>Notes</small><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} placeholder="Optional" /></label>
        </div>
        <p className="pay-note">Goes to the hub as a receipt of the project.{f.payer === 'me' ? ' Paid by you: you are owed it back in My Finance.' : ''}</p>
      </div>
    </Modal>
  )
}
