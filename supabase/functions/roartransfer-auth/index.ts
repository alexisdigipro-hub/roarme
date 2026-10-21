// RoarTransfer's own sign-up and password reset (Alex, 21 Oct 2026: "everything inside roartransfer"). Supabase's own
// emails came from "Supabase Auth" and their link landed on RoarMe. Here the account is made with the admin API,
// which returns the confirmation token without sending anything; RoarTransfer emails it itself (Resend, its own look)
// as https://roartransfer.com/?confirm=<token>, and the page signs in with verifyOtp. Reset the same way (?reset=).
// Limits: 5 a hour per address, 3 an hour per email. Secrets: RESEND_API_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FROM = 'RoarTransfer <noreply@themadlions.com>'
const PAGE = 'https://roartransfer.com/'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const clientIp = (req: Request) => (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try { return await handle(req) } catch (e) {
    console.error(e)
    return json({ error: 'Something went wrong. Try again in a minute.' }, 502)
  }
})

async function handle(req: Request): Promise<Response> {
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const email = String(b.email || '').trim().toLowerCase()
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i.test(email) || email.length > 200) return json({ error: 'email' }, 400)
  const ip = clientIp(req)
  const hour = new Date(Date.now() - 36e5).toISOString()
  const { count: byIp } = await sb.from('roar_transfer_auth_log').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', hour)
  const { count: byMail } = await sb.from('roar_transfer_auth_log').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', hour)
  if ((byIp || 0) >= 5 || (byMail || 0) >= 3) return json({ error: 'wait' }, 429)
  await sb.from('roar_transfer_auth_log').insert({ kind: String(b.action || ''), ip, email })

  if (b.action === 'signup') {
    const password = String(b.password || '')
    if (password.length < 6 || password.length > 200) return json({ error: 'short' }, 400)
    const name = String(b.name || '').trim().slice(0, 80)
    const { data, error } = await sb.auth.admin.generateLink({ type: 'signup', email, password, options: { data: name ? { name, app: 'roartransfer' } : { app: 'roartransfer' } } })
    if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'taken' : error.message }, 400)
    const url = `${PAGE}?confirm=${encodeURIComponent(data.properties.hashed_token)}`
    const r = await sendMail(email, 'Confirm your RoarTransfer account', frame(`
<tr><td style="color:#ffffff;font-size:24px;font-weight:700;line-height:1.25;padding-bottom:10px">${name ? `Welcome, ${esc(name)}` : 'Welcome to RoarTransfer'}</td></tr>
<tr><td style="color:#8b929b;font-size:15px;line-height:1.55;padding-bottom:26px">One click and your account is ready: up to 5 GB, sent by email or as one short link, with a password and an email when it is downloaded.</td></tr>
<tr><td align="center" style="padding-bottom:16px">${button(url, 'Confirm my account')}</td></tr>
<tr><td align="center" style="color:#8b929b;font-size:12px">If you did not sign up for RoarTransfer, ignore this email.</td></tr>`),
      `Welcome to RoarTransfer${name ? ', ' + name : ''}.\n\nConfirm your account: ${url}\n\nIf you did not sign up for RoarTransfer, ignore this email.`)
    return r === true ? json({ ok: true }) : json({ error: r }, 502)
  }

  if (b.action === 'reset') {
    const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email })
    // the same answer whether or not there is an account, so nobody can probe emails
    if (error || !data?.properties?.hashed_token) return json({ ok: true })
    const url = `${PAGE}?reset=${encodeURIComponent(data.properties.hashed_token)}`
    const r = await sendMail(email, 'Reset your RoarTransfer password', frame(`
<tr><td style="color:#ffffff;font-size:24px;font-weight:700;line-height:1.25;padding-bottom:10px">A new password</td></tr>
<tr><td style="color:#8b929b;font-size:15px;line-height:1.55;padding-bottom:26px">Press the button and choose a new password for your RoarTransfer account. The link works once, for one hour.</td></tr>
<tr><td align="center" style="padding-bottom:16px">${button(url, 'Choose a new password')}</td></tr>
<tr><td align="center" style="color:#8b929b;font-size:12px">If you did not ask for this, ignore this email: your password stays as it is.</td></tr>`),
      `Choose a new password for your RoarTransfer account: ${url}\n\nIf you did not ask for this, ignore this email.`)
    return r === true ? json({ ok: true }) : json({ error: r }, 502)
  }

  return json({ error: 'unknown action' }, 400)
}

async function sendMail(to: string, subject: string, html: string, text: string): Promise<true | string> {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return 'email is not set up'
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  if (r.ok) return true
  try { return (await r.json()).message || `error ${r.status}` } catch { return `error ${r.status}` }
}

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
