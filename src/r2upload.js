import { SUPABASE_KEY, SUPABASE_URL, supabase } from './lib.js'

/* RoarTransfer on Cloudflare R2, as on roartransfer.com (Alex, 22 Oct: "the RoarTransfer in RoarMe the same as
   roartransfer.com"). The files go straight from here to R2 in 16 MB pieces, three at a time; the Edge Function
   roartransfer-r2 signs each piece and makes the links (supabase/functions/roartransfer-r2), so no key is ever here.
   Then one link for the whole upload (a bundle) with its title, message, password and an email when it is downloaded. */

const GB = 1024 ** 3
const PART = 16 * 1024 * 1024
const FN = `${SUPABASE_URL}/functions/v1/roartransfer-r2`
export const PAGE = 'https://roartransfer.com/'
// the free choices, the same as roartransfer.com: 1 day up to 5 GB, 3 days up to 3 GB, 7 days up to 1 GB (Alex, 23 Oct);
// 1 day is the first, chosen and recommended one (eco)
export const PLANS = [{ days: 1, max: 5 * GB, eco: true }, { days: 3, max: 3 * GB }, { days: 7, max: 1 * GB }]
export const planOf = (days) => PLANS.find((p) => p.days === days) || PLANS[1]

async function bridge(body) {
  const { data } = await supabase.auth.getSession()
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' }
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify(body) })
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
  const put = (url, body, onUp) => new Promise((ok, no) => {
    if (stopped) { no(new Error('cancelled')); return }
    const x = new XMLHttpRequest()
    xhrs.push(x)
    const drop = () => { xhrs = xhrs.filter((y) => y !== x) }
    x.open('PUT', url)
    x.upload.onprogress = (e) => onUp(e.loaded)
    x.onload = () => { drop(); ok(x) }
    x.onerror = () => { drop(); no(new Error('The connection dropped.')) }
    x.onabort = () => { drop(); no(new Error('cancelled')) }
    x.send(body)
  })

  async function upOne(f, days, before) {
    const made = await bridge({ action: 'create', name: f.name || 'file', size: f.size, type: f.type || '', days })
    const n = Math.max(1, Math.ceil(f.size / PART))
    let next = 1
    const urls = {}, etags = {}, loaded = {}
    const sum = () => Object.values(loaded).reduce((a, x) => a + x, 0)
    let signing = null // one signing request at a time, for the next 20 pieces
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
        const piece = f.slice(from, Math.min(from + PART, f.size))
        let tries = 0
        for (;;) {
          try {
            const r = await put(await urlFor(i), piece, (x) => { loaded[i] = x; onProgress(before + sum()) })
            if (r.status >= 200 && r.status < 300) { etags[i] = r.getResponseHeader('ETag') || ''; loaded[i] = piece.size; onProgress(before + sum()); break }
            if (r.status === 403) delete urls[i] // its signature ran out: sign it again
            throw new Error(`Upload failed (${r.status})`)
          } catch (e) {
            if (stopped || e.message === 'cancelled' || e.fatal) throw e
            loaded[i] = 0
            if (++tries > 6) throw e
            await wait(Math.min(30000, 1000 * 2 ** tries))
          }
        }
      }
    }
    try { await Promise.all([worker(), worker(), worker()]) } catch (e) {
      bridge({ action: 'abort', key: made.key, uploadId: made.uploadId }).catch(() => {})
      throw e
    }
    const parts = Object.keys(etags).map((k) => ({ n: +k, etag: etags[k] }))
    const fin = await bridge({ action: 'complete', key: made.key, uploadId: made.uploadId, parts, name: f.name || 'file', size: f.size, type: f.type || '', days })
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
