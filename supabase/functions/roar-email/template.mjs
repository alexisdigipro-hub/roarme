// The unread-messages email, in RoarMe's look: graphite, one red, Jost for the big line, a mono for the small
// labels. Tables and inline styles only, so it holds together in Gmail, Apple Mail and Outlook. It never carries
// the text of a message, only how many and from which chats.

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const JOST = `Jost, ${SANS}`
const MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function subjectFor({ total, chats }) {
  if (chats.length === 1) {
    const c = chats[0]
    return c.group ? `${plural(c.n, 'new message', 'new messages')} in ${c.name}` : `${c.name} sent you ${c.n === 1 ? 'a message' : `${c.n} messages`}`
  }
  return `${plural(total, 'new message', 'new messages')} on RoarMe`
}

export function emailText({ name, total, chats, app, off }) {
  return [
    `Hi ${name},`,
    '',
    `You have ${plural(total, 'unread message', 'unread messages')} on RoarMe:`,
    ...chats.map((c) => `- ${c.name}: ${c.n}`),
    '',
    `Open RoarMe: ${app}`,
    '',
    'We never put the text of your messages in an email.',
    `Turn these emails off: ${off}`,
  ].join('\n')
}

export function emailHtml({ name, total, chats, more, app, off, icon }) {
  const head = chats.length === 1 && !chats[0].group
    ? `<b style="font-weight:700;color:#ffffff">${esc(chats[0].name)}</b> wrote to you.`
    : `You have <b style="font-weight:700;color:#ffffff">${plural(total, 'new message', 'new messages')}</b>.`
  const rows = chats.map((c) => `
          <tr><td style="padding:0 0 8px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1f2329;border:1px solid #2b3038;border-radius:16px">
              <tr>
                <td width="56" style="padding:12px 0 12px 14px;vertical-align:middle">
                  <div style="width:40px;height:40px;line-height:40px;border-radius:${c.group ? '12px' : '50%'};background:#2a1517;border:1px solid #5a1a1a;color:#ff3b2f;font-family:${JOST};font-size:17px;font-weight:600;text-align:center">${esc(String(c.name).replace(/^@/, '').charAt(0).toUpperCase() || '#')}</div>
                </td>
                <td style="padding:12px 10px;vertical-align:middle;font-family:${SANS}">
                  <div style="font-size:15px;font-weight:600;color:#eef0f3;line-height:1.3">${esc(c.name)}</div>
                  <div style="font-family:${MONO};font-size:11px;letter-spacing:.08em;color:#7d848f;text-transform:uppercase;padding-top:3px">${c.group ? 'Group' : 'Direct'}</div>
                </td>
                <td align="right" style="padding:12px 14px 12px 0;vertical-align:middle">
                  <span style="display:inline-block;min-width:12px;padding:4px 10px;border-radius:999px;background:#d40000;color:#ffffff;font-family:${SANS};font-size:12px;font-weight:700;text-align:center">${c.n}</span>
                </td>
              </tr>
            </table>
          </td></tr>`).join('')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(subjectFor({ total, chats }))}</title>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
  @media (max-width: 520px) { .card { padding: 28px 18px !important; } .big { font-size: 26px !important; } }
  a { color: #ff3b2f; }
</style>
</head>
<body style="margin:0;padding:0;background:#0e1013">
<div style="display:none;max-height:0;overflow:hidden">${esc(emailText({ name, total, chats, app, off }).split('\n')[2])}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e1013">
  <tr><td align="center" style="padding:40px 16px 32px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td align="center" style="padding:0 0 22px">
        <a href="${esc(app)}" style="text-decoration:none"><img src="${esc(icon)}" width="60" height="60" alt="RoarMe" style="display:block;width:60px;height:60px;border:0;border-radius:15px"></a>
      </td></tr>
      <tr><td class="card" style="background:#16181c;border:1px solid #262a31;border-radius:26px;padding:36px 32px 32px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:.24em;color:#ff3b2f;text-transform:uppercase;padding:0 0 14px">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff3b2f;vertical-align:middle;margin-right:8px"></span>Unread on RoarMe
          </td></tr>
          <tr><td class="big" style="font-family:${JOST};font-size:30px;font-weight:300;line-height:1.18;color:#eef0f3;padding:0 0 10px">${head}</td></tr>
          <tr><td style="font-family:${SANS};font-size:15px;line-height:1.55;color:#9aa1ab;padding:0 0 24px">Hi ${esc(name)}, while you were away the conversation kept going.</td></tr>
          ${rows}
          ${more ? `<tr><td style="font-family:${SANS};font-size:13px;color:#7d848f;padding:2px 2px 8px">and ${plural(more, 'more chat', 'more chats')}</td></tr>` : ''}
          <tr><td align="center" style="padding:20px 0 4px">
            <a href="${esc(app)}" style="display:inline-block;background:#d40000;color:#ffffff;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;padding:14px 30px;border-radius:999px">Open RoarMe</a>
          </td></tr>
          <tr><td align="center" style="font-family:${MONO};font-size:11px;letter-spacing:.06em;color:#6b717b;padding:18px 0 0">We never put the text of your messages in an email.</td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="font-family:${SANS};font-size:12px;line-height:1.65;color:#6b717b;padding:24px 18px 0">
        You get this because you have unread messages on RoarMe and have been away for a while. At most one email every 3 hours.<br>
        <a href="${esc(off)}" style="color:#9aa1ab;text-decoration:underline">Turn these emails off</a> &nbsp;·&nbsp; you can turn them back on in Settings
      </td></tr>
      <tr><td align="center" style="font-family:${JOST};font-size:11px;font-weight:600;letter-spacing:.32em;color:#4a5059;padding:18px 0 0">ROAR ME &nbsp;·&nbsp; BY THE MAD LIONS</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

// the small page the off link opens
export function offPage(ok) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RoarMe emails</title>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1013;color:#eef0f3;font-family:${SANS}">
<div style="max-width:420px;margin:24px;padding:36px 30px;border-radius:26px;background:#16181c;border:1px solid #262a31;text-align:center">
<div style="font-family:${JOST};font-size:28px;font-weight:300;line-height:1.2">${ok ? 'No more <b style="font-weight:700">emails.</b>' : 'This link has <b style="font-weight:700">expired.</b>'}</div>
<p style="color:#9aa1ab;font-size:15px;line-height:1.55;margin:14px 0 24px">${ok ? 'RoarMe will not email you about unread messages any more. You can turn them back on in Settings &gt; Notifications and Sounds.' : 'Turn the emails off in RoarMe, in Settings &gt; Notifications and Sounds.'}</p>
<a href="https://alexisdigipro-hub.github.io/roarme/" style="display:inline-block;background:#d40000;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 28px;border-radius:999px">Open RoarMe</a>
</div></body></html>`
}
