// RoarTransfer on Cloudflare R2 (Alex, 21 Oct 2026: its own domain roartransfer.com and its own storage, so
// RoarMe keeps its room). The page never holds a key: it asks here, signed in with its RoarMe account, and gets
// short-lived signed addresses for each 16 MB piece of a file, which it sends straight to R2 (bucket roartransfer).
// When every piece is up, this puts the file together and makes its download link (roar_transfer_links, store 'r2').
// Files go to free/<account id>/… (7-day ones to week/<account id>/…); the hourly sweep below deletes each one as soon as its link has ended (R2's own
// lifecycle rule, free/ after 8 days, pro/ after 35 (5 days past the longest link, Alex 26 Oct), stays as a backstop).
// Secrets (Supabase > Edge Functions > Secrets): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; RESEND_API_KEY for email.
// Pro (25 Oct): up to 20 GB, 1 to 30 days, no download limit, under pro/<id>/.
// Free (Alex, 21 Oct): 1 day up to 5 GB, or 3 days up to 3 GB. One link per upload (bundle) with an optional title,
// message, password, emails to the people it is for, and an email to the sender when someone downloads.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const BUCKET = 'roartransfer'
const GB = 1024 ** 3
// 7 days up to 1 GB (Alex, 23 Oct); those go under week/, which R2's 8-day rule on free/ does not touch: the hourly sweep
// deletes them when their link ends
const plan = (days: unknown) => (Number(days) === 1 ? { days: 1, max: 5 * GB } : Number(days) === 7 ? { days: 7, max: 1 * GB } : { days: 3, max: 3 * GB })
// Pro (Alex, 25 Oct): up to 20 GB, kept 1, 3, 7 or 30 days, downloaded without limit; under pro/<id>/, which R2's own
// 35-day rule on pro/ backs up (the hourly sweep follows the link as for everyone)
const PRO_DAYS = [1, 3, 7, 30]
const proPlan = (days: unknown) => ({ days: PRO_DAYS.includes(Number(days)) ? Number(days) : 7, max: 20 * GB })
const dayText = (d: number) => (d === 1 ? '1 day' : `${d} days`)
// without an account (Alex, 21 Oct: a way to get to know us): link only, 24 hours, up to 1 GB, 3 transfers a day
const GUEST = { days: 1, max: 1 * GB, perDay: 3, downloads: 1 }
// downloads per file with an account (Alex, 23 Oct: something for Pro to lift later)
const FREE_DOWNLOADS = 5
// Pro "Receive files" (Alex, 23 Oct; supabase/transfer-pro.sql): roartransfer.com/u/<slug> takes files for a Pro from
// anyone, without an account: up to 20 GB a file, kept 30 days, with limits per sender's address so it cannot be flooded
const INBOX = { max: 20 * GB, days: 30, perDayFiles: 200, perDayBytes: 100 * GB, perDaySends: 30 }
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/
const FROM = 'RoarTransfer <noreply@themadlions.com>'
const PAGE = 'https://roartransfer.com/'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// the account id alone, even when the secret holds the whole S3 address (https://<id>.r2.cloudflarestorage.com)
const account = ((Deno.env.get('R2_ACCOUNT_ID') || '').match(/[0-9a-f]{32}/i) || [''])[0]
const r2 = new AwsClient({ accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') || '', secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') || '', service: 's3', region: 'auto' })
const base = `https://${account}.r2.cloudflarestorage.com/${BUCKET}`
const at = (key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

async function presign(method: string, key: string, query: Record<string, string> = {}, expires = 3600) {
  const u = new URL(at(key))
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  u.searchParams.set('X-Amz-Expires', String(expires))
  return (await r2.sign(new Request(u, { method }), { aws: { signQuery: true } })).url
}
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}>([^<]*)</${name}>`)) || [])[1] || ''
// a file's own token is 12 characters; the link people share (the upload's) only 6, as short as it can be and still not
// guessable (Alex, 21 Oct): roartransfer.com/<token>. 56^6 is about 3 * 10^10, and a link lives a few days.
const newToken = (n = 12) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => abc[x % abc.length]).join('')
}
const safeName = (n: string) => (n || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'file'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // anything unexpected still answers with CORS, so the page shows the reason instead of "Load failed"
  try { return await handle(req) } catch (e) {
    console.error(e)
    return json({ error: 'RoarTransfer could not reach its storage. Try again in a minute.' }, 502)
  }
})

async function handle(req: Request): Promise<Response> {
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  // whether the keys are in place, without showing them
  if (b.action === 'health') {
    let reach = 0
    if (account) { try { reach = (await r2.fetch(`${base}?max-keys=1`)).status } catch { reach = -1 } }
    return json({ ok: !!(account && Deno.env.get('R2_ACCESS_KEY_ID') && Deno.env.get('R2_SECRET_ACCESS_KEY')), account: !!account, reach })
  }

  // "Report abuse" on the download page: anyone, no account; the admins hear of it by email
  if (b.action === 'report') {
    const t = String(b.token || '')
    if (!/^[A-Za-z0-9]{6,32}$/.test(t)) return json({ error: 'bad request' }, 400)
    const ip = clientIp(req)
    const { count } = await sb.from('roar_transfer_reports').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', new Date(Date.now() - 864e5).toISOString())
    if ((count || 0) >= 20) return json({ ok: true })
    const reason = String(b.reason || '').trim().slice(0, 1000)
    await sb.from('roar_transfer_reports').insert({ token: t, reason, ip })
    const { data: admins } = await sb.from('roar_admins').select('user_id')
    for (const a of admins || []) {
      const { data: u } = await sb.auth.admin.getUserById(a.user_id)
      if (u?.user?.email) await sendMail({ to: u.user.email, subject: 'RoarTransfer: a link was reported', html: frame(`<tr><td style="color:#ff8f86;font-size:13px;font-weight:700;padding-bottom:8px">A link was reported</td></tr><tr><td style="color:#ffffff;font-size:18px;font-weight:700;padding-bottom:14px;word-break:break-all">${PAGE}${t}</td></tr><tr><td style="padding-bottom:22px"><div style="color:#d9dde2;font-size:14px;line-height:1.55;padding:14px 18px;background:rgba(255,255,255,.06);border-radius:18px;white-space:pre-wrap">${esc(reason || '(no reason given)')}</div></td></tr><tr><td align="center" style="padding-bottom:10px">${button(PAGE + t, 'Open it', '#ffffff', '#111317')}</td></tr><tr><td align="center" style="color:#8b929b;font-size:12px">Check it in Admin, and delete it there if it breaks the rules.</td></tr>`), text: `A RoarTransfer link was reported: ${PAGE}${t}\n\n${reason || '(no reason given)'}` })
    }
    return json({ ok: true })
  }

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: who } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
  const uid = who?.user?.id
  // Admin > Storage (Alex, 22 Oct: "how much room is left"): what is in the bucket right now, by kind, and the uploads
  // that never finished (they take room too until R2's 7-day rule clears them). Cloudflare gives 10 GB free.
  if (b.action === 'usage') {
    const { data: admin } = uid ? await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle() : { data: null }
    if (!admin) return json({ error: 'not allowed' }, 403)
    const u = { bytes: 0, files: 0, guest: 0, free: 0, pro: 0, other: 0, open: 0 }
    let next = ''
    for (let i = 0; i < 50; i++) {
      const r = await r2.fetch(`${base}?list-type=2&max-keys=1000${next ? '&continuation-token=' + encodeURIComponent(next) : ''}`)
      const xml = await r.text()
      if (!r.ok) return json({ error: `Could not read the storage (${r.status})` }, 502)
      for (const c of xml.split('<Contents>').slice(1)) {
        const key = tag(c, 'Key'), size = Number(tag(c, 'Size')) || 0
        u.bytes += size; u.files++
        if (key.startsWith('free/guest/')) u.guest += size; else if (key.startsWith('free/') || key.startsWith('week/')) u.free += size; else if (key.startsWith('pro/')) u.pro += size; else u.other += size
      }
      next = tag(xml, 'NextContinuationToken')
      if (tag(xml, 'IsTruncated') !== 'true' || !next) break
    }
    const up = await r2.fetch(`${base}?uploads`)
    if (up.ok) u.open = ((await up.text()).match(/<Upload>/g) || []).length
    return json({ ...u, included: 10 * GB })
  }

  // Sweep (Alex, 23 Oct: "the links have expired but the room has not emptied"): every file in the bucket that no live
  // link points at any more (expired, stopped, or a link that was never made) goes at once, not when R2's 8-day rule gets
  // to it, and uploads left half done for a day are aborted. A file gets 6 hours before it counts as without a link, so
  // one being put together right now is never touched. roar-transfer-sweep calls this every hour with the service key;
  // an admin may call it too.
  if (b.action === 'sweep') {
    const service = !!jwt && jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const { data: admin } = !service && uid ? await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle() : { data: null }
    if (!service && !admin) return json({ error: 'not allowed' }, 403)
    // every file is kept 5 days after its link ends, quietly (Alex, 26 Oct: "keep them all 5 days past the longest, not
    // shown"); an account's link gives its one last download in that time (roar-transfer-get). Stopped links go at once.
    const { data: live, error } = await sb.from('roar_transfer_links').select('path').eq('store', 'r2').gt('expires_at', new Date(Date.now() - 5 * 864e5).toISOString()).is('stopped_at', null)
    if (error) return json({ error: error.message }, 500)
    const keep = new Set((live || []).map((r: any) => r.path))
    // each live link's preview picture (og/<token>.jpg) stays as long as its link
    const { data: bundles } = await sb.from('roar_transfer_bundles').select('token').gt('expires_at', new Date().toISOString())
    for (const r of bundles || []) keep.add(`og/${r.token}.jpg`)
    const old = Date.now() - 6 * 36e5
    const out = { removed: 0, bytes: 0, kept: 0, aborted: 0 }
    let next = ''
    for (let i = 0; i < 50; i++) {
      const r = await r2.fetch(`${base}?list-type=2&max-keys=1000${next ? '&continuation-token=' + encodeURIComponent(next) : ''}`)
      const xml = await r.text()
      if (!r.ok) return json({ error: `Could not read the storage (${r.status})` }, 502)
      for (const c of xml.split('<Contents>').slice(1)) {
        const key = tag(c, 'Key'), size = Number(tag(c, 'Size')) || 0
        if (keep.has(key) || new Date(tag(c, 'LastModified')).getTime() > old) { out.kept++; continue }
        const d = await r2.fetch(at(key), { method: 'DELETE' })
        if (d.ok || d.status === 404) { out.removed++; out.bytes += size }
      }
      next = tag(xml, 'NextContinuationToken')
      if (tag(xml, 'IsTruncated') !== 'true' || !next) break
    }
    const up = await r2.fetch(`${base}?uploads`)
    if (up.ok) {
      for (const u of (await up.text()).split('<Upload>').slice(1)) {
        const key = tag(u, 'Key'), id = tag(u, 'UploadId')
        if (key && id && new Date(tag(u, 'Initiated')).getTime() < Date.now() - 864e5) {
          const d = await r2.fetch(`${at(key)}?uploadId=${encodeURIComponent(id)}`, { method: 'DELETE' })
          if (d.ok || d.status === 404) out.aborted++
        }
      }
    }
    return json(out)
  }

  // ---- Pro (Alex, 23 Oct): the admins always, and whoever has a live row in roar_transfer_pro ----
  const isPro = async (id: string | undefined) => {
    if (!id) return false
    const { data: a } = await sb.from('roar_admins').select('user_id').eq('user_id', id).maybeSingle()
    if (a) return true
    const { data: p } = await sb.from('roar_transfer_pro').select('until').eq('user_id', id).maybeSingle()
    return !!p && (!p.until || new Date(p.until).getTime() > Date.now())
  }
  const dayAgo = new Date(Date.now() - 864e5).toISOString()
  // a Receive-files page: whose it is, if its owner is Pro
  const box = b.inbox ? await (async () => {
    const slug = String(b.inbox || '').toLowerCase()
    if (!SLUG.test(slug)) return null
    const { data } = await sb.from('roar_transfer_pro').select('user_id, name, slug').eq('slug', slug).maybeSingle()
    return data && (await isPro(data.user_id)) ? data : null
  })() : null
  if (b.inbox && !box) return json({ error: 'This page does not take files.', gone: true }, 404)
  if (b.action === 'inbox-info') {
    if (!box) return json({ error: 'not found', gone: true }, 404)
    // the Pro's own name, logo and backgrounds on their page (Alex, 25 Oct)
    const { data: br } = await sb.from('roar_transfer_pro').select('brand_name, brand_logo, brand_bgs').eq('user_id', box.user_id).maybeSingle()
    const brand = br && (br.brand_name || br.brand_logo || (br.brand_bgs || []).length) ? { name: br.brand_name || '', logo: br.brand_logo || '', bgs: br.brand_bgs || [] } : null
    return json({ name: br?.brand_name || box.name || box.slug, max: INBOX.max, days: INBOX.days, brand })
  }

  // the Pro's own: are they Pro, their page's name, and every drop they received in the last 30 days
  if (b.action === 'pro') {
    if (!uid) return json({ error: 'signed-out' }, 401)
    if (!(await isPro(uid))) return json({ pro: false })
    const { data: me } = await sb.from('roar_transfer_pro').select('slug, name').eq('user_id', uid).maybeSingle()
    const { data: got } = await sb.from('roar_transfer_inbox').select('id, bundle, sender_name, sender_email, message, files, bytes, created_at')
      .eq('owner', uid).gte('created_at', new Date(Date.now() - INBOX.days * 864e5).toISOString()).order('created_at', { ascending: false }).limit(200)
    return json({ pro: true, slug: me?.slug || '', name: me?.name || '', received: got || [], days: INBOX.days, max: INBOX.max })
  }
  if (b.action === 'pro-set') {
    if (!uid || !(await isPro(uid))) return json({ error: 'not allowed' }, 403)
    const slug = String(b.slug || '').toLowerCase().trim()
    if (!SLUG.test(slug)) return json({ error: 'Use 3 to 30 letters, numbers or dashes.' }, 400)
    const name = String(b.name || '').trim().slice(0, 80)
    const { error } = await sb.from('roar_transfer_pro').upsert({ user_id: uid, slug, name }, { onConflict: 'user_id' })
    if (error) return json({ error: error.code === '23505' ? 'That name is taken. Try another.' : error.message }, 400)
    return json({ ok: true, slug, name })
  }

  // a drop on a Receive-files page is sent: one link for its files, a row in the owner's Received, and an email to them
  if (b.action === 'inbox-send') {
    if (!box) return json({ error: 'not found', gone: true }, 404)
    const ip = clientIp(req)
    const sender = String(b.name || '').trim().slice(0, 80)
    if (!sender) return json({ error: 'Write your name, so they know who sent it.' }, 400)
    const { count: sends } = await sb.from('roar_transfer_inbox').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', dayAgo)
    if ((sends || 0) >= INBOX.perDaySends) return json({ error: 'limit', limit: true }, 429)
    const tokens = (Array.isArray(b.tokens) ? b.tokens : []).map(String).filter((t: string) => /^[A-Za-z0-9]{10,32}$/.test(t)).slice(0, 200)
    const { data: rows } = tokens.length ? await sb.from('roar_transfer_links').select('token, name, size, expires_at').in('token', tokens)
      .eq('created_by', box.user_id).eq('ip', ip).like('path', `pro/${box.user_id}/inbox/%`).gte('created_at', new Date(Date.now() - 6 * 36e5).toISOString()) : { data: [] }
    if (!rows || !rows.length || rows.length !== new Set(tokens).size) return json({ error: 'not allowed' }, 403)
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200)
    const from = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(email) ? email : ''
    const message = String(b.message || '').trim().slice(0, 2000)
    const expires = rows.reduce((a: string, r: any) => (r.expires_at > a ? r.expires_at : a), rows[0].expires_at)
    let token = newToken(6)
    let error: { message: string, code?: string } | null = null
    for (let i = 0; i < 4; i++) {
      if (i) token = newToken(6)
      ;({ error } = await sb.from('roar_transfer_bundles').insert({ token, tokens, created_by: null, ip: null, expires_at: expires, title: `From ${sender}`, message, recipients: [], notify: false }))
      if (!error || error.code !== '23505') break
    }
    if (error) return json({ error: error.message }, 500)
    const bytes = rows.reduce((a: number, r: any) => a + Number(r.size || 0), 0)
    await sb.from('roar_transfer_inbox').insert({ owner: box.user_id, bundle: token, sender_name: sender, sender_email: from, message, files: rows.length, bytes, ip })
    const { data: o } = await sb.auth.admin.getUserById(box.user_id)
    if (o?.user?.email) {
      const ordered = rows.sort((a: any, z: any) => tokens.indexOf(a.token) - tokens.indexOf(z.token))
      const what = rows.length === 1 ? '1 file' : `${rows.length} files`
      const list = ordered.slice(0, 8).map((f: any) => `<tr><td style="padding:11px 0;border-top:1px solid rgba(255,255,255,.08);color:#e9ebee;font-size:14px;word-break:break-all">${esc(f.name)}</td><td style="padding:11px 0 11px 12px;border-top:1px solid rgba(255,255,255,.08);color:#8b929b;font-size:12px;text-align:right;white-space:nowrap">${fmtSize(Number(f.size || 0))}</td></tr>`).join('')
      await sendMail({
        to: o.user.email, reply_to: from || undefined,
        subject: `${sender} sent you ${what} on RoarTransfer`,
        html: frame(`<tr><td style="color:#8b929b;font-size:14px;padding-bottom:6px">Received on your page roartransfer.com/u/${esc(box.slug)}</td></tr>
<tr><td style="color:#ffffff;font-size:24px;font-weight:700;line-height:1.25;padding-bottom:18px;word-break:break-word">${esc(sender)} sent you ${what} · ${fmtSize(bytes)}</td></tr>
${message ? `<tr><td style="padding-bottom:18px"><div style="color:#d9dde2;font-size:15px;line-height:1.55;padding:14px 18px;background:rgba(255,255,255,.06);border-radius:18px;white-space:pre-wrap">${esc(message)}</div></td></tr>` : ''}
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list}</table></td></tr>
<tr><td align="center" style="padding:28px 0 12px">${button(PAGE + token, 'Open', '#2b2f36', '#ffffff')}&nbsp;&nbsp;${button(PAGE + token + '#dl', rows.length > 1 ? 'Download all' : 'Download')}</td></tr>
<tr><td align="center" style="color:#8b929b;font-size:12px">${from ? `Reply to this email to answer ${esc(sender)}. ` : ''}Kept until ${fmtDate(expires)}.</td></tr>`),
        text: `${sender}${from ? ` (${from})` : ''} sent you ${what} on RoarTransfer.\n\n${message ? message + '\n\n' : ''}${ordered.map((f: any) => `- ${f.name} (${fmtSize(Number(f.size || 0))})`).join('\n')}\n\nOpen: ${PAGE}${token}\nKept until ${fmtDate(expires)}.`,
      })
    }
    return json({ ok: true, name: box.name || box.slug })
  }

  // without an account: only uploads, their link and abort, within GUEST; the files go to free/guest/<random>/…
  const guest = !uid
  if (guest && !box && !['create', 'sign', 'complete', 'bundle', 'abort', 'guest'].includes(b.action)) return json({ error: 'signed-out' }, 401)
  const ip = clientIp(req)
  const guestLeft = async () => {
    const { count } = await sb.from('roar_transfer_bundles').select('token', { count: 'exact', head: true }).is('created_by', null).eq('ip', ip).gte('created_at', new Date(Date.now() - 864e5).toISOString())
    return Math.max(0, GUEST.perDay - (count || 0))
  }
  if (b.action === 'guest') return json({ left: await guestLeft(), ...GUEST })
  const mine = (key: string) => typeof key === 'string' && !key.includes('..') && (box ? key.startsWith(`pro/${box.user_id}/inbox/`) : guest ? /^free\/guest\/[0-9a-f-]{36}\//.test(key) : (key.startsWith(`free/${uid}/`) || key.startsWith(`week/${uid}/`) || key.startsWith(`pro/${uid}/`)))
  // the caller is Pro (their own uploads, not someone's Receive-files page)
  const proMe = !guest && !box && ['create', 'complete'].includes(b.action) ? await isPro(uid) : false

  if (b.action === 'create') {
    const size = Number(b.size) || 0
    const { days, max } = box ? INBOX : guest ? GUEST : proMe ? proPlan(b.days) : plan(b.days)
    // a file for someone's Receive-files page: its own size and the sender's limits for the day
    if (box) {
      if (size <= 0 || size > max) return json({ error: `Files can be up to ${max / GB} GB.` }, 400)
      const { data: today } = await sb.from('roar_transfer_links').select('size').like('path', 'pro/%/inbox/%').eq('ip', ip).gte('created_at', dayAgo)
      if ((today || []).length >= INBOX.perDayFiles || (today || []).reduce((a: number, r: any) => a + Number(r.size || 0), 0) + size > INBOX.perDayBytes) return json({ error: 'limit', limit: true }, 429)
    } else if (size <= 0 || size > max) return json({ error: guest ? 'Without an account, files can be up to 1 GB. Sign up free for up to 5 GB.' : `Files kept ${dayText(days)} can be up to ${max / GB} GB.` }, 400)
    if (guest && !box) {
      if ((await guestLeft()) <= 0) return json({ error: 'limit', limit: true }, 429)
      // and no more than 3 GB of files a day from one address, links made or not
      const { data: today } = await sb.from('roar_transfer_links').select('size').is('created_by', null).eq('ip', ip).gte('created_at', new Date(Date.now() - 864e5).toISOString())
      if ((today || []).reduce((a: number, r: any) => a + Number(r.size || 0), 0) + size > GUEST.max * GUEST.perDay) return json({ error: 'limit', limit: true }, 429)
    }
    const key = box ? `pro/${box.user_id}/inbox/${crypto.randomUUID()}-${safeName(b.name)}` : guest ? `free/guest/${crypto.randomUUID()}/${safeName(b.name)}` : proMe ? `pro/${uid}/${crypto.randomUUID()}-${safeName(b.name)}` : `${days === 7 ? 'week' : 'free'}/${uid}/${crypto.randomUUID()}-${safeName(b.name)}`
    const r = await r2.fetch(`${at(key)}?uploads`, { method: 'POST', headers: { 'Content-Type': b.type || 'application/octet-stream' } })
    const uploadId = tag(await r.text(), 'UploadId')
    if (!r.ok || !uploadId) return json({ error: `Could not start the upload (${r.status})` }, 502)
    return json({ key, uploadId })
  }

  if (b.action === 'sign') {
    if (!mine(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    const parts = (Array.isArray(b.parts) ? b.parts : []).map(Number).filter((n: number) => n >= 1 && n <= 10000).slice(0, 50)
    const urls: Record<number, string> = {}
    for (const n of parts) urls[n] = await presign('PUT', b.key, { partNumber: String(n), uploadId: b.uploadId })
    return json({ urls })
  }

  if (b.action === 'complete') {
    if (!mine(b.key) || !b.uploadId || !Array.isArray(b.parts) || !b.parts.length) return json({ error: 'not allowed' }, 403)
    const xml = '<CompleteMultipartUpload>' + b.parts
      .sort((x: any, y: any) => x.n - y.n)
      .map((p: any) => `<Part><PartNumber>${Number(p.n)}</PartNumber><ETag>${String(p.etag).replace(/[<>&]/g, '')}</ETag></Part>`).join('') + '</CompleteMultipartUpload>'
    const r = await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(b.uploadId)}`, { method: 'POST', body: xml, headers: { 'Content-Type': 'application/xml' } })
    const text = await r.text()
    if (!r.ok || text.includes('<Error>')) return json({ error: `Could not finish the upload (${tag(text, 'Code') || r.status})` }, 502)
    // the real size, from R2 itself
    const head = await r2.fetch(at(b.key), { method: 'HEAD' })
    const size = Number(head.headers.get('content-length')) || Number(b.size) || 0
    const { days, max } = box ? INBOX : guest ? GUEST : proMe ? proPlan(b.days) : plan(b.days)
    if (size > max) { await r2.fetch(at(b.key), { method: 'DELETE' }); return json({ error: `Files can be up to ${max / GB} GB.` }, 400) }
    const token = newToken()
    const expires = new Date(Date.now() + days * 864e5).toISOString()
    // how many times each file can be downloaded (Alex, 23 Oct): FastTransfer once, an account 5 times, the admins without limit
    const { data: admin } = guest || box ? { data: null } : await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    const maxDownloads = box ? null : guest ? GUEST.downloads : admin || proMe ? null : FREE_DOWNLOADS
    const { error } = await sb.from('roar_transfer_links').insert({ token, path: b.key, name: String(b.name || 'file').slice(0, 300), size, type: String(b.type || ''), expires_at: expires, created_by: box ? box.user_id : uid || null, ip: guest || box ? ip : null, store: 'r2', max_downloads: maxDownloads })
    if (error) return json({ error: error.message }, 500)
    return json({ token, expires, size, downloads: maxDownloads })
  }

  // one link for the whole upload (Alex, 21 Oct): the file links it holds must all be the caller's own
  if (b.action === 'bundle') {
    const tokens = (Array.isArray(b.tokens) ? b.tokens : []).map(String).filter((t: string) => /^[A-Za-z0-9]{10,32}$/.test(t)).slice(0, 200)
    if (!tokens.length) return json({ error: 'nothing to link' }, 400)
    // one's own file links; without an account, links with no account made in the last hour, 1 GB in all
    const q = sb.from('roar_transfer_links').select('token, expires_at, size, created_at').in('token', tokens)
    const { data: rows } = await (guest ? q.is('created_by', null).gte('created_at', new Date(Date.now() - 36e5).toISOString()) : q.eq('created_by', uid))
    if (!rows || rows.length !== new Set(tokens).size) return json({ error: 'not allowed' }, 403)
    if (guest) {
      if (rows.reduce((a: number, r: any) => a + Number(r.size || 0), 0) > GUEST.max) return json({ error: 'Without an account, a transfer can be up to 1 GB.' }, 400)
      if ((await guestLeft()) <= 0) return json({ error: 'limit', limit: true }, 429)
      b.recipients = []; b.notify = false
    }
    let token = newToken(6)
    const expires = rows.reduce((a: string, r: any) => (r.expires_at > a ? r.expires_at : a), rows[0].expires_at)
    const title = String(b.title || '').trim().slice(0, 120)
    const message = String(b.message || '').trim().slice(0, 2000)
    const recipients = [...new Set((Array.isArray(b.recipients) ? b.recipients : []).map((e: unknown) => String(e).trim().toLowerCase())
      .filter((e: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(e)))].slice(0, 20) as string[]
    const password = String(b.password || '').slice(0, 100)
    // a short token can already be taken: try another
    let error: { message: string, code?: string } | null = null
    for (let i = 0; i < 4; i++) {
      if (i) token = newToken(6)
      ;({ error } = await sb.from('roar_transfer_bundles').insert({
        token, tokens, created_by: uid || null, ip: guest ? ip : null, expires_at: expires, title, message, recipients,
        password_hash: password ? await sha(`${token}:${password}`) : null, notify: !!b.notify,
      }))
      if (!error || error.code !== '23505') break
    }
    if (error) return json({ error: error.message }, 500)
    // the link's preview picture (Alex, 25 Oct): a frame of the first video or the first picture, made 1200x630 by the
    // page, shown when the link is pasted in WhatsApp, Messenger, iMessage, Slack… (roar-transfer-get ?og=). Never for a
    // transfer with a password: its preview says only who sent it.
    const cover = typeof b.cover === 'string' && !password ? b.cover.replace(/^data:image\/jpeg;base64,/, '') : ''
    if (cover && cover.length < 600000 && cover.startsWith('/9j/')) {
      try {
        const bytes = Uint8Array.from(atob(cover), (c) => c.charCodeAt(0))
        await r2.fetch(at(`og/${token}.jpg`), { method: 'PUT', body: bytes, headers: { 'Content-Type': 'image/jpeg' } })
      } catch (e) { console.error('cover', e) }
    }
    // the email to the people it is for: who sent it, the title, the message, the files, until when, Download
    let mailed = 0
    const mailErrors: string[] = []
    if (recipients.length) {
      const { data: files } = await sb.from('roar_transfer_links').select('token, name, size').in('token', tokens)
      const ordered = (files || []).sort((a: any, z: any) => tokens.indexOf(a.token) - tokens.indexOf(z.token))
      const from = await senderName(uid as string, who?.user?.user_metadata?.name || who?.user?.email || '')
      const mail = invite({ from, title, message, files: ordered, expires, url: PAGE + token, locked: !!password })
      for (const to of recipients) {
        const r = await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text, reply_to: who?.user?.email || undefined })
        if (r === true) mailed++; else mailErrors.push(`${to}: ${r}`)
      }
    }
    return json({ token, expires, mailed, mailErrors })
  }

  if (b.action === 'abort') {
    if (!mine(b.key) || !b.uploadId) return json({ error: 'not allowed' }, 403)
    await r2.fetch(`${at(b.key)}?uploadId=${encodeURIComponent(b.uploadId)}`, { method: 'DELETE' })
    return json({ ok: true })
  }

  // Stop: the link ends (roar_transfer_stop, as the caller) and the file goes from R2 at once
  if (b.action === 'delete') {
    const key = String(b.key || '')
    const { data: admin } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
    if (!(key.startsWith(`free/${uid}/`) || key.startsWith(`week/${uid}/`) || key.startsWith(`pro/${uid}/`) || (admin && /^(free|week|pro)\//.test(key)))) return json({ error: 'not allowed' }, 403)
    await sb.from('roar_transfer_links').update({ stopped_at: new Date().toISOString(), expires_at: new Date().toISOString() }).eq('path', key)
    await r2.fetch(at(key), { method: 'DELETE' })
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
}

// the caller's address, for the limits without an account
const clientIp = (req: Request) => (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'

// ---- email (Resend, as RoarMe's own emails) ----
async function sendMail(m: { to: string, subject: string, html: string, text: string, reply_to?: string }): Promise<true | string> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 'email is not set up'
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.reply_to ? { reply_to: m.reply_to } : {}) }),
  })
  if (r.ok) return true
  try { return (await r.json()).message || `error ${r.status}` } catch { return `error ${r.status}` }
}
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}
async function senderName(uid: string, email: string) {
  const { data: p } = await sb.from('roar_profiles').select('display_name, username').eq('id', uid).maybeSingle()
  return p?.display_name || (p?.username ? '@' + p.username : '') || email || 'Someone'
}
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
const fmtSize = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' })
// the look of every RoarTransfer email (Alex, 21 Oct): white page, one dark glassy card, the ROARTRANSFER wordmark
// (ROAR thin, TRANSFER bold, as on the site), little else
const FONT = "Jost,Futura,'Trebuchet MS',Helvetica,Arial,sans-serif"
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
function frame(rows: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@200;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;padding:40px 14px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#15171b" style="max-width:500px;background:#15171b;background-image:linear-gradient(155deg,#2a2d33 0%,#15171b 45%,#0d0e11 100%);border:1px solid #2c2f35;border-radius:28px;box-shadow:0 24px 60px rgba(15,17,21,.22)">
<tr><td style="padding:34px 32px 30px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:30px;font-family:${FONT};font-size:21px;letter-spacing:.05em;color:#ffffff;line-height:1"><span style="font-weight:200">ROAR</span><span style="font-weight:800">TRANSFER</span></td></tr>
${rows}
</table></td></tr></table>
<p style="margin:22px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a3a8b0">Powered by <a href="https://www.themadlions.com" style="color:#5f6570;text-decoration:none;font-weight:600">The Mad Lions</a></p>
</td></tr></table></body></html>`
}
const button = (href: string, label: string, bg = '#d40000', fg = '#ffffff') =>
  `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};text-decoration:none;font-weight:700;font-size:15px;padding:14px 34px;border-radius:999px">${label}</a>`
function invite(v: { from: string, title: string, message: string, files: any[], expires: string, url: string, locked: boolean }) {
  const n = v.files.length
  const total = v.files.reduce((a, f) => a + Number(f.size || 0), 0)
  // no title: the heading is just how many files (Alex, 21 Oct: a long file name is not a heading); the names are in the list
  const what = n === 1 ? '1 file' : `${n} files`
  const subject = v.title ? `${v.from} sent you ${v.title}` : `${v.from} sent you ${what} with RoarTransfer`
  const list = v.files.slice(0, 8).map((f) => `<tr><td style="padding:11px 0;border-top:1px solid rgba(255,255,255,.08);color:#e9ebee;font-size:14px;word-break:break-all">${esc(f.name)}</td><td style="padding:11px 0 11px 12px;border-top:1px solid rgba(255,255,255,.08);color:#8b929b;font-size:12px;text-align:right;white-space:nowrap">${fmtSize(Number(f.size || 0))}</td></tr>`).join('')
    + (n > 8 ? `<tr><td colspan="2" style="padding:11px 0;border-top:1px solid rgba(255,255,255,.08);color:#8b929b;font-size:12px">and ${n - 8} more</td></tr>` : '')
  const html = frame(`
<tr><td style="color:#8b929b;font-size:14px;padding-bottom:6px">${esc(v.from)} sent you</td></tr>
<tr><td style="color:#ffffff;font-size:26px;font-weight:700;line-height:1.2;padding-bottom:20px;word-break:break-word">${v.title ? esc(v.title) : `${what} · ${fmtSize(total)}`}</td></tr>
${v.message ? `<tr><td style="padding-bottom:20px"><div style="color:#d9dde2;font-size:15px;line-height:1.55;padding:14px 18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.07);border-radius:18px;white-space:pre-wrap">${esc(v.message)}</div></td></tr>` : ''}
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list}</table></td></tr>
${v.title ? `<tr><td style="color:#8b929b;font-size:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)">${what} · ${fmtSize(total)}</td></tr>` : '<tr><td style="border-top:1px solid rgba(255,255,255,.08)"></td></tr>'}
<tr><td align="center" style="padding:30px 0 14px">${button(v.url, 'Open', '#2b2f36', '#ffffff')}&nbsp;&nbsp;${button(v.url + '#dl', n > 1 ? 'Download all' : 'Download')}</td></tr>
<tr><td align="center"><span style="display:inline-block;padding:6px 14px;border-radius:999px;background:rgba(126,226,160,.12);color:#7ee2a0;font-size:12.5px;font-weight:700">Available until ${fmtDate(v.expires)}</span></td></tr>
${v.locked ? `<tr><td align="center" style="color:#8b929b;font-size:12px;padding-top:12px">Protected with a password: ask ${esc(v.from)} for it.</td></tr>` : ''}
<tr><td align="center" style="padding-top:26px"><div style="border-top:1px solid rgba(255,255,255,.08);padding-top:18px;color:#8b929b;font-size:12.5px">Sent with RoarTransfer · <a href="${PAGE}" style="color:#ffffff;text-decoration:none;font-weight:700">send yours free, up to 5 GB &rarr;</a></div></td></tr>`)
  const text = `${v.from} sent you ${v.title || what}\n\n${v.message ? v.message + '\n\n' : ''}${v.files.map((f) => `- ${f.name} (${fmtSize(Number(f.size || 0))})`).join('\n')}\n\nOpen: ${v.url}\nDownload: ${v.url}#dl\nAvailable until ${fmtDate(v.expires)}${v.locked ? '\nIt is protected with a password: ask the sender for it.' : ''}\n\nSent with RoarTransfer. Send yours free, up to 5 GB: ${PAGE}\nPowered by The Mad Lions`
  return { subject, html, text }
}
