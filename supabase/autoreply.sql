-- Auto-reply (Alex, 18 Oct 2026): Settings > Auto-Reply. When it is on, someone who writes to you in a one-to-one
-- chat gets your text back by itself, once per chat every 12 hours; "Only when I'm away" sends it only while you
-- have not been in RoarMe for 10 minutes, and "Until" turns it off by itself. The reply is a normal message from
-- you, marked file.auto (the app shows "Auto-reply" on it), and it does not mark the chat read for you.
-- Run after scheduled.sql (it uses the same roar_touch_room). Safe to run again.
create table if not exists public.roar_autoreply (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  body text not null default '' check (char_length(body) <= 2000),
  away_only boolean not null default false,
  until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.roar_autoreply enable row level security;
drop policy if exists roar_autoreply_mine on public.roar_autoreply;
create policy roar_autoreply_mine on public.roar_autoreply for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists roar_mfa on public.roar_autoreply;
create policy roar_mfa on public.roar_autoreply as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_autoreply from anon;
grant select, insert, update, delete on public.roar_autoreply to authenticated;

-- when each chat last got one (nobody reads this but the trigger)
create table if not exists public.roar_autoreply_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (user_id, room_id)
);
alter table public.roar_autoreply_sent enable row level security;
revoke all on public.roar_autoreply_sent from anon, authenticated;

create or replace function public.roar_autoreply_send() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  a record;
begin
  if new.kind = 'system' or new.user_id is null or coalesce(new.file, '{}'::jsonb) ?| array['auto', 'scheduled'] then return new; end if;
  if not exists (select 1 from roar_rooms where id = new.room_id and kind = 'direct') then return new; end if;
  select m.user_id into o from roar_members m where m.room_id = new.room_id and m.user_id <> new.user_id limit 1;
  if o is null then return new; end if;
  select * into a from roar_autoreply where user_id = o and enabled and body <> '' and (until is null or until > now());
  if not found then return new; end if;
  if a.away_only and exists (select 1 from roar_profiles where id = o and last_seen > now() - interval '10 minutes') then return new; end if;
  if exists (select 1 from roar_autoreply_sent where user_id = o and room_id = new.room_id and sent_at > now() - interval '12 hours') then return new; end if;
  if exists (select 1 from roar_blocks where (blocker = o and blocked = new.user_id) or (blocker = new.user_id and blocked = o)) then return new; end if;
  if exists (select 1 from roar_e2e_sessions where room_id = new.room_id and ended_at is null) then return new; end if;
  insert into roar_autoreply_sent (user_id, room_id, sent_at) values (o, new.room_id, now())
    on conflict (user_id, room_id) do update set sent_at = excluded.sent_at;
  insert into roar_messages (room_id, user_id, kind, body, file) values (new.room_id, o, 'text', a.body, '{"auto": true}'::jsonb);
  return new;
end $$;
revoke all on function public.roar_autoreply_send() from public, anon, authenticated;
create or replace trigger roar_autoreply after insert on public.roar_messages for each row execute function public.roar_autoreply_send();

-- the reply comes a moment after the message it answers, so it sorts under it (in one go both would get the same time)
create or replace function public.roar_message_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := case when coalesce(new.file, '{}'::jsonb) ? 'auto' then clock_timestamp() else now() end;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $$;
