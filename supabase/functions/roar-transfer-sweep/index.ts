// RoarTransfer (Alex, 16 Oct): big files sent through RoarMe stay 3 days, then this removes them, and their
// download links with them. Called every hour by pg_cron (supabase/transfers.sql). It takes no input and can only delete transfers
// already older than 3 days (the list comes from roar_expired_transfers()), so it needs no login.
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await sb.rpc('roar_expired_transfers')
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  const names = ((data || []) as unknown[]).map((x) => (typeof x === 'string' ? x : (x as Record<string, string>)?.roar_expired_transfers)).filter(Boolean) as string[]
  if (names.length) {
    const { error: e2 } = await sb.storage.from('roar-transfers').remove(names)
    if (e2) return new Response(JSON.stringify({ error: e2.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
  await sb.from('roar_transfer_links').delete().lt('expires_at', new Date().toISOString())
  return new Response(JSON.stringify({ removed: names.length }), { headers: { 'Content-Type': 'application/json' } })
})
