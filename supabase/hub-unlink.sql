-- RoarMe without THEMADLIONS Hub (Alex, 1 Nov 2026: the hub has its own chat; RoarMe stays a separate app with no tie
-- to the hub). Safe to run again. Undoes hub-link.sql, hub-bridge.sql, hub-owner.sql, hub-signin.sql and
-- hub-signin-confirmed.sql (keep those files only as history; do not run them again).
--
-- * Everybody's RoarMe account, chats, rooms and messages stay.
-- * The former project groups (roar_rooms.hub_project) become ordinary groups: the guards that locked them are gone,
--   a group with nobody as admin gets one (whoever joined it first), and hub_project is emptied so nothing treats
--   them as hub groups any more. The columns hub_project, hub_closed_at and hub_title_custom stay, unused.
-- * The links, the one-time codes, the shared secret and every roar_hub_* function go.

-- 1. the guards that locked project groups, off (first, so the steps below may change those groups)
do $$ begin
  if to_regclass('public.roar_members') is not null then drop trigger if exists roar_hub_guard_members on public.roar_members; end if;
  if to_regclass('public.roar_rooms') is not null then drop trigger if exists roar_hub_guard_rooms on public.roar_rooms; end if;
  if to_regclass('public.roar_e2e_sessions') is not null then drop trigger if exists roar_hub_guard_e2e on public.roar_e2e_sessions; end if;
  if to_regclass('public.roar_hub_links') is not null then drop trigger if exists roar_hub_unlinked on public.roar_hub_links; end if;
end $$;

-- 2. the former project groups become ordinary groups: an admin where there is none (the earliest to join), then no
--    hub mark. Only rooms still marked are touched, so a second run changes nothing.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roar_rooms' and column_name = 'hub_project') then
    update public.roar_members m set role = 'admin'
      from (
        select distinct on (x.room_id) x.room_id, x.user_id
        from public.roar_members x
        join public.roar_rooms r on r.id = x.room_id
        where r.hub_project is not null and r.kind = 'group'
          and not exists (select 1 from public.roar_members a where a.room_id = x.room_id and a.role = 'admin')
        order by x.room_id, x.joined_at, x.user_id
      ) first_in
      where m.room_id = first_in.room_id and m.user_id = first_in.user_id;
    update public.roar_rooms set hub_project = null where hub_project is not null;
  end if;
end $$;

-- 3. leaving a group, as before the hub (schema.sql): the last one out takes the group with them
create or replace function public.roar_leave(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from roar_members where room_id = r and user_id = auth.uid()
    and exists (select 1 from roar_rooms where id = r and kind = 'group');
  if not exists (select 1 from roar_members where room_id = r) then delete from roar_rooms where id = r; end if;
end $$;
revoke all on function public.roar_leave(uuid) from public, anon;
grant execute on function public.roar_leave(uuid) to authenticated;

-- the group photo: anyone in the group, as for every group (hub-owner.sql had a project-chat branch)
create or replace function public.roar_set_group_photo(r uuid, url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_member(r) then
    raise exception 'not allowed';
  end if;
  update roar_rooms set avatar_url = coalesce(url, '') where id = r;
end $$;
revoke all on function public.roar_set_group_photo(uuid, text) from public, anon;
grant execute on function public.roar_set_group_photo(uuid, text) to authenticated;

-- roles for @mentions: a group's admins make them (mentions.sql also let anyone in a hub group)
do $$ begin
  if to_regclass('public.roar_roles') is not null then
    create or replace function public.roar_roles_editor(r uuid) returns boolean
    language sql stable security definer set search_path = public as $f$
      select exists (select 1 from roar_rooms x where x.id = r and x.kind = 'group' and roar_is_admin(r))
    $f$;
    revoke all on function public.roar_roles_editor(uuid) from public, anon;
    grant execute on function public.roar_roles_editor(uuid) to authenticated;
  end if;
end $$;

-- 4. every roar_hub_* function
drop function if exists public.roar_hub_guard_members() cascade;
drop function if exists public.roar_hub_guard_rooms() cascade;
drop function if exists public.roar_hub_guard_e2e() cascade;
drop function if exists public.roar_hub_unlinked() cascade;
drop function if exists public.roar_hub_syncing();
drop function if exists public.roar_hub_sync_project(text, text, uuid[]);
drop function if exists public.roar_hub_close_project(text);
drop function if exists public.roar_hub_rename(uuid, text);
drop function if exists public.roar_hub_link_code(text);
drop function if exists public.roar_hub_user_by_email(text);
drop function if exists public.roar_hub_unconfirmed_by_email(text);
drop function if exists public.roar_hub_free_username(text);

-- 5. the links, the one-time codes and the shared secret
drop table if exists public.roar_hub_link_codes cascade;
drop table if exists public.roar_hub_links cascade;
drop table if exists public.roar_hub_conf cascade;
