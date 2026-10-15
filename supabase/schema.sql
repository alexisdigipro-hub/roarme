-- Roar (working name): a chat for everyone, separate from the THEMADLIONS hub.
-- For now it lives in the hub's Supabase project under its own roar_ tables and its own storage
-- buckets, touching nothing of the hub; before it goes public it moves to a project of its own.
-- Safe to run again.

-- ---------- profiles: one per person, found by @username ----------
create table if not exists public.roar_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text not null default '',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint roar_username_ok check (username ~ '^[a-z0-9_]{3,24}$')
);
create unique index if not exists roar_profiles_username on public.roar_profiles (username);

-- ---------- rooms: a direct chat between two people, or a group ----------
create table if not exists public.roar_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text not null default '',
  avatar_url text not null default '',
  direct_key text unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.roar_members (
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  muted boolean not null default false,
  archived boolean not null default false,
  primary key (room_id, user_id)
);
create index if not exists roar_members_user on public.roar_members (user_id);

create table if not exists public.roar_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  body text not null default '',
  kind text not null default 'text' check (kind in ('text', 'image', 'file', 'voice', 'system')),
  file jsonb,
  reply_to uuid references public.roar_messages(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists roar_messages_room on public.roar_messages (room_id, created_at desc);

-- ---------- who is in a room (security definer, so the policies do not loop) ----------
create or replace function public.roar_is_member(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roar_members where room_id = r and user_id = auth.uid())
$$;
create or replace function public.roar_is_admin(r uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roar_members where room_id = r and user_id = auth.uid() and role = 'admin')
$$;

-- ---------- row level security ----------
alter table public.roar_profiles enable row level security;
alter table public.roar_rooms enable row level security;
alter table public.roar_members enable row level security;
alter table public.roar_messages enable row level security;

drop policy if exists roar_profiles_read on public.roar_profiles;
create policy roar_profiles_read on public.roar_profiles for select to authenticated using (true);
drop policy if exists roar_profiles_insert on public.roar_profiles;
create policy roar_profiles_insert on public.roar_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists roar_profiles_update on public.roar_profiles;
create policy roar_profiles_update on public.roar_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists roar_rooms_read on public.roar_rooms;
create policy roar_rooms_read on public.roar_rooms for select to authenticated using (public.roar_is_member(id));
drop policy if exists roar_rooms_update on public.roar_rooms;
create policy roar_rooms_update on public.roar_rooms for update to authenticated using (kind = 'group' and public.roar_is_admin(id));

drop policy if exists roar_members_read on public.roar_members;
create policy roar_members_read on public.roar_members for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_members_update on public.roar_members;
create policy roar_members_update on public.roar_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists roar_messages_read on public.roar_messages;
create policy roar_messages_read on public.roar_messages for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_messages_insert on public.roar_messages;
create policy roar_messages_insert on public.roar_messages for insert to authenticated
  with check (user_id = auth.uid() and kind <> 'system' and public.roar_is_member(room_id));
drop policy if exists roar_messages_update on public.roar_messages;
create policy roar_messages_update on public.roar_messages for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- only these columns can be changed from the app; rooms and members are made through the functions below
revoke insert, update, delete on public.roar_rooms from authenticated, anon;
revoke insert, update, delete on public.roar_members from authenticated, anon;
revoke update, delete on public.roar_messages from authenticated, anon;
revoke all on public.roar_profiles, public.roar_rooms, public.roar_members, public.roar_messages from anon;
grant update (title, avatar_url) on public.roar_rooms to authenticated;
grant update (last_read_at, muted, archived) on public.roar_members to authenticated;
grant update (body, edited_at, deleted_at) on public.roar_messages to authenticated;

-- a new message moves its room to the top
create or replace function public.roar_touch_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update roar_rooms set last_message_at = new.created_at where id = new.room_id;
  update roar_members set last_read_at = new.created_at where room_id = new.room_id and user_id = new.user_id;
  return new;
end $$;
drop trigger if exists roar_messages_touch on public.roar_messages;
create trigger roar_messages_touch after insert on public.roar_messages for each row execute function public.roar_touch_room();

-- ---------- the app's actions ----------
-- open (or find) the direct chat with someone
create or replace function public.roar_open_direct(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text; r uuid;
begin
  if me is null or other is null or other = me then raise exception 'not allowed'; end if;
  if not exists (select 1 from roar_profiles where id = other) then raise exception 'no such person'; end if;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into r from roar_rooms where direct_key = k;
  if r is null then
    insert into roar_rooms (kind, direct_key, created_by) values ('direct', k, me) returning id into r;
    insert into roar_members (room_id, user_id, role) values (r, me, 'admin'), (r, other, 'admin') on conflict do nothing;
  end if;
  return r;
end $$;

-- a new group with the people picked
create or replace function public.roar_create_group(group_title text, people uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r uuid;
begin
  if me is null then raise exception 'not allowed'; end if;
  if coalesce(trim(group_title), '') = '' then raise exception 'a group needs a name'; end if;
  insert into roar_rooms (kind, title, created_by) values ('group', trim(group_title), me) returning id into r;
  insert into roar_members (room_id, user_id, role) values (r, me, 'admin');
  insert into roar_members (room_id, user_id)
    select r, p from unnest(coalesce(people, '{}')) p where p <> me and exists (select 1 from roar_profiles where id = p)
    on conflict do nothing;
  return r;
end $$;

-- an admin adds people to a group
create or replace function public.roar_add_members(r uuid, people uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_admin(r) then raise exception 'not allowed'; end if;
  insert into roar_members (room_id, user_id)
    select r, p from unnest(coalesce(people, '{}')) p where exists (select 1 from roar_profiles where id = p)
    on conflict do nothing;
end $$;

-- leave a group (the last one out takes the group with them)
create or replace function public.roar_leave(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from roar_members where room_id = r and user_id = auth.uid()
    and exists (select 1 from roar_rooms where id = r and kind = 'group');
  if not exists (select 1 from roar_members where room_id = r) then delete from roar_rooms where id = r; end if;
end $$;

revoke all on function public.roar_open_direct(uuid), public.roar_create_group(text, uuid[]), public.roar_add_members(uuid, uuid[]), public.roar_leave(uuid) from public, anon;
grant execute on function public.roar_open_direct(uuid), public.roar_create_group(text, uuid[]), public.roar_add_members(uuid, uuid[]), public.roar_leave(uuid), public.roar_is_member(uuid), public.roar_is_admin(uuid) to authenticated;

-- ---------- live updates ----------
do $$ begin
  begin alter publication supabase_realtime add table public.roar_messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.roar_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.roar_rooms; exception when duplicate_object then null; end;
end $$;

-- ---------- files: photos and files in a room, profile pictures ----------
insert into storage.buckets (id, name, public) values ('roar-files', 'roar-files', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('roar-avatars', 'roar-avatars', true) on conflict (id) do nothing;

-- the room is the file's first folder; anything else (the hub's own files) is simply not Roar's
create or replace function public.roar_file_ok(objname text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(objname, '/', 1);
begin
  if f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return roar_is_member(f::uuid);
end $$;
grant execute on function public.roar_file_ok(text) to authenticated;

drop policy if exists roar_files_read on storage.objects;
create policy roar_files_read on storage.objects for select to authenticated
  using (bucket_id = 'roar-files' and public.roar_file_ok(name));
drop policy if exists roar_files_write on storage.objects;
create policy roar_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'roar-files' and public.roar_file_ok(name));
drop policy if exists roar_avatars_write on storage.objects;
create policy roar_avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'roar-avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists roar_avatars_update on storage.objects;
create policy roar_avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'roar-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- the list of one's chats, with the last message and the unread count, in one call ----------
create or replace function public.roar_my_rooms()
returns table (room_id uuid, kind text, title text, avatar_url text, last_message_at timestamptz, muted boolean, archived boolean,
  last_read_at timestamptz, role text, unread int, last_body text, last_kind text, last_user uuid, last_deleted boolean, members uuid[])
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.title, r.avatar_url, r.last_message_at, m.muted, m.archived, m.last_read_at, m.role,
    (select count(*)::int from roar_messages x where x.room_id = r.id and x.created_at > m.last_read_at
       and x.user_id is distinct from auth.uid() and x.deleted_at is null),
    l.body, l.kind, l.user_id, l.deleted_at is not null,
    (select array_agg(mm.user_id) from roar_members mm where mm.room_id = r.id)
  from roar_members m
  join roar_rooms r on r.id = m.room_id
  left join lateral (select y.body, y.kind, y.user_id, y.deleted_at from roar_messages y where y.room_id = r.id order by y.created_at desc limit 1) l on true
  where m.user_id = auth.uid()
  order by r.last_message_at desc
$$;
revoke all on function public.roar_my_rooms() from public, anon;
grant execute on function public.roar_my_rooms() to authenticated;

-- ---------- reactions (one per person per message) and a pinned message per chat (15 Oct) ----------
create table if not exists public.roar_reactions (
  message_id uuid not null references public.roar_messages(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists roar_reactions_room on public.roar_reactions (room_id);
alter table public.roar_reactions enable row level security;
alter table public.roar_reactions replica identity full;
drop policy if exists roar_reactions_read on public.roar_reactions;
create policy roar_reactions_read on public.roar_reactions for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_reactions_add on public.roar_reactions;
create policy roar_reactions_add on public.roar_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.roar_is_member(room_id) and exists (select 1 from public.roar_messages m where m.id = message_id and m.room_id = roar_reactions.room_id));
drop policy if exists roar_reactions_change on public.roar_reactions;
create policy roar_reactions_change on public.roar_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists roar_reactions_remove on public.roar_reactions;
create policy roar_reactions_remove on public.roar_reactions for delete to authenticated using (user_id = auth.uid());
revoke all on public.roar_reactions from anon;
do $$ begin alter publication supabase_realtime add table public.roar_reactions; exception when duplicate_object then null; end $$;

alter table public.roar_rooms add column if not exists pinned_message_id uuid references public.roar_messages(id) on delete set null;
create or replace function public.roar_pin(r uuid, msg uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_member(r) then raise exception 'not allowed'; end if;
  if msg is not null and not exists (select 1 from roar_messages where id = msg and room_id = r) then raise exception 'not in this chat'; end if;
  update roar_rooms set pinned_message_id = msg where id = r;
end $$;
revoke all on function public.roar_pin(uuid, uuid) from public, anon;
grant execute on function public.roar_pin(uuid, uuid) to authenticated;
