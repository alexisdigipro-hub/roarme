-- Any member of a group can add people to it (Alex, 15 Nov), not only its admins. Safe to run again.
create or replace function public.roar_add_members(r uuid, people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_member(r) then raise exception 'not allowed'; end if;
  insert into roar_members (room_id, user_id)
    select r, p from unnest(coalesce(people, '{}')) p where exists (select 1 from roar_profiles where id = p)
    on conflict do nothing;
end $$;
grant execute on function public.roar_add_members(uuid, uuid[]) to authenticated;
