-- RoarTransfer Pro, more (Alex, 25 Oct 2026: "yes to unlimited downloads, 20 GB, 30 days, own name and logo and
-- backgrounds on the pages with the links, change expiry or password after sending, stats per link, resume uploads").
-- Run after transfer-pro.sql and transfer-limits.sql. Safe to run again.

-- 1. A Pro's brand: the name and logo on their download pages and Receive-files page, and their own backgrounds
--    (pictures in the public bucket roartransfer-brand, under <user id>/). Written only by roartransfer-pro.
alter table public.roar_transfer_pro add column if not exists brand_name text;
alter table public.roar_transfer_pro add column if not exists brand_logo text;
alter table public.roar_transfer_pro add column if not exists brand_bgs text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roartransfer-brand', 'roartransfer-brand', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

drop policy if exists "roartransfer brand insert own" on storage.objects;
create policy "roartransfer brand insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "roartransfer brand update own" on storage.objects;
create policy "roartransfer brand update own" on storage.objects for update to authenticated
  using (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "roartransfer brand delete own" on storage.objects;
create policy "roartransfer brand delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Stats per link: every open of a download page and every download, with when, the country (Cloudflare's
--    cf-ipcountry in front of Supabase) and the kind of device. Never the address itself. Read by roartransfer-pro.
create table if not exists public.roar_transfer_events (
  id bigserial primary key,
  token text not null,
  kind text not null check (kind in ('open', 'download')),
  at timestamptz not null default now(),
  country text,
  device text
);
create index if not exists roar_transfer_events_token on public.roar_transfer_events (token, at desc);
alter table public.roar_transfer_events enable row level security;
revoke all on public.roar_transfer_events from anon, authenticated;

-- the device from a browser's user agent, in a word or two
create or replace function public.roar_transfer_device(ua text) returns text
language sql immutable as $$
  select case
    when ua is null or ua = '' then null
    when ua ~* 'iphone' then 'iPhone'
    when ua ~* 'ipad' then 'iPad'
    when ua ~* 'android' then 'Android'
    when ua ~* 'macintosh|mac os x' then 'Mac'
    when ua ~* 'windows' then 'Windows'
    when ua ~* 'linux' then 'Linux'
    else 'Other' end
$$;

-- the download page was opened (dl = false) or a file downloaded (dl = true). The page calls it itself, so the
-- country and device come from its own request; roartransfer's Edge Function passes them when it counts a download.
drop function if exists public.roar_transfer_hit(text, boolean);
create or replace function public.roar_transfer_hit(t text, dl boolean, country text default null, agent text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b text; h json; c text; d text; n int;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  c := upper(left(coalesce(country, h->>'cf-ipcountry', ''), 2));
  if c = '' or c = 'XX' or c = 'T1' then c := null; end if;
  d := public.roar_transfer_device(coalesce(agent, h->>'user-agent'));
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

-- 3. The site's own backgrounds (Alex, 25 Oct: "somewhere in Admin to upload the pictures behind the home page and
--    the others"): one row per picture, read by everyone, changed only by an admin. The pictures themselves are in the
--    bucket roartransfer-brand under site/; the six that came with the site (stills/ in the repository) are rows too,
--    so they can be removed like the rest. The page falls back to its own stills when the list is empty.
create table if not exists public.roar_transfer_backgrounds (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.roar_transfer_backgrounds enable row level security;
grant select on public.roar_transfer_backgrounds to anon, authenticated;
grant insert, update, delete on public.roar_transfer_backgrounds to authenticated;
drop policy if exists "backgrounds read" on public.roar_transfer_backgrounds;
create policy "backgrounds read" on public.roar_transfer_backgrounds for select using (true);
drop policy if exists "backgrounds admin" on public.roar_transfer_backgrounds;
create policy "backgrounds admin" on public.roar_transfer_backgrounds for all to authenticated
  using (public.roar_is_admin()) with check (public.roar_is_admin());
insert into public.roar_transfer_backgrounds (url, sort)
select 'stills/' || f, n from unnest(array['salon.webp', 'shoes.webp', 'tartan.webp', 'corridor.webp', 'sunflower.webp', 'silhouette.webp']) with ordinality as x(f, n)
where not exists (select 1 from public.roar_transfer_backgrounds)
on conflict (url) do nothing;

drop policy if exists "roartransfer site insert admin" on storage.objects;
create policy "roartransfer site insert admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = 'site' and public.roar_is_admin());
drop policy if exists "roartransfer site delete admin" on storage.objects;
create policy "roartransfer site delete admin" on storage.objects for delete to authenticated
  using (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = 'site' and public.roar_is_admin());

-- 4. (25 Oct, later) A download is counted by roar-transfer-get on Supabase's servers, whose country header says where
--    that server is (Switzerland), not the person. The person opened the page a moment before from their own browser,
--    so a download takes the country and device of the latest open of the same link (or its upload's link) within
--    two hours, and the header only when there was none.
create or replace function public.roar_transfer_hit(t text, dl boolean, country text default null, agent text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b text; h json; c text; d text; n int; o record;
begin
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
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
