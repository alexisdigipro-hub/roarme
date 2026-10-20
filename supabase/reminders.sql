-- Remind me about a message, as in Slack (Alex, 20 Oct 2026): in a message's menu, Remind Me, then a time. At that
-- time RoarMe brings it back: in the app if it is open (src/reminders.jsx), else as a notification (Edge Function
-- roar-push, {reminder}), with RoarMe closed too. Only the person who set it ever sees it; nothing is posted in the chat.
-- Run after push.sql. Safe to run again.
create table if not exists public.roar_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  message_id uuid not null references public.roar_messages(id) on delete cascade,
  remind_at timestamptz not null,
  fired_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists roar_reminders_due on public.roar_reminders (remind_at) where fired_at is null;
create index if not exists roar_reminders_mine on public.roar_reminders (user_id, remind_at);

alter table public.roar_reminders enable row level security;
drop policy if exists roar_reminders_read on public.roar_reminders;
create policy roar_reminders_read on public.roar_reminders for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_reminders_add on public.roar_reminders;
create policy roar_reminders_add on public.roar_reminders for insert to authenticated
  with check (user_id = auth.uid() and public.roar_is_member(room_id)
    and exists (select 1 from public.roar_messages m where m.id = message_id and m.room_id = roar_reminders.room_id)
    and remind_at < now() + interval '366 days'
    and (select count(*) from public.roar_reminders r where r.user_id = auth.uid()) < 300);
drop policy if exists roar_reminders_change on public.roar_reminders;
create policy roar_reminders_change on public.roar_reminders for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and remind_at < now() + interval '366 days');
drop policy if exists roar_reminders_remove on public.roar_reminders;
create policy roar_reminders_remove on public.roar_reminders for delete to authenticated using (user_id = auth.uid());
drop policy if exists roar_mfa on public.roar_reminders;
create policy roar_mfa on public.roar_reminders as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_reminders from anon;
revoke update on public.roar_reminders from authenticated;
grant select, insert, delete on public.roar_reminders to authenticated;
grant update (remind_at, fired_at) on public.roar_reminders to authenticated;

-- every minute: what is due is marked and, for someone with notifications on, knocks on roar-push
create or replace function public.roar_fire_reminders() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  n int := 0;
  tok uuid;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select hook_token into tok from roar_push_conf where id = 1;
  for r in select * from roar_reminders where fired_at is null and remind_at <= now() order by remind_at limit 500 for update skip locked loop
    update roar_reminders set fired_at = now() where id = r.id;
    -- left the chat: nothing to bring back
    if not exists (select 1 from roar_members where room_id = r.room_id and user_id = r.user_id) then continue; end if;
    if tok is not null and exists (select 1 from roar_push_subs where user_id = r.user_id) then
      perform net.http_post(
        url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-push',
        body := jsonb_build_object('reminder', r.id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', tok::text)
      );
      n := n + 1;
    end if;
  end loop;
  -- what went off more than 30 days ago goes
  delete from roar_reminders where fired_at < now() - interval '30 days';
  return n;
end $$;
revoke all on function public.roar_fire_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('roar-reminders') where exists (select 1 from cron.job where jobname = 'roar-reminders');
select cron.schedule('roar-reminders', '* * * * *', $$select public.roar_fire_reminders()$$);
