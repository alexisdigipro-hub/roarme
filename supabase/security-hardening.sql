-- Security check before the App Store (15 Nov 2026). Safe to run again.

-- 1. Adding people to a group respects each person's own choice (Privacy > who may add me to groups) and blocks, as
--    making a new group already did. Before, any member could add someone who had blocked them or chosen "nobody".
create or replace function public.roar_add_members(r uuid, people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_member(r) then raise exception 'not allowed'; end if;
  insert into roar_members (room_id, user_id)
    select r, p from unnest(coalesce(people, '{}')) p where exists (select 1 from roar_profiles where id = p) and roar_may_add(p)
    on conflict do nothing;
end $$;
revoke all on function public.roar_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.roar_add_members(uuid, uuid[]) to authenticated;

-- 2. roar_who gives a person's name (or the first part of their email) for a notification's words. Only the
--    database's own triggers need it; nobody on the outside may ask it about any account.
revoke all on function public.roar_who(uuid) from public, anon, authenticated;

-- 3. Small helpers with a fixed search path, as every other function has.
alter function public.roar_at(date, text) set search_path = public;
alter function public.roar_day(text) set search_path = public;
alter function public.roar_hash(text) set search_path = public;
alter function public.roar_calendar_touch() set search_path = public;
