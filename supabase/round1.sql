-- ROAR, round 1 (16 Oct 2026): the parts that delete things, run by hand in the SQL Editor
-- (the rest of round 1 is already in the database). Safe to run again.

-- an admin deletes a whole group, with its messages
create or replace function public.roar_delete_group(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_admin(r) then raise exception 'not allowed'; end if;
  delete from roar_rooms where id = r;
end $$;

-- an admin takes someone out of a group
create or replace function public.roar_remove_member(r uuid, person uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if person = auth.uid() or not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_admin(r) then raise exception 'not allowed'; end if;
  delete from roar_members where room_id = r and user_id = person;
end $$;

-- a person deletes their own account: their private chats go, group messages stay without a name
create or replace function public.roar_delete_me() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not allowed'; end if;
  delete from roar_rooms r where r.kind = 'direct' and r.direct_key like '%' || me::text || '%';
  delete from auth.users where id = me;
end $$;

-- sign out one of my own devices
create or replace function public.roar_end_session(sid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  delete from auth.sessions where id = sid and user_id = auth.uid();
end $$;

revoke all on function public.roar_delete_group(uuid), public.roar_remove_member(uuid, uuid), public.roar_delete_me(), public.roar_end_session(uuid) from public, anon;
grant execute on function public.roar_delete_group(uuid), public.roar_remove_member(uuid, uuid), public.roar_delete_me(), public.roar_end_session(uuid) to authenticated;

-- every 10 minutes: messages past their chat's Auto-Delete time go; every night: devices idle too long are signed out
create extension if not exists pg_cron;
select cron.schedule('roar-auto-delete', '*/10 * * * *',
  $$delete from public.roar_messages m using public.roar_rooms r
    where m.room_id = r.id and r.auto_delete_hours is not null and m.created_at < now() - make_interval(hours => r.auto_delete_hours)$$);
select cron.schedule('roar-old-sessions', '17 3 * * *',
  $$delete from auth.sessions s using public.roar_profiles p
    where s.user_id = p.id and coalesce(s.refreshed_at, s.updated_at, s.created_at) < now() - make_interval(days => coalesce((p.privacy->>'session_days')::int, 180))$$);
