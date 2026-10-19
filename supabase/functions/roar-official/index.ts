// The official RoarMe account (Alex, 19 Oct): @roarme, "RoarMe", the app's icon as its picture, marked official in
// roar_official. Everyone can open a chat with it (Settings > RoarMe · Feedback & Help) for feedback and questions about
// the app. Made once from the database (it answers only to the token in roar_push_conf); running it again only refreshes
// the picture and the profile. The account has no password: whoever answers for RoarMe signs in to it with "Forgot
// password" sent to roarme@themadlions.com.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const EMAIL = 'roarme@themadlions.com'
const ICON = 'https://alexisdigipro-hub.github.io/roarme/icon-512.png'
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: conf } = await sb.from('roar_push_conf').select('hook_token').eq('id', 1).maybeSingle()
  if (!conf || req.headers.get('x-roar-hook') !== String(conf.hook_token)) return json({ error: 'not allowed' }, 403)

  // the account: found by its profile, or made
  let id = ((await sb.from('roar_profiles').select('id').eq('username', 'roarme').maybeSingle()).data as { id: string } | null)?.id
  if (!id) {
    const made = await sb.auth.admin.createUser({ email: EMAIL, email_confirm: true, user_metadata: { official: true } })
    if (made.error) return json({ error: made.error.message }, 500)
    id = made.data.user.id
  }

  // its picture, in RoarMe's own storage (profile pictures may only come from there)
  const pic = await fetch(ICON)
  if (!pic.ok) return json({ error: `icon ${pic.status}` }, 500)
  const path = `${id}/roarme-${Date.now()}.png`
  const up = await sb.storage.from('roar-avatars').upload(path, new Uint8Array(await pic.arrayBuffer()), { contentType: 'image/png', upsert: true })
  if (up.error) return json({ error: up.error.message }, 500)
  const avatar = sb.storage.from('roar-avatars').getPublicUrl(path).data.publicUrl

  const prof = await sb.from('roar_profiles').upsert({
    id, username: 'roarme', display_name: 'RoarMe',
    bio: 'The RoarMe team. Feedback, ideas, questions about the app: write here.',
    avatar_url: avatar,
  })
  if (prof.error) return json({ error: prof.error.message }, 500)
  await sb.from('roar_official').upsert({ user_id: id, label: 'RoarMe' })
  return json({ id, avatar })
})
