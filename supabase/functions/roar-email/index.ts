// Email reminders for unread messages (Alex, 18 Oct 2026; supabase/email.sql). pg_cron calls this every 10 minutes:
// it asks the database who is due (new messages, away for 10 minutes, nothing sent in the last 3 hours), marks each one
// sent and emails them from noreply@themadlions.com through Resend. Opened with ?off=<token> (the link at the foot
// of the email, or a mail app's one-click unsubscribe) it turns that person's emails off. It never reads message text.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { emailHtml, emailText, offPage, subjectFor } from './template.mjs'

const APP = 'https://alexisdigipro-hub.github.io/roarme/'
const ICON = APP + 'icon-512.png'
const FROM = Deno.env.get('EMAIL_FROM') || 'RoarMe <noreply@themadlions.com>'
const SELF = `${Deno.env.get('SUPABASE_URL')}/functions/v1/roar-email`
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const off = new URL(req.url).searchParams.get('off')
  if (off !== null) {
    const ok = UUID.test(off) ? !!(await sb.rpc('roar_email_off', { t: off })).data : false
    if (req.method === 'POST') return json({ ok })
    return new Response(offPage(ok), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return json({ skipped: 'RESEND_API_KEY is not set' })
  const { data, error } = await sb.rpc('roar_email_due', { lim: 50 })
  if (error) return json({ error: error.message }, 500)

  let sent = 0
  const failed: string[] = []
  for (const u of (data || []) as { user_id: string; email: string; name: string; total: number; chats: { name: string; n: number; group: boolean }[] }[]) {
    // marked first, so a slow or failed send can never turn into a second email ten minutes later
    const { data: token, error: e1 } = await sb.rpc('roar_email_sent', { u: u.user_id })
    if (e1 || !token) { failed.push(e1?.message || 'no token'); continue }
    const offUrl = `${SELF}?off=${token}`
    const all = u.chats || []
    const view = { name: u.name || 'there', total: u.total, chats: all.slice(0, 5), more: Math.max(0, all.length - 5), app: APP, off: offUrl, icon: ICON }
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to: [u.email], subject: subjectFor(view), html: emailHtml(view), text: emailText(view),
        headers: { 'List-Unsubscribe': `<${offUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    })
    if (r.ok) sent++
    else failed.push(`${r.status} ${(await r.text()).slice(0, 200)}`)
  }
  return json({ due: (data || []).length, sent, failed })
})
