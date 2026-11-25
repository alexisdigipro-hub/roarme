import { SUPABASE_KEY, SUPABASE_URL, supabase } from './lib.js'

/* RoarTransfer on Cloudflare R2, as on roartransfer.com (Alex, 22 Oct: "the RoarTransfer in RoarMe the same as
   roartransfer.com"). The files go straight from here to R2 in 16 MB pieces, three at a time; the Edge Function
   roartransfer-r2 signs each piece and makes the links (supabase/functions/roartransfer-r2), so no key is ever here.
   Then one link for the whole upload (a bundle) with its title, message, password and an email when it is downloaded. */

const GB = 1024 ** 3
const PART = 16 * 1024 * 1024
const FN = `${SUPABASE_URL}/functions/v1/roartransfer-r2`
const VIA = `${SUPABASE_URL}/functions/v1/roartransfer-put` // a piece the long way round (supabase/functions/roartransfer-put)
export const PAGE = 'https://roartransfer.com/'
// the free choices, the same as roartransfer.com: 1 day up to 5 GB, 3 days up to 3 GB, 7 days up to 1 GB (Alex, 23 Oct);
// 1 day is the first, chosen and recommended one (eco)
export const PLANS = [{ days: 1, max: 5 * GB, eco: true }, { days: 3, max: 3 * GB }, { days: 7, max: 1 * GB }]
export const planOf = (days) => PLANS.find((p) => p.days === days) || PLANS[1]
// Pro (Alex, 25 Oct, as roartransfer-r2 PRO_GB): 1 day up to 50 GB, 3 days 40, 7 days 30, 30 days 20, no download limit
export const PRO_PLANS = [{ days: 1, max: 50 * GB, eco: true }, { days: 3, max: 40 * GB }, { days: 7, max: 30 * GB }, { days: 30, max: 20 * GB }]
export const PRICING = 'https://roartransfer.com/pricing/'
/* Is this RoarMe account Pro on RoarTransfer (the same account; Alex, 21 Nov: "it should know my account has Pro")?
   Asked of roartransfer-pro once a visit; { pro, until } */
let proAsk = null
export function transferPro() {
  if (!proAsk) {
    proAsk = (async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) return { pro: false }
      const r = await fetch(`${SUPABASE_URL}/functions/v1/roartransfer-pro`, { method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'me' }) })
      const d = await r.json().catch(() => ({}))
      return { pro: !!d.pro, until: d.until || null }
    })().catch(() => { proAsk = null; return { pro: false } })
  }
  return proAsk
}

async function bridge(body, note = '') {
  const { data } = await supabase.auth.getSession()
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  const r = await fetch(note ? `${FN}?${note}` : FN, { method: 'POST', headers, body: JSON.stringify(body) }) // note: how the upload went, readable in the function's own log (Alex, 24 Nov)
  let d = {}
  try { d = await r.json() } catch { /* not JSON */ }
  if (!r.ok) throw Object.assign(new Error(d.error === 'signed-out' ? 'Sign in again to send.' : d.error || `Error ${r.status}`), { fatal: r.status < 500 })
  return d
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))

/* an upload that can be followed and stopped: start(files, options) gives the bundle's link */
export function r2Transfer({ onProgress = () => {} } = {}) {
  let stopped = false
  let xhrs = []
  // a piece that has said nothing at all for a while is started again (Alex, 24 Nov: a 580 KB photo hung 13 s before
  // its first try gave up): 6 s, or longer for a big piece on a slow line (100 KB a second); any sign of life resets it
  const put = (url, body, onUp, headers = null) => new Promise((ok, no) => {
    if (stopped) { no(new Error('cancelled')); return }
    const x = new XMLHttpRequest()
    xhrs.push(x)
    const quiet = Math.max(6000, (body.size || body.byteLength || 0) / 100)
    let dog = 0
    const watch = () => { clearTimeout(dog); dog = setTimeout(() => { x.stalled = true; x.abort() }, quiet) }
    const drop = () => { clearTimeout(dog); xhrs = xhrs.filter((y) => y !== x) }
    x.open(headers ? 'POST' : 'PUT', url)
    if (headers) for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v)
    x.upload.onprogress = (e) => { watch(); onUp(e.loaded) }
    // every byte is out: now only the answer is awaited (R2 itself 15 s; through the Edge Function, which then sends the
    // piece on to R2, 90 s)
    x.upload.onload = () => { clearTimeout(dog); dog = setTimeout(() => { x.stalled = true; x.abort() }, headers ? 90000 : 15000) }
    x.onload = () => { drop(); ok(x) }
    x.onerror = () => { drop(); no(new Error('The connection dropped.')) }
    x.onabort = () => { drop(); no(new Error(x.stalled ? 'stalled' : 'cancelled')) }
    watch()
    x.send(body)
  })

  async function upOne(f, days, before) {
    const made = await bridge({ action: 'create', name: f.name || 'file', size: f.size, type: f.type || '', days })
    const n = Math.max(1, Math.ceil(f.size / PART))
    let next = 1
    const urls = {}, etags = {}, loaded = {}
    const t0 = Date.now()
    let retries = 0
    let why = '' // what went wrong last, for the function's log when the upload gives up
    const sum = () => Object.values(loaded).reduce((a, x) => a + x, 0)
    let signing = null // one signing request at a time, for the next 20 pieces
    // through the Edge Function instead of straight to R2, once a piece fails or hangs on the way there (Alex, 25 Nov:
    // from the iPhone's Safari a 277 KB photo reached R2 but R2's answer never came back and it hung at 100%)
    let via = false
    const viaPut = async (i, piece, onUp) => {
      const { data } = await supabase.auth.getSession()
      const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/octet-stream' }
      if (data.session) h.Authorization = `Bearer ${data.session.access_token}`
      const x = await put(`${VIA}?key=${encodeURIComponent(made.key)}&uploadId=${encodeURIComponent(made.uploadId)}&part=${i}`, piece, onUp, h)
      let d = {}
      try { d = JSON.parse(x.responseText || '{}') } catch { /* not JSON */ }
      return { status: x.status, etag: d.etag || '', error: d.error }
    }
    const urlFor = async (i) => {
      while (!urls[i]) {
        if (!signing) {
          const want = []
          for (let k = i; k <= Math.min(n, i + 19); k++) if (!urls[k] && !etags[k]) want.push(k)
          signing = bridge({ action: 'sign', key: made.key, uploadId: made.uploadId, parts: want })
            .then((got) => { Object.assign(urls, got.urls) })
            .finally(() => { signing = null })
        }
        await signing
      }
      return urls[i]
    }
    const worker = async () => {
      for (;;) {
        if (stopped) throw new Error('cancelled')
        const i = next++
        if (i > n) return
        const from = (i - 1) * PART
        // the piece is read into memory first and its bytes are sent (Alex, 24 Nov: on the iPhone a picked file the
        // system no longer lets us read failed six times as "The connection dropped"); a file that cannot be read says so
        let piece
        try { piece = await f.slice(from, Math.min(from + PART, f.size)).arrayBuffer() } catch {
          why = 'read'
          throw Object.assign(new Error("Couldn't read the file. Pick it again."), { fatal: true })
        }
        const size = piece.byteLength
        let tries = 0
        for (;;) {
          try {
            const onUp = (x) => { loaded[i] = x; onProgress(before + sum()) }
            if (via) {
              const r = await viaPut(i, piece, onUp)
              if (r.status >= 200 && r.status < 300 && r.etag) { etags[i] = r.etag; loaded[i] = size; onProgress(before + sum()); break }
              if (r.status === 400 || r.status === 403) throw Object.assign(new Error(r.error || `Upload failed (${r.status})`), { fatal: true })
              throw new Error(`Upload failed (${r.status})`)
            }
            const r = await put(await urlFor(i), piece, onUp)
            if (r.status >= 200 && r.status < 300 && r.getResponseHeader('ETag')) { etags[i] = r.getResponseHeader('ETag'); loaded[i] = size; onProgress(before + sum()); break }
            if (r.status === 403) delete urls[i] // its signature ran out: sign it again
            if (r.status >= 200 && r.status < 300) via = true // R2 took it but its ETag cannot be read here: the way round
            throw new Error(`Upload failed (${r.status})`)
          } catch (e) {
            if (stopped || e.message === 'cancelled' || e.fatal) throw e
            why = e.message === 'stalled' ? 'stall' : e.message === 'The connection dropped.' ? 'net' : e.message.replace(/\D+/g, '') ? `http${e.message.replace(/\D+/g, '')}` : 'other'
            loaded[i] = 0
            retries++
            if (!via && why !== 'other') { via = true; tries = 0; continue } // straight to R2 failed: the way round, at once
            if (++tries > 6) throw e
            await wait(e.message === 'stalled' ? 300 : Math.min(30000, 1000 * 2 ** tries))
          }
        }
      }
    }
    try { await Promise.all([worker(), worker(), worker()]) } catch (e) {
      if (!stopped) why ||= 'other'
      bridge({ action: 'abort', key: made.key, uploadId: made.uploadId }, why ? `fail=${why}${via ? '&via=1' : ''}&kb=${Math.round(f.size / 1024)}&ms=${Date.now() - t0}&retries=${retries}` : '').catch(() => {})
      throw e
    }
    const parts = Object.keys(etags).map((k) => ({ n: +k, etag: etags[k] }))
    const fin = await bridge({ action: 'complete', key: made.key, uploadId: made.uploadId, parts, name: f.name || 'file', size: f.size, type: f.type || '', days }, `kb=${Math.round(f.size / 1024)}&ms=${Date.now() - t0}&retries=${retries}${via ? '&via=1' : ''}`)
    return { name: f.name, size: fin.size || f.size, type: f.type || '', token: fin.token, expires: fin.expires }
  }

  // every file, one after the other, then one link for all that went up
  const start = async (files, { days = 3, title = '', message = '', password = '', notify = false } = {}) => {
    const sent = [], errs = []
    let before = 0
    for (const f of files) {
      if (stopped) break
      try { sent.push(await upOne(f, days, before)) } catch (e) {
        if (stopped || e.message === 'cancelled') break
        errs.push(`${f.name}: ${e.message}`)
      }
      before += f.size
      onProgress(before)
    }
    if (!sent.length) return { sent, errs, url: '', token: '', expires: '' }
    try {
      const b = await bridge({ action: 'bundle', tokens: sent.map((m) => m.token), title, message, recipients: [], password, notify })
      return { sent, errs, token: b.token, url: PAGE + b.token, expires: b.expires }
    } catch (e) {
      // the files are up; with one file its own link still works
      if (sent.length === 1) return { sent, errs, token: sent[0].token, url: PAGE + sent[0].token, expires: sent[0].expires }
      return { sent, errs: [...errs, e.message], url: '', token: '', expires: '' }
    }
  }
  const stop = () => { stopped = true; xhrs.forEach((x) => x.abort()) }
  return { start, stop }
}
