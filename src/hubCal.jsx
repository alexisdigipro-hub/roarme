// The hub's Calendar in a PROject's Overview, above the Team (Alex, 25 Nov: "exactly the TML Hub's calendar, its
// calendars and what it does, talking to it; the phone's form, on the phone and the computer"). The same month with its
// dots, the picked day's list, All types, Not available (⊘) and + (add), the same event window, drawn in the
// Workspace's glass. Everything goes through roar-hub cal.get / cal.put / cal.delete to the hub's hub-bridge, as the person
// whose RoarMe email is a member of that hub sees it: the hub's types and who sees which calendar, their project access,
// their own days off, the hub's calendar feeds (Google calendars). Someone who is not in the hub sees only this project's
// events and cannot change them. The month, holidays and feeds are drawn by the hub's own code (hubCalLib.js).
import { useEffect, useMemo, useState } from 'react'
import { Modal } from './ui.jsx'
import { hubCall, hubState } from './hub.jsx'
import { keepKv, keptKv, readKv } from './cache.js'
import { addDays, fmtDate, holidayName, monthGrid, monthLabel, parseIcs, toISODate, weekdayShort } from './hubCalLib.js'

const FEED_KEEP = 30 * 60e3 // the feeds are read at most every half hour, as the hub does (Google refuses calendars read too often)
const FEED_COLOR = '#6C9BD1'
const todayIso = () => toISODate(new Date())
const uid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const allDayOf = (d) => (d.allDay != null ? d.allDay : !d.start && !d.end)
const mapsHref = (v) => {
  const t = String(v || '').trim()
  if (/^https?:\/\/\S*(google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(t)) return t
  return t ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(t)}` : 'https://www.google.com/maps'
}
const NO_I = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></svg>
const PLUS_I = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
const MAP_I = <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" /><path d="M9 4v14M15 6v14" /></svg>
const CHEV = (d) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>

export function HubCalendar({ room }) {
  const [tied, setTied] = useState(null)
  useEffect(() => { let gone = false; hubState(room).then((s) => { if (!gone) setTied(!!s?.project) }, () => { if (!gone) setTied(false) }); return () => { gone = true } }, [room])
  if (!tied) return null
  return <Cal room={room} />
}

function Cal({ room }) {
  const K = `hcal:${room}`
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [sel, setSel] = useState(todayIso)
  const [data, setData] = useState(() => keptKv(K) || null)
  const [feeds, setFeeds] = useState(() => keptKv(`${K}:f`) || null) // { at, list: [{ id, name, color, text }] }
  const [err, setErr] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [year, setYear] = useState(now.getFullYear()) // the events are asked a year either side of this
  const load = async (wantFeeds) => {
    try {
      const j = await hubCall({ action: 'cal.get', room, from: `${year - 1}-01-01`, to: `${year + 1}-12-31`, feeds: !!wantFeeds })
      if (j?.error) throw new Error(j.error)
      const { feeds: f, ...rest } = j
      setData(rest); keepKv(K, rest); setErr('')
      if (wantFeeds) { const v = { at: Date.now(), list: (f || []).map((x) => ({ id: x.id, name: x.name, color: x.color, text: x.text || '', error: x.error || '' })) }; setFeeds(v); keepKv(`${K}:f`, v) }
      else if (f?.length) setFeeds((old) => old || { at: 0, list: f })
    } catch (e) { setErr(e.message || 'The hub did not answer') }
  }
  useEffect(() => {
    let gone = false
    ;(async () => {
      if (!data) { const v = await readKv(K); if (!gone && v) setData((d) => d || v) }
      const f = feeds || await readKv(`${K}:f`)
      if (!gone && f && !feeds) setFeeds(f)
      if (!gone) load(!f || Date.now() - (f.at || 0) > FEED_KEEP)
    })()
    return () => { gone = true }
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ym.y !== year) setYear(ym.y) }, [ym.y]) // eslint-disable-line react-hooks/exhaustive-deps

  const me = data?.me || null
  const isAdmin = !!me?.admin
  const editable = !!me?.edit
  const canMarkOff = !!me
  const canEditDraft = (d) => (!me || d?.feed ? false : d?.type === 'unavailable' ? isAdmin || d.personId === me.id : editable)
  const allTypes = data?.types || []
  const typeOf = (k) => allTypes.find((t) => t.key === k) || { key: k, label: 'Other', color: '#9AA0A6' }
  const feedList = (feeds?.list || []).filter((f) => (data?.feeds || feeds?.list || []).some((x) => x.id === f.id))
  const feedById = Object.fromEntries(feedList.map((f) => [f.id, f]))
  const colorOf = (e) => (e.feed ? feedById[e.feedId]?.color || FEED_COLOR : typeOf(e.type).color)
  const labelOf = (e) => (e.feed ? e.feedName || 'Calendar feed' : typeOf(e.type).label)
  const projName = (id) => data?.projects?.find((p) => p.id === id)?.title || ''
  const personLabel = (e) => e.personName || e.createdByName || e.title
  const legendTypes = [...allTypes, ...feedList.map((f) => ({ key: `feed:${f.id}`, label: f.name || 'Calendar feed', color: f.color || FEED_COLOR }))]
  const feedEvents = useMemo(() => {
    const from = `${year - 1}-01-01`, to = `${year + 1}-12-31`
    return feedList.flatMap((f) => (f.text ? parseIcs(f.text, { from, to, feed: f }) : []))
  }, [feeds, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => [...(data?.events || []), ...feedEvents].filter((e) => {
    if (typeFilter.startsWith('feed:')) return e.feedId === typeFilter.slice(5)
    if (typeFilter !== 'all') return e.type === typeFilter
    return !(e.type === 'unavailable' && isAdmin) // the hub's phone: an administrator sees days off when picked
  }), [data, feedEvents, typeFilter, isAdmin])
  const byDate = useMemo(() => {
    const m = {}
    for (const e of events) {
      if (e.endDate && e.endDate > e.date) { let d = e.date, guard = 0; while (d <= e.endDate && guard < 60) { (m[d] = m[d] || []).push(e); d = addDays(d, 1); guard += 1 } }
      else (m[e.date] = m[e.date] || []).push(e)
    }
    for (const k in m) m[k].sort((a, b) => (a.start || '').localeCompare(b.start || ''))
    return m
  }, [events])

  const weekStart = data?.weekStart || 'monday'
  const grid = monthGrid(ym.y, ym.m, weekStart)
  const holiday = (iso) => holidayName(iso, data?.greekHolidays !== false)
  const shift = (n) => { const d = new Date(ym.y, ym.m + n, 1); setYm({ y: d.getFullYear(), m: d.getMonth() }) }
  const goToday = () => { setYm({ y: now.getFullYear(), m: now.getMonth() }); setSel(todayIso()) }
  const t0 = todayIso()
  const dayItems = byDate[sel] || []

  const firstType = () => allTypes.find((t) => t.key !== 'unavailable' && t.key !== 'google')?.key || 'meeting'
  const newEvent = (date, type = firstType()) => ({ id: uid(), projectId: type === 'unavailable' ? '' : data?.project || '', type, title: '', date, endDate: '', start: '', end: '', locationText: '', notes: '', personId: type === 'unavailable' && !isAdmin ? me?.id || '' : '', personName: type === 'unavailable' && !isAdmin ? me?.name || '' : '', isNew: true })
  const save = async () => {
    if (draft.type === 'unavailable' && !draft.personId) { setErr('Pick who is not available.'); return }
    if (draft.type !== 'unavailable' && !draft.title.trim()) { setErr('Give the event a title.'); return }
    if (draft.endDate && draft.endDate < draft.date) { setErr('End date is before the start.'); return }
    const { isNew, ...ev } = { ...draft, ...(allDayOf(draft) ? { start: '', end: '', allDay: true } : { allDay: false }), title: draft.type === 'unavailable' ? `${draft.personName || 'Someone'} not available` : draft.title }
    setBusy(true); setErr('')
    try {
      const j = await hubCall({ action: 'cal.put', room, event: ev })
      if (j?.error) throw new Error(j.error)
      const saved = j.event || ev
      setData((d) => { const n = { ...d, events: [...(d?.events || []).filter((x) => x.id !== saved.id), saved] }; keepKv(K, n); return n })
      setDraft(null)
    } catch (e) { setErr(e.message || 'Not saved') }
    setBusy(false)
  }
  const remove = async () => {
    if (!window.confirm('Delete this event?')) return
    setBusy(true); setErr('')
    try {
      const j = await hubCall({ action: 'cal.delete', room, id: draft.id })
      if (j?.error) throw new Error(j.error)
      setData((d) => { const n = { ...d, events: (d?.events || []).filter((x) => x.id !== draft.id) }; keepKv(K, n); return n })
      setDraft(null)
    } catch (e) { setErr(e.message || 'Not deleted') }
    setBusy(false)
  }

  const typeOptions = (d) => allTypes.filter((t) => t.key === d.type || ((t.key !== 'google' || d.type === 'google') && (t.key !== 'unavailable' || isAdmin)))
  const ro = draft && !canEditDraft(draft)
  return (
    <div className="prw-box hcal">
      {/* the hub's phone row: the type menu, then Not available as a round no-entry sign and Add event as a round + */}
      <div className="hcal-top">
        <label className="hcal-types">
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event types">
            <option value="all">All types</option>
            {legendTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          {CHEV('M6 9l6 6 6-6')}
        </label>
        {canMarkOff && <button type="button" className="round hcal-round" aria-label="Not available" title="Not available" onClick={() => setDraft(newEvent(sel || t0, 'unavailable'))}>{NO_I}</button>}
        {editable && <button type="button" className="round hcal-round hcal-add" aria-label="Add event" title="Add event" onClick={() => setDraft(newEvent(sel || t0))}>{PLUS_I}</button>}
      </div>
      <div className="hcal-card">
        <div className="hcal-nav">
          <button type="button" className="round hcal-arrow" onClick={() => shift(-1)} aria-label="Previous month">{CHEV('M15 5l-7 7 7 7')}</button>
          <button type="button" className="hcal-month" onClick={goToday} title="Back to today">{monthLabel(ym.y, ym.m)}</button>
          <button type="button" className="round hcal-arrow" onClick={() => shift(1)} aria-label="Next month">{CHEV('M9 5l7 7-7 7')}</button>
        </div>
        <div className="hcal-grid">
          {weekdayShort(weekStart).map((d) => <span key={d} className="hcal-dow">{d[0]}</span>)}
          {grid.map((d) => {
            const its = byDate[d.iso] || []
            const hol = holiday(d.iso)
            return (
              <button key={d.iso} type="button" className={`hcal-cell${d.inMonth ? '' : ' dim'}${d.iso === t0 ? ' today' : ''}${d.iso === sel ? ' sel' : ''}${d.weekend ? ' weekend' : ''}${hol ? ' holiday' : ''}`}
                onClick={() => setSel(d.iso)} title={hol || undefined} aria-label={`${fmtDate(d.iso, { weekday: 'long', day: 'numeric', month: 'long' })}${hol ? `, ${hol}` : ''}`}>
                <span className="hcal-day">{Number(d.iso.slice(8))}</span>
                <span className="hcal-dots">{its.slice(0, 3).map((e, i) => <i key={i} style={{ background: colorOf(e) }} />)}</span>
              </button>
            )
          })}
        </div>
        <div className="hcal-list">
          <div className="hcal-sel">{sel === t0 ? `Today · ${fmtDate(sel, { weekday: 'short', day: 'numeric', month: 'short' })}` : fmtDate(sel, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {!data && !err ? <p className="hcal-none">Getting the hub's calendar…</p>
            : !dayItems.length ? <p className="hcal-none">Nothing on this day.</p>
            : <ul className="hcal-evs">{dayItems.map((e) => (
              <li key={`${e.id}|${sel}`}>
                <button type="button" className="hcal-ev" style={{ '--ev': colorOf(e) }} onClick={() => setDraft({ ...e })}>
                  <span className="hcal-ev-time">{e.start || (e.endDate && e.endDate > e.date ? 'Days' : 'All day')}</span>
                  <span className="hcal-ev-main">
                    <span className="hcal-ev-title">{e.type === 'unavailable' ? `${personLabel(e)} not available` : e.title}</span>
                    <span className="hcal-ev-sub">{[e.projectId ? projName(e.projectId) : '', e.type !== 'unavailable' ? labelOf(e) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}</ul>}
          {err && !draft && <p className="hcal-err">{err}</p>}
          {data && !me && <p className="hcal-none">Only this project's events: your email is not a member of the hub.</p>}
          {(feeds?.list || []).filter((f) => f.error).map((f) => <p key={f.id} className="hcal-err">{f.name}: {f.error}</p>)}
        </div>
      </div>

      {draft && (
        <Modal title={draft.isNew ? 'New event' : 'Event'} onClose={() => { setDraft(null); setErr('') }}
          foot={ro ? <button type="button" className="pill-btn" onClick={() => setDraft(null)}>Close</button> : <div className="hcal-foot">
            {!draft.isNew && <button type="button" className="round hcal-del" aria-label="Delete" title="Delete" disabled={busy} onClick={remove}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button>}
            <span className="hcal-sp" />
            <button type="button" className="pill-btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn btn-main" disabled={busy} onClick={save}>{busy ? 'Saving…' : draft.isNew ? 'Add event' : 'Save event'}</button>
          </div>}>
          <div className="hcal-form">
            {draft.feed ? <p className="hcal-hint">From <b>{draft.feedName}</b>, a calendar the hub only reads. Change it in that calendar.</p>
              : draft.createdByName && <p className="hcal-hint">Added by {draft.createdByName}</p>}
            {draft.type === 'unavailable' ? (
              <label className="hcal-f"><span>Who is not available</span>
                <select value={draft.personId || ''} disabled={!isAdmin || ro} onChange={(e) => setDraft({ ...draft, personId: e.target.value, personName: data?.people?.find((p) => p.id === e.target.value)?.name || '' })}>
                  {isAdmin ? [<option key="" value="">Pick a person</option>, ...(data?.people || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)] : <option value={draft.personId || ''}>{draft.personName || 'Someone'}</option>}
                </select>
              </label>
            ) : (
              <label className="hcal-f"><span>Title</span><input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} disabled={ro} autoFocus={draft.isNew} /></label>
            )}
            {!draft.feed && <div className="hcal-two">
              <label className="hcal-f"><span>Type</span>
                <select value={draft.type} disabled={ro || (draft.type === 'unavailable' && !isAdmin)} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>{typeOptions(draft).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
              </label>
              <label className="hcal-f"><span>Project</span>
                <select value={draft.projectId || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                  <option value="">No project</option>
                  {(data?.projects || []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </label>
            </div>}
            <div className="hcal-two">
              <label className="hcal-f"><span>{draft.type === 'unavailable' ? 'From' : 'Date'}</span><input type="date" value={draft.date || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              {draft.type === 'unavailable'
                ? <label className="hcal-f"><span>To (optional)</span><input type="date" value={draft.endDate || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></label>
                : <label className="hcal-f hcal-allday"><span>All day</span><span className="switch"><input type="checkbox" checked={allDayOf(draft)} disabled={ro} onChange={(e) => setDraft(e.target.checked ? { ...draft, allDay: true, start: '', end: '' } : { ...draft, allDay: false })} /><span /></span></label>}
            </div>
            {draft.type !== 'unavailable' && !allDayOf(draft) && (
              <div className="hcal-two">
                <label className="hcal-f"><span>Start</span><input type="time" value={draft.start || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></label>
                <label className="hcal-f"><span>End</span><input type="time" value={draft.end || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></label>
              </div>
            )}
            <label className="hcal-f"><span>Location</span>
              <span className="hcal-loc">
                <input value={draft.locationText || ''} disabled={ro} placeholder="Address, place or a Google Maps link" onChange={(e) => setDraft({ ...draft, locationText: e.target.value })} />
                <a className="round hcal-map" href={mapsHref(draft.locationText)} target="_blank" rel="noreferrer" aria-label={draft.locationText ? 'Directions in Google Maps' : 'Open Google Maps'} title={draft.locationText ? 'Directions in Google Maps' : 'Open Google Maps'}>{MAP_I}</a>
              </span>
            </label>
            <label className="hcal-f"><span>Notes</span><textarea rows={3} value={draft.notes || ''} disabled={ro} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            {draft.sourceDayId && <p className="hcal-hint">This event mirrors a shoot day from the hub's schedule. Change the date there to keep them in step.</p>}
            {draft.type === 'google' && draft.googleEventId && <p className="hcal-hint">Synced with Google Calendar in the hub: a change here reaches Google the next time the hub syncs.</p>}
            {err && <p className="hcal-err">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
