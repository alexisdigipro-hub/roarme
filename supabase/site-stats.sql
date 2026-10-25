-- roartransfer.com's own visitor numbers (Alex, 25 Oct 2026: "now I want statistics of the website, a tab in admin").
-- No cookies and no addresses: each page sends one hit with a random id kept in that browser (localStorage), the page,
-- where the visitor came from (the other site's name only) and the language; the country comes from Cloudflare's
-- cf-ipcountry header in front of Supabase and the kind of device from the browser's user agent. Only the admin reads
-- the totals (roar_site_stats). Run after transfer-pro-plus.sql (roar_transfer_device). Safe to run again.

create table if not exists public.roar_site_visits (
  id bigserial primary key,
  at timestamptz not null default now(),
  visitor text,
  page text,
  ref text,
  lang text,
  country text,
  device text
);
create index if not exists roar_site_visits_at on public.roar_site_visits (at desc);
alter table public.roar_site_visits enable row level security;
revoke all on public.roar_site_visits from anon, authenticated;

-- one page seen; robots (by their user agent) are left out
create or replace function public.roar_site_hit(v text, p text, r text default '', l text default '') returns void
language plpgsql security definer set search_path = public as $$
declare h json; ua text; c text;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  ua := coalesce(h->>'user-agent', '');
  if ua ~* 'bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse' then return; end if;
  c := upper(left(coalesce(h->>'cf-ipcountry', ''), 2));
  if c = '' or c = 'XX' or c = 'T1' then c := null; end if;
  insert into public.roar_site_visits (visitor, page, ref, lang, country, device)
  values (left(coalesce(v, ''), 40), left(coalesce(p, ''), 40), nullif(left(lower(coalesce(r, '')), 80), ''), left(coalesce(l, ''), 5), c, public.roar_transfer_device(ua));
end $$;
revoke all on function public.roar_site_hit(text, text, text, text) from public;
grant execute on function public.roar_site_hit(text, text, text, text) to anon, authenticated;

-- the admin's numbers for the last `days` days (Athens time): visitors and views per day, now, today, the countries,
-- devices, pages, where people came from and languages
-- days 0 = All time (Alex, 25 Oct: "and All time, everywhere"), from the first visit counted
create or replace function public.roar_site_stats(days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz;
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if days > 0 then since := date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens' - make_interval(days => days - 1);
  else since := coalesce((select date_trunc('day', min(at) at time zone 'Europe/Athens') at time zone 'Europe/Athens' from public.roar_site_visits), date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens'); end if;
  return (
    with v as (select * from public.roar_site_visits where at >= since),
    today as (select * from v where at >= date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens')
    select json_build_object(
      'visitors', (select count(distinct visitor) from v),
      'views', (select count(*) from v),
      'today_visitors', (select count(distinct visitor) from today),
      'today_views', (select count(*) from today),
      'now', (select count(distinct visitor) from v where at > now() - interval '5 minutes'),
      'week', (select count(distinct visitor) from v where at > now() - interval '7 days'),
      'returning', (select count(*) from (select visitor from v group by visitor having count(distinct (at at time zone 'Europe/Athens')::date) > 1) x),
      'days', (select json_agg(json_build_object('day', d, 'visitors', coalesce(x.vs, 0), 'views', coalesce(x.n, 0)) order by d)
               from generate_series((since at time zone 'Europe/Athens')::date, (now() at time zone 'Europe/Athens')::date, interval '1 day') d
               left join (select (at at time zone 'Europe/Athens')::date dd, count(distinct visitor) vs, count(*) n from v group by 1) x on x.dd = d::date),
      'countries', (select json_agg(t) from (select country, count(distinct visitor) n from v where country is not null group by 1 order by 2 desc limit 12) t),
      'devices', (select json_agg(t) from (select coalesce(device, 'Other') device, count(distinct visitor) n from v group by 1 order by 2 desc) t),
      'pages', (select json_agg(t) from (select page, count(*) n, count(distinct visitor) vs from v group by 1 order by 2 desc limit 12) t),
      'refs', (select json_agg(t) from (select ref, count(distinct visitor) n from v where ref is not null group by 1 order by 2 desc limit 12) t),
      'langs', (select json_agg(t) from (select lang, count(distinct visitor) n from v where lang <> '' group by 1 order by 2 desc) t)
    ) from (select 1) one
  );
end $$;
revoke all on function public.roar_site_stats(int) from public, anon;
grant execute on function public.roar_site_stats(int) to authenticated;

-- Admin > Transfers for a period too (7, 30, 90 days, 0 = All time): the same numbers as roar_admin_transfer_stats()
-- (kept for the RoarMe app), counted over the transfers sent in that period, one bar a day from its start
create or replace function public.roar_admin_transfer_stats(days int) returns jsonb
language plpgsql stable security definer set search_path to 'public', 'storage' as $function$
declare res jsonb; since timestamptz; first date;
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if days > 0 then since := date_trunc('day', now()) - make_interval(days => days - 1); else since := '-infinity'; end if;
  with t as (select * from public.roar_transfer_items_people() x where x.created_at >= since)
  select coalesce(min(created_at)::date, now()::date) into first from t;
  with t as (select * from public.roar_transfer_items_people() x where x.created_at >= since)
  select jsonb_build_object(
    'transfers', (select count(*) from t),
    'bytes', (select coalesce(sum(size), 0) from t),
    'senders', (select count(distinct user_id) from t),
    'from_chat', (select count(*) from t where source = 'chat'),
    'from_link', (select count(*) from t where source = 'link'),
    'active', (select count(*) from t where expires > now() and not stopped and not deleted),
    'active_bytes', (select coalesce(sum(size), 0) from t where expires > now() and not stopped and not deleted),
    'opens', (select coalesce(sum(opens), 0) from t),
    'downloads', (select coalesce(sum(downloads), 0) from t),
    'week', (select count(*) from t where created_at > now() - interval '7 days'),
    'week_bytes', (select coalesce(sum(size), 0) from t where created_at > now() - interval '7 days'),
    'biggest', (select coalesce(max(size), 0) from t),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'n', d.n, 'bytes', d.bytes) order by d.day), '[]'::jsonb) from (
      select g::date as day, count(t.path) as n, coalesce(sum(t.size), 0) as bytes
      from generate_series(case when days > 0 then since::date else first end, now()::date, interval '1 day') g
      left join t on t.created_at::date = g::date
      group by g) d),
    'kinds', (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n, 'bytes', k.bytes)), '[]'::jsonb) from (
      select case when type like 'video/%' then 'video' when type like 'image/%' then 'image' when type like 'audio/%' then 'audio' else 'other' end as kind,
        count(*) as n, coalesce(sum(size), 0) as bytes
      from t group by 1) k),
    'top', (select coalesce(jsonb_agg(to_jsonb(x) order by x.bytes desc), '[]'::jsonb) from (
      select t.user_id as id, p.username, p.display_name, p.avatar_url, u.email::text as email,
        count(*) as n, coalesce(sum(t.size), 0) as bytes, coalesce(sum(t.downloads), 0) as downloads, max(t.created_at) as last
      from t left join public.roar_profiles p on p.id = t.user_id left join auth.users u on u.id = t.user_id
      group by t.user_id, p.username, p.display_name, p.avatar_url, u.email
      order by bytes desc limit 20) x)
  ) into res;
  return res;
end $function$;
revoke all on function public.roar_admin_transfer_stats(int) from public, anon;
grant execute on function public.roar_admin_transfer_stats(int) to authenticated;
