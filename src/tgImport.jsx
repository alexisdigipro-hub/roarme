// Import from Telegram (Alex, 22 Nov: "can all the chats and files come out of Telegram and into RoarMe? for all users").
// Telegram Desktop exports a chat as a folder (result.json and its photos, videos, voice messages and files); this window
// reads that folder on the device, asks who each Telegram person is here, and brings the messages into this chat with
// their own dates. The rows go in through roar_import_messages (supabase/telegram-import.sql); files go to this chat's
// own folder in roar-files. An import that stops can be run again: what is already here is skipped.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, I, Modal } from './ui.jsx'
import { errText, fmtBytes, nameOf, shrinkImage, supabase, uploadWithProgress, videoPoster } from './lib.js'
import { peaksOf } from './extras.jsx'

const FILE_MAX = 50e6 // what a chat's own folder takes; larger files stay out, with a line in their place
const BATCH = 100
const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// the same Telegram message always gets the same id here, so a second run skips what the first one brought
async function idFor(room, chat, n) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tg|${room}|${chat}|${n}`)))
  h[6] = (h[6] & 0x0f) | 0x40
  h[8] = (h[8] & 0x3f) | 0x80
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

// Telegram's text: a string, or pieces with a kind (a link keeps its address beside its words)
const textOf = (t) => (typeof t === 'string' ? t : Array.isArray(t) ? t.map((p) => (typeof p === 'string' ? p : p?.type === 'text_link' && p.href && p.href !== p.text ? `${p.text} (${p.href})` : p?.text || '')).join('') : '')

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', pdf: 'application/pdf' }
const typeOf = (name, given) => given || TYPES[(String(name).match(/\.(\w+)$/) || [])[1]?.toLowerCase()] || 'application/octet-stream'

// the chats a result.json holds: one (a single chat's export) or many (the whole account's)
function chatsOf(j) {
  const list = Array.isArray(j?.chats?.list) ? j.chats.list : Array.isArray(j?.messages) ? [j] : []
  return list.filter((c) => Array.isArray(c.messages) && c.messages.some((m) => m.type === 'message'))
    .map((c) => ({ id: String(c.id ?? c.name ?? 'chat'), name: c.name || (c.type === 'saved_messages' ? 'Saved Messages' : 'Chat'), type: c.type || '', messages: c.messages.filter((m) => m.type === 'message') }))
}

export function TelegramImport({ room, me, people, onClose, onDone }) {
  const [step, setStep] = useState('start') // start · chats · people · run · done
  const [err, setErr] = useState('')
  const [chats, setChats] = useState([])
  const [chat, setChat] = useState(null)
  const [who, setWho] = useState({}) // Telegram from_id -> a member's id here, or '' to keep the Telegram name
  const [prog, setProg] = useState({ n: 0, all: 0, file: '', added: 0, left: 0 })
  const files = useRef(new Map())
  const myTg = useRef('')
  const stop = useRef(false)
  const pick = useRef(null)
  useEffect(() => () => { stop.current = true }, [])
  const members = useMemo(() => (room.members || []).map((id) => ({ id, name: id === me.id ? `${nameOf(me)} (you)` : nameOf(people[id]) })), [room.members, people, me])

  const read = async (list) => {
    setErr('')
    const all = [...list]
    if (!all.length) return
    const res = all.filter((f) => /(^|\/)result\.json$/.test(f.webkitRelativePath || f.name)).sort((a, b) => (a.webkitRelativePath || '').length - (b.webkitRelativePath || '').length)[0]
    if (!res) {
      setErr(all.some((f) => /messages\d*\.html$/.test(f.name))
        ? 'This export is in HTML. In Telegram Desktop export it again and, under Format, choose "Machine-readable JSON".'
        : 'There is no result.json in this folder. Choose the folder Telegram Desktop made (it is usually called ChatExport and a date).')
      return
    }
    try {
      const j = JSON.parse(await res.text())
      const base = (res.webkitRelativePath || '').replace(/result\.json$/, '')
      const map = new Map()
      all.forEach((f) => { const p = f.webkitRelativePath || f.name; if (p.startsWith(base)) map.set(p.slice(base.length), f) })
      files.current = map
      myTg.current = j?.personal_information?.user_id ? `user${j.personal_information.user_id}` : ''
      const cs = chatsOf(j)
      if (!cs.length) { setErr('No messages were found in this export.'); return }
      setChats(cs)
      if (cs.length === 1) choose(cs[0]); else setStep('chats')
    } catch (x) { setErr(`The export could not be read: ${errText(x)}`) }
  }

  const sendersOf = (c) => {
    const by = new Map()
    c.messages.forEach((m) => { const k = m.from_id || m.from || '?'; const s = by.get(k) || { key: k, name: m.from || 'Deleted Account', n: 0 }; s.n += 1; if (m.from) s.name = m.from; by.set(k, s) })
    return [...by.values()].sort((a, b) => b.n - a.n)
  }
  const choose = (c) => {
    const ss = sendersOf(c)
    const guess = {}
    const others = members.filter((x) => x.id !== me.id)
    ss.forEach((s) => {
      if (myTg.current && s.key === myTg.current) { guess[s.key] = me.id; return }
      const same = members.find((x) => fold(x.name.replace(/ \(you\)$/, '')) === fold(s.name))
      guess[s.key] = same ? same.id : ''
    })
    // a chat of two: whoever is not me is the other one
    if (room.kind !== 'group' && ss.length === 2 && others.length === 1) {
      const mine = ss.find((s) => guess[s.key] === me.id)
      if (mine) { const o = ss.find((s) => s !== mine); if (!guess[o.key]) guess[o.key] = others[0].id }
    }
    // nobody is me yet (a single chat's export does not say who exported it): in a chat of two, once the other one is
    // known, whoever wrote most of the rest is me; it can be changed in the list
    if (room.kind !== 'group' && !ss.some((s) => guess[s.key] === me.id) && ss.some((s) => guess[s.key])) {
      const top = ss.find((s) => !guess[s.key])
      if (top) guess[top.key] = me.id
    }
    setWho(guess); setChat({ ...c, senders: ss }); setStep('people')
  }

  const sum = useMemo(() => {
    if (!chat) return null
    let media = 0, bytes = 0, out = 0
    chat.messages.forEach((m) => {
      const p = m.photo || m.file
      if (!p) return
      const f = files.current.get(p)
      if (!f || f.size > FILE_MAX) out += 1; else { media += 1; bytes += f.size }
    })
    return { media, bytes, out }
  }, [chat])

  const run = async () => {
    stop.current = false
    setStep('run'); setErr('')
    const list = chat.messages
    const rid = room.room_id
    let added = 0, left = 0
    const ids = await Promise.all(list.map((m) => idFor(rid, chat.id, m.id)))
    const idOf = new Map(list.map((m, i) => [m.id, ids[i]]))
    const up = async (file, name, type) => {
      const safe = (name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'
      const path = `${rid}/${crypto.randomUUID()}-${safe}`
      await uploadWithProgress('roar-files', path, file, type, () => {})
      return path
    }
    try {
      for (let at = 0; at < list.length; at += BATCH) {
        if (stop.current) break
        const part = list.slice(at, at + BATCH)
        const partIds = part.map((m) => idOf.get(m.id))
        const { data: have, error: e0 } = await supabase.from('roar_messages').select('id').in('id', partIds)
        if (e0) throw e0
        const here = new Set((have || []).map((x) => x.id))
        const rows = []
        for (const m of part) {
          if (stop.current) break
          const id = idOf.get(m.id)
          if (here.has(id)) continue
          const key = m.from_id || m.from || '?'
          const uid = who[key] || ''
          let body = textOf(m.text)
          let kind = 'text'
          let file = null
          const notes = []
          if (m.forwarded_from) notes.push(`Forwarded from ${m.forwarded_from}`)
          const p = m.photo || m.file
          if (p) {
            const f = files.current.get(p)
            const label = m.photo ? 'Photo' : m.media_type === 'voice_message' ? 'Voice message' : m.media_type === 'video_message' || m.media_type === 'video_file' ? 'Video' : m.media_type === 'sticker' ? `Sticker ${m.sticker_emoji || ''}`.trim() : m.file_name || 'File'
            if (!f) { notes.push(`📎 ${label} (not in the export)`); left += 1 }
            else if (f.size > FILE_MAX) { notes.push(`📎 ${m.file_name || f.name} (${fmtBytes(f.size)}, too large to import)`); left += 1 }
            else if (m.media_type === 'sticker' && !/\.(webp|png)$/i.test(f.name)) { body = body || m.sticker_emoji || 'Sticker' }
            else {
              setProg((x) => ({ ...x, file: f.name }))
              const name = m.file_name || f.name
              const type = typeOf(f.name, m.photo ? '' : m.mime_type)
              try {
                const path = await up(f, name, type)
                file = { path, name, size: f.size, type }
                const dur = Number(m.duration_seconds) || 0
                if (m.photo || (m.media_type === 'sticker')) {
                  kind = 'image'
                  try { const small = await shrinkImage(f, 1080, 0.8); if (small !== f) file.thumb = await up(small, `thumb-${name}`, small.type) } catch { /* the chat shows the whole photo */ }
                } else if (m.media_type === 'voice_message') {
                  kind = 'voice'
                  file.dur = Math.max(1, dur)
                  try { const peaks = await peaksOf(await f.arrayBuffer()); if (peaks) file.peaks = peaks } catch { /* a plain line stands in */ }
                } else {
                  kind = 'file'
                  if (dur) file.dur = dur
                  if (m.media_type === 'video_message') file.round = true
                  if (/^video\//.test(type)) {
                    try { const still = await videoPoster(f, 640); if (still) file.thumb = await up(still, `still-${name}.jpg`, 'image/jpeg') } catch { /* the chat reads the first frame itself */ }
                  } else if (!/^(audio|image)\//.test(type)) file.asFile = true
                }
              } catch (x) { notes.push(`📎 ${name} (could not be uploaded)`); left += 1; file = null; kind = 'text' }
            }
          }
          const loc = m.location_information
          if (loc && Number.isFinite(Number(loc.latitude))) {
            file = { ...(file || {}), location: { lat: Number(loc.latitude), lng: Number(loc.longitude), z: 16, name: m.place_name || 'Location', addr: m.address || '' } }
            body = body || m.place_name || 'Location'
          }
          const c = m.contact_information
          if (c) notes.push(`👤 ${[c.first_name, c.last_name].filter(Boolean).join(' ')}${c.phone_number ? ` · ${c.phone_number}` : ''}`)
          if (m.poll) notes.push([`📊 ${m.poll.question || 'Poll'}`, ...(m.poll.answers || []).map((a) => `• ${textOf(a.text)}${a.voters ? ` (${a.voters})` : ''}`)].join('\n'))
          body = [...notes, body].filter(Boolean).join('\n')
          if (!body && kind === 'text' && !file) continue
          const when = m.date_unixtime ? new Date(Number(m.date_unixtime) * 1000) : new Date(m.date)
          if (Number.isNaN(when.getTime())) continue
          rows.push({ id, user_id: uid, as: uid ? '' : (m.from || 'Deleted Account'), kind, body: body.slice(0, 20000), at: when.toISOString(), reply_to: idOf.get(m.reply_to_message_id) || '', ...(file ? { file } : {}) })
        }
        if (rows.length) {
          const { data, error } = await supabase.rpc('roar_import_messages', { r: rid, rows })
          if (error) throw error
          added += Number(data) || 0
        }
        setProg({ n: Math.min(list.length, at + part.length), all: list.length, file: '', added, left })
      }
      setProg((x) => ({ ...x, file: '', added, left }))
      setStep('done')
      onDone?.(added)
    } catch (x) { setErr(errText(x)); setProg((p) => ({ ...p, file: '', added, left })); setStep('done') }
  }

  const title = 'Import from Telegram'
  return (
    <Modal title={title} onClose={() => { stop.current = true; onClose() }}>
      <div className="tgi">
        {step === 'start' && (
          <>
            <ol className="tgi-steps">
              <li>On a computer, open <b>Telegram Desktop</b> and the chat you want.</li>
              <li>Press <b>⋯</b> at the top right, then <b>Export chat history</b>.</li>
              <li>Tick what to bring (photos, videos, voice messages, files) and, under <b>Format</b>, choose <b>Machine-readable JSON</b>. Press Export.</li>
              <li>Come back here and choose the folder Telegram made.</li>
            </ol>
            <button type="button" className="btn btn-main tgi-go" onClick={() => pick.current?.click()}>{I.file}<span>Choose the Export Folder</span></button>
            <p className="tgi-hint">Everything is read on this device. Messages come in with their own dates and a small "imported" mark; nobody gets a notification. Files over 50 MB stay out.</p>
          </>
        )}
        {step === 'chats' && (
          <>
            <p className="tgi-hint">This export holds {chats.length} chats. Which one comes into this chat?</p>
            <div className="tgi-list">
              {chats.map((c) => <button key={c.id} type="button" className="tgi-row" onClick={() => choose(c)}><Avatar name={c.name} size={34} /><span className="tgi-text"><b>{c.name}</b><small>{c.messages.length.toLocaleString()} messages</small></span>{I.right}</button>)}
            </div>
          </>
        )}
        {step === 'people' && chat && (
          <>
            <p className="tgi-hint"><b>{chat.name}</b> · {chat.messages.length.toLocaleString()} messages{sum.media ? ` · ${sum.media.toLocaleString()} photos and files (${fmtBytes(sum.bytes)})` : ''}{sum.out ? ` · ${sum.out.toLocaleString()} left out (not in the export, or over 50 MB)` : ''}</p>
            <small className="tgi-cap">Who is who</small>
            <div className="tgi-list">
              {chat.senders.map((s) => (
                <label key={s.key} className="tgi-row">
                  <Avatar name={s.name} size={34} />
                  <span className="tgi-text"><b>{s.name}</b><small>{s.n.toLocaleString()} {s.n === 1 ? 'message' : 'messages'}</small></span>
                  <select value={who[s.key] || ''} onChange={(e) => setWho({ ...who, [s.key]: e.target.value })}>
                    <option value="">Not here (keep the name)</option>
                    {members.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="tgi-foot">
              {chats.length > 1 && <button type="button" className="btn" onClick={() => setStep('chats')}>Back</button>}
              <button type="button" className="btn btn-main" onClick={run}>Import {chat.messages.length.toLocaleString()} Messages</button>
            </div>
          </>
        )}
        {step === 'run' && (
          <>
            <p className="tgi-big">{prog.n.toLocaleString()} <small>of {(prog.all || chat.messages.length).toLocaleString()}</small></p>
            <div className="tgi-bar"><i style={{ width: `${Math.round((prog.n / (prog.all || chat.messages.length || 1)) * 100)}%` }} /></div>
            <p className="tgi-hint tgi-now">{prog.file ? `Uploading ${prog.file}` : 'Bringing the messages in…'}</p>
            <p className="tgi-hint">Keep this window open. If it stops, run the import again: what is already here is skipped.</p>
            <div className="tgi-foot"><button type="button" className="btn" onClick={() => { stop.current = true }}>Stop</button></div>
          </>
        )}
        {step === 'done' && (
          <>
            <p className="tgi-big">{prog.added.toLocaleString()} <small>messages imported</small></p>
            {prog.left > 0 && <p className="tgi-hint">{prog.left.toLocaleString()} photos or files stayed out (not in the export, or over 50 MB); a line stands in their place.</p>}
            {prog.n < prog.all && !err && <p className="tgi-hint">Stopped at {prog.n.toLocaleString()} of {prog.all.toLocaleString()}. Run it again to go on.</p>}
            <div className="tgi-foot"><button type="button" className="btn btn-main" onClick={onClose}>Done</button></div>
          </>
        )}
        {err && <p className="auth-err">{err}</p>}
      </div>
      <input ref={pick} type="file" hidden multiple webkitdirectory="" directory="" onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ''; read(l) }} />
    </Modal>
  )
}
