-- Email reminders for unread messages (Alex, 18 Oct 2026): when someone has new messages and has been away from
-- RoarMe for a while, one email from noreply@themadlions.com says how many and from which chats, never the text.
-- At most one every 3 hours, only for messages from the last 2 days, never for muted chats. Each person can turn
-- them off in Settings > Notifications and Sounds, or with the link at the foot of the email.
-- The Edge Function roar-email sends them (through Resend, its key in the function secret RESEND_API_KEY);
-- pg_cron calls it every 10 minutes. Safe to run again.

create table if not exists public.roar_email_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  token uuid not null default gen_random_uuid(),
  last_sent_at timestamptz
);
create unique index if not exists roar_email_prefs_token on public.roar_email_prefs (token);
alter table public.roar_email_prefs enable row level security;
drop policy if exists roar_email_prefs_read on public.roar_email_prefs;
create policy roar_email_prefs_read on public.roar_email_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_email_prefs_insert on public.roar_email_prefs;
create policy roar_email_prefs_insert on public.roar_email_prefs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists roar_email_prefs_update on public.roar_email_prefs;
create policy roar_email_prefs_update on public.roar_email_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.roar_email_prefs from anon;
grant select, insert on public.roar_email_prefs to authenticated;
revoke update on public.roar_email_prefs from authenticated;
grant update (enabled) on public.roar_email_prefs to authenticated;

-- who is due an email now, with their unread chats (for the Edge Function only)
create or replace function public.roar_email_due(lim int default 50)
returns table (user_id uuid, email text, name text, token uuid, total int, chats jsonb)
language sql stable security definer set search_path = public as $$
  with prefs as (
    -- everyone gets a row (and so a token for the email's off link) the first time they are due
    select u.id, u.email::text as email, coalesce(e.enabled, true) as enabled, e.token, e.last_sent_at
    from auth.users u left join roar_email_prefs e on e.user_id = u.id
    where u.email is not null and u.email_confirmed_at is not null and u.deleted_at is null
  ),
  away as (
    select p.* from prefs p join roar_profiles pr on pr.id = p.id
    where p.enabled and pr.last_seen < now() - interval '10 minutes'
      and (p.last_sent_at is null or p.last_sent_at < now() - interval '3 hours')
  ),
  unread as (
    select a.id as uid, m.room_id, count(*)::int as n, max(x.created_at) as newest,
      bool_or(x.created_at > coalesce(a.last_sent_at, '-infinity'::timestamptz) and x.created_at < now() - interval '10 minutes') as fresh
    from away a
    join roar_members m on m.user_id = a.id and not m.muted
    join roar_messages x on x.room_id = m.room_id and x.created_at > m.last_read_at
      and x.created_at > now() - interval '2 days' and x.user_id is distinct from a.id
      and x.deleted_at is null and x.kind <> 'system'
    group by a.id, m.room_id
  ),
  named as (
    select u.uid, u.n, u.newest, u.fresh,
      case when r.kind = 'group' then nullif(r.title, '')
        else (select coalesce(nullif(p.display_name, ''), '@' || p.username) from roar_members o join roar_profiles p on p.id = o.user_id
              where o.room_id = r.id and o.user_id <> u.uid limit 1) end as chat,
      r.kind
    from unread u join roar_rooms r on r.id = u.room_id
  ),
  due as (
    select uid from named group by uid having bool_or(fresh)
  )
  select a.id, a.email,
    (select coalesce(nullif(display_name, ''), username) from roar_profiles where id = a.id),
    a.token,
    (select sum(n)::int from named where uid = a.id),
    (select jsonb_agg(jsonb_build_object('name', coalesce(chat, 'A chat'), 'n', n, 'group', kind = 'group') order by newest desc)
       from (select * from named where uid = a.id order by newest desc limit 5) t)
  from away a join due d on d.uid = a.id
  limit lim
$$;
revoke all on function public.roar_email_due(int) from public, anon, authenticated;
grant execute on function public.roar_email_due(int) to service_role;

-- the Edge Function marks each email sent (and makes the row, with its token, the first time)
create or replace function public.roar_email_sent(u uuid) returns uuid
language sql security definer set search_path = public as $$
  insert into roar_email_prefs (user_id, last_sent_at) values (u, now())
  on conflict (user_id) do update set last_sent_at = now()
  returning token
$$;
revoke all on function public.roar_email_sent(uuid) from public, anon, authenticated;
grant execute on function public.roar_email_sent(uuid) to service_role;

-- the off link at the foot of an email
create or replace function public.roar_email_off(t uuid) returns boolean
language sql security definer set search_path = public as $$
  with x as (update roar_email_prefs set enabled = false where token = t returning 1) select exists (select 1 from x)
$$;
revoke all on function public.roar_email_off(uuid) from public, anon, authenticated;
grant execute on function public.roar_email_off(uuid) to service_role;

-- every 10 minutes
create extension if not exists pg_net with schema extensions;
select cron.unschedule('roar-email') where exists (select 1 from cron.job where jobname = 'roar-email');
select cron.schedule('roar-email', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-email',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
$$);
