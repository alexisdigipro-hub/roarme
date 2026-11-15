-- Video chats in groups, as Telegram's (Alex, 15 Nov): anyone in a group starts one, the others join and leave when they
-- like, it ends when the last one leaves (or when whoever started it, or an admin, ends it for all). The sound and
-- picture go through LiveKit (the Edge Function roar-livekit hands a pass to members of the group, room
-- roar-gcall-<id>); who is in it now is Realtime presence on the channel gcall-<id>. Safe to run again.
create table if not exists public.roar_group_calls (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.roar_rooms (id) on delete cascade,
  started_by uuid not null references auth.users (id) on delete cascade,
  video boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists roar_group_calls_room on public.roar_group_calls (room_id, started_at desc);
alter table public.roar_group_calls enable row level security;
drop policy if exists roar_group_calls_read on public.roar_group_calls;
create policy roar_group_calls_read on public.roar_group_calls for select to authenticated using (public.roar_is_member(room_id) or started_by = auth.uid());
grant select on public.roar_group_calls to authenticated;
do $$ begin alter publication supabase_realtime add table public.roar_group_calls; exception when duplicate_object then null; end $$;

-- start one, or get the one already on in this group: { id, fresh }
create or replace function public.roar_group_call_start(r uuid, v boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not exists (select 1 from roar_rooms where id = r and kind = 'group') or not roar_is_member(r) then raise exception 'not allowed'; end if;
  select id into cid from roar_group_calls where room_id = r and ended_at is null and started_at > now() - interval '12 hours' order by started_at desc limit 1;
  if cid is not null then return jsonb_build_object('id', cid, 'fresh', false); end if;
  insert into roar_group_calls (room_id, started_by, video) values (r, auth.uid(), coalesce(v, true)) returning id into cid;
  return jsonb_build_object('id', cid, 'fresh', true);
end $$;

-- end it: whoever started it, an admin of the group, or the last one leaving (the app asks only then)
create or replace function public.roar_group_call_end(c uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update roar_group_calls set ended_at = now() where id = c and ended_at is null and (room_id is null or roar_is_member(room_id));
end $$;

-- Call links and calls with chosen people (Alex, 15 Nov, from Telegram's New Call): a call that belongs to no group
-- (room_id null) with a link of its own; whoever is signed in and has the link (or the call's card) joins it
alter table public.roar_group_calls add column if not exists link_token text;
create unique index if not exists roar_group_calls_link on public.roar_group_calls (link_token) where link_token is not null;

create or replace function public.roar_call_link_create(v boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid uuid; t text;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  t := substr(translate(encode(decode(md5(random()::text || clock_timestamp()::text || auth.uid()::text), 'hex'), 'base64'), '+/=', '-_'), 1, 12);
  insert into roar_group_calls (room_id, started_by, video, link_token) values (null, auth.uid(), coalesce(v, true), t) returning id into cid;
  return jsonb_build_object('id', cid, 'token', t);
end $$;

-- a link to its call: { id, ended, video }
create or replace function public.roar_call_by_link(t text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'ended', ended_at is not null or started_at < now() - interval '12 hours', 'video', video)
  from roar_group_calls where link_token = t limit 1
$$;

-- is a call still on (for the card a call with chosen people leaves in each chat)
create or replace function public.roar_call_state(c uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ended', ended_at is not null or started_at < now() - interval '12 hours') from roar_group_calls where id = c
$$;

revoke all on function public.roar_group_call_start(uuid, boolean), public.roar_group_call_end(uuid), public.roar_call_link_create(boolean), public.roar_call_by_link(text), public.roar_call_state(uuid) from public, anon;
grant execute on function public.roar_group_call_start(uuid, boolean), public.roar_group_call_end(uuid), public.roar_call_link_create(boolean), public.roar_call_by_link(text), public.roar_call_state(uuid) to authenticated;
