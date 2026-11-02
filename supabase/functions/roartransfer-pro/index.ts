// RoarTransfer Pro (Alex, 25 Oct 2026: "make my Pro profile, and give me somewhere to make someone else Pro").
// Who is Pro: the admins (roar_admins) always, and anyone with a row in roar_transfer_pro whose `until` is empty or
// still ahead (supabase/transfer-pro.sql). The page's Pro tab asks 'me'; Admin > Pro asks 'list', 'grant' and
// 'revoke', which answer only an admin. Receive files itself (the page, what came in) stays in roartransfer-r2.
// Since 25 Oct (supabase/transfer-pro-plus.sql) a Pro also has: 'brand' (their name, logo and backgrounds on their
// download pages and Receive-files page), 'link' (a sent link's expiry, password and every open and download with
// when, country and device) and 'edit' (a new expiry or password for a link already sent).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const live = (until: string | null) => !until || new Date(until).getTime() > Date.now()
const BRAND = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/roartransfer-brand/`
const DAY = 864e5
// how long a file can stay at most, from when it was sent: free/ 3 days, pro/ 30, and a big Pro file only as long as its
// size was allowed (Alex, 26 Oct: 1 day up to 50 GB, 3 days 40, 7 days 30, 30 days 20; roartransfer-r2 PRO_GB);
// week/ has no rule of its own (the hourly sweep follows the link)
const GB = 1024 ** 3
const keepMax = (path: string, size = 0) => (/^free\//.test(path) ? 3 : size > 40 * GB ? 1 : size > 30 * GB ? 3 : size > 20 * GB ? 7 : 30) * DAY
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: who } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } }
  const uid = who?.user?.id
  if (!uid) return json({ error: 'signed-out' }, 401)
  const { data: adminRow } = await sb.from('roar_admins').select('user_id').eq('user_id', uid).maybeSingle()
  const admin = !!adminRow

  const { data: me } = await sb.from('roar_transfer_pro').select('until, created_at, brand_name, brand_logo, brand_bgs').eq('user_id', uid).maybeSingle()
  const pro = admin || (!!me && live(me.until))

  // the caller's own: Pro or not, until when, and why (admin or given), and their brand
  if (b.action === 'me') {
    return json({ pro, admin, until: admin ? null : me?.until || null, since: me?.created_at || null,
      brand: { name: me?.brand_name || '', logo: me?.brand_logo || '', bgs: me?.brand_bgs || [] } })
  }

  // ---- what a Pro does with their own ----
  if (['brand', 'link', 'edit'].includes(b.action) && !pro) return json({ error: 'This is for Pro.' }, 403)

  // their name, logo and backgrounds (pictures they put in roartransfer-brand/<their id>/ themselves)
  if (b.action === 'brand') {
    const mine = (u: unknown) => typeof u === 'string' && u.startsWith(`${BRAND}${uid}/`) && u.length < 600
    const name = String(b.name || '').trim().slice(0, 80)
    const logo = mine(b.logo) ? b.logo : ''
    const bgs = (Array.isArray(b.bgs) ? b.bgs : []).filter(mine).slice(0, 8)
    const row = { brand_name: name || null, brand_logo: logo || null, brand_bgs: bgs }
    const { error } = me ? await sb.from('roar_transfer_pro').update(row).eq('user_id', uid) : await sb.from('roar_transfer_pro').insert({ user_id: uid, ...row })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, brand: { name, logo, bgs } })
  }

  // a link they sent (a file's token from My transfers): its upload(s), expiry, password, and what happened to it
  if (b.action === 'link' || b.action === 'edit') {
    const t = String(b.token || '')
    if (!/^[A-Za-z0-9]{6,32}$/.test(t)) return json({ error: 'bad request' }, 400)
    const { data: file } = await sb.from('roar_transfer_links').select('token, path, size, created_at, expires_at, created_by').eq('token', t).maybeSingle()
    if (!file || file.created_by !== uid) return json({ error: 'not allowed' }, 403)
    const { data: bundles } = await sb.from('roar_transfer_bundles').select('token, tokens, expires_at, password_hash, created_at').contains('tokens', [t]).eq('created_by', uid)
    const tokens = [...new Set([t, ...(bundles || []).flatMap((x: any) => x.tokens)])]
    const { data: files } = await sb.from('roar_transfer_links').select('token, path, size, created_at, expires_at, stopped_at').in('token', tokens).eq('created_by', uid)
    const max = Math.min(...(files || [file]).map((f: any) => new Date(f.created_at).getTime() + keepMax(f.path, Number(f.size) || 0)))
    if (b.action === 'link') {
      const { data: ev } = await sb.from('roar_transfer_events').select('token, kind, at, country, device')
        .in('token', [...tokens, ...(bundles || []).map((x: any) => x.token)]).order('at', { ascending: false }).limit(300)
      return json({ expires: (bundles || [])[0]?.expires_at || file.expires_at, locked: (bundles || []).some((x: any) => !!x.password_hash),
        max: new Date(max).toISOString(), bundle: (bundles || [])[0]?.token || '', events: ev || [] })
    }
    // edit: a new expiry (never past what the storage keeps) and/or a password (empty takes it off)
    const out: Record<string, unknown> = { ok: true }
    if (b.until) {
      let until = new Date(String(b.until)).getTime()
      if (!isFinite(until)) return json({ error: 'bad date' }, 400)
      until = Math.max(Date.now() + 36e5, Math.min(until, max))
      const iso = new Date(until).toISOString()
      const alive = (files || []).filter((f: any) => !f.stopped_at).map((f: any) => f.token)
      if (alive.length) await sb.from('roar_transfer_links').update({ expires_at: iso }).in('token', alive).eq('created_by', uid)
      for (const x of bundles || []) await sb.from('roar_transfer_bundles').update({ expires_at: iso }).eq('token', x.token)
      out.until = iso
    }
    if (typeof b.password === 'string') {
      const pw = b.password.slice(0, 100)
      for (const x of bundles || []) await sb.from('roar_transfer_bundles').update({ password_hash: pw ? await sha(`${x.token}:${pw}`) : null }).eq('token', x.token)
      out.locked = !!pw
    }
    return json(out)
  }

  if (!admin) return json({ error: 'not allowed' }, 403)

  // every Pro: the admins (always) and each row, live or ended, with the person's name and email
  if (b.action === 'list') {
    const { data: rows } = await sb.from('roar_transfer_pro').select('user_id, slug, name, until, created_at')
    const { data: admins } = await sb.from('roar_admins').select('user_id')
    const ids = [...new Set([...(rows || []).map((r: any) => r.user_id), ...(admins || []).map((a: any) => a.user_id)])]
    const { data: profiles } = ids.length ? await sb.from('roar_profiles').select('id, display_name, username, avatar_url').in('id', ids) : { data: [] }
    const people = await Promise.all(ids.map(async (id) => {
      const { data: u } = await sb.auth.admin.getUserById(id)
      const p = (profiles || []).find((x: any) => x.id === id)
      const r = (rows || []).find((x: any) => x.user_id === id)
      const isAdmin = (admins || []).some((a: any) => a.user_id === id)
      return {
        id, email: u?.user?.email || '', display_name: p?.display_name || u?.user?.user_metadata?.name || '', username: p?.username || '',
        avatar_url: p?.avatar_url || '', admin: isAdmin, until: r?.until || null, since: r?.created_at || null, slug: r?.slug || '',
        pro: isAdmin || (!!r && live(r.until)),
      }
    }))
    people.sort((a, z) => Number(z.admin) - Number(a.admin) || Number(z.pro) - Number(a.pro) || (a.display_name || a.email).localeCompare(z.display_name || z.email))
    return json({ people })
  }

  // make someone Pro: by account id or by email, for a month, a year or always (an existing page name stays)
  if (b.action === 'grant') {
    let id = String(b.id || '')
    const email = String(b.email || '').trim().toLowerCase()
    if (!id && email) {
      for (let page = 1; page <= 20 && !id; page++) {
        const { data } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
        const users = data?.users || []
        id = users.find((u) => (u.email || '').toLowerCase() === email)?.id || ''
        if (users.length < 1000) break
      }
      if (!id) return json({ error: 'There is no account with this email. They need to sign up on roartransfer.com first.' }, 404)
    }
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad request' }, 400)
    const months = Number(b.months) || 0
    const until = months > 0 ? new Date(Date.now() + months * 30 * 864e5).toISOString() : null
    const { data: had } = await sb.from('roar_transfer_pro').select('user_id').eq('user_id', id).maybeSingle()
    const { error } = had
      ? await sb.from('roar_transfer_pro').update({ until }).eq('user_id', id)
      : await sb.from('roar_transfer_pro').insert({ user_id: id, until })
    if (error) return json({ error: error.message }, 500)
    // Pro Trial (Alex, 2 Nov 2026): three months as a thank-you, with an email that says so and what Pro gives
    let mailed = false
    if (b.trial && until) mailed = await sendTrial(id, until)
    return json({ ok: true, id, until, mailed })
  }

  // Pro ends now; the row (and the page name) stays, so giving it back later keeps the same link
  if (b.action === 'revoke') {
    const id = String(b.id || '')
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad request' }, 400)
    const { error } = await sb.from('roar_transfer_pro').update({ until: new Date().toISOString() }).eq('user_id', id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  }

  return json({ error: 'unknown action' }, 400)
})

// ---- the Pro Trial email (Alex, 2 Nov 2026: "thank you for your support, 3 months of Pro free, what Pro has, nice HTML";
// wider on a computer, signed "With love, The Mad Lions"). Sent through Resend as every RoarTransfer email.
const FROM = 'RoarTransfer <noreply@themadlions.com>'
async function sendTrial(id: string, until: string): Promise<boolean> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return false
  const { data: u } = await sb.auth.admin.getUserById(id)
  const to = u?.user?.email
  if (!to) return false
  const { data: p } = await sb.from('roar_profiles').select('display_name').eq('id', id).maybeSingle()
  const name = String(p?.display_name || u?.user?.user_metadata?.name || '').trim()
  const m = trialMail(name, until)
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: m.subject, html: m.html, text: m.text }),
  })
  return r.ok
}
const FONT = "Jost,Futura,'Trebuchet MS',Helvetica,Arial,sans-serif"
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])
function trialMail(name: string, until: string) {
  const day = new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Athens' })
  const perks = [
    ['Up to 50 GB a transfer', '50 GB for 1 day, 40 GB for 3 days, 30 GB for 7 days, 20 GB for 30 days'],
    ['Links up to 30 days', 'Choose 1, 3, 7 or 30 days for every link'],
    ['Unlimited downloads', 'Send once, share with as many people as you like'],
    ['Receive files', 'Your own page: anyone sends you up to 20 GB a file, no account needed, kept 30 days'],
    ['Your brand', 'Your name, logo and backgrounds on every page people open from your links'],
    ['Change it after sending', 'New expiry or password on a link you already sent'],
    ['Who downloaded', 'Every open and download: when, from where, on what device'],
    ['Uploads that resume', 'Lost connection? It carries on from where it stopped'],
  ]
  const row = ([t, d]: string[]) => `<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:16px"><tr>
<td width="44" valign="top" style="padding:15px 0 14px 16px"><div style="width:26px;height:26px;border-radius:50%;background:#d40000;box-shadow:0 0 14px rgba(212,0,0,.55);color:#fff;font-size:14px;font-weight:800;line-height:26px;text-align:center">&#10003;</div></td>
<td style="padding:13px 16px 13px 4px"><div style="color:#ffffff;font-size:15px;font-weight:700;line-height:1.35">${t}</div><div style="color:#9aa0a8;font-size:13px;line-height:1.45;padding-top:2px">${d}</div></td></tr></table></td></tr>`
  const hi = name ? `Hi ${esc(name)},` : 'Hi,'
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@200;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${SANS}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;padding:40px 14px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#15171b" style="max-width:640px;background:#15171b;background-image:linear-gradient(155deg,#2a2d33 0%,#15171b 45%,#0d0e11 100%);border:1px solid #2c2f35;border-radius:28px;box-shadow:0 24px 60px rgba(15,17,21,.22)">
<tr><td style="padding:38px 40px 36px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding-bottom:30px;font-family:${FONT};font-size:21px;letter-spacing:.05em;color:#ffffff;line-height:1"><span style="font-weight:200">ROAR</span><span style="font-weight:800">TRANSFER</span>
<span style="display:inline-block;vertical-align:3px;margin-left:8px;padding:4px 9px;border-radius:999px;background:#d40000;box-shadow:0 0 16px rgba(212,0,0,.6);color:#fff;font-family:${SANS};font-size:10px;font-weight:800;letter-spacing:.12em">PRO</span></td></tr>
<tr><td style="color:#ff6b6b;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding-bottom:12px">A gift from us</td></tr>
<tr><td style="color:#ffffff;font-size:30px;font-weight:800;line-height:1.18;letter-spacing:-.01em;padding-bottom:16px">Thank you for being with us.<br><span style="color:#d40000">3 months of Pro</span>, free.</td></tr>
<tr><td style="color:#c9cdd3;font-size:15px;line-height:1.6;padding-bottom:8px">${hi}</td></tr>
<tr><td style="color:#c9cdd3;font-size:15px;line-height:1.6;padding-bottom:24px">Thank you for using RoarTransfer and for your support from the start. To say thanks, your account is now <b style="color:#fff">RoarTransfer Pro, free for three months</b>. No card, nothing to do: it is already on.</td></tr>
<tr><td style="padding-bottom:26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:18px;background:#d40000;background-image:linear-gradient(135deg,#ff2a2a 0%,#d40000 55%,#9e0000 100%);box-shadow:0 10px 30px rgba(212,0,0,.35)"><tr>
<td style="padding:18px 20px"><div style="color:rgba(255,255,255,.8);font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase">Your Pro</div><div style="color:#fff;font-size:20px;font-weight:800;padding-top:4px">Free until <span style="white-space:nowrap">${day}</span></div></td>
<td align="right" style="padding:18px 20px;color:#fff;font-family:${FONT};font-size:38px;font-weight:800;line-height:1;white-space:nowrap">3<span style="font-size:13px;font-weight:700;letter-spacing:.08em">&nbsp;MONTHS</span></td></tr></table></td></tr>
<tr><td style="color:#ffffff;font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding-bottom:14px">What Pro gives you</td></tr>
${perks.map(row).join('\n')}
<tr><td align="center" style="padding:20px 0 8px"><a href="https://roartransfer.com/#mine" style="display:inline-block;background:#d40000;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:15px 38px;border-radius:999px;box-shadow:0 0 22px rgba(212,0,0,.5)">Open my Pro</a></td></tr>
<tr><td align="center" style="color:#8b929b;font-size:13px;line-height:1.55;padding-top:18px">With love,<br><b style="color:#c9cdd3">The Mad Lions</b></td></tr>
</table></td></tr></table>
<p style="margin:22px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#a3a8b0">Powered by <a href="https://www.themadlions.com" style="color:#5f6570;text-decoration:none;font-weight:600">The Mad Lions</a></p>
</td></tr></table></body></html>`
  const text = `${hi}\n\nThank you for using RoarTransfer and for your support. Your account is now RoarTransfer Pro, free for three months (until ${day}). No card, nothing to do: it is already on.\n\nWhat Pro gives you:\n${perks.map(([t, d]: string[]) => `- ${t}: ${d}`).join('\n')}\n\nOpen my Pro: https://roartransfer.com/#mine\n\nWith love,\nThe Mad Lions`
  return { subject: 'A gift: 3 months of RoarTransfer Pro, free', html, text }
}
