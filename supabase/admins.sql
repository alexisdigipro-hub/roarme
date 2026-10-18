-- Group admins (Alex, 18 Oct 2026): an admin makes someone in the group an admin, or takes it back. An admin can
-- also step down, as long as another admin stays. Members cannot change their own role (roar_members' update grant
-- has no role column). Safe to run again.
create or replace function public.roar_set_admin(r uuid, person uuid, admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_admin(r) then raise exception 'not allowed'; end if;
  if not exists (select 1 from roar_members where room_id = r and user_id = person) then raise exception 'Not in this group'; end if;
  if not admin and not exists (select 1 from roar_members where room_id = r and role = 'admin' and user_id <> person) then
    raise exception 'A group needs at least one admin';
  end if;
  update roar_members set role = case when admin then 'admin' else 'member' end where room_id = r and user_id = person;
end $$;
revoke all on function public.roar_set_admin(uuid, uuid, boolean) from public, anon;
grant execute on function public.roar_set_admin(uuid, uuid, boolean) to authenticated;
