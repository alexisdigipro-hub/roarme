-- Project chats from THEMADLIONS Hub: RoarMe's admin may rename them and change their photo (Alex, 21 Oct 2026:
-- "let me change it, only me"). Safe to run again. Needs supabase/hub-bridge.sql.
--
-- * Only a RoarMe admin (roar_admins, roar_is_admin()) gets past the guard for the name and the photo; everybody
--   else in the group is still refused, and members, leaving, auto-delete and Encrypted Chat stay the hub's.
-- * A name set by the admin is kept: the hub's next sync no longer writes its project title over it
--   (roar_rooms.hub_title_custom). Putting the name back to empty is not possible; rename it to the hub's title instead.

alter table public.roar_rooms add column if not exists hub_title_custom boolean not null default false;

create or replace function public.roar_hub_guard_rooms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.roar_hub_syncing() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    if new.hub_project is distinct from old.hub_project or new.hub_closed_at is distinct from old.hub_closed_at then
      raise exception 'not allowed';
    end if;
    if old.hub_project is not null then
      if new.auto_delete_hours is distinct from old.auto_delete_hours or new.kind is distinct from old.kind then
        raise exception 'This project chat is managed by THEMADLIONS Hub.';
      end if;
      if new.title is distinct from old.title or new.avatar_url is distinct from old.avatar_url
          or new.hub_title_custom is distinct from old.hub_title_custom then
        if not public.roar_is_admin() then raise exception 'This project chat is managed by THEMADLIONS Hub.'; end if;
        if new.title is distinct from old.title then new.hub_title_custom := true; end if;
      end if;
    elsif new.hub_title_custom is distinct from old.hub_title_custom then
      raise exception 'not allowed';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.hub_project is not null or new.hub_closed_at is not null or new.hub_title_custom then raise exception 'not allowed'; end if;
    return new;
  end if;
  -- DELETE: a project group goes only once nobody is left in it
  if old.hub_project is not null and exists (select 1 from roar_members where room_id = old.id) then
    raise exception 'This project chat is managed by THEMADLIONS Hub.';
  end if;
  return old;
end $$;

-- the group photo: members of an ordinary group as before; in a project chat only RoarMe's admin, member or not
create or replace function public.roar_set_group_photo(r uuid, url text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') then raise exception 'not allowed'; end if;
  if exists (select 1 from roar_rooms where id = r and hub_project is not null) then
    if not public.roar_is_admin() then raise exception 'This project chat is managed by THEMADLIONS Hub.'; end if;
  elsif not roar_is_member(r) then
    raise exception 'not allowed';
  end if;
  update roar_rooms set avatar_url = coalesce(url, '') where id = r;
end $$;

-- the name of a project chat, for RoarMe's admin (an ordinary group is still renamed by its own admins, as before)
create or replace function public.roar_hub_rename(r uuid, t text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed'; end if;
  if nullif(trim(coalesce(t, '')), '') is null then raise exception 'A name is needed'; end if;
  update roar_rooms set title = left(trim(t), 80) where id = r and hub_project is not null;
end $$;
revoke all on function public.roar_hub_rename(uuid, text) from public, anon;
grant execute on function public.roar_hub_rename(uuid, text) to authenticated;

-- the hub's sync: the project title is written only while the admin has not named the chat themselves
create or replace function public.roar_hub_sync_project(project text, group_title text, hub_users uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid; wanted uuid[]; added int := 0; removed int := 0; t text := left(coalesce(nullif(trim(group_title), ''), 'Project'), 80);
begin
  if project is null or project !~ '^[A-Za-z0-9_-]{1,80}$' then raise exception 'bad project id'; end if;
  perform set_config('roar.hub_sync', 'on', true);
  select array_agg(l.user_id) into wanted from roar_hub_links l
    where l.hub = 'themadlions' and l.hub_user_id = any(coalesce(hub_users, '{}'))
      and not exists (select 1 from roar_suspended s where s.user_id = l.user_id)
      and exists (select 1 from roar_profiles p where p.id = l.user_id);
  wanted := coalesce(wanted, '{}');
  select id into rid from roar_rooms where hub_project = project;
  if rid is null then
    insert into roar_rooms (kind, title, created_by, hub_project) values ('group', t, null, project) returning id into rid;
  else
    update roar_rooms set title = case when hub_title_custom then title else t end, hub_closed_at = null
      where id = rid and ((not hub_title_custom and title is distinct from t) or hub_closed_at is not null);
  end if;
  with gone as (delete from roar_members where room_id = rid and not (user_id = any(wanted)) returning 1) select count(*) into removed from gone;
  with came as (insert into roar_members (room_id, user_id, role) select rid, u, 'member' from unnest(wanted) u on conflict do nothing returning 1) select count(*) into added from came;
  update roar_members set role = 'member' where room_id = rid and role <> 'member';
  return jsonb_build_object('room', rid, 'added', added, 'removed', removed, 'members', cardinality(wanted));
end $$;
revoke all on function public.roar_hub_sync_project(text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.roar_hub_sync_project(text, text, uuid[]) to service_role;
