import { useRef, useState } from 'react'
import { errText, lastSeenText, nameOf, onlineNow, supabase } from './lib.js'
import { Avatar, CropModal, I, Modal } from './ui.jsx'
import { inviteLink } from './invite.jsx'

/* A contact's card (Alex, 21 Oct, like the iPhone's Contacts): a tap on someone in Contacts opens it. The big
   picture and the name, round Message · Call · Video, then what we know: the username, their bio, my note for them,
   Share Contact and Add to Favourites, and Block Contact on its own. Edit (top right) is Edit Contact: my own name,
   photo and note for them, which only I see. */
export function ContactCard({ me, person: p, fav, onFav, blocked, onBlocks, onMessage, onCall, onClose, loadPeople, toast }) {
  // Edit turns the card itself into the form (Alex, 21 Oct): my name for them, my note, my photo; Done saves
  const [editing, setEditing] = useState(false)
  const [nick, setNick] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const startEdit = () => { setNick(p.nickname || ''); setNote(p.my_note || ''); setErr(''); setEditing(true) }
  const saveEdit = async () => {
    setSaving(true); setErr('')
    const { error } = await supabase.from('roar_contacts').upsert({ owner: me.id, person: p.id, nickname: nick.trim(), note: note.trim(), updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { setErr(errText(error)); return }
    setEditing(false); loadPeople([p.id]); toast('Saved, only you see it')
  }
  const [cropFile, setCropFile] = useState(null)
  const [err, setErr] = useState('')
  const picRef = useRef(null)
  const name = nameOf(p)

  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); toast(done) } catch { toast(text) } }
  const share = async () => {
    const url = inviteLink(p.username)
    if (navigator.share) { try { await navigator.share({ title: name, text: `${name} on RoarMe (@${p.username})`, url }) } catch { /* closed */ } return }
    copy(url, 'Contact link copied')
  }
  const block = async () => {
    setErr('')
    if (blocked) {
      const { error } = await supabase.from('roar_blocks').delete().eq('blocker', me.id).eq('blocked', p.id)
      if (error) setErr(errText(error)); else { onBlocks(); toast(`${name} unblocked`) }
      return
    }
    if (!window.confirm(`Block ${name}? They will not be able to message or call you, or add you to groups.`)) return
    const { error } = await supabase.from('roar_blocks').insert({ blocker: me.id, blocked: p.id })
    if (error) setErr(errText(error)); else { onBlocks(); toast(`${name} blocked`) }
  }
  // my own photo for them, which only I see (the same as in a chat's card)
  const pickPic = async (file) => {
    setCropFile(null)
    if (!file) return
    try {
      const path = `${me.id}/contact-${p.id}-${Date.now()}.jpg`
      const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const url = supabase.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl
      const { error } = await supabase.from('roar_contacts').upsert({ owner: me.id, person: p.id, photo_url: url, updated_at: new Date().toISOString() })
      if (error) throw error
      loadPeople([p.id]); toast('Photo set, only you see it')
    } catch (e) { setErr(errText(e)) }
  }
  const dropMyPhoto = async () => {
    const { error } = await supabase.from('roar_contacts').update({ photo_url: '' }).eq('owner', me.id).eq('person', p.id)
    if (error) setErr(errText(error)); else { loadPeople([p.id]); toast('Your photo for them is gone') }
  }

  return (
    <Modal title="" onClose={onClose}>
      <div className="cc">
        {/* a row of its own at the top, level with the close button, so nothing sits over the picture */}
        <div className="cc-top">
          {editing
            ? <><button type="button" className="pill-btn" onClick={() => setEditing(false)}>Cancel</button><button type="button" className="pill-btn cc-done" disabled={saving} onClick={saveEdit}>{saving ? '…' : 'Done'}</button></>
            : <button type="button" className="pill-btn" onClick={startEdit}>Edit</button>}
        </div>
        {editing ? (
          <button type="button" className="cc-pic" onClick={() => picRef.current?.click()} title="Set a photo for them, only you see it">
            <Avatar src={p.avatar_url} name={nick.trim() || name} size={96} />
            <span className="pf-pic-cam">{I.camera}</span>
          </button>
        ) : <Avatar src={p.avatar_url} name={name} size={96} online={onlineNow(p)} />}
        {editing && p.my_photo && <button type="button" className="link cc-own" onClick={dropMyPhoto}>Use their own photo</button>}
        {editing
          ? <input className="cc-name cc-name-in" value={nick} onChange={(e) => setNick(e.target.value)} placeholder={p.real_name || `@${p.username}`} maxLength={60} autoFocus aria-label="Name" />
          : <h2 className="cc-name">{name}</h2>}
        <p className="cc-sub">{lastSeenText(p) || `@${p.username}`}</p>
        {p.nickname && <p className="cc-sub cc-real">{`Their name: ${p.real_name || `@${p.username}`}`}</p>}

        <div className="cc-acts">
          <button type="button" onClick={onMessage} aria-label="Message" title="Message">{I.chats}</button>
          <button type="button" onClick={() => onCall(false)} aria-label="Call" title="Call">{I.phone}</button>
          <button type="button" onClick={() => onCall(true)} aria-label="Video call" title="Video call">{I.video}</button>
          <button type="button" onClick={share} aria-label="Share Contact" title="Share Contact">{I.link}</button>
        </div>

        <div className="cc-card">
          <button type="button" className="cc-row" onClick={() => copy(`@${p.username}`, 'Username copied')}>
            <small>username</small><span>@{p.username}</span><i>{I.copy}</i>
          </button>
          {p.bio && <div className="cc-row"><small>bio</small><span className="cc-text">{p.bio}</span></div>}
        </div>

        {editing ? (
          <label className="cc-card cc-notes">
            <small>Notes</small>
            <textarea className="cc-note-in" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you met, what they do, anything" maxLength={500} />
          </label>
        ) : (
          <button type="button" className="cc-card cc-notes" onClick={startEdit}>
            <small>Notes</small>
            <span className="cc-text">{p.my_note || ''}</span>
          </button>
        )}
        {editing && <p className="muted cc-hint">Only you see these. They keep their own name and photo for everyone else.</p>}

        <div className="cc-card">
          <button type="button" className="cc-row cc-link" onClick={share}>Share Contact</button>
          <button type="button" className="cc-row cc-link" onClick={onFav}>{fav ? 'Remove from Favourites' : 'Add to Favourites'}</button>
        </div>

        <div className="cc-card">
          <button type="button" className="cc-row cc-link danger" onClick={block}>{blocked ? 'Unblock Contact' : 'Block Contact'}</button>
        </div>
        {err && <p className="auth-err">{err}</p>}
      </div>
      <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { setCropFile(e.target.files?.[0] || null); e.target.value = '' }} />
      {cropFile && <CropModal file={cropFile} title={`Your photo for ${name}`} onDone={pickPic} onClose={() => setCropFile(null)} />}
    </Modal>
  )
}

/* Edit Contact (Alex, 19 Oct): my own name, photo and note for someone, which only I see; they never know */
export function ContactEdit({ me, other, onClose, onSaved, onPhoto, onDropPhoto }) {
  const [name, setName] = useState(other.nickname || '')
  const [note, setNote] = useState(other.my_note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    const { error } = await supabase.from('roar_contacts').upsert({ owner: me.id, person: other.id, nickname: name.trim(), note: note.trim(), updated_at: new Date().toISOString() })
    setBusy(false)
    if (error) setErr(errText(error)); else onSaved()
  }
  return (
    <Modal title="Edit Contact" onClose={onClose} foot={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn btn-main" disabled={busy} onClick={save}>{busy ? '…' : 'Save'}</button></>}>
      <div className="ce">
        <button type="button" className="ce-pic" onClick={onPhoto} title="Set a photo for them">
          <Avatar src={other.avatar_url} name={name.trim() || other.real_name || other.username} size={88} />
          <span className="pf-pic-cam">{I.camera}</span>
        </button>
        {other.my_photo && <button type="button" className="link" onClick={() => { onDropPhoto(); onClose() }}>Use their own photo</button>}
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={other.real_name || `@${other.username}`} maxLength={60} autoFocus /></label>
        <label className="field"><span>Note</span><textarea className="input ce-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you met, what they do, anything" maxLength={500} /></label>
        <p className="muted ce-hint">Only you see these. They keep their own name and photo for everyone else.</p>
        {err && <p className="auth-err">{err}</p>}
      </div>
    </Modal>
  )
}
