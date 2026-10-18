// What is deleted from a chat leaves the database and storage too (Alex, 18 Oct; supabase/cleanup.sql). Called every
// 15 minutes by pg_cron. It takes no input and can only remove what is already gone from every chat: the rows come from
// roar_cleanup_rows(), the files from roar_orphan_files() (nothing points to them), so it needs no login.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async () => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const rows = await sb.rpc('roar_cleanup_rows')
  if (rows.error) return json({ error: rows.error.message }, 500)
  const { data, error } = await sb.rpc('roar_orphan_files')
  if (error) return json({ error: error.message }, 500)
  const byBucket: Record<string, string[]> = {}
  for (const f of (data || []) as { bucket: string; name: string }[]) (byBucket[f.bucket] ||= []).push(f.name)
  let files = 0
  for (const [bucket, names] of Object.entries(byBucket)) {
    for (let i = 0; i < names.length; i += 100) {
      const part = names.slice(i, i + 100)
      const { error: e } = await sb.storage.from(bucket).remove(part)
      if (e) return json({ error: e.message, rows: rows.data, files }, 500)
      files += part.length
      if (bucket === 'roar-transfers') await sb.from('roar_transfer_links').delete().in('path', part)
    }
  }
  return json({ rows: rows.data, files })
})
