-- Live location (Alex, 15 Nov, from Telegram's): a message in a chat that follows where its sender is for a while
-- (15 minutes, 1 hour, 8 hours, or until they stop it). The message carries file.live; the place itself lives here,
-- one row per message, updated by the sender's phone and read by the chat's members through Realtime. Safe to run again.
create table if not exists public.roar_live (
  message_id uuid primary key references public.roar_messages (id) on delete cascade,
  room_id uuid not null references public.roar_rooms (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  acc real,
  until timestamptz,
  stopped_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists roar_live_room on public.roar_live (room_id);
alter table public.roar_live enable row level security;
drop policy if exists roar_live_read on public.roar_live;
create policy roar_live_read on public.roar_live for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_live_add on public.roar_live;
create policy roar_live_add on public.roar_live for insert to authenticated with check (user_id = auth.uid() and public.roar_is_member(room_id));
drop policy if exists roar_live_move on public.roar_live;
create policy roar_live_move on public.roar_live for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.roar_live to authenticated;
do $$ begin alter publication supabase_realtime add table public.roar_live; exception when duplicate_object then null; end $$;
