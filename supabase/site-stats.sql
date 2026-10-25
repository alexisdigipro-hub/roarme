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
create or replace function public.roar_site_stats(days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
declare since timestamptz := date_trunc('day', now() at time zone 'Europe/Athens') at time zone 'Europe/Athens' - make_interval(days => greatest(days, 1) - 1);
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
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
