-- A notification when a Locked Message opens (Alex, 21 Nov, "ΟΛΑ ΕΚΤΟΣ από κωδικούς"). Run after capsules.sql and push.sql.
-- At a time: every minute the ones whose time has come knock on roar-push {capsule}, which tells the chat's other members.
-- At a place: the first time someone reaches it and it opens, roar-push {capsule, by} tells the sender who opened it.
-- Safe to run again.
alter table public.roar_capsules add column if not exists notified_at timestamptz;

create or replace function public.roar_fire_capsules() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare c record; n int := 0; tok uuid;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  select hook_token into tok from roar_push_conf where id = 1;
  for c in select message_id from roar_capsules
      where notified_at is null and open_at is not null and open_at <= now() and open_at > now() - interval '1 day'
      order by open_at limit 300 for update skip locked loop
    update roar_capsules set notified_at = now() where message_id = c.message_id;
    if tok is not null then
      perform net.http_post(
        url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-push',
        body := jsonb_build_object('capsule', c.message_id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', tok::text));
      n := n + 1;
    end if;
  end loop;
  -- a time long past when this was first run: marked, never told
  update roar_capsules set notified_at = now() where notified_at is null and open_at is not null and open_at <= now() - interval '1 day';
  return n;
end $$;
revoke all on function public.roar_fire_capsules() from public, anon, authenticated;

-- the words, when they may be read; else null with why in the second column (as in capsules.sql, plus the knock when a
-- place opens it the first time)
create or replace function public.roar_capsule_open(msg uuid, la double precision default null, lo double precision default null)
returns table (body text, why text) language plpgsql security definer set search_path = public, extensions as $$
declare c record; d double precision; tok uuid;
begin
  select * into c from roar_capsules where message_id = msg;
  if c.message_id is null then return query select null::text, 'gone'; return; end if;
  if not roar_is_member(c.room_id) then return query select null::text, 'no'; return; end if;
  if c.user_id = auth.uid() then return query select c.body, 'mine'; return; end if;
  if c.open_at is not null and now() >= c.open_at then
    update roar_capsules set opened_at = coalesce(opened_at, now()) where message_id = msg;
    return query select c.body, 'time'; return;
  end if;
  if c.lat is not null and la is not null and lo is not null then
    d := 6371000 * 2 * asin(sqrt(power(sin(radians(la - c.lat) / 2), 2) + cos(radians(c.lat)) * cos(radians(la)) * power(sin(radians(lo - c.lng) / 2), 2)));
    if d <= c.radius_m then
      update roar_capsules set opened_at = coalesce(opened_at, now()) where message_id = msg;
      if c.opened_at is null and c.notified_at is null then
        update roar_capsules set notified_at = now() where message_id = msg;
        select hook_token into tok from roar_push_conf where id = 1;
        if tok is not null then
          perform net.http_post(
            url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-push',
            body := jsonb_build_object('capsule', msg, 'by', auth.uid()),
            headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', tok::text));
        end if;
      end if;
      return query select c.body, 'place'; return;
    end if;
    return query select null::text, 'far:' || round(d)::text; return;
  end if;
  return query select null::text, 'locked';
end $$;
revoke all on function public.roar_capsule_open(uuid, double precision, double precision) from public, anon;
grant execute on function public.roar_capsule_open(uuid, double precision, double precision) to authenticated;

create extension if not exists pg_cron;
select cron.unschedule('roar-capsules') where exists (select 1 from cron.job where jobname = 'roar-capsules');
select cron.schedule('roar-capsules', '* * * * *', $$select public.roar_fire_capsules()$$);
