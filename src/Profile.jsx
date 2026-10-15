import { useEffect, useMemo, useState } from 'react'
import { errText, fileLink, fmtBytes, lastSeenText, nameOf, supabase, timeOf } from './lib.js'
import { Avatar, I, Modal, OnTop } from './ui.jsx'
import { AudioNote, MediaViewer, MusicTile, isAudioFile } from './extras.jsx'

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi
const monthOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toUpperCase()
const isVideo = (m) => /^video\//.test(m.file?.type || '')
const isGif = (m) => /gif/.test(m.file?.type || '')
const isAudio = (m) => m.kind === 'file' && isAudioFile(m.file)

/* A chat's card, as in Telegram (Alex, 16 Oct): the big picture, the name, last seen, Message · Call ·
   Video · More, what we know about the person, and everything shared in the chat by kind. */
export default function Profile({ room, me, people, title, other, rooms, titleOf, toast, onClose, onChanged, onLeft, onMessage, onOpenRoom, loadPeople }) {
  const group = room.kind === 'group'
  const admin = room.role === 'admin'
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
    const list = items || []
    return {
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
      const { data } = await supabase.from('roar_profiles').select('id, username, display_name, avatar_url, last_seen').or(`username.ilike.${t.toLowerCase()}%,display_name.ilike.%${t}%`).neq('id', me.id).limit(20)
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
    const shown = await Promise.all(list.map(async (m) => ({ url: await fileLink(m.file?.path), type: m.file?.type, name: m.file?.name })))
    setViewer({ items: shown, index: n })
  }
  const openFile = async (m) => { const u = await fileLink(m.file?.path); if (u) window.open(u, '_blank', 'noopener') }
  const copy = async (s, what) => { try { await navigator.clipboard.writeText(s); toast(what) } catch { toast('Copy did not work here') } }

  const members = (room.members || []).map((id) => people[id] || { id, username: '…' })
  const tabs = [
    group && ['members', 'Members', members.length],
    ['media', 'Media', sets.media.length],
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
  const when = (iso) => `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${timeOf(iso)}`

  return (
    <Modal title="" onClose={onClose} wide>
      <div className="pf">
        <div className="pf-top">
          <Avatar src={group ? room.avatar_url : other?.avatar_url} name={title} size={112} group={group} />
          {group && admin
            ? <input className="pf-name-edit" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} title="Rename the group" />
            : <h2 className="pf-name">{title}</h2>}
          <p className="pf-sub">{group ? `${members.length} members` : lastSeenText(other) || ' '}</p>
        </div>

        <div className="pf-acts">
          <button type="button" onClick={onMessage}>{I.chats}<span>Message</span></button>
          <button type="button" onClick={() => toast('Voice calls are coming soon')}>{I.phone}<span>Call</span></button>
          <button type="button" onClick={() => toast('Video calls are coming soon')}>{I.video}<span>Video</span></button>
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
                  {group && admin && <button type="button" className="danger" onClick={() => { setMore(false); toast('Deleting a group is coming soon') }}>{I.trash}<span>Delete group</span></button>}
                  {!group && <button type="button" className="danger" onClick={() => { setMore(false); toast('Blocking is coming soon') }}>{I.x}<span>Block</span></button>}
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
                  <span className="pf-row-text"><b>{p.id === me.id ? 'You' : nameOf(p)}</b><small>{p.username !== '…' ? `@${p.username} · ${lastSeenText(p)}` : ''}</small></span>
                  {admin && p.id !== me.id && <button type="button" className="link soon" onClick={() => toast('Removing people is coming soon')}>Remove</button>}
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

          {tab === 'files' && items && (sets.files.length ? sets.files.map((m) => row(m, I.file, m.file?.name, `${fmtBytes(m.file?.size)} · ${when(m.created_at)}`, () => openFile(m))) : <p className="muted pf-empty">No files yet.</p>)}

          {tab === 'links' && items && (links.length ? links.map((l) => (
            <a key={l.id} className="pf-row" href={l.url} target="_blank" rel="noreferrer">
              <span className="pf-row-ico">{I.link}</span>
              <span className="pf-row-text"><b>{l.url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}</b><small>{l.url}</small></span>
            </a>
          )) : <p className="muted pf-empty">No links yet.</p>)}

          {tab === 'music' && items && (sets.music.length ? sets.music.map((m) => (
            <div key={m.id} className="pf-row pf-music"><MusicTile file={m.file} /></div>
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
  const [url, setUrl] = useState('')
  const [dur, setDur] = useState(0)
  useEffect(() => { let alive = true; fileLink(m.file?.path).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [m.file?.path])
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  return (
    <button type="button" className="pf-thumb" onClick={onClick}>
      {url && (isVideo(m) ? <video src={url} muted preload="metadata" onLoadedMetadata={(e) => setDur(e.currentTarget.duration || 0)} /> : <img src={url} alt="" loading="lazy" />)}
      {isVideo(m) && dur > 0 && <span className="pf-dur">{mmss(dur)}</span>}
    </button>
  )
}
