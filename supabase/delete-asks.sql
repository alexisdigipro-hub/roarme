-- Deleting what others wrote (Alex, 18 Oct 2026). Two things, safe to run again:
-- 1. Delete for Me: anyone hides any message from their own view of a chat (also the "turned on / off Encrypted
--    Chat" lines and messages this device cannot open). Kept in roar_msg_hides, one row per person and message.
-- 2. Ask to Delete for Everyone: on someone else's message you ask its writer; they get Accept / Decline in the chat,
--    and Accept deletes it for everyone. roar_delete_asks, through roar_ask_delete() and roar_answer_delete().
create table if not exists public.roar_msg_hides (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id uuid not null references public.roar_messages(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists roar_msg_hides_room on public.roar_msg_hides (user_id, room_id);
alter table public.roar_msg_hides enable row level security;
drop policy if exists roar_msg_hides_mine on public.roar_msg_hides;
create policy roar_msg_hides_mine on public.roar_msg_hides for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.roar_is_member(room_id)
    and exists (select 1 from public.roar_messages m where m.id = message_id and m.room_id = roar_msg_hides.room_id));
drop policy if exists roar_mfa on public.roar_msg_hides;
create policy roar_mfa on public.roar_msg_hides as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_msg_hides from anon;
grant select, insert, update, delete on public.roar_msg_hides to authenticated; -- update too: the app saves with an upsert

create table if not exists public.roar_delete_asks (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.roar_messages(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  asked_by uuid not null references auth.users(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index if not exists roar_delete_asks_one on public.roar_delete_asks (message_id, asked_by) where status = 'pending';
create index if not exists roar_delete_asks_room on public.roar_delete_asks (room_id, status);
alter table public.roar_delete_asks enable row level security;
drop policy if exists roar_delete_asks_read on public.roar_delete_asks;
create policy roar_delete_asks_read on public.roar_delete_asks for select to authenticated using (asked_by = auth.uid() or owner = auth.uid());
drop policy if exists roar_mfa on public.roar_delete_asks;
create policy roar_mfa on public.roar_delete_asks as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_delete_asks from anon;
revoke insert, update, delete on public.roar_delete_asks from authenticated;
grant select on public.roar_delete_asks to authenticated;
do $$ begin alter publication supabase_realtime add table public.roar_delete_asks; exception when duplicate_object then null; end $$;

create or replace function public.roar_ask_delete(msg uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m record; ask uuid;
begin
  select id, room_id, user_id, kind, deleted_at into m from roar_messages where id = msg;
  if m.id is null or not roar_is_member(m.room_id) then raise exception 'not allowed'; end if;
  if m.user_id is null or m.user_id = auth.uid() or m.kind = 'system' or m.deleted_at is not null then raise exception 'This message cannot be asked for'; end if;
  if not exists (select 1 from roar_members where room_id = m.room_id and user_id = m.user_id) then raise exception 'They are no longer in this chat'; end if;
  select id into ask from roar_delete_asks where message_id = msg and asked_by = auth.uid() and status = 'pending';
  if ask is not null then return ask; end if;
  insert into roar_delete_asks (message_id, room_id, asked_by, owner) values (msg, m.room_id, auth.uid(), m.user_id) returning id into ask;
  return ask;
end $$;

create or replace function public.roar_answer_delete(ask uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from roar_delete_asks where id = ask;
  if a.id is null or a.owner <> auth.uid() then raise exception 'not allowed'; end if;
  if a.status <> 'pending' then return; end if;
  update roar_delete_asks set status = case when accept then 'accepted' else 'declined' end, answered_at = now() where id = ask;
  if accept then
    update roar_messages set deleted_at = now(), body = '' where id = a.message_id and user_id = auth.uid() and deleted_at is null;
    -- anyone else who asked for the same message has their answer too
    update roar_delete_asks set status = 'accepted', answered_at = now() where message_id = a.message_id and status = 'pending';
  end if;
end $$;
revoke all on function public.roar_ask_delete(uuid), public.roar_answer_delete(uuid, boolean) from public, anon;
grant execute on function public.roar_ask_delete(uuid), public.roar_answer_delete(uuid, boolean) to authenticated;
