-- Mentions that reach people, as in Slack (Alex, 20 Oct 2026). In a message:
--   @all (or @everyone, @channel)  everyone in the chat
--   @here                          everyone in the chat seen in the last 10 minutes
--   @<role>                        the people of a role of this group, e.g. @montage or @μοντάζ (roar_roles)
--   @<username>                    that person, as before
-- Who is mentioned gets the notification even with the chat muted, and the chat list shows an @ until it is read.
-- Roles belong to a group: its admins make them. Run after push.sql. Safe to run again.
create table if not exists public.roar_roles (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  name text not null check (name ~ '^[[:alnum:]_]{2,24}$' and name = lower(name) and name not in ('all', 'everyone', 'channel', 'here')),
  user_ids uuid[] not null default '{}' check (cardinality(user_ids) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);

-- who may make and change the roles of a group
create or replace function public.roar_roles_editor(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roar_rooms x where x.id = r and x.kind = 'group'
    and roar_is_admin(r))
$$;
revoke all on function public.roar_roles_editor(uuid) from public, anon;
grant execute on function public.roar_roles_editor(uuid) to authenticated;

-- a role holds only people of its group
create or replace function public.roar_roles_members_ok(r uuid, ids uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from unnest(ids) u where not exists (select 1 from roar_members m where m.room_id = r and m.user_id = u))
$$;
revoke all on function public.roar_roles_members_ok(uuid, uuid[]) from public, anon;
grant execute on function public.roar_roles_members_ok(uuid, uuid[]) to authenticated;

alter table public.roar_roles enable row level security;
drop policy if exists roar_roles_read on public.roar_roles;
create policy roar_roles_read on public.roar_roles for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_roles_add on public.roar_roles;
create policy roar_roles_add on public.roar_roles for insert to authenticated
  with check (public.roar_roles_editor(room_id) and public.roar_roles_members_ok(room_id, user_ids)
    and (select count(*) from public.roar_roles g where g.room_id = roar_roles.room_id) < 50);
drop policy if exists roar_roles_change on public.roar_roles;
create policy roar_roles_change on public.roar_roles for update to authenticated
  using (public.roar_roles_editor(room_id)) with check (public.roar_roles_editor(room_id) and public.roar_roles_members_ok(room_id, user_ids));
drop policy if exists roar_roles_remove on public.roar_roles;
create policy roar_roles_remove on public.roar_roles for delete to authenticated using (public.roar_roles_editor(room_id));
drop policy if exists roar_mfa on public.roar_roles;
create policy roar_mfa on public.roar_roles as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_roles from anon;
revoke update on public.roar_roles from authenticated;
grant select, insert, delete on public.roar_roles to authenticated;
grant update (name, user_ids) on public.roar_roles to authenticated;
do $$ begin alter publication supabase_realtime add table public.roar_roles; exception when duplicate_object then null; end $$;

-- the people a message mentions (never its writer). Locked (encrypted) text mentions no one: the server cannot read it.
-- with_here off: @here is left out (it counts only at the moment the message is sent)
create or replace function public.roar_mentioned(room uuid, body text, author uuid, with_here boolean default true)
returns setof uuid
language sql stable security definer set search_path = public as $$
  with w as (
    select distinct lower(x[2]) as w
    from regexp_matches(coalesce(body, ''), '(^|[^[:alnum:]_@])@([[:alnum:]_]{2,24})', 'g') x
    where body not like 'e2e1.%'
  )
  select mem.user_id from roar_members mem
  where mem.room_id = room and mem.user_id is distinct from author and exists (select 1 from w) and (
    exists (select 1 from w where w.w in ('all', 'everyone', 'channel'))
    or (with_here and exists (select 1 from w where w.w = 'here')
        and exists (select 1 from roar_profiles p where p.id = mem.user_id and (p.last_seen > now() - interval '10 minutes' or p.active_until > now())))
    or exists (select 1 from w join roar_profiles p on p.username = w.w where p.id = mem.user_id)
    or exists (select 1 from w join roar_roles g on g.room_id = room and g.name = w.w where mem.user_id = any (g.user_ids))
  )
$$;
revoke all on function public.roar_mentioned(uuid, text, uuid, boolean) from public, anon, authenticated;

-- one's chats with unread messages that mention them, and how many (for the @ in the chat list)
create or replace function public.roar_my_mentions()
returns table (room_id uuid, n int)
language sql stable security definer set search_path = public as $$
  select x.room_id, count(*)::int
  from roar_members m
  join roar_messages x on x.room_id = m.room_id and x.created_at > m.last_read_at
  where m.user_id = auth.uid() and x.user_id is distinct from auth.uid() and x.deleted_at is null and x.kind <> 'system'
    and x.body like '%@%' and auth.uid() in (select public.roar_mentioned(x.room_id, x.body, x.user_id, false))
  group by x.room_id
$$;
revoke all on function public.roar_my_mentions() from public, anon;
grant execute on function public.roar_my_mentions() to authenticated;

-- push: who is mentioned is told even in a muted chat, and the notification says so (mention = true)
drop function if exists public.roar_push_targets(uuid);
create function public.roar_push_targets(msg uuid)
returns table (endpoint text, p256dh text, auth text, preview boolean, user_id uuid, unread int, mention boolean)
language sql stable security definer set search_path = public as $$
  with m as (select * from roar_messages where id = msg and kind <> 'system' and user_id is not null),
  men as (select public.roar_mentioned(m.room_id, m.body, m.user_id) as uid from m where m.body like '%@%')
  select s.endpoint, s.p256dh, s.auth, s.preview, s.user_id,
    (select count(*)::int from roar_members mm join roar_messages x on x.room_id = mm.room_id
       where mm.user_id = s.user_id and not mm.muted and x.created_at > mm.last_read_at
         and x.user_id is distinct from s.user_id and x.kind <> 'system' and x.deleted_at is null),
    mem.user_id in (select uid from men)
  from m
  join roar_members mem on mem.room_id = m.room_id and mem.user_id <> m.user_id
  join roar_push_subs s on s.user_id = mem.user_id
  left join roar_profiles p on p.id = mem.user_id
  where (not mem.muted or mem.user_id in (select uid from men))
    and (p.active_until is null or p.active_until < now())
    and not exists (select 1 from roar_blocks b where b.blocker = mem.user_id and b.blocked = m.user_id)
$$;
revoke all on function public.roar_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.roar_push_targets(uuid) to service_role;
