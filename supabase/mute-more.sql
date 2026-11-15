-- Mute as Telegram's (Alex, 15 Nov): from a chat's profile, Mute for 1 hour / 8 hours / 1 day / 7 days, Disable Sound
-- (notifications come, quietly), Customize (this chat's own sound), Mute Forever. Safe to run again.
--   muted_until: when a mute for a while ends (null = until turned off); a mute that has run out lets notifications through
--   silent:      this chat's notifications come with no sound
--   sound:       this chat's own sound (one of the app's SOUNDS), null = the device's own pick
alter table public.roar_members add column if not exists muted_until timestamptz;
alter table public.roar_members add column if not exists silent boolean not null default false;
alter table public.roar_members add column if not exists sound text;
grant update (muted_until, silent, sound) on public.roar_members to authenticated;

-- who is told: as before (supabase/mentions.sql), and a mute whose time has passed no longer holds
drop function if exists public.roar_push_targets(uuid);
create function public.roar_push_targets(msg uuid)
returns table (endpoint text, p256dh text, auth text, preview boolean, user_id uuid, unread int, mention boolean)
language sql stable security definer set search_path = public as $$
  with m as (select * from roar_messages where id = msg and kind <> 'system' and user_id is not null),
  men as (select public.roar_mentioned(m.room_id, m.body, m.user_id) as uid from m where m.body like '%@%')
  select s.endpoint, s.p256dh, s.auth, s.preview, s.user_id,
    (select count(*)::int from roar_members mm join roar_messages x on x.room_id = mm.room_id
       where mm.user_id = s.user_id and (not mm.muted or mm.muted_until < now()) and x.created_at > mm.last_read_at
         and x.user_id is distinct from s.user_id and x.kind <> 'system' and x.deleted_at is null),
    mem.user_id in (select uid from men)
  from m
  join roar_members mem on mem.room_id = m.room_id and mem.user_id <> m.user_id
  join roar_push_subs s on s.user_id = mem.user_id
  left join roar_profiles p on p.id = mem.user_id
  where (not mem.muted or mem.muted_until < now() or mem.user_id in (select uid from men))
    and (p.active_until is null or p.active_until < now())
    and not exists (select 1 from roar_blocks b where b.blocker = mem.user_id and b.blocked = m.user_id)
$$;
revoke all on function public.roar_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.roar_push_targets(uuid) to service_role;
