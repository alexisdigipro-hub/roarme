-- RoarMe Inbox (Alex, 19 Oct 2026): "where do I see who writes to the RoarMe chat". The admins (roar_admins) read every
-- chat of the official RoarMe account and answer as RoarMe from their own login, in Settings > RoarMe Inbox. Nobody
-- else can call these. Run after official.sql. Safe to run again.

-- the official account (the first in roar_official)
create or replace function public.roar_official_id() returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from roar_official order by user_id limit 1
$$;

-- every chat of RoarMe with a person, newest first, with what RoarMe has not read yet
create or replace function public.roar_official_inbox()
returns table (room_id uuid, person uuid, username text, display_name text, avatar_url text,
  last_body text, last_kind text, last_from_them boolean, last_at timestamptz, unread int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare o uuid := roar_official_id();
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return query
    select r.id, p.id, p.username, p.display_name, p.avatar_url,
      lm.body, lm.kind, lm.user_id <> o, coalesce(lm.created_at, r.created_at),
      (select count(*)::int from roar_messages x where x.room_id = r.id and x.user_id <> o and x.deleted_at is null
         and x.kind <> 'system' and x.created_at > mo.last_read_at)
    from roar_rooms r
    join roar_members mo on mo.room_id = r.id and mo.user_id = o
    join roar_members mp on mp.room_id = r.id and mp.user_id <> o
    join roar_profiles p on p.id = mp.user_id
    left join lateral (select x.body, x.kind, x.user_id, x.created_at from roar_messages x
      where x.room_id = r.id and x.deleted_at is null and x.kind <> 'system' order by x.created_at desc limit 1) lm on true
    where r.kind = 'direct'
    order by coalesce(lm.created_at, r.created_at) desc;
end $$;

-- one chat's messages, oldest first; reading them marks them read for RoarMe
create or replace function public.roar_official_messages(r uuid, lim int default 300)
returns table (id uuid, user_id uuid, body text, kind text, file jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare o uuid := roar_official_id();
begin
  if not roar_is_admin() or not exists (select 1 from roar_members where room_id = r and user_id = o) then raise exception 'not allowed'; end if;
  update roar_members set last_read_at = now() where room_id = r and user_id = o;
  return query
    select * from (select m.id, m.user_id, m.body, m.kind, m.file, m.created_at from roar_messages m
      where m.room_id = r and m.deleted_at is null order by m.created_at desc limit lim) z order by z.created_at;
end $$;

-- an answer, written as RoarMe
create or replace function public.roar_official_send(r uuid, body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o uuid := roar_official_id(); id uuid;
begin
  if not roar_is_admin() or not exists (select 1 from roar_members where room_id = r and user_id = o) then raise exception 'not allowed'; end if;
  if body is null or length(trim(body)) = 0 or length(body) > 8000 then raise exception 'Write the answer'; end if;
  insert into roar_messages (room_id, user_id, kind, body) values (r, o, 'text', trim(body)) returning roar_messages.id into id;
  update roar_members set last_read_at = now() where room_id = r and user_id = o;
  return id;
end $$;

revoke all on function public.roar_official_id(), public.roar_official_inbox(), public.roar_official_messages(uuid, int), public.roar_official_send(uuid, text) from public, anon;
grant execute on function public.roar_official_id(), public.roar_official_inbox(), public.roar_official_messages(uuid, int), public.roar_official_send(uuid, text) to authenticated;
