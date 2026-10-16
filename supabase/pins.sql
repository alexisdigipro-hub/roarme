-- Pinned messages, as many as one likes in a chat (17 Oct 2026). Safe to run again.
create table if not exists public.roar_pins (
  message_id uuid primary key references public.roar_messages(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  pinned_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pinned_at timestamptz not null default now()
);
create index if not exists roar_pins_room on public.roar_pins (room_id, pinned_at);
alter table public.roar_pins enable row level security;
drop policy if exists roar_pins_read on public.roar_pins;
create policy roar_pins_read on public.roar_pins for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_pins_add on public.roar_pins;
create policy roar_pins_add on public.roar_pins for insert to authenticated
  with check (pinned_by = auth.uid() and public.roar_is_member(room_id) and exists (select 1 from public.roar_messages m where m.id = message_id and m.room_id = roar_pins.room_id));
drop policy if exists roar_pins_remove on public.roar_pins;
create policy roar_pins_remove on public.roar_pins for delete to authenticated using (public.roar_is_member(room_id));
grant select, insert, delete on public.roar_pins to authenticated;
revoke all on public.roar_pins from anon;
do $$ begin alter publication supabase_realtime add table public.roar_pins; exception when duplicate_object then null; end $$;
-- the one pinned message each chat had before moves in
insert into public.roar_pins (message_id, room_id, pinned_by, pinned_at)
select r.pinned_message_id, r.id, coalesce(r.created_by, (select user_id from public.roar_members m where m.room_id = r.id limit 1)), now()
from public.roar_rooms r where r.pinned_message_id is not null
on conflict do nothing;
