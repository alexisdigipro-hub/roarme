// RoarTransfer Pro (Alex, 25 Oct 2026: "make my Pro profile, and give me somewhere to make someone else Pro").
// Who is Pro: the admins (roar_admins) always, and anyone with a row in roar_transfer_pro whose `until` is empty or
// still ahead (supabase/transfer-pro.sql). The page's Pro tab asks 'me'; Admin > Pro asks 'list', 'grant' and
// 'revoke', which answer only an admin. Receive files itself (the page, what came in) stays in roartransfer-r2.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const live = (until: string | null) => !until || new Date(until).getTime() > Date.now()

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

  // the caller's own: Pro or not, until when, and why (admin or given)
  if (b.action === 'me') {
    const { data: p } = await sb.from('roar_transfer_pro').select('until, created_at').eq('user_id', uid).maybeSingle()
    const given = !!p && live(p.until)
    return json({ pro: admin || given, admin, until: admin ? null : p?.until || null, since: p?.created_at || null })
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
