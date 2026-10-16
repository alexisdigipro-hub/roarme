import { useEffect, useMemo, useRef, useState } from 'react'
import { dayLabel, fileLink, fmtBytes, nameOf, supabase } from './lib.js'
import { I, Lens } from './ui.jsx'
import { MediaViewer, MusicTile, isAudioFile } from './extras.jsx'

/* Media from all chats (Alex, 17 Oct, after WhatsApp's): one page with every photo and video, link, song and
   document anyone sent in the chats one is in, each with who sent it and where. The list on the left picks one
   chat or all of them. */

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g
const isMediaFile = (m) => m.kind === 'image' || /^(image|video)\//.test(m.file?.type || '')
const expired = (m) => m.file?.expires && new Date(m.file.expires).getTime() <= Date.now()

/* everything at once, read once per visit to the tab; the database only gives back the chats one is in */
export function useLibrary(on) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!on || data) return
    let alive = true
    Promise.all([
      supabase.from('roar_messages').select('id, room_id, user_id, kind, file, created_at').in('kind', ['image', 'file']).is('deleted_at', null).order('created_at', { ascending: false }).limit(800),
      supabase.from('roar_messages').select('id, room_id, user_id, body, created_at').eq('kind', 'text').ilike('body', '%http%').is('deleted_at', null).order('created_at', { ascending: false }).limit(500),
    ]).then(([f, t]) => {
      if (!alive) return
      const files = (f.data || []).filter((m) => m.file?.path && !expired(m))
      const links = (t.data || []).flatMap((m) => [...new Set(m.body.match(URL_RE) || [])].map((url, n) => ({ ...m, id: `${m.id}-${n}`, msgId: m.id, url })))
      setData({
        media: files.filter(isMediaFile),
        music: files.filter((m) => !isMediaFile(m) && isAudioFile(m.file)),
        docs: files.filter((m) => !isMediaFile(m) && !isAudioFile(m.file)),
        links,
      })
    })
    return () => { alive = false }
  }, [on, data])
  return [data, () => setData(null)]
}

/* the left side: all chats, or one, with how many things each has */
export function LibrarySide({ data, rooms, titleOf, face, room, onRoom }) {
  const count = (id) => (data ? ['media', 'links', 'music', 'docs'].reduce((n, k) => n + data[k].filter((m) => !id || m.room_id === id).length, 0) : 0)
  const list = rooms.filter((r) => count(r.room_id) > 0).sort((a, b) => count(b.room_id) - count(a.room_id))
  return (
    <div className="lib-side">
      <button type="button" className={`lib-chat${!room ? ' on' : ''}`} onClick={() => onRoom('')}>
        <span className="lib-all">{I.image}</span><b>All chats</b><small>{count('')}</small>
      </button>
      {list.map((r) => (
        <button key={r.room_id} type="button" className={`lib-chat${room === r.room_id ? ' on' : ''}`} onClick={() => onRoom(r.room_id)}>
          {face(r, 36)}<b>{titleOf(r)}</b><small>{count(r.room_id)}</small>
        </button>
      ))}
      {!data && <span className="pic-wait lib-wait" />}
    </div>
  )
}

/* a tile appears as it scrolls into view, so hundreds of photos do not all load at once */
function useSeen() {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return undefined
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}

function Tile({ m, who, where, onOpen, onChat }) {
  const [ref, seen] = useSeen()
  const [url, setUrl] = useState('')
  const isVid = /^video\//.test(m.file?.type || '')
  useEffect(() => { if (!seen) return undefined; let alive = true; fileLink(m.file).then((u) => { if (alive) setUrl(u) }); return () => { alive = false } }, [seen, m.file])
  return (
    <div ref={ref} className="lib-tile" role="button" tabIndex={0} onClick={onOpen}>
      {url && (isVid ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" loading="lazy" />)}
      {isVid && <i className="lib-play">{I.play}</i>}
      <span className="lib-who"><b>{who}</b><small>{where}</small></span>
      <button type="button" className="lib-go" onClick={(e) => { e.stopPropagation(); onChat() }} title="Show in chat" aria-label="Show in chat">{I.chats}</button>
    </div>
  )
}

function Row({ icon, title, sub, meta, onClick, onChat, children }) {
  return (
    <div className="lib-row" role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}>
      {icon}
      <span className="lib-row-text">
        <b>{title}</b>
        {sub && <small className="lib-sub">{sub}</small>}
        {children}
        <small>{meta}</small>
      </span>
      <button type="button" className="lib-go row" onClick={(e) => { e.stopPropagation(); onChat() }} title="Show in chat" aria-label="Show in chat">{I.chats}</button>
    </div>
  )
}

export function Library({ data, room, people, me, rooms, titleOf, onChat, onBack }) {
  const [kind, setKind] = useState('media')
  const [q, setQ] = useState('')
  const [viewer, setViewer] = useState(null)
  const titleById = useMemo(() => Object.fromEntries(rooms.map((r) => [r.room_id, titleOf(r)])), [rooms, titleOf])
  const who = (m) => (m.user_id === me.id ? 'You' : nameOf(people[m.user_id]))
  const where = (m) => titleById[m.room_id] || ''
  const words = q.trim().toLowerCase()
  const pick = (list) => list.filter((m) => (!room || m.room_id === room)
    && (!words || [m.file?.name, m.url, who(m), where(m)].some((s) => (s || '').toLowerCase().includes(words))))
  const lists = data ? { media: pick(data.media), links: pick(data.links), music: pick(data.music), docs: pick(data.docs) } : null
  const list = lists?.[kind] || []
  const photos = lists ? lists.media.filter((m) => !/^video\//.test(m.file?.type || '')).length : 0
  const videos = lists ? lists.media.length - photos : 0

  // the viewer gets the photos and videos around the one opened, so it can step left and right
  const openAt = async (n) => {
    const from = Math.max(0, n - 25)
    const near = list.slice(from, n + 26)
    const items = await Promise.all(near.map(async (m) => ({ url: await fileLink(m.file), type: m.file?.type, name: m.file?.name })))
    setViewer({ items, index: n - from })
  }
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
  const when = (m) => dayLabel(m.created_at)
  const tabs = [['media', 'Media'], ['links', 'Links'], ['music', 'Music'], ['docs', 'Docs']]

  return (
    <div className="lib">
      <div className="lib-top">
        <button type="button" className="round lib-back" onClick={onBack} aria-label="Back">{I.left}</button>
        <span className="lib-title"><b>Media</b><small>{room ? titleById[room] : 'From all chats'}</small></span>
        <Lens className="seg lib-seg" dep={kind}>
          {tabs.map(([k, label]) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{label}{lists && lists[k].length > 0 && <i>{lists[k].length}</i>}</button>)}
        </Lens>
        <label className="search lib-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label>
      </div>

      <div className="lib-body">
        {!data && <div className="lib-grid">{Array.from({ length: 12 }, (_, n) => <span key={n} className="pic-wait lib-tile" />)}</div>}
        {data && !list.length && <p className="empty lib-empty">{words ? 'Nothing found.' : kind === 'media' ? 'No photos or videos yet.' : kind === 'links' ? 'No links yet.' : kind === 'music' ? 'No songs or sound files yet.' : 'No documents yet.'}</p>}
        {data && kind === 'media' && list.length > 0 && (
          <div className="lib-grid">
            {list.map((m, n) => <Tile key={m.id} m={m} who={who(m)} where={where(m)} onOpen={() => openAt(n)} onChat={() => onChat(m.room_id, m.id)} />)}
          </div>
        )}
        {data && kind === 'links' && list.length > 0 && (
          <div className="lib-rows">
            {list.map((m) => (
              <Row key={m.id} icon={<span className="lib-ico link">{host(m.url).slice(0, 1).toUpperCase()}</span>} title={host(m.url)} sub={m.url}
                meta={`${who(m)} · ${where(m)} · ${when(m)}`} onClick={() => window.open(m.url, '_blank', 'noopener')} onChat={() => onChat(m.room_id, m.msgId)} />
            ))}
          </div>
        )}
        {data && kind === 'music' && list.length > 0 && (
          <div className="lib-rows">
            {list.map((m) => (
              <Row key={m.id} icon={<span className="lib-ico music">{I.play}</span>} title={m.file?.name} meta={`${who(m)} · ${where(m)} · ${when(m)}`} onChat={() => onChat(m.room_id, m.id)}>
                <span className="lib-player"><MusicTile file={m.file} /></span>
              </Row>
            ))}
          </div>
        )}
        {data && kind === 'docs' && list.length > 0 && (
          <div className="lib-rows">
            {list.map((m) => {
              const ext = ((m.file?.name || '').match(/\.(\w{1,5})$/) || [])[1]?.toUpperCase() || 'FILE'
              return (
                <Row key={m.id} icon={<span className="lib-ico doc"><b>{ext}</b></span>} title={m.file?.name} meta={`${fmtBytes(m.file?.size)} · ${who(m)} · ${where(m)} · ${when(m)}`}
                  onClick={async () => { const u = await fileLink(m.file, m.file?.name || 'file'); if (u) window.open(u, '_blank', 'noopener') }} onChat={() => onChat(m.room_id, m.id)} />
              )
            })}
          </div>
        )}
      </div>
      {data && kind === 'media' && <div className="lib-foot">{photos === 1 ? '1 Photo' : `${photos} Photos`}, {videos === 1 ? '1 Video' : `${videos} Videos`}</div>}
      {viewer && <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />}
    </div>
  )
}
