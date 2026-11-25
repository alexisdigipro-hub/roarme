// The hub's Calendar's own helpers, copied from THEMADLIONS Projects (src/lib/dates.js and the parsing half of
// src/lib/ical.js), so RoarMe draws the month, the Greek holidays and the calendar feeds exactly as the hub does (Alex, 25 Nov).
// Keep in step with those files.
export function pad(n) {
  return String(n).padStart(2, '0')
}

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromISODate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso, n) {
  const d = fromISODate(iso)
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return ''
  return fromISODate(iso).toLocaleDateString('en-GB', opts)
}

export function fmtLong(iso) {
  return fmtDate(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** Returns 6 weeks x 7 days grid starting on Monday for the month containing `iso`. */
export function monthGrid(year, month, weekStart = 'monday') {
  const shift = weekStart === 'sunday' ? 0 : 6
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + shift) % 7
  const start = new Date(year, month, 1 - startOffset)
  const days = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    // dow: 5 and 6 are always the weekend columns' indices for Monday start; for Sunday start weekend is 0 and 6
    days.push({ iso: toISODate(d), inMonth: d.getMonth() === month, dow: (d.getDay() + shift) % 7, weekend: d.getDay() === 0 || d.getDay() === 6 })
  }
  return days
}

export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function weekdayShort(weekStart = 'monday') {
  return weekStart === 'sunday' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}
export function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31)
  const day = ((d + e + 114) % 31) + 1
  // Read back in UTC, not local time: toISODate() reads local fields, which lands a day early
  // for anyone west of Greenwich and would move every movable holiday with it.
  const easter = new Date(Date.UTC(year, month - 1, day) + (year < 2100 ? 13 : 14) * 86400000)
  return `${easter.getUTCFullYear()}-${pad(easter.getUTCMonth() + 1)}-${pad(easter.getUTCDate())}`
}

// The days Greece does not work. Movable ones hang off Easter.
export function greekHolidays(year) {
  const easter = orthodoxEaster(year)
  const off = (n) => addDays(easter, n)
  return {
    [`${year}-01-01`]: 'New Year',
    [`${year}-01-06`]: 'Epiphany',
    [off(-48)]: 'Clean Monday',
    [`${year}-03-25`]: 'Independence Day',
    [off(-2)]: 'Good Friday',
    [easter]: 'Easter Sunday',
    [off(1)]: 'Easter Monday',
    [`${year}-05-01`]: 'Labour Day',
    [off(50)]: 'Holy Spirit Monday',
    [`${year}-08-15`]: 'Assumption',
    [`${year}-10-28`]: 'Ohi Day',
    [`${year}-12-25`]: 'Christmas',
    [`${year}-12-26`]: 'Boxing Day',
  }
}

// Holiday name for one date, or '' when it is an ordinary day.
export function holidayName(iso, on = true) {
  if (!on || !/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return ''
  return greekHolidays(Number(iso.slice(0, 4)))[iso] || ''
}

// ---- calendar feeds (.ics), from src/lib/ical.js: the texts come through roar-hub / hub-bridge cal.get
export const FEED_COLOR = '#6C9BD1'
/* Settings > Integrations > Calendar feeds: [{ id, name, url, color, off }] */
export const feedsOf = (settings) => (settings?.calendarFeeds || []).filter((f) => f && f.url)
/* `calendarFeedsOff` is the one switch over all of them: the Calendar page then reads nothing,
   draws nothing and says nothing, while the addresses stay where they are. */
export const feedsAreOff = (settings) => settings?.calendarFeedsOff === true
export const liveFeeds = (settings) => (feedsAreOff(settings) ? [] : feedsOf(settings).filter((f) => !f.off))

/* ---------------------------------------------------------------- parsing */

/* RFC 5545 folds long lines by starting the next one with a space or tab. Unfold first, or a
   summary breaks in half mid-word. */
const unfold = (text) => String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n')

/* NAME;PARAM=value;PARAM2="a:b":the value — the first colon outside quotes ends the head. */
function prop(line) {
  let at = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) { at = i; break }
  }
  if (at < 0) return null
  const [name, ...rest] = line.slice(0, at).split(';')
  const params = {}
  for (const seg of rest) {
    const eq = seg.indexOf('=')
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase().trim(), params, value: line.slice(at + 1) }
}

const unescape = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

/* "20261010" | "20261010T180000" | "20261010T150000Z" -> { date, time }. A Z time is the real
   instant, so it is moved to this device's clock; anything else is already a wall clock time
   (Google writes TZID=Europe/Athens for a calendar kept in Athens). */
export function parseWhen(value, params = {}) {
  const v = String(value || '').trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(v)
  if (!m) return null
  const [, y, mo, d, hh, mi, , z] = m
  if (params.VALUE === 'DATE' || hh === undefined) return { date: iso(+y, +mo, +d), time: '' }
  if (z) {
    const at = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi))
    return { date: iso(at.getFullYear(), at.getMonth() + 1, at.getDate()), time: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
  }
  return { date: iso(+y, +mo, +d), time: `${hh}:${mi}` }
}

const dayMs = 86400000
const toUTC = (isoDate) => Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10))
const fromUTC = (ms) => { const d = new Date(ms); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) }
const icsAddDays = (isoDate, n) => fromUTC(toUTC(isoDate) + n * dayMs)
const weekday = (isoDate) => new Date(toUTC(isoDate)).getUTCDay() // 0 Sun … 6 Sat
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRule(value) {
  const out = {}
  for (const part of String(value || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1)
  }
  return out
}

/* The dates a repeating event falls on inside [from, to]. A deliberate subset of RFC 5545:
   every day / week (with BYDAY) / month / year, with INTERVAL, COUNT and UNTIL. Rules like
   "the second Tuesday of the month" fall back to the day of the month the series starts on,
   which is what most calendars mean anyway. */
export function occurrences(startDate, rule, from, to, cap = 400) {
  const freq = String(rule.FREQ || '').toUpperCase()
  if (!freq) return [startDate]
  const step = Math.max(1, Number(rule.INTERVAL) || 1)
  const until = rule.UNTIL ? parseWhen(rule.UNTIL)?.date : ''
  const count = Number(rule.COUNT) || 0
  const stop = until && until < to ? until : to
  const out = []
  let made = 0 // occurrences since the series began, so COUNT is counted from its real start
  // A daily series that began years ago needs thousands of steps before it reaches the window,
  // so the walk is bounded separately from how many events can come out of it.
  let guard = 20000

  const take = (d) => { if (d >= from && d >= startDate && out.length < cap) out.push(d) }

  if (freq === 'WEEKLY') {
    const days = String(rule.BYDAY || '').split(',').map((x) => WEEKDAYS[x.trim().slice(-2).toUpperCase()]).filter((n) => n !== undefined)
    const wanted = (days.length ? days : [weekday(startDate)]).slice().sort()
    let weekStart = icsAddDays(startDate, -((weekday(startDate) - 1 + 7) % 7)) // the Monday of the first week
    while (weekStart <= stop && guard-- > 0 && out.length < cap) {
      for (const wd of wanted) {
        const d = icsAddDays(weekStart, (wd - 1 + 7) % 7)
        if (d < startDate) continue
        if (count && made >= count) return out
        if (d > stop) break
        made += 1
        take(d)
      }
      weekStart = icsAddDays(weekStart, 7 * step)
    }
    return out
  }

  let d = startDate
  while (d <= stop && guard-- > 0 && out.length < cap && (!count || made < count)) {
    made += 1
    take(d)
    if (freq === 'DAILY') d = icsAddDays(d, step)
    else if (freq === 'MONTHLY') {
      const first = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1 + step, 1))
      const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
      d = iso(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(+startDate.slice(8, 10), last))
    } else if (freq === 'YEARLY') d = iso(+d.slice(0, 4) + step, +d.slice(5, 7), +d.slice(8, 10))
    else break
  }
  return out
}

/* An .ics file -> the app's events, one per occurrence inside [from, to] (ISO dates). */
export function parseIcs(text, { from, to, feed = {} } = {}) {
  const raw = []
  let cur = null
  for (const line of unfold(text)) {
    const p = prop(line)
    if (!p) continue
    if (p.name === 'BEGIN' && p.value === 'VEVENT') { cur = { exdates: [] }; continue }
    if (p.name === 'END' && p.value === 'VEVENT') { if (cur) raw.push(cur); cur = null; continue }
    if (!cur) continue
    switch (p.name) {
      case 'UID': cur.uid = p.value.trim(); break
      case 'SUMMARY': cur.title = unescape(p.value); break
      case 'LOCATION': cur.locationText = unescape(p.value); break
      case 'DESCRIPTION': cur.notes = unescape(p.value); break
      case 'STATUS': cur.status = p.value.trim().toUpperCase(); break
      case 'TRANSP': break
      case 'DTSTART': cur.start = parseWhen(p.value, p.params); break
      case 'DTEND': cur.end = parseWhen(p.value, p.params); break
      case 'RRULE': cur.rule = parseRule(p.value); break
      case 'RECURRENCE-ID': cur.recurrenceId = parseWhen(p.value, p.params)?.date || ''; break
      case 'EXDATE': for (const one of p.value.split(',')) { const w = parseWhen(one, p.params); if (w) cur.exdates.push(w.date) } break
      default: break
    }
  }

  // An occurrence changed on its own (RECURRENCE-ID) comes as its own VEVENT; the series must
  // not also draw the original on that date.
  const moved = new Set()
  for (const e of raw) if (e.recurrenceId && e.uid) moved.add(`${e.uid}@${e.recurrenceId}`)

  const out = []
  for (const e of raw) {
    if (!e.start || e.status === 'CANCELLED') continue
    const allDay = !e.start.time
    // DTEND is exclusive for all-day events: a one-day event ends the next morning.
    const endDate = e.end ? (allDay ? icsAddDays(e.end.date, -1) : e.end.date) : e.start.date
    const span = Math.max(0, Math.round((toUTC(endDate) - toUTC(e.start.date)) / dayMs))
    const dates = e.rule && !e.recurrenceId ? occurrences(e.start.date, e.rule, from, to) : [e.start.date]
    for (const date of dates) {
      if (e.exdates.includes(date)) continue
      if (e.uid && !e.recurrenceId && moved.has(`${e.uid}@${date}`)) continue
      const last = span ? icsAddDays(date, span) : ''
      if ((last || date) < from || date > to) continue
      out.push({
        id: `feed:${feed.id || 'x'}:${e.uid || date}:${date}`,
        feed: true,
        feedId: feed.id || '',
        feedName: feed.name || 'Calendar feed',
        type: 'feed',
        projectId: '',
        title: e.title || '(untitled)',
        date,
        endDate: last,
        start: e.start.time || '',
        end: e.end?.time || '',
        locationText: e.locationText || '',
        notes: e.notes || '',
        createdByName: feed.name || 'Calendar feed',
      })
    }
  }
  return out
}

