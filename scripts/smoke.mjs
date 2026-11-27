// The smoke test (Alex, 27 Nov: "check before every change that nothing breaks"): it opens the built app in
// Chromium, signed in as a made-up person with made-up chats (every Supabase call is answered here, nothing reaches
// the real project), and walks the main road on a phone and on a computer: the chat list, a chat, Contacts and a
// contact's long press, Calls, Settings and Appearance. Any error on the page, a white screen or a missing piece stops
// the build, so the change never goes online.
//   node scripts/smoke.mjs [dir=dist]          (the folder vite built)
import http from 'http'
import fs from 'fs'
import path from 'path'
import { chromium } from 'playwright'

const DIR = path.resolve(process.argv[2] || 'dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  const f = path.join(DIR, p)
  if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('') }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const BASE = `http://127.0.0.1:${server.address().port}/`

// a made-up account and its world
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const me = '11111111-1111-4111-8111-111111111111', u2 = '22222222-2222-4222-8222-222222222222', u3 = '33333333-3333-4333-8333-333333333333'
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: me, role: 'authenticated', aal: 'aal1', exp: 4102444800, email: 'smoke@example.com' })}.sig`
const user = { id: me, aud: 'authenticated', role: 'authenticated', email: 'smoke@example.com', app_metadata: {}, user_metadata: {}, factors: [] }
const session = { access_token: jwt, refresh_token: 'r', expires_in: 999999, expires_at: 4102444800, token_type: 'bearer', user }
const ago = (m) => new Date(Date.now() - m * 6e4).toISOString()
const people = [[me, 'nina', 'Nina Rossi'], [u2, 'sofia', 'Sofia Andreou'], [u3, 'leo', 'Leo Martin']]
  .map(([id, username, display_name], i) => ({ id, username, display_name, avatar_url: '', privacy: {}, last_seen: ago(i * 7) }))
const R1 = 'aaaaaaaa-0000-4000-8000-000000000001', R2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const rooms = [
  { room_id: R1, kind: 'group', title: 'Camera Dept', role: 'admin', avatar_url: '', members: [me, u2, u3], unread: 1, last_body: 'Batteries charged', last_kind: 'text', last_user: u3, last_message_at: ago(5) },
  { room_id: R2, kind: 'direct', title: '', role: 'member', avatar_url: '', members: [me, u2], unread: 0, last_body: 'Bring the 85mm', last_kind: 'text', last_user: u2, last_message_at: ago(50) },
]
const msg = (id, room, by, min, body) => ({ id, room_id: room, user_id: by, kind: 'text', body, created_at: ago(min) })
const msgs = [msg('m1', R1, u3, 30, 'Lens test went well.'), msg('m2', R1, me, 20, 'Perfect, keep it for the close-ups.'), msg('m3', R1, u3, 5, 'Batteries charged'), msg('m4', R2, u2, 50, 'Bring the 85mm')]
const calls = [{ id: 'c1', caller: u2, callee: me, video: false, status: 'missed', started_at: ago(30), room_id: R2 }]

const fails = []
const browser = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {})

async function road(label, { w, h, phone }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: !!phone, isMobile: !!phone })
  await ctx.addInitScript(([s]) => { localStorage.setItem('roarme-auth-2', s); localStorage.setItem('roarme-prefs', JSON.stringify({ mode: 'light' })) }, [JSON.stringify(session)])
  await ctx.route(/supabase\.co/, (route) => {
    const req = route.request(), u = decodeURIComponent(req.url()), one = (req.headers().accept || '').includes('vnd.pgrst.object')
    if (u.includes('/auth/v1/user')) return route.fulfill({ json: user })
    if (u.includes('/auth/v1/')) return route.fulfill({ json: {} })
    if (u.includes('/realtime/')) return route.abort()
    if (u.includes('/rpc/roar_my_rooms')) return route.fulfill({ json: rooms })
    if (u.includes('/rpc/') || u.includes('/functions/')) return route.fulfill({ contentType: 'application/json', body: 'null' })
    if (u.includes('/storage/')) return route.fulfill({ status: 404, body: '' })
    if (u.includes('roar_calls')) return route.fulfill({ json: calls })
    if (u.includes('roar_messages')) { const id = (u.match(/room_id=eq\.([\w-]+)/) || [])[1]; const l = msgs.filter((x) => !id || x.room_id === id); return route.fulfill({ json: one ? (l[0] || null) : l }) }
    if (u.includes('roar_people')) { const l = people.filter((x) => u.includes(x.id)); return route.fulfill({ json: one ? (l[0] || people[0]) : (l.length ? l : people) }) }
    if (u.includes('roar_profiles') && one) return route.fulfill({ json: { id: me, username: 'nina', display_name: 'Nina Rossi', privacy: {} } })
    return route.fulfill({ json: one ? null : [] })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => fails.push(`${label}: page error: ${e.message}`))
  const step = async (name, fn) => {
    try { await fn(); if (await page.locator('.root-fail').count()) throw new Error('the app fell over: Something went wrong') } catch (e) { fails.push(`${label}: ${name}: ${String(e.message || e).split('\n')[0]}`) }
  }
  const gotIt = async () => { const b = page.getByRole('button', { name: 'Got It' }); if (await b.count()) await b.first().click().catch(() => {}) }
  const foot = (cls) => page.locator(`.foot .${cls}, nav .${cls}`).first()
  const hold = async (loc) => {
    const box = await loc.boundingBox(); if (!box) throw new Error('nothing to hold')
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    if (phone) {
      const cdp = await ctx.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
      await page.waitForTimeout(700)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else await page.mouse.click(x, y, { button: 'right' })
    await page.waitForTimeout(500)
  }

  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForTimeout(3500)
  await gotIt()
  await step('the app starts', async () => {
    const txt = await page.evaluate(() => document.getElementById('root')?.innerText.trim().length || 0)
    if (txt < 20) throw new Error('white screen')
  })
  await step('the chat list', () => page.locator('.rooms .room').first().waitFor({ timeout: 8000 }))
  await step('a chat opens', async () => {
    await page.locator('.rooms .room', { hasText: 'Camera Dept' }).first().click()
    await page.locator('.room-view').first().waitFor({ timeout: 8000 })
    await page.locator('.msg', { hasText: 'Batteries charged' }).first().waitFor({ timeout: 8000 })
    await page.locator('.room-view textarea').first().waitFor({ timeout: 5000 })
  })
  if (phone) await step('back to the list', async () => { await page.locator('.room-view [data-back]').first().click(); await page.waitForTimeout(600) })
  await step('Contacts', async () => {
    await foot('foot-contacts').click(); await page.waitForTimeout(800)
    const row = page.locator('.contacts-list .contact').first()
    await row.waitFor({ timeout: 8000 })
    await hold(row)
    if (!(await page.locator('.contacts-list .call-cap.hold').count())) throw new Error('the long press shows no buttons')
    await page.mouse.click(5, h - 140); await page.waitForTimeout(500)
  })
  await step('Calls', async () => {
    await foot('foot-calls').click(); await page.waitForTimeout(800)
    await page.locator('.calls-list .call-row').first().waitFor({ timeout: 8000 })
  })
  await step('Settings', async () => {
    await foot('foot-settings').click(); await page.waitForTimeout(1000)
    await page.getByText('Appearance', { exact: true }).first().click()
    await page.waitForTimeout(1200)
    if (!(await page.getByText('Message Text Size').count())) throw new Error('Appearance did not open')
  })
  await step('nothing is wider than the screen', async () => {
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    if (wide > 2) throw new Error(`the page is ${wide}px wider than the screen`)
  })
  await ctx.close()
  console.log(`${label}: walked`)
}

await road('phone', { w: 390, h: 844, phone: true })
await road('computer', { w: 1280, h: 820 })
await browser.close()
server.close()

if (fails.length) {
  console.error('\nSMOKE TEST FAILED\n' + fails.map((f) => ' - ' + f).join('\n'))
  process.exit(1)
}
console.log('smoke test passed')
