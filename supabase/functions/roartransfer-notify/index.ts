// "Email me when they download" (Alex, 21 Oct 2026, roartransfer.com). roar_transfer_hit asks here right after it
// counts a download of a file in an upload whose sender asked to be told, at most once an hour per upload (it stamps
// roar_transfer_bundles.notified_at first). This only emails that sender, and only if the stamp is fresh.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FROM = 'RoarTransfer <noreply@themadlions.com>'
const PAGE = 'https://roartransfer.com/'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
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
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])

Deno.serve(async (req) => {
  let b: { bundle?: string, file?: string } = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  if (!/^[A-Za-z0-9]{6,32}$/.test(b.bundle || '')) return json({ error: 'bad request' }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: x } = await sb.from('roar_transfer_bundles').select('token, tokens, title, created_by, notify, notified_at').eq('token', b.bundle).maybeSingle()
  if (!x || !x.notify || !x.notified_at || Date.now() - new Date(x.notified_at).getTime() > 120000) return json({ skipped: true })
  const { data: u } = await sb.auth.admin.getUserById(x.created_by)
  const to = u?.user?.email
  if (!to) return json({ skipped: 'no email' })
  const { data: f } = await sb.from('roar_transfer_links').select('name, downloads').eq('token', b.file || '').maybeSingle()
  const { data: all } = await sb.from('roar_transfer_links').select('downloads').in('token', x.tokens)
  const total = (all || []).reduce((a: number, r: { downloads: number }) => a + Number(r.downloads || 0), 0)
  const what = x.title || f?.name || 'your files'
  const subject = `Downloaded: ${what}`
  const html = frame(`
<tr><td style="color:#7ee2a0;font-size:13px;font-weight:700;padding-bottom:8px">Someone just downloaded</td></tr>
<tr><td style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;padding-bottom:10px;word-break:break-all">${esc(f?.name || what)}</td></tr>
${x.title ? `<tr><td style="color:#8b929b;font-size:14px;padding-bottom:6px">From your transfer “${esc(x.title)}”</td></tr>` : ''}
<tr><td style="color:#8b929b;font-size:13px">${total === 1 ? '1 download so far' : total + ' downloads so far'} · at most one email an hour</td></tr>
<tr><td align="center" style="padding:28px 0 4px">${button(PAGE + '#mine', 'My transfers', '#ffffff', '#111317')}</td></tr>`)
  const text = `Someone just downloaded ${f?.name || what}${x.title ? ` (from “${x.title}”)` : ''}.\n${total} download(s) so far.\n\nMy transfers: ${PAGE}#mine`
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ skipped: 'email is not set up' })
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  return json({ sent: r.ok })
})
