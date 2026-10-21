-- What is deleted from a chat leaves the database too, and its files leave storage (Alex, 18 Oct 2026). Safe to run
-- again. Every 15 minutes pg_cron calls the Edge Function roar-cleanup, which:
-- 1. removes the rows of messages deleted for everyone (10 minutes after, so every open RoarMe has seen it go), and of
--    messages that everyone still in the chat has taken out of their own view: Delete for Me, or Clear Chat History /
--    Delete Chat (the app now also writes the time of those in roar_members.cleared_at);
-- 2. removes from storage the photos, videos, voice messages and files no message points to any more (an hour after
--    they were uploaded, so a file on its way up is never touched), and the RoarTransfer links to them.
-- Reactions, pins, hides and delete requests go with their message (on delete cascade); replies keep their text.
alter table public.roar_members add column if not exists cleared_at timestamptz;
grant update (cleared_at) on public.roar_members to authenticated;

create or replace function public.roar_cleanup_rows() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with gone as (
    select m.id from roar_messages m
    where (m.deleted_at is not null and m.deleted_at < now() - interval '10 minutes')
       or (m.created_at < now() - interval '10 minutes'
           and exists (select 1 from roar_members mm where mm.room_id = m.room_id)
           and not exists (
             select 1 from roar_members mm
             where mm.room_id = m.room_id
               and not exists (select 1 from roar_msg_hides h where h.user_id = mm.user_id and h.message_id = m.id)
               and not (mm.cleared_at is not null and mm.cleared_at >= m.created_at)))
    limit 5000
  )
  delete from roar_messages where id in (select id from gone);
  get diagnostics n = row_count;
  return n;
end $$;

-- files in the chats' buckets that no message points to
create or replace function public.roar_orphan_files() returns table (bucket text, name text)
language sql stable security definer set search_path = public, storage as $$
  select o.bucket_id::text, o.name::text from storage.objects o
  where o.bucket_id in ('roar-files', 'roar-transfers')
    and o.created_at < now() - interval '1 hour'
    and not exists (select 1 from roar_messages m
      where (m.file->>'path' = o.name or m.file->>'thumb' = o.name) and coalesce(m.file->>'bucket', 'roar-files') = o.bucket_id)
  limit 1000
$$;
revoke all on function public.roar_cleanup_rows(), public.roar_orphan_files() from public, anon, authenticated;
grant execute on function public.roar_cleanup_rows(), public.roar_orphan_files() to service_role;

create extension if not exists pg_net with schema extensions;
select cron.unschedule('roar-cleanup') where exists (select 1 from cron.job where jobname = 'roar-cleanup');
select cron.schedule('roar-cleanup', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-cleanup',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
$$);
