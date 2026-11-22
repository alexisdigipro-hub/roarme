-- The number on RoarMe's icon (Alex, 22 Nov, from Messages' icon: "when a message comes, show the number like here"):
-- each person's unread messages in chats that are neither muted nor archived, as the app's own count, for roar-push
-- to send with an iPhone notification (APNs badge). Only the Edge Function (service role) calls it. Safe to run again.
create or replace function public.roar_badge_counts(ids uuid[])
returns table (user_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select m.user_id, least(count(x.id), 9999)::int
  from roar_members m
  join roar_messages x on x.room_id = m.room_id and x.created_at > m.last_read_at
    and x.user_id is distinct from m.user_id and x.deleted_at is null and x.kind <> 'system'
  where m.user_id = any(ids)
    and not coalesce(m.archived, false)
    and not (coalesce(m.muted, false) and (m.muted_until is null or m.muted_until > now()))
  group by m.user_id
$$;
revoke all on function public.roar_badge_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.roar_badge_counts(uuid[]) to service_role;
