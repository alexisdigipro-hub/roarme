import { useEffect, useMemo, useRef, useState } from 'react'
import { errText, fileLink, thumbOf, fmtBytes, lastSeenText, nameOf, supabase, timeOf } from './lib.js'
import { Avatar, CropModal, I, Modal, OnTop, useSeen } from './ui.jsx'
import { AudioNote, MediaViewer, MusicTile, isAudioFile } from './extras.jsx'
import { usePrefs } from './prefs.js'
import { CopyLink } from './transfer.jsx'
import { locale } from './i18n.js'
import { ContactEdit } from './contactCard.jsx'

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi
const monthOf = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }).toUpperCase()
const isVideo = (m) => /^video\//.test(m.file?.type || '')
const isGif = (m) => /gif/.test(m.file?.type || '')
const isAudio = (m) => m.kind === 'file' && isAudioFile(m.file)

/* A chat's card, as in Telegram (Alex, 16 Oct): the big picture, the name, last seen, Message · Call ·
   Video · More, what we know about the person, and everything shared in the chat by kind. */
export default function Profile({ room, me, people, title, other, rooms, titleOf, toast, onClose, onChanged, onLeft, onMessage, onOpenRoom, loadPeople, blocked, onBlocks, onCall }) {
  const group = room.kind === 'group'
  const showIds = usePrefs().peerIds
  const admin = room.role === 'admin'
  const canName = group && admin
  const [items, setItems] = useState(null)
  const [links, setLinks] = useState([])
  const [tab, setTab] = useState(group ? 'members' : 'media')
  const [more, setMore] = useState(false)
  const [viewer, setViewer] = useState(null)
  const [name, setName] = useState(room.title)
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [err, setErr] = useState('')
  const [busyPic, setBusyPic] = useState(false)
  const [editing, setEditing] = useState(false) // my name and note for them
  const picRef = useRef(null)

  // a new picture: the group's (anyone in it), or my own one for a friend who has none (only I see it)
  const [cropFile, setCropFile] = useState(null) // the picture being adjusted before it is saved
  const pickPic = async (file) => {
    setCropFile(null)
    if (!file) return
    setBusyPic(true); setErr('')
    try {
      const path = `${me.id}/${group ? `group-${room.room_id}` : `contact-${other.id}`}-${Date.now()}.jpg`
      const up = await supabase.storage.from('roar-avatars').upload(path, file, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const url = supabase.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl
      const { error } = group
        ? await supabase.rpc('roar_set_group_photo', { r: room.room_id, url })
        : await supabase.from('roar_contacts').upsert({ owner: me.id, person: other.id, photo_url: url, updated_at: new Date().toISOString() })
      if (error) throw error
      if (group) onChanged(); else loadPeople([other.id])
      toast(group ? 'Group photo changed' : 'Photo set, only you see it')
    } catch (e) { setErr(errText(e)) }
    setBusyPic(false)
  }
  const dropMyPhoto = async () => {
    setMore(false)
    const { error } = await supabase.from('roar_contacts').update({ photo_url: '' }).eq('owner', me.id).eq('person', other.id)
    if (error) setErr(errText(error)); else { loadPeople([other.id]); toast('Your photo for them is gone') }
  }
  const canPic = group || !!other // my own photo for someone, over theirs too: only I see it
  const dropGroupPhoto = async () => {
    setMore(false)
    if (!window.confirm('Remove the group photo?')) return
    const { error } = await supabase.rpc('roar_set_group_photo', { r: room.room_id, url: '' })
    if (error) setErr(errText(error)); else { onChanged(); toast('Group photo removed') }
  }
  const block = async () => {
    setMore(false)
    if (blocked) {
      const { error } = await supabase.from('roar_blocks').delete().eq('blocker', me.id).eq('blocked', other.id)
      if (error) setErr(errText(error)); else { onBlocks(); toast(`${nameOf(other)} unblocked`) }
      return
    }
    if (!window.confirm(`Block ${nameOf(other)}? They will not be able to message or call you, or add you to groups.`)) return
    const { error } = await supabase.from('roar_blocks').insert({ blocker: me.id, blocked: other.id })
    if (error) setErr(errText(error)); else { onBlocks(); toast(`${nameOf(other)} blocked`) }
  }
  const deleteGroup = async () => {
    setMore(false)
    if (!window.confirm(`Delete ${title} for everyone, with all its messages?`)) return
    const { error } = await supabase.rpc('roar_delete_group', { r: room.room_id })
    if (error) setErr(errText(error)); else { toast('Group deleted'); onLeft() }
  }
  // who is an admin (Alex, 18 Oct): an admin makes others admins or takes it back (supabase/admins.sql)
  const [roles, setRoles] = useState({})
  const loadRoles = async () => {
    if (!group) return
    const { data } = await supabase.from('roar_members').select('user_id, role').eq('room_id', room.room_id)
    setRoles(Object.fromEntries((data || []).map((x) => [x.user_id, x.role])))
  }
  useEffect(() => { loadRoles() }, [room.room_id, (room.members || []).length]) // eslint-disable-line react-hooks/exhaustive-deps
  const setAdmin = async (p, on) => {
    const { error } = await supabase.rpc('roar_set_admin', { r: room.room_id, person: p.id, admin: on })
    if (error) { setErr(errText(error)); return }
    loadRoles()
    if (p.id === me.id) onChanged()
    toast(on ? `${nameOf(p)} is now an admin` : p.id === me.id ? 'You are no longer an admin' : `${nameOf(p)} is no longer an admin`)
  }
  const removeMember = async (p) => {
    if (!window.confirm(`Remove ${nameOf(p)} from ${title}?`)) return
    const { error } = await supabase.rpc('roar_remove_member', { r: room.room_id, person: p.id })
    if (error) setErr(errText(error)); else { onChanged(); toast(`${nameOf(p)} removed`) }
  }

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('roar_messages').select('id, user_id, kind, file, created_at').eq('room_id', room.room_id).in('kind', ['image', 'file', 'voice']).is('deleted_at', null).order('created_at', { ascending: false }).limit(600),
      supabase.from('roar_messages').select('id, user_id, body, created_at').eq('room_id', room.room_id).ilike('body', '%http%').is('deleted_at', null).order('created_at', { ascending: false }).limit(300),
    ]).then(([a, b]) => {
      if (!alive) return
      if (a.error) setErr(errText(a.error))
      setItems(a.data || [])
      setLinks((b.data || []).flatMap((m) => (m.body.match(URL_RE) || []).map((url, i) => ({ id: `${m.id}-${i}`, url, at: m.created_at, by: m.user_id }))))
    })
    return () => { alive = false }
  }, [room.room_id])

  const sets = useMemo(() => {
    // RoarTransfer files have their own tab (Alex, 17 Oct: "Files" became "Transfers"); other files sit under them
    const all = items || []
    const isTr = (m) => m.file?.bucket === 'roar-transfers'
    const list = all.filter((m) => !isTr(m))
    return {
      transfers: all.filter(isTr),
      media: list.filter((m) => (m.kind === 'image' && !isGif(m)) || isVideo(m)),
      files: list.filter((m) => m.kind === 'file' && !isVideo(m) && !isAudio(m) && !isGif(m)),
      music: list.filter(isAudio),
      voice: list.filter((m) => m.kind === 'voice'),
      gifs: list.filter(isGif),
    }
  }, [items])
  const common = useMemo(() => (group || !other ? [] : rooms.filter((r) => r.kind === 'group' && (r.members || []).includes(other.id))), [rooms, group, other])

  // people to add to a group
  useEffect(() => {
    const t = q.trim().replace(/[^\p{L}\p{N}_ .-]/gu, '').replace(/^@/, '')
    if (!adding || t.length < 2) { setHits([]); return }
    let alive = true
    const id = setTimeout(async () => {
      const { data } = await supabase.from('roar_people').select('id, username, display_name, avatar_url, last_seen').or(`username.ilike.${t.toLowerCase()}%,display_name.ilike.%${t}%`).neq('id', me.id).limit(20)
      if (alive) setHits((data || []).filter((p) => !(room.members || []).includes(p.id)))
    }, 220)
    return () => { alive = false; clearTimeout(id) }
  }, [q, adding, me.id, room.members])

  const setMine = async (patch, done) => {
    setMore(false)
    const { error } = await supabase.from('roar_members').update(patch).eq('room_id', room.room_id).eq('user_id', me.id)
    if (error) setErr(errText(error)); else { onChanged(); toast(done) }
  }
  const rename = async () => {
    if (!name.trim() || name.trim() === room.title) return
    const { error } = await supabase.from('roar_rooms').update({ title: name.trim() }).eq('id', room.room_id)
    if (error) setErr(errText(error)); else onChanged()
  }
  const add = async (p) => {
    const { error } = await supabase.rpc('roar_add_members', { r: room.room_id, people: [p.id] })
    if (error) setErr(errText(error)); else { loadPeople([p.id]); onChanged(); setHits((h) => h.filter((x) => x.id !== p.id)); toast(`${nameOf(p)} added`) }
  }
  const leave = async () => {
    setMore(false)
    if (!window.confirm(`Leave ${title}?`)) return
    const { error } = await supabase.rpc('roar_leave', { r: room.room_id })
    if (error) setErr(errText(error)); else onLeft()
  }
  const openMedia = async (n) => {
    const list = sets.media
    const shown = await Promise.all(list.map(async (m) => ({ url: await fileLink(m.file), type: m.file?.type, name: m.file?.name })))
    setViewer({ items: shown, index: n })
  }
  const openFile = async (m) => { const u = await fileLink(m.file); if (u) window.open(u, '_blank', 'noopener') }
  const copy = async (s, what) => { try { await navigator.clipboard.writeText(s); toast(what) } catch { toast('Copy did not work here') } }

  const members = (room.members || []).map((id) => people[id] || { id, username: '…' })
  const tabs = [
    group && ['members', 'Members', members.length],
    ['media', 'Media', sets.media.length],
    ['transfers', 'Transfers', sets.transfers.length],
    ['files', 'Files', sets.files.length],
    ['links', 'Links', links.length],
    ['music', 'Music', sets.music.length],
    ['voice', 'Voice', sets.voice.length],
    ['gifs', 'GIFs', sets.gifs.length],
    !group && ['groups', 'Groups', common.length],
  ].filter(Boolean)

  // the media grid, one header per month
  const byMonth = useMemo(() => {
    const out = []
    sets.media.forEach((m, n) => {
      const k = monthOf(m.created_at)
      if (!out.length || out[out.length - 1].k !== k) out.push({ k, list: [] })
      out[out.length - 1].list.push({ m, n })
    })
    return out
  }, [sets.media])

  const row = (m, icon, label, sub, onClick) => (
    <button key={m.id} type="button" className="pf-row" onClick={onClick}>
      <span className="pf-row-ico">{icon}</span>
      <span className="pf-row-text"><b>{label}</b><small>{sub}</small></span>
    </button>
  )
  const when = (iso) => `${new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })} · ${timeOf(iso)}`

  return (
    <Modal title="" onClose={onClose} wide>
      <div className="pf">
        <div className="pf-top">
          {canPic
            ? (
              <button type="button" className={`pf-pic${busyPic ? ' busy' : ''}`} onClick={() => picRef.current?.click()} title={group ? 'Change the group photo' : 'Set a photo for them, only you see it'}>
                <Avatar src={group ? room.avatar_url : other?.avatar_url} name={title} size={112} group={group} />
                <span className="pf-pic-cam">{I.camera}</span>
              </button>
            )
            : <Avatar src={group ? room.avatar_url : other?.avatar_url} name={title} size={112} group={group} />}
          <input ref={picRef} type="file" accept="image/*" hidden onChange={(e) => { setCropFile(e.target.files?.[0] || null); e.target.value = '' }} />
          {cropFile && <CropModal file={cropFile} title={group ? 'Group photo' : `Your photo for ${title}`} onDone={pickPic} onClose={() => setCropFile(null)} />}
          {editing && other && <ContactEdit me={me} other={other} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); loadPeople([other.id]); toast('Saved, only you see it') }} onPhoto={() => { setEditing(false); picRef.current?.click() }} onDropPhoto={dropMyPhoto} />}
          {canName
            ? <input className="pf-name-edit" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} title="Rename the group" />
            : <h2 className="pf-name">{title}</h2>}
          <p className="pf-sub">{group ? `${members.length} members` : lastSeenText(other) || ' '}</p>
          {!group && other?.nickname && <p className="pf-sub pf-real">{`Their name: ${other.real_name || `@${other.username}`}`}</p>}
        </div>

        <div className="pf-acts">
          <button type="button" onClick={onMessage}>{I.chats}<span>Message</span></button>
          <button type="button" onClick={() => (onCall ? onCall(false) : toast('Calls are for chats between two people'))}>{I.phone}<span>Call</span></button>
          <button type="button" onClick={() => (onCall ? onCall(true) : toast('Calls are for chats between two people'))}>{I.video}<span>Video</span></button>
          <span className="pf-more">
            <button type="button" className={more ? 'on' : ''} onClick={() => setMore((v) => !v)}>{I.more}<span>More</span></button>
            {more && (
              <>
                <button type="button" className="scrim" aria-label="Close" onClick={() => setMore(false)} />
                <div className="menu pf-menu">
                  <button type="button" onClick={() => setMine({ muted: !room.muted }, room.muted ? 'Sounds on' : 'Muted')}>{I.bell}<span>{room.muted ? 'Unmute' : 'Mute'}</span></button>
                  <button type="button" onClick={() => setMine({ archived: !room.archived }, room.archived ? 'Unarchived' : 'Archived')}>{I.archive}<span>{room.archived ? 'Unarchive' : 'Archive'}</span></button>
                  {!group && other && <button type="button" onClick={() => { setMore(false); copy(`@${other.username}`, 'Username copied') }}>{I.copy}<span>Copy username</span></button>}
                  {group && admin && <button type="button" onClick={() => { setMore(false); setTab('members'); setAdding(true) }}>{I.people}<span>Add people</span></button>}
                  {group && <button type="button" className="danger" onClick={leave}>{I.trash}<span>Leave group</span></button>}
                  {!group && other && <button type="button" onClick={() => { setMore(false); setEditing(true) }}>{I.edit}<span>Edit Contact</span></button>}
                  {canPic && <button type="button" onClick={() => { setMore(false); picRef.current?.click() }}>{I.camera}<span>{group ? 'Change group photo' : 'Set a photo for them'}</span></button>}
                  {!group && other?.my_photo && <button type="button" onClick={dropMyPhoto}>{I.x}<span>Remove my photo for them</span></button>}
                  {group && room.avatar_url && <button type="button" onClick={dropGroupPhoto}>{I.x}<span>Remove group photo</span></button>}
                  {group && admin && <button type="button" className="danger" onClick={deleteGroup}>{I.trash}<span>Delete group</span></button>}
                  {!group && other && <button type="button" className="danger" onClick={block}>{I.x}<span>{blocked ? 'Unblock' : 'Block'}</span></button>}
                </div>
              </>
            )}
          </span>
        </div>

        {!group && other && (
          <div className="pf-card">
            <button type="button" className="pf-field" onClick={() => copy(`@${other.username}`, 'Username copied')} title="Copy">
              <small>username</small><span>@{other.username}</span><i>{I.copy}</i>
            </button>
            {other.bio && <div className="pf-field"><small>about</small><span>{other.bio}</span></div>}
            {other.my_note && <button type="button" className="pf-field" onClick={() => setEditing(true)} title="Edit"><small>your note · only you see it</small><span className="pf-note">{other.my_note}</span><i>{I.edit}</i></button>}
            {showIds && <button type="button" className="pf-field" onClick={() => copy(other.id, 'ID copied')} title="Copy"><small>user id</small><span className="pf-id">{other.id}</span><i>{I.copy}</i></button>}
          </div>
        )}
        {err && <p className="auth-err">{err}</p>}

        <nav className="pf-tabs">
          {tabs.map(([k, l, n]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{n > 0 && <small>{n}</small>}</button>)}
        </nav>

        <div className="pf-body">
          {items === null && tab !== 'members' && tab !== 'groups' && <p className="muted pf-empty">Loading…</p>}

          {tab === 'members' && (
            <div className="people">
              {admin && (adding
                ? <label className="search">{I.search}<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people by @username or name" /><button type="button" className="link" onClick={() => { setAdding(false); setQ('') }}>Done</button></label>
                : <button type="button" className="pf-row" onClick={() => setAdding(true)}><span className="pf-row-ico add">{I.plus}</span><span className="pf-row-text"><b>Add people</b></span></button>)}
              {hits.map((p) => (
                <button key={p.id} type="button" className="pf-row" onClick={() => add(p)}>
                  <Avatar src={p.avatar_url} name={nameOf(p)} size={40} />
                  <span className="pf-row-text"><b>{nameOf(p)}</b><small>@{p.username}</small></span>
                  <span className="pf-tag">Add</span>
                </button>
              ))}
              {members.map((p) => (
                <div key={p.id} className="pf-row">
                  <Avatar src={p.avatar_url} name={nameOf(p)} size={40} />
                  <span className="pf-row-text"><b>{p.id === me.id ? 'You' : nameOf(p)}{roles[p.id] === 'admin' && <span className="pf-tag pf-admin">Admin</span>}</b><small>{p.username !== '…' ? `@${p.username} · ${lastSeenText(p)}` : ''}</small></span>
                  {admin && (roles[p.id] === 'admin'
                    ? (p.id !== me.id || Object.values(roles).filter((x) => x === 'admin').length > 1) && <button type="button" className="link" onClick={() => setAdmin(p, false)}>{p.id === me.id ? 'Step Down' : 'Remove Admin'}</button>
                    : <button type="button" className="link" onClick={() => setAdmin(p, true)}>Make Admin</button>)}
                  {admin && p.id !== me.id && <button type="button" className="link danger-link" onClick={() => removeMember(p)}>Remove</button>}
                </div>
              ))}
            </div>
          )}

          {tab === 'media' && items && (sets.media.length ? byMonth.map((g) => (
            <div key={g.k}>
              <div className="pf-month">{g.k}</div>
              <div className="pf-grid">{g.list.map(({ m, n }) => <Thumb key={m.id} m={m} onClick={() => openMedia(n)} />)}</div>
            </div>
          )) : <p className="muted pf-empty">No photos or videos yet.</p>)}

          {tab === 'transfers' && items && (sets.transfers.length ? (
            <>
              {sets.transfers.map((m) => {
                const left = new Date(m.file?.expires || 0).getTime() - Date.now()
                const gone = left <= 0
                const short = gone ? 'Expired' : left > 864e5 ? `${Math.ceil(left / 864e5)} days left` : left > 36e5 ? `${Math.ceil(left / 36e5)} h left` : 'Last hour'
                const ext = ((m.file?.name || '').match(/\.(\w{1,5})$/) || [])[1]?.toUpperCase()
                return (
                  <div key={m.id} className={`pf-tr${gone ? ' gone' : left < 864e5 ? ' soon' : ''}`}>
                    <button type="button" className="pf-row" disabled={gone} onClick={async () => { const u = await fileLink(m.file, m.file?.name || 'file'); if (u) window.open(u, '_blank', 'noopener') }}>
                      <span className="pf-row-ico pf-tr-ico">{I.transfer}</span>
                      <span className="pf-row-text"><b>{fmtBytes(m.file?.size)}{ext ? ` · ${ext}` : ''}</b><small>{when(m.created_at)}</small></span>
                      <span className="pf-tr-left">{I.timer}<span>{short}</span></span>
                    </button>
                    {!gone && <CopyLink file={m.file} round />}
                  </div>
                )
              })}
            </>
          ) : <p className="muted pf-empty">No transfers yet.</p>)}
          {tab === 'files' && items && (sets.files.length ? sets.files.map((m) => row(m, I.file, m.file?.name, `${fmtBytes(m.file?.size)} · ${when(m.created_at)}`, () => openFile(m))) : <p className="muted pf-empty">No files yet.</p>)}

          {tab === 'links' && items && (links.length ? links.map((l) => (
            <a key={l.id} className="pf-row" href={l.url} target="_blank" rel="noreferrer">
              <span className="pf-row-ico">{I.link}</span>
              <span className="pf-row-text"><b>{l.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</b><small>{l.url}</small></span>
            </a>
          )) : <p className="muted pf-empty">No links yet.</p>)}

          {tab === 'music' && items && (sets.music.length ? sets.music.map((m) => (
            <div key={m.id} className="pf-row pf-music"><MusicTile file={m.file} roomId={m.room_id} /></div>
          )) : <p className="muted pf-empty">No music yet.</p>)}

          {tab === 'voice' && items && (sets.voice.length ? sets.voice.map((m) => (
            <div key={m.id} className="pf-row"><span className="pf-row-ico">{I.mic}</span><span className="pf-row-text"><b>{m.user_id === me.id ? 'You' : nameOf(people[m.user_id])}</b><small>{when(m.created_at)}</small></span><AudioNote file={m.file} /></div>
          )) : <p className="muted pf-empty">No voice messages yet.</p>)}

          {tab === 'gifs' && items && (sets.gifs.length ? <div className="pf-grid">{sets.gifs.map((m) => <Thumb key={m.id} m={m} onClick={() => openFile(m)} />)}</div> : <p className="muted pf-empty">No GIFs yet.</p>)}

          {tab === 'groups' && (common.length ? common.map((r) => (
            <button key={r.room_id} type="button" className="pf-row" onClick={() => onOpenRoom(r.room_id)}>
              <Avatar src={r.avatar_url} name={titleOf(r)} size={40} group />
              <span className="pf-row-text"><b>{titleOf(r)}</b><small>{(r.members || []).length} members</small></span>
            </button>
          )) : <p className="muted pf-empty">No groups in common.</p>)}
        </div>
      </div>
      {viewer && <OnTop><MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} /></OnTop>}
    </Modal>
  )
}

function Thumb({ m, onClick }) {
  const [ref, seen] = useSeen()
  const [url, setUrl] = useState('')
  const [dur, setDur] = useState(0)
  useEffect(() => { if (!seen) return undefined; let alive = true; fileLink(thumbOf(m.file)).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path, seen])
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <button ref={ref} type="button" className="pf-thumb" onClick={onClick}>
      {url && (isVideo(m) ? <video src={url} muted preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} /> : <img src={url} alt="" loading="lazy" />)}
      {isVideo(m) && dur > 0 && <span className="pf-dur">{mmss(dur)}</span>}
    </button>
  )
}

