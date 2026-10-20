-- RoarMe <-> THEMADLIONS Hub, phase 2: project group chats run by the hub (Alex, 20 Oct 2026). Safe to run again.
-- Needs supabase/hub-link.sql.
--
-- A project's group carries roar_rooms.hub_project. Its members are set only by the hub, through the Edge Function
-- roar-hub-bridge (shared secret, see hub-link.sql) and the function roar_hub_sync_project below, which only the
-- service role may call. Only people who linked their own account (roar_hub_links) can ever be put in one.
--
-- Inside RoarMe such a group is locked:
--   * nobody is admin in it, so adding or removing people, renaming, the photo, auto-delete and deleting the group
--     are all refused by the existing functions; the guards below refuse them again at the table, whatever calls it;
--   * nobody can leave it (the project decides who is in);
--   * Encrypted Chat cannot be switched on there for now (members change from outside, new ones could not read);
--   * removing the hub link (Settings > Privacy and Security > Linked apps) takes the person out of every project group at once.

alter table public.roar_rooms add column if not exists hub_project text;
alter table public.roar_rooms add column if not exists hub_closed_at timestamptz;
create unique index if not exists roar_rooms_hub_project on public.roar_rooms (hub_project) where hub_project is not null;

-- true only inside roar_hub_sync_project / roar_hub_close_project (a setting local to that one transaction)
create or replace function public.roar_hub_syncing() returns boolean
language sql stable as $$ select coalesce(current_setting('roar.hub_sync', true), '') = 'on' $$;

create or replace function public.roar_hub_guard_members() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid uuid := coalesce(new.room_id, old.room_id);
begin
  if public.roar_hub_syncing() or not exists (select 1 from roar_rooms where id = rid and hub_project is not null) then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then raise exception 'This project chat is managed by THEMADLIONS Hub.'; end if;
  if tg_op = 'UPDATE' and new.role is distinct from old.role then raise exception 'This project chat is managed by THEMADLIONS Hub.'; end if;
  -- a person's own row may go only with their account (account deletion); taking others out is the hub's job
  -- (RoarMe's own admins may still delete a whole account, supabase/suspend.sql roar_admin_delete)
  if tg_op = 'DELETE' and auth.uid() is not null and old.user_id <> auth.uid() and not public.roar_is_admin() then raise exception 'This project chat is managed by THEMADLIONS Hub.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists roar_hub_guard_members on public.roar_members;
create trigger roar_hub_guard_members before insert or update or delete on public.roar_members
  for each row execute function public.roar_hub_guard_members();

create or replace function public.roar_hub_guard_rooms() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.roar_hub_syncing() then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' then
    if new.hub_project is distinct from old.hub_project or new.hub_closed_at is distinct from old.hub_closed_at then
      raise exception 'not allowed';
    end if;
    if old.hub_project is not null and (new.title is distinct from old.title or new.avatar_url is distinct from old.avatar_url
        or new.auto_delete_hours is distinct from old.auto_delete_hours or new.kind is distinct from old.kind) then
      raise exception 'This project chat is managed by THEMADLIONS Hub.';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.hub_project is not null or new.hub_closed_at is not null then raise exception 'not allowed'; end if;
    return new;
  end if;
  -- DELETE: a project group goes only once nobody is left in it
  if old.hub_project is not null and exists (select 1 from roar_members where room_id = old.id) then
    raise exception 'This project chat is managed by THEMADLIONS Hub.';
  end if;
  return old;
end $$;
drop trigger if exists roar_hub_guard_rooms on public.roar_rooms;
create trigger roar_hub_guard_rooms before insert or update or delete on public.roar_rooms
  for each row execute function public.roar_hub_guard_rooms();

create or replace function public.roar_hub_guard_e2e() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from roar_rooms where id = new.room_id and hub_project is not null) then
    raise exception 'Encrypted Chat is not available in project chats yet.';
  end if;
  return new;
end $$;
drop trigger if exists roar_hub_guard_e2e on public.roar_e2e_sessions;
create trigger roar_hub_guard_e2e before insert on public.roar_e2e_sessions
  for each row execute function public.roar_hub_guard_e2e();

-- Leave: refused in a project group, with a clear reason (the guard alone would let a person remove their own row)
create or replace function public.roar_leave(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from roar_rooms where id = r and hub_project is not null) then
    raise exception 'This project chat is managed by THEMADLIONS Hub. You leave it when you leave the project.';
  end if;
  delete from roar_members where room_id = r and user_id = auth.uid()
    and exists (select 1 from roar_rooms where id = r and kind = 'group');
  if not exists (select 1 from roar_members where room_id = r) then delete from roar_rooms where id = r; end if;
end $$;

-- The one way in: make the project's group if needed, set its name, and make its members exactly the linked people
-- among hub_users. Removal is part of the same step, so nobody stays in by mistake.
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
    update roar_rooms set title = t, hub_closed_at = null where id = rid and (title is distinct from t or hub_closed_at is not null);
  end if;
  with gone as (delete from roar_members where room_id = rid and not (user_id = any(wanted)) returning 1) select count(*) into removed from gone;
  with came as (insert into roar_members (room_id, user_id, role) select rid, u, 'member' from unnest(wanted) u on conflict do nothing returning 1) select count(*) into added from came;
  update roar_members set role = 'member' where room_id = rid and role <> 'member';
  return jsonb_build_object('room', rid, 'added', added, 'removed', removed, 'members', cardinality(wanted));
end $$;
revoke all on function public.roar_hub_sync_project(text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.roar_hub_sync_project(text, text, uuid[]) to service_role;

-- A project closed or deleted in the hub: everyone out; the chat stays in the database but nobody sees it
create or replace function public.roar_hub_close_project(project text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; removed int := 0;
begin
  perform set_config('roar.hub_sync', 'on', true);
  select id into rid from roar_rooms where hub_project = project;
  if rid is null then return jsonb_build_object('room', null, 'removed', 0); end if;
  with gone as (delete from roar_members where room_id = rid returning 1) select count(*) into removed from gone;
  update roar_rooms set hub_closed_at = now() where id = rid;
  return jsonb_build_object('room', rid, 'removed', removed);
end $$;
revoke all on function public.roar_hub_close_project(text) from public, anon, authenticated;
grant execute on function public.roar_hub_close_project(text) to service_role;

-- Removing the hub link takes the person out of every project group straight away
create or replace function public.roar_hub_unlinked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('roar.hub_sync', 'on', true);
  delete from roar_members m using roar_rooms r where r.id = m.room_id and r.hub_project is not null and m.user_id = old.user_id;
  return old;
end $$;
drop trigger if exists roar_hub_unlinked on public.roar_hub_links;
create trigger roar_hub_unlinked after delete on public.roar_hub_links
  for each row execute function public.roar_hub_unlinked();
