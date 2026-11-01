import { useState } from 'react'
import { Avatar, I, Modal } from './ui.jsx'
import { errText, nameOf, supabase } from './lib.js'

/* Roles for @mentions, as Slack's user groups (Alex, 20 Oct): a group's role has a name and its people, and @name in a
   message reaches all of them, even with the chat muted (supabase/mentions.sql). Beside them @all (everyone in the
   chat) and @here (who is in RoarMe right now). A group's admins make the roles. */

export const SPECIAL = ['all', 'everyone', 'channel', 'here']
export const roleName = (v) => String(v || '').toLowerCase().replace(/^@/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 24)

// the words after @ in a text, small letters
export const mentionWords = (body) => [...String(body || '').matchAll(/(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_]{2,24})/gu)].map((x) => x[1].toLowerCase())

// does this text reach me: @all, @here, my @username or a role I am in
export const mentionsMe = (body, me, roles = []) => {
  if (!body || !String(body).includes('@')) return false
  return mentionWords(body).some((w) => SPECIAL.includes(w) || w === me.username || roles.some((g) => g.name === w && g.user_ids.includes(me.id)))
}

export const canEditRoles = (room) => room.kind === 'group' && room.role === 'admin'

export function RolesWindow({ room, roles, people, me, onClose, toast }) {
  const can = canEditRoles(room)
  const [edit, setEdit] = useState(null) // null, 'new' or a role
  const [name, setName] = useState('')
  const [ids, setIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const members = (room.members || []).map((id) => (id === me.id ? me : people[id])).filter(Boolean)
  const open = (g) => { setEdit(g || 'new'); setName(g ? g.name : ''); setIds(g ? g.user_ids.filter((u) => (room.members || []).includes(u)) : []); setFail('') }
  const taken = roles.some((g) => g.name === name && g.id !== edit?.id)
  const err = name.length < 2 ? 'At least 2 letters' : SPECIAL.includes(name) ? `@${name} is taken by RoarMe` : taken ? 'There is a role with this name' : !ids.length ? 'Pick its people' : ''
  const save = async () => {
    if (err || busy) return
    setBusy(true); setFail('')
    const { error } = edit === 'new'
      ? await supabase.from('roar_roles').insert({ room_id: room.room_id, name, user_ids: ids })
      : await supabase.from('roar_roles').update({ name, user_ids: ids }).eq('id', edit.id)
    setBusy(false)
    if (error) { setFail(errText(error)); return }
    toast(edit === 'new' ? `@${name} added` : 'Saved')
    setEdit(null)
  }
  const remove = async (g) => {
    if (!window.confirm(`Delete the role @${g.name}?`)) return
    const { error } = await supabase.from('roar_roles').delete().eq('id', g.id)
    if (error) toast(errText(error)); else toast('Deleted')
  }

  if (edit) {
    return (
      <Modal title={edit === 'new' ? 'New Role' : `@${edit.name}`} onClose={() => setEdit(null)}
        foot={<><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn btn-main" disabled={!!err || busy} onClick={save}>{err || (busy ? '…' : 'Save')}</button></>}>
        <label className="role-name"><span>@</span><input autoFocus value={name} onChange={(e) => setName(roleName(e.target.value))} placeholder="montage" maxLength={24} /></label>
        <p className="muted role-hint">Small letters, numbers and _ . Greek works too, e.g. @μοντάζ</p>
        <div className="people role-people">
          {members.map((p) => {
            const on = ids.includes(p.id)
            return (
              <button key={p.id} type="button" className={`person${on ? ' on' : ''}`} onClick={() => setIds((l) => (on ? l.filter((x) => x !== p.id) : [...l, p.id]))}>
                <Avatar src={p.avatar_url} name={nameOf(p)} size={34} />
                <span className="person-text"><b>{p.id === me.id ? 'You' : nameOf(p)}</b><small>@{p.username}</small></span>
                <span className={`tick${on ? ' on' : ''}`} />
              </button>
            )
          })}
        </div>
        {fail && <p className="sch-err">{fail}</p>}
      </Modal>
    )
  }
  return (
    <Modal title="Roles" onClose={onClose}
      foot={can ? <button type="button" className="btn btn-main" onClick={() => open(null)}>{I.plus}<span>New Role</span></button> : null}>
      <p className="muted role-hint">Write @ and a role in a message and everyone in it is told, even with the chat muted. Also @all for everyone here, @here for who is online now.</p>
      {!roles.length && <p className="empty">{can ? 'No roles yet. Make one, e.g. @montage or @production.' : 'No roles yet. The group\'s admins make them.'}</p>}
      <div className="people">
        {roles.map((g) => {
          const ppl = g.user_ids.map((u) => (u === me.id ? me : people[u])).filter(Boolean)
          return (
            <div key={g.id} className="person role-row">
              <span className="role-at">@</span>
              <span className="person-text"><b>@{g.name}</b><small>{ppl.length === 1 ? '1 person' : `${ppl.length} people`} · {ppl.slice(0, 4).map((p) => (p.id === me.id ? 'You' : nameOf(p))).join(', ')}{ppl.length > 4 ? '…' : ''}</small></span>
              {can && (
                <span className="smsg-acts">
                  <button type="button" className="round" onClick={() => open(g)} aria-label="Edit" title="Edit">{I.edit}</button>
                  <button type="button" className="round danger" onClick={() => remove(g)} aria-label="Delete" title="Delete">{I.trash}</button>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
