-- Add All Team (Alex, 26 Nov: "when a group is made in a project not everyone goes in; keep putting people in and out as
-- now, and a button Add All Team"). A new project group no longer takes the hub's members by itself; an admin of the group
-- who has a hub brings them all in with one call, each in their category's chats. Safe to run again.
drop trigger if exists roar_project_add_hub_members on public.roar_pro_projects;

create or replace function public.roar_add_hub_team(r uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from roar_members where room_id = r and user_id = auth.uid() and role = 'admin') then
    raise exception 'Only an admin of the group can add the team';
  end if;
  insert into roar_members (room_id, user_id, role, channels)
  select r, hm.member, 'member', hm.channels
  from roar_hub_members hm
  where hm.owner = auth.uid()
    and not exists (select 1 from roar_members x where x.room_id = r and x.user_id = hm.member)
    and not exists (select 1 from roar_blocks b where (b.blocker = hm.member and b.blocked = auth.uid()) or (b.blocker = auth.uid() and b.blocked = hm.member))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.roar_add_hub_team(uuid) from public, anon;
grant execute on function public.roar_add_hub_team(uuid) to authenticated;
