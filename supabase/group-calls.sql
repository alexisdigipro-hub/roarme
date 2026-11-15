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
create policy roar_group_calls_read on public.roar_group_calls for select to authenticated using (public.roar_is_member(room_id));
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
  update roar_group_calls set ended_at = now() where id = c and ended_at is null and roar_is_member(room_id);
end $$;

revoke all on function public.roar_group_call_start(uuid, boolean), public.roar_group_call_end(uuid) from public, anon;
grant execute on function public.roar_group_call_start(uuid, boolean), public.roar_group_call_end(uuid) to authenticated;
