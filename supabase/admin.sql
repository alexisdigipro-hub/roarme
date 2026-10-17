-- RoarMe admin (Alex, 17 Oct 2026): "only I want to see every user in the database and what files they send".
-- Only the accounts in roar_admins (Alex) can list every account and every file sent: names, sizes, types, who, when,
-- in which kind of chat. Never the content: no message text and no file links come back from here.
-- Safe to run again.

create table if not exists public.roar_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.roar_admins enable row level security;
revoke all on public.roar_admins from anon, authenticated;
insert into public.roar_admins (user_id) values ('98f8b6e1-0ce2-4576-805b-cffa25667d22') on conflict do nothing; -- @iamalexkon

create or replace function public.roar_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roar_admins where user_id = auth.uid())
$$;
revoke all on function public.roar_is_admin() from public, anon;
grant execute on function public.roar_is_admin() to authenticated;

-- a file's size, when the message carries one
create or replace function public.roar_file_size(f jsonb) returns bigint
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(f -> 'size') = 'number' then (f ->> 'size')::numeric::bigint else 0 end
$$;

-- every account, newest first, with what it has sent
create or replace function public.roar_admin_users()
returns table (id uuid, username text, display_name text, avatar_url text, email text, joined timestamptz,
  last_sign_in timestamptz, last_seen timestamptz, messages bigint, files bigint, bytes bigint, chats bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select u.id, p.username, p.display_name, p.avatar_url, u.email::text, u.created_at, u.last_sign_in_at, p.last_seen,
    (select count(*) from public.roar_messages m where m.user_id = u.id),
    (select count(*) from public.roar_messages m where m.user_id = u.id and m.file ? 'path'),
    (select coalesce(sum(public.roar_file_size(m.file)), 0)::bigint from public.roar_messages m where m.user_id = u.id and m.file ? 'path' and m.deleted_at is null),
    (select count(*) from public.roar_members mm where mm.user_id = u.id)
  from auth.users u left join public.roar_profiles p on p.id = u.id
  order by u.created_at desc;
end $$;
revoke all on function public.roar_admin_users() from public, anon;
grant execute on function public.roar_admin_users() to authenticated;

-- every file sent, newest first, a page at a time (before = the last created_at of the page before)
create or replace function public.roar_admin_files(before timestamptz default null, lim int default 100)
returns table (id uuid, created_at timestamptz, user_id uuid, username text, display_name text, kind text,
  room_kind text, room_title text, name text, type text, size bigint, transfer boolean, expires timestamptz, deleted boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select m.id, m.created_at, m.user_id, p.username, p.display_name, m.kind,
    r.kind, case when r.kind = 'group' then r.title else null end,
    m.file ->> 'name', m.file ->> 'type', public.roar_file_size(m.file),
    coalesce(m.file ->> 'bucket', '') = 'roar-transfers',
    case when m.file ? 'expires' then (m.file ->> 'expires')::timestamptz else null end,
    m.deleted_at is not null
  from public.roar_messages m
  left join public.roar_profiles p on p.id = m.user_id
  left join public.roar_rooms r on r.id = m.room_id
  where m.file ? 'path' and (before is null or m.created_at < before)
  order by m.created_at desc
  limit least(greatest(coalesce(lim, 100), 1), 500);
end $$;
revoke all on function public.roar_admin_files(timestamptz, int) from public, anon;
grant execute on function public.roar_admin_files(timestamptz, int) to authenticated;
