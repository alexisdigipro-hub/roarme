import { useCallback, useEffect, useRef, useState } from 'react'
import { I } from './ui.jsx'
import { errText, nameOf, picLink, supabase } from './lib.js'
import { inApp } from './push.js'

/* RoarMe Pro (Alex, 22 Nov, from the sample https://claude.ai/artifact/HzxD32EAhTGsWVS7QPs4dT, "Pro grouped"): the same
   chat, with a group able to be a project. Only on the website on a computer for now (not the iPhone app, not the Mac
   apps). The chat list stays the chat list (Projects and Direct join its folders, a project shows its stage); the open
   chat keeps everything it has, and a panel at its right holds the project: stage, due date, brief, fields, its files in
   folders and its tasks. Turning Pro off hides all of this; the rows in roar_pro_projects stay (supabase/pro.sql). */

export const proOk = () => typeof window !== 'undefined' && !inApp() && !window.roarDesktop && window.matchMedia('(min-width: 761px) and (pointer: fine)').matches

export const STAGES = [['prep', 'In prep'], ['shoot', 'Shooting'], ['post', 'Post'], ['done', 'Delivered']]
export const stageName = (s) => (STAGES.find((x) => x[0] === s) || STAGES[0])[1]
export const ProChip = ({ p }) => <span className={`prj-chip prj-${p.status}`}>{stageName(p.status)}</span>

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
const FIELD_START = ['Client', 'Budget', 'Location', 'Lead']

// every project I can see, live
export function useProjects(me, on) {
  const [map, setMap] = useState({})
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('roar_pro_projects').select('*')
    if (!error) setMap(Object.fromEntries((data || []).map((p) => [p.room_id, p])))
  }, [])
  useEffect(() => {
    if (!on) return undefined
    load()
    const ch = supabase.channel(`roar-pro-projects-${me.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'roar_pro_projects' }, (ev) => {
        if (ev.eventType === 'DELETE') setMap((m) => { const n = { ...m }; delete n[ev.old.room_id]; return n })
        else if (ev.new?.room_id) setMap((m) => ({ ...m, [ev.new.room_id]: ev.new }))
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [on, me.id, load])
  const save = useCallback(async (roomId, patch) => {
    setMap((m) => ({ ...m, [roomId]: { ...(m[roomId] || {}), room_id: roomId, ...patch } }))
    const { data, error } = await supabase.from('roar_pro_projects').upsert({ room_id: roomId, ...patch }, { onConflict: 'room_id' }).select().single()
    if (error) { load(); throw error }
    setMap((m) => ({ ...m, [roomId]: data }))
    return data
  }, [load])
  const remove = useCallback(async (roomId) => {
    const { error } = await supabase.from('roar_pro_projects').delete().eq('room_id', roomId)
    if (error) throw error
    setMap((m) => { const n = { ...m }; delete n[roomId]; return n })
  }, [])
  return { map, save, remove, reload: load }
}

/* ---------- files in folders ---------- */
const EXT = (f) => ((f?.name || '').match(/\.(\w+)$/) || [])[1]?.toLowerCase() || ''
const DOCS = /^(pdf|docx?|pages|txt|rtf|odt|xlsx?|numbers|csv|pptx?|key|fdx|fountain|celtx|md)$/
const folderOf = (m) => {
  const f = m.file || {}, t = f.type || '', e = EXT(f)
  if (m.kind === 'image' || /^image\//.test(t) || /^(jpe?g|png|heic|webp|gif|tiff?|dng|raw|psd)$/.test(e)) return 'photos'
  if (/^video\//.test(t) || /^(mov|mp4|m4v|avi|mkv|mxf|braw|r3d)$/.test(e)) return 'videos'
  if (/^audio\//.test(t) || /^(wav|mp3|m4a|aiff?|flac|ogg)$/.test(e)) return 'audio'
  if (DOCS.test(e) || /pdf|word|text|sheet|presentation/.test(t)) return 'docs'
  return 'other'
}
const FOLDERS = [['docs', 'Documents'], ['photos', 'Photos'], ['videos', 'Videos'], ['audio', 'Audio'], ['other', 'Other']]
const tagOf = (m) => (EXT(m.file) || (m.kind === 'image' ? 'jpg' : 'file')).slice(0, 4).toUpperCase()
const sizeText = (n) => (!n ? '' : n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

function useRoomFiles(roomId) {
  const [files, setFiles] = useState(null)
  useEffect(() => {
    let gone = false
    setFiles(null)
    supabase.from('roar_messages').select('id, user_id, kind, file, created_at').eq('room_id', roomId).in('kind', ['image', 'file'])
      .is('deleted_at', null).order('created_at', { ascending: false }).limit(400)
      .then(({ data }) => { if (!gone) setFiles((data || []).filter((m) => m.file?.path && !m.file.round && !m.file.groupcall)) })
    return () => { gone = true }
  }, [roomId])
  return files
}

function Thumb({ m }) {
  const [src, setSrc] = useState('')
  const pic = folderOf(m) === 'photos' || m.file?.thumb
  useEffect(() => {
    let gone = false
    if (pic) picLink(m.file).then((u) => { if (!gone && u) setSrc(u) }).catch(() => {})
    return () => { gone = true }
  }, [m.id])
  return <i className={`prj-tag prj-k-${folderOf(m)}`}>{src ? <img src={src} alt="" /> : tagOf(m)}</i>
}

function Files({ files, onJump }) {
  const [open, setOpen] = useState('')
  if (!files) return <p className="prj-quiet">Loading…</p>
  if (!files.length) return <p className="prj-quiet">Nothing shared yet. Files and photos sent here gather in folders.</p>
  const by = Object.fromEntries(FOLDERS.map(([k]) => [k, files.filter((m) => folderOf(m) === k)]))
  return (
    <div className="prj-folders">
      {FOLDERS.filter(([k]) => by[k].length).map(([k, label]) => (
        <div key={k} className={`prj-folder${open === k ? ' open' : ''}`}>
          <button type="button" className="prj-frow" onClick={() => setOpen(open === k ? '' : k)}>
            <span className={`prj-fico prj-k-${k}`}>{I.folder}</span><b>{label}</b><small>{by[k].length}</small><span className="prj-car">{I.right}</span>
          </button>
          {open === k && (
            <div className="prj-flist">
              {by[k].slice(0, 60).map((m) => (
                <button key={m.id} type="button" className="prj-file" onClick={() => onJump(m.id)} title="Show in chat">
                  <Thumb m={m} /><span className="prj-ftext"><b>{m.file.name || (m.kind === 'image' ? 'Photo' : 'File')}</b><small>{[sizeText(m.file.size), new Date(m.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })].filter(Boolean).join(' · ')}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ---------- a section that folds ---------- */
function Section({ id, title, count, children, extra }) {
  const key = `roarme-pro-${id}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0' } catch { return true } })
  const flip = () => { setOpen(!open); try { localStorage.setItem(key, open ? '0' : '1') } catch { /* private window */ } }
  return (
    <section className={`prj-sec${open ? ' open' : ''}`}>
      <div className="prj-sechead">
        <button type="button" className="prj-secbtn" onClick={flip}><span className="prj-car">{I.right}</span><span>{title}</span>{count != null && <small>{count}</small>}</button>
        {extra}
      </div>
      {open && <div className="prj-secbody">{children}</div>}
    </section>
  )
}

/* ---------- text that saves when it lets go ---------- */
function Field({ value, onSave, placeholder, area = false, className = '' }) {
  const [v, setV] = useState(value || '')
  const ref = useRef(null)
  useEffect(() => { if (document.activeElement !== ref.current) setV(value || '') }, [value])
  useEffect(() => { if (area && ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${ref.current.scrollHeight}px` } }, [v, area])
  const done = () => { if ((v || '') !== (value || '')) onSave(v) }
  const P = { ref, value: v, placeholder, className, onChange: (e) => setV(e.target.value), onBlur: done, onKeyDown: (e) => { if (e.key === 'Enter' && (!area || e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { setV(value || ''); setTimeout(() => e.target.blur()) } } }
  return area ? <textarea rows={2} {...P} /> : <input {...P} />
}

/* ---------- tasks ---------- */
const TASK_COLS = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']]
function Tasks({ list, onChange }) {
  const [add, setAdd] = useState('')
  const put = (next) => onChange(next)
  const step = (t) => put(list.map((x) => (x.id === t.id ? { ...x, s: x.s === 'todo' ? 'doing' : x.s === 'doing' ? 'done' : 'todo' } : x)))
  return (
    <div className="prj-tasks">
      <form className="prj-add" onSubmit={(e) => { e.preventDefault(); const t = add.trim(); if (!t) return; put([...list, { id: uid(), t: t.slice(0, 200), s: 'todo' }]); setAdd('') }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a task" maxLength={200} />
        <button type="submit" className="round" aria-label="Add task" disabled={!add.trim()}>{I.plus}</button>
      </form>
      {TASK_COLS.map(([s, label]) => {
        const rows = list.filter((t) => t.s === s)
        if (!rows.length) return null
        return (
          <div key={s} className={`prj-tcol prj-t-${s}`}>
            <h5>{label}<small>{rows.length}</small></h5>
            {rows.map((t) => (
              <div key={t.id} className="prj-task">
                <button type="button" className="prj-tick" onClick={() => step(t)} aria-label={`Move to ${s === 'todo' ? 'Doing' : s === 'doing' ? 'Done' : 'To do'}`} title={s === 'todo' ? 'Start' : s === 'doing' ? 'Done' : 'Back to To do'}>{s === 'done' ? I.check : s === 'doing' ? <i className="prj-half" /> : null}</button>
                <span className="prj-ttext">{t.t}</span>
                <button type="button" className="prj-tdel" onClick={() => put(list.filter((x) => x.id !== t.id))} aria-label="Delete task" title="Delete">{I.x}</button>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- the panel ---------- */
function ProInner({ room, other, project, kit, rooms, titleOf, toast, onJump, onOpenRoom }) {
  const files = useRoomFiles(room.room_id)
  const save = (patch) => kit.save(room.room_id, patch).catch((e) => toast(errText(e)))

  if (room.kind !== 'group') {
    const together = rooms.filter((r) => r.kind === 'group' && kit.map[r.room_id] && other && (r.members || []).includes(other.id))
    return (
      <>
        <Section id="together" title="Projects together" count={together.length}>
          {together.length ? together.map((r) => (
            <button key={r.room_id} type="button" className="prj-link" onClick={() => onOpenRoom(r.room_id)}><b>{titleOf(r)}</b><ProChip p={kit.map[r.room_id]} /></button>
          )) : <p className="prj-quiet">No projects with {other ? nameOf(other).split(' ')[0] : 'them'} yet.</p>}
        </Section>
        <Section id="files" title="Shared files" count={files?.length}><Files files={files} onJump={onJump} /></Section>
      </>
    )
  }

  if (!project) {
    return (
      <>
        <div className="prj-make">
          <span className="prj-make-ico">{I.folder}</span>
          <b>Make this group a project</b>
          <p>A stage, a due date, a brief, its files in folders and its tasks, beside the chat. The chat stays as it is.</p>
          <button type="button" className="btn btn-main" onClick={() => save({ status: 'prep', fields: FIELD_START.map((k) => ({ k, v: '' })) })}>Make It a Project</button>
        </div>
        <Section id="files" title="Files" count={files?.length}><Files files={files} onJump={onJump} /></Section>
      </>
    )
  }

  const fields = Array.isArray(project.fields) ? project.fields : []
  const tasks = Array.isArray(project.tasks) ? project.tasks : []
  const setField = (i, patch) => save({ fields: fields.map((f, n) => (n === i ? { ...f, ...patch } : f)) })
  const done = tasks.filter((t) => t.s === 'done').length
  return (
    <>
      <div className="prj-top">
        <div className="prj-stages" role="radiogroup" aria-label="Stage">
          {STAGES.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={project.status === k} className={`prj-stage prj-${k}${project.status === k ? ' on' : ''}`} onClick={() => save({ status: k })}>{label}</button>)}
        </div>
        <label className="prj-due"><span>{I.calendar}</span><span>Due</span><input type="date" value={project.due || ''} onChange={(e) => save({ due: e.target.value || null })} /></label>
      </div>
      <Section id="brief" title="Brief">
        <Field area className="prj-brief" value={project.brief} placeholder="What it is, where, when, the look…" onSave={(v) => save({ brief: v.slice(0, 4000) })} />
        <div className="prj-kv">
          {fields.map((f, i) => (
            <div key={i} className="prj-kvrow">
              <Field className="prj-k" value={f.k} placeholder="Field" onSave={(k) => setField(i, { k: k.slice(0, 40) })} />
              <Field className="prj-v" value={f.v} placeholder="—" onSave={(v) => setField(i, { v: v.slice(0, 200) })} />
              <button type="button" className="prj-kvdel" onClick={() => save({ fields: fields.filter((_, n) => n !== i) })} aria-label="Remove field" title="Remove">{I.x}</button>
            </div>
          ))}
          {fields.length < 20 && <button type="button" className="pill-btn prj-kvadd" onClick={() => save({ fields: [...fields, { k: '', v: '' }] })}>{I.plus}<span>Add Field</span></button>}
        </div>
      </Section>
      <Section id="files" title="Files" count={files?.length}><Files files={files} onJump={onJump} /></Section>
      <Section id="tasks" title="Tasks" count={tasks.length ? `${done}/${tasks.length}` : null}><Tasks list={tasks} onChange={(next) => save({ tasks: next })} /></Section>
      <button type="button" className="pill-btn prj-unmake" onClick={() => { if (window.confirm('Stop this group being a project? Its stage, brief, fields and tasks are deleted; the chat stays.')) kit.remove(room.room_id).catch((e) => toast(errText(e))) }}>Stop Being a Project</button>
    </>
  )
}

/* the panel's width follows its left edge (Alex, 22 Nov: "this window should be dragged wider or narrower, left and right"):
   kept on the device, a double click puts it back */
const PRJ_W = 330
const prjMax = () => Math.max(300, Math.min(640, window.innerWidth - 760))
export function ProPanel(props) {
  const [w, setW] = useState(() => { try { return Number(localStorage.getItem('roarme-pro-w')) || PRJ_W } catch { return PRJ_W } })
  const keep = (v) => { try { localStorage.setItem('roarme-pro-w', String(Math.round(v))) } catch { /* private window */ } }
  const drag = (e) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = w
    let last = w0
    document.documentElement.classList.add('prj-dragging')
    const move = (ev) => { last = Math.max(260, Math.min(prjMax(), w0 + (x0 - ev.clientX))); setW(last) }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.documentElement.classList.remove('prj-dragging'); keep(last) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="prj-wrap" style={{ width: Math.min(w, prjMax()) }}>
      <span className="prj-grip" onPointerDown={drag} onDoubleClick={() => { setW(PRJ_W); keep(PRJ_W) }} title="Drag to widen or narrow, double-click to reset" />
      <aside className="prj"><ProInner {...props} /></aside>
    </div>
  )
}
