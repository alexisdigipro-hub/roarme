// "Email me when they download" (Alex, 21 Oct 2026, roartransfer.com). roar_transfer_hit asks here right after it
// counts a download of a file in an upload whose sender asked to be told, at most once an hour per upload (it stamps
// roar_transfer_bundles.notified_at first). This only emails that sender, and only if the stamp is fresh.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const FROM = 'RoarTransfer <noreply@themadlions.com>'
const PAGE = 'https://roartransfer.com/'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c])

Deno.serve(async (req) => {
  let b: { bundle?: string, file?: string } = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  if (!/^[A-Za-z0-9]{10,32}$/.test(b.bundle || '')) return json({ error: 'bad request' }, 400)
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
  const html = `<!doctype html><html><body style="margin:0;background:#101215;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#101215;padding:32px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#1b1e23;border:1px solid #2f343c;border-radius:24px;padding:28px">
<tr><td style="font-size:20px;font-weight:800;color:#eef0f3;padding-bottom:18px">Roar<span style="color:#ff3b2f">Transfer</span></td></tr>
<tr><td style="color:#7ee2a0;font-size:14px;font-weight:700;padding-bottom:6px">Someone just downloaded</td></tr>
<tr><td style="color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;padding-bottom:10px">${esc(f?.name || what)}</td></tr>
${x.title ? `<tr><td style="color:#9aa3ad;font-size:14px;padding-bottom:10px">From your transfer “${esc(x.title)}”</td></tr>` : ''}
<tr><td style="color:#9aa3ad;font-size:13px">${total === 1 ? '1 download so far' : total + ' downloads so far'}. You hear at most once an hour for this transfer.</td></tr>
<tr><td align="center" style="padding:24px 0 6px"><a href="${PAGE}#mine" style="display:inline-block;background:#2b3038;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 28px;border-radius:999px">My transfers</a></td></tr>
<tr><td align="center" style="color:#5f6873;font-size:11px;padding-top:18px">RoarTransfer · by The Mad Lions · <a href="${PAGE}" style="color:#5f6873">roartransfer.com</a></td></tr>
</table></td></tr></table></body></html>`
  const text = `Someone just downloaded ${f?.name || what}${x.title ? ` (from “${x.title}”)` : ''}.\n${total} download(s) so far.\n\nMy transfers: ${PAGE}#mine`
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ skipped: 'email is not set up' })
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  })
  return json({ sent: r.ok })
})
