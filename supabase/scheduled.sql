-- Scheduled messages, as in Telegram (Alex, 18 Oct 2026): hold Send (or right click it) > Schedule Message, pick the
-- day, the time and a repeat. The text waits here and pg_cron sends it, in the writer's name, within the minute.
-- A repeating one moves on to its next time; one in a chat with Encrypted Chat on waits until it is off (it is
-- plain text). Each person sees, changes and deletes only their own. Safe to run again.
create table if not exists public.roar_scheduled (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 8000),
  reply_to uuid references public.roar_messages(id) on delete set null,
  first_at timestamptz not null,
  send_at timestamptz not null,
  repeat text not null default 'never' check (repeat in ('never', 'day', 'week', '2weeks', 'month', '3months', '6months', 'year')),
  times int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists roar_scheduled_due on public.roar_scheduled (send_at);
create index if not exists roar_scheduled_mine on public.roar_scheduled (user_id, room_id);

alter table public.roar_scheduled enable row level security;
drop policy if exists roar_scheduled_read on public.roar_scheduled;
create policy roar_scheduled_read on public.roar_scheduled for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_scheduled_add on public.roar_scheduled;
create policy roar_scheduled_add on public.roar_scheduled for insert to authenticated
  with check (user_id = auth.uid() and public.roar_is_member(room_id) and not public.roar_blocked_in(room_id)
    and (select count(*) from public.roar_scheduled s where s.user_id = auth.uid()) < 300);
drop policy if exists roar_scheduled_change on public.roar_scheduled;
create policy roar_scheduled_change on public.roar_scheduled for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.roar_is_member(room_id));
drop policy if exists roar_scheduled_remove on public.roar_scheduled;
create policy roar_scheduled_remove on public.roar_scheduled for delete to authenticated using (user_id = auth.uid());
drop policy if exists roar_mfa on public.roar_scheduled;
create policy roar_mfa on public.roar_scheduled as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_scheduled from anon;
revoke update on public.roar_scheduled from authenticated;
grant select, insert, delete on public.roar_scheduled to authenticated;
grant update (body, first_at, send_at, repeat, times) on public.roar_scheduled to authenticated;

-- every minute: what is due goes out
create or replace function public.roar_send_scheduled() returns int
language plpgsql security definer set search_path = public as $$
declare
  s record;
  n int := 0;
  step interval;
  k int;
  nxt timestamptz;
begin
  -- only the minute job runs this, never a signed-in person
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  for s in select * from roar_scheduled where send_at <= now() order by send_at limit 500 for update skip locked loop
    -- left the chat: it goes
    if not exists (select 1 from roar_members where room_id = s.room_id and user_id = s.user_id) then
      delete from roar_scheduled where id = s.id;
      continue;
    end if;
    -- Encrypted Chat on: plain text waits until it is off
    if exists (select 1 from roar_e2e_sessions where room_id = s.room_id and ended_at is null) then continue; end if;
    -- blocked either way in a one-to-one chat: not sent
    if not exists (select 1 from roar_rooms x join roar_members m on m.room_id = x.id and m.user_id <> s.user_id
        join roar_blocks b on (b.blocker = s.user_id and b.blocked = m.user_id) or (b.blocker = m.user_id and b.blocked = s.user_id)
        where x.id = s.room_id and x.kind = 'direct') then
      insert into roar_messages (room_id, user_id, kind, body, reply_to, file)
        values (s.room_id, s.user_id, 'text', s.body, (select id from roar_messages where id = s.reply_to and room_id = s.room_id), '{"scheduled": true}'::jsonb);
      n := n + 1;
    end if;
    step := case s.repeat when 'day' then interval '1 day' when 'week' then interval '7 days' when '2weeks' then interval '14 days'
      when 'month' then interval '1 month' when '3months' then interval '3 months' when '6months' then interval '6 months'
      when 'year' then interval '1 year' end;
    if step is null then
      delete from roar_scheduled where id = s.id;
    else
      -- the next time after now, counted from the first one (so the 31st stays the 31st where the month has one)
      k := s.times + 1;
      loop
        nxt := s.first_at + step * k;
        exit when nxt > now();
        k := k + 1;
      end loop;
      update roar_scheduled set send_at = nxt, times = k, reply_to = null where id = s.id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.roar_send_scheduled() from public, anon, authenticated;

-- a message that goes out by itself (scheduled, or an auto-reply) does not mark the chat read for its writer,
-- so what came in before it still shows as unread
create or replace function public.roar_touch_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update roar_rooms set last_message_at = new.created_at where id = new.room_id;
  if not (coalesce(new.file, '{}'::jsonb) ?| array['scheduled', 'auto']) then
    update roar_members set last_read_at = new.created_at where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end $$;

create extension if not exists pg_cron;
select cron.unschedule('roar-scheduled') where exists (select 1 from cron.job where jobname = 'roar-scheduled');
select cron.schedule('roar-scheduled', '* * * * *', $$select public.roar_send_scheduled()$$);
