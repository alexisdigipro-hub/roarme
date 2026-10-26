-- RoarTransfer security check (Alex, 26 Oct 2026: "check roartransfer for security holes", then "yes, fix them all").
-- Run after transfer-pro-plus.sql, site-stats.sql and transfer-grace.sql. Safe to run again.

-- 1. Wrong passwords on a transfer: every wrong try is kept a while, so roar-transfer-get can stop guessing (10 wrong
--    tries from one address, or 50 from anywhere, in 15 minutes). Read and written only by the Edge Function.
create table if not exists public.roar_transfer_pw_fails (
  id bigserial primary key,
  token text not null,
  ip text,
  at timestamptz not null default now()
);
create index if not exists roar_transfer_pw_fails_token on public.roar_transfer_pw_fails (token, at desc);
alter table public.roar_transfer_pw_fails enable row level security;
revoke all on public.roar_transfer_pw_fails from anon, authenticated;

-- 2. A download of a file on R2 is counted only by roar-transfer-get (service role), so nobody can use up someone's
--    downloads from the outside; the page still counts opens, and downloads of files that are not on R2.
create or replace function public.roar_transfer_hit(t text, dl boolean, country text default null, agent text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b text; h json; c text; d text; n int; o record; svc boolean;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  begin svc := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role'; exception when others then svc := false; end;
  if dl and not svc and exists (select 1 from public.roar_transfer_links x where x.token = t and x.store = 'r2') then return; end if;
  c := upper(left(coalesce(country, h->>'cf-ipcountry', ''), 2));
  if c = '' or c = 'XX' or c = 'T1' then c := null; end if;
  d := public.roar_transfer_device(coalesce(agent, h->>'user-agent'));
  if dl then
    select e.country, e.device into o from public.roar_transfer_events e
    where e.kind = 'open' and e.at > now() - interval '2 hours'
      and (e.token = t or e.token in (select x.token from public.roar_transfer_bundles x where t = any (x.tokens)))
    order by e.at desc limit 1;
    if found then c := coalesce(o.country, c); d := coalesce(o.device, d); end if;
  end if;
  update public.roar_transfer_links
  set opens = opens + case when dl then 0 else 1 end,
      downloads = downloads + case when dl then 1 else 0 end,
      last_download = case when dl then now() else last_download end
  where expires_at > now()
    and (token = t or (not dl and token = any (coalesce((select x.tokens from public.roar_transfer_bundles x where x.token = t), '{}'))));
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.roar_transfer_events (token, kind, country, device) values (t, case when dl then 'download' else 'open' end, c, d);
  end if;
  if dl then
    update public.roar_transfer_bundles set notified_at = now()
    where t = any (tokens) and notify and (notified_at is null or notified_at < now() - interval '1 hour')
    returning token into b;
    if b is not null then
      perform net.http_post(
        url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roartransfer-notify',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object('bundle', b, 'file', t));
    end if;
  end if;
end $$;
revoke all on function public.roar_transfer_hit(text, boolean, text, text) from public;
grant execute on function public.roar_transfer_hit(text, boolean, text, text) to anon, authenticated, service_role;

-- 3. The site's visits cannot be flooded: one visitor counts a page at most once in 10 seconds, and past 600 visits in
--    a minute (far above real traffic) the rest are not kept.
create or replace function public.roar_site_hit(v text, p text, r text default '', l text default '') returns void
language plpgsql security definer set search_path = public as $$
declare h json; ua text; c text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  ua := coalesce(h->>'user-agent', '');
  if ua ~* 'bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse' then return; end if;
  if (select count(*) from public.roar_site_visits where at > now() - interval '1 minute') >= 600 then return; end if;
  if exists (select 1 from public.roar_site_visits where at > now() - interval '10 seconds' and visitor = left(coalesce(v, ''), 40) and page = left(coalesce(p, ''), 40)) then return; end if;
  c := upper(left(coalesce(h->>'cf-ipcountry', ''), 2));
  if c = '' or c = 'XX' or c = 'T1' then c := null; end if;
  insert into public.roar_site_visits (visitor, page, ref, lang, country, device)
  values (left(coalesce(v, ''), 40), left(coalesce(p, ''), 40), nullif(left(lower(coalesce(r, '')), 80), ''), left(coalesce(l, ''), 5), c, public.roar_transfer_device(ua));
end $$;
revoke all on function public.roar_site_hit(text, text, text, text) from public;
grant execute on function public.roar_site_hit(text, text, text, text) to anon, authenticated;

-- 4. Brand pictures: no SVG any more (an SVG can carry code)
update storage.buckets set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'] where id = 'roartransfer-brand';

-- 5. The site's backgrounds: only reading is open; writing stays the admin's through the policy
revoke truncate, references, trigger on public.roar_transfer_backgrounds from anon, authenticated;
revoke insert, update, delete on public.roar_transfer_backgrounds from anon;

-- 6. Stop works on 7-day links too (week/<id>/), and the device helper has a fixed search_path
create or replace function public.roar_transfer_stop(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p is null or not (
       public.roar_is_admin()
       or (split_part(p, '/', 1) in ('u', 'free', 'week', 'pro') and split_part(p, '/', 2) = auth.uid()::text and split_part(p, '/', 3) <> '')
     ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if split_part(p, '/', 1) not in ('u', 'free', 'week', 'pro') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.roar_transfer_links set stopped_at = coalesce(stopped_at, now()), expires_at = least(expires_at, now())
  where path = p;
end $$;
alter function public.roar_transfer_device(text) set search_path = public;
