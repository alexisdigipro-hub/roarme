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
// how long a file can stay at most, from when it was sent: R2 deletes free/ after 3 days by itself, pro/ after 30;
// week/ has no rule of its own (the hourly sweep follows the link)
const keepMax = (path: string) => (/^free\//.test(path) ? 3 : 30) * DAY
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
    const { data: file } = await sb.from('roar_transfer_links').select('token, path, created_at, expires_at, created_by').eq('token', t).maybeSingle()
    if (!file || file.created_by !== uid) return json({ error: 'not allowed' }, 403)
    const { data: bundles } = await sb.from('roar_transfer_bundles').select('token, tokens, expires_at, password_hash, created_at').contains('tokens', [t]).eq('created_by', uid)
    const tokens = [...new Set([t, ...(bundles || []).flatMap((x: any) => x.tokens)])]
    const { data: files } = await sb.from('roar_transfer_links').select('token, path, created_at, expires_at, stopped_at').in('token', tokens).eq('created_by', uid)
    const max = Math.min(...(files || [file]).map((f: any) => new Date(f.created_at).getTime() + keepMax(f.path)))
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
    return json({ ok: true, id, until })
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
