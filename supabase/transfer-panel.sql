-- RoarTransfer panels (Alex, 21 Oct 2026): "for each user a panel where they see what they have sent, and for me, the
-- admin, what everyone has sent and the overall numbers". Shown in the app (Settings > RoarTransfer, Admin > RoarTransfer)
-- and on RoarTransfer's own page (public/transfer/: My transfers, and Admin only for the accounts in roar_admins).
-- Each link now counts how often its page was opened and how often the file was downloaded (the download page
-- calls roar_transfer_hit itself). A person can stop a transfer from their own folder before the 3 days.
-- Names, sizes, types, when, how often downloaded: never what the files say. Run after transfers.sql,
-- roarmail-transfers.sql and admin.sql. Safe to run again.

alter table public.roar_transfer_links add column if not exists opens integer not null default 0;
alter table public.roar_transfer_links add column if not exists downloads integer not null default 0;
alter table public.roar_transfer_links add column if not exists last_download timestamptz;
alter table public.roar_transfer_links add column if not exists stopped_at timestamptz;
create index if not exists roar_transfer_links_path on public.roar_transfer_links (path);
create index if not exists roar_transfer_links_by on public.roar_transfer_links (created_by, created_at desc);

-- the download page was opened (dl = false) or the file downloaded (dl = true); only the Edge Function may count
create or replace function public.roar_transfer_hit(t text, dl boolean) returns void
language sql security definer set search_path = public as $$
  update public.roar_transfer_links
  set opens = opens + case when dl then 0 else 1 end,
      downloads = downloads + case when dl then 1 else 0 end,
      last_download = case when dl then now() else last_download end
  where token = t and expires_at > now()
$$;
-- the public download page (?t=…, signed out, src/transfer.jsx TransferPage) counts its own opens and downloads:
-- only a token that is known and still alive moves anything
revoke all on function public.roar_transfer_hit(text, boolean) from public;
grant execute on function public.roar_transfer_hit(text, boolean) to anon, authenticated, service_role;

-- every transfer ever sent, one row per file: from a chat (roar_messages, bucket roar-transfers) or from a person's
-- own folder u/<id>/ (RoarTransfer's page, RoarMail). Its links add up how often it was opened and downloaded.
-- Kept after the 3 days (the file goes, the record stays), so the numbers cover all time. Only the functions below use it.
create or replace function public.roar_transfer_items()
returns table (path text, user_id uuid, name text, size bigint, type text, created_at timestamptz, expires timestamptz,
  source text, room_kind text, room_title text, token text, links integer, opens bigint, downloads bigint,
  last_download timestamptz, stopped boolean, deleted boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select l.path, (array_agg(l.token order by l.created_at desc))[1] as token, count(*)::int as links,
      sum(l.opens)::bigint as opens, sum(l.downloads)::bigint as downloads, max(l.last_download) as last_download,
      bool_or(l.stopped_at is not null) as stopped, min(l.created_at) as created_at, max(l.expires_at) as expires,
      (array_agg(l.name order by l.created_at))[1] as name, max(l.size) as size, (array_agg(l.type order by l.created_at))[1] as type,
      (array_agg(l.created_by order by l.created_at))[1] as created_by
    from public.roar_transfer_links l group by l.path
  ), i as (
    (select distinct on (m.file ->> 'path') m.file ->> 'path' as path, m.user_id, m.file ->> 'name' as name,
      public.roar_file_size(m.file) as size, m.file ->> 'type' as type, m.created_at,
      case when m.file ? 'expires' then (m.file ->> 'expires')::timestamptz end as expires,
      'chat'::text as source, r.kind as room_kind, case when r.kind = 'group' then r.title end as room_title,
      m.deleted_at is not null as deleted
    from public.roar_messages m left join public.roar_rooms r on r.id = m.room_id
    where m.file ->> 'bucket' = 'roar-transfers' and m.file ? 'path'
    order by m.file ->> 'path', m.created_at)
    union all
    select s.path, s.created_by, s.name, s.size, s.type, s.created_at, s.expires, 'link', null, null, false
    from s where s.path like 'u/%'
  )
  select i.path, i.user_id, coalesce(nullif(i.name, ''), 'file'), coalesce(i.size, 0), coalesce(i.type, ''), i.created_at,
    coalesce(i.expires, s.expires, i.created_at + interval '3 days'),
    i.source, i.room_kind, i.room_title, s.token, coalesce(s.links, 0), coalesce(s.opens, 0), coalesce(s.downloads, 0),
    s.last_download, coalesce(s.stopped, false), i.deleted
  from i left join s on s.path = i.path
$$;
revoke all on function public.roar_transfer_items() from public, anon, authenticated;

-- My transfers: what the caller sent, newest first
create or replace function public.roar_my_transfers()
returns table (path text, name text, size bigint, type text, created_at timestamptz, expires timestamptz, source text,
  room_kind text, room_title text, token text, opens bigint, downloads bigint, last_download timestamptz, stopped boolean, deleted boolean)
language sql stable security definer set search_path = public as $$
  select t.path, t.name, t.size, t.type, t.created_at, t.expires, t.source, t.room_kind, t.room_title, t.token,
    t.opens, t.downloads, t.last_download, t.stopped, t.deleted
  from public.roar_transfer_items() t
  where auth.uid() is not null and t.user_id = auth.uid()
  order by t.created_at desc
  limit 1000
$$;
revoke all on function public.roar_my_transfers() from public, anon;
grant execute on function public.roar_my_transfers() to authenticated;

-- stop a transfer before its 3 days: its links stop working at once; the page then removes the file itself
-- (Storage API, policy roar_transfers_delete below). Only for files in the caller's own folder, or any one for the admin;
-- a file in a chat stays with its message.
create or replace function public.roar_transfer_stop(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p is null or split_part(p, '/', 1) <> 'u' or not (public.roar_own_transfer(p) or public.roar_is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.roar_transfer_links set stopped_at = coalesce(stopped_at, now()), expires_at = least(expires_at, now())
  where path = p;
end $$;
revoke all on function public.roar_transfer_stop(text) from public, anon;
grant execute on function public.roar_transfer_stop(text) to authenticated;

drop policy if exists roar_transfers_delete on storage.objects;
create policy roar_transfers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'roar-transfers' and split_part(name, '/', 1) = 'u' and (public.roar_own_transfer(name) or public.roar_is_admin()));

-- Admin: every transfer with who sent it, newest first, a page at a time; who = one sender only
create or replace function public.roar_admin_transfers(before timestamptz default null, lim int default 100, who uuid default null)
returns table (path text, user_id uuid, username text, display_name text, avatar_url text, email text, name text, size bigint,
  type text, created_at timestamptz, expires timestamptz, source text, room_kind text, room_title text, token text,
  opens bigint, downloads bigint, last_download timestamptz, stopped boolean, deleted boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select t.path, t.user_id, p.username, p.display_name, p.avatar_url, u.email::text, t.name, t.size, t.type, t.created_at,
    t.expires, t.source, t.room_kind, t.room_title, t.token, t.opens, t.downloads, t.last_download, t.stopped, t.deleted
  from public.roar_transfer_items() t
  left join public.roar_profiles p on p.id = t.user_id
  left join auth.users u on u.id = t.user_id
  where (before is null or t.created_at < before) and (who is null or t.user_id = who)
  order by t.created_at desc
  limit least(greatest(coalesce(lim, 100), 1), 500);
end $$;
revoke all on function public.roar_admin_transfers(timestamptz, int, uuid) from public, anon;
grant execute on function public.roar_admin_transfers(timestamptz, int, uuid) to authenticated;

-- Admin: the overall numbers, the last 30 days, the kinds of file and the people who send the most
create or replace function public.roar_admin_transfer_stats() returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
declare res jsonb;
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  with t as (select * from public.roar_transfer_items())
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
    'stored', (select count(*) from storage.objects o where o.bucket_id = 'roar-transfers'),
    'stored_bytes', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o where o.bucket_id = 'roar-transfers'),
    'days', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'n', d.n, 'bytes', d.bytes) order by d.day), '[]'::jsonb) from (
      select g::date as day, count(t.path) as n, coalesce(sum(t.size), 0) as bytes
      from generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') g
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
end $$;
revoke all on function public.roar_admin_transfer_stats() from public, anon;
grant execute on function public.roar_admin_transfer_stats() to authenticated;

-- RoarTransfer on Cloudflare R2 (Alex, 21 Oct 2026: roartransfer.com, its own storage). A link made by the Edge
-- Function roartransfer-r2 has store 'r2' and its path is the R2 key free/<account>/… (pro/… later); R2's own lifecycle
-- rules delete free/ after 3 days and pro/ after 30. roar-transfer-get signs the download on R2 for those.
alter table public.roar_transfer_links add column if not exists store text not null default 'supabase';

create or replace function public.roar_transfer_items()
returns table (path text, user_id uuid, name text, size bigint, type text, created_at timestamptz, expires timestamptz,
  source text, room_kind text, room_title text, token text, links integer, opens bigint, downloads bigint,
  last_download timestamptz, stopped boolean, deleted boolean)
language sql stable security definer set search_path = public as $$
  with s as (
    select l.path, (array_agg(l.token order by l.created_at desc))[1] as token, count(*)::int as links,
      sum(l.opens)::bigint as opens, sum(l.downloads)::bigint as downloads, max(l.last_download) as last_download,
      bool_or(l.stopped_at is not null) as stopped, min(l.created_at) as created_at, max(l.expires_at) as expires,
      (array_agg(l.name order by l.created_at))[1] as name, max(l.size) as size, (array_agg(l.type order by l.created_at))[1] as type,
      (array_agg(l.created_by order by l.created_at))[1] as created_by, bool_or(l.store = 'r2') as r2
    from public.roar_transfer_links l group by l.path
  ), i as (
    (select distinct on (m.file ->> 'path') m.file ->> 'path' as path, m.user_id, m.file ->> 'name' as name,
      public.roar_file_size(m.file) as size, m.file ->> 'type' as type, m.created_at,
      case when m.file ? 'expires' then (m.file ->> 'expires')::timestamptz end as expires,
      'chat'::text as source, r.kind as room_kind, case when r.kind = 'group' then r.title end as room_title,
      m.deleted_at is not null as deleted
    from public.roar_messages m left join public.roar_rooms r on r.id = m.room_id
    where m.file ->> 'bucket' = 'roar-transfers' and m.file ? 'path'
    order by m.file ->> 'path', m.created_at)
    union all
    select s.path, s.created_by, s.name, s.size, s.type, s.created_at, s.expires, 'link', null, null, false
    from s where s.path like 'u/%' or s.r2
  )
  select i.path, i.user_id, coalesce(nullif(i.name, ''), 'file'), coalesce(i.size, 0), coalesce(i.type, ''), i.created_at,
    coalesce(i.expires, s.expires, i.created_at + interval '3 days'),
    i.source, i.room_kind, i.room_title, s.token, coalesce(s.links, 0), coalesce(s.opens, 0), coalesce(s.downloads, 0),
    s.last_download, coalesce(s.stopped, false), i.deleted
  from i left join s on s.path = i.path
$$;
revoke all on function public.roar_transfer_items() from public, anon, authenticated;

-- Stop: one's own u/, free/ or pro/ file, or any of them for the admin (the file on R2 is removed by roartransfer-r2)
create or replace function public.roar_transfer_stop(p text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p is null or not (
       public.roar_is_admin()
       or (split_part(p, '/', 1) in ('u', 'free', 'pro') and split_part(p, '/', 2) = auth.uid()::text and split_part(p, '/', 3) <> '')
     ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if split_part(p, '/', 1) not in ('u', 'free', 'pro') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.roar_transfer_links set stopped_at = coalesce(stopped_at, now()), expires_at = least(expires_at, now())
  where path = p;
end $$;
revoke all on function public.roar_transfer_stop(text) from public, anon;
grant execute on function public.roar_transfer_stop(text) to authenticated;

-- One link for a whole upload (Alex, 21 Oct 2026: "one link, one file or many"). roartransfer-r2 'bundle' makes it
-- from the caller's own file links; roar-transfer-get ?t=<bundle> lists every file still alive with its address.
create table if not exists public.roar_transfer_bundles (
  token text primary key check (token ~ '^[A-Za-z0-9]{10,32}$'),
  tokens text[] not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.roar_transfer_bundles enable row level security;
revoke all on public.roar_transfer_bundles from anon, authenticated;

-- an open of a bundle counts as an open of each of its files; a download is always one file
create or replace function public.roar_transfer_hit(t text, dl boolean) returns void
language sql security definer set search_path = public as $$
  update public.roar_transfer_links
  set opens = opens + case when dl then 0 else 1 end,
      downloads = downloads + case when dl then 1 else 0 end,
      last_download = case when dl then now() else last_download end
  where expires_at > now()
    and (token = t or (not dl and token = any (coalesce((select b.tokens from public.roar_transfer_bundles b where b.token = t), '{}'))))
$$;
revoke all on function public.roar_transfer_hit(text, boolean) from public;
grant execute on function public.roar_transfer_hit(text, boolean) to anon, authenticated, service_role;

-- Send by email, title, message, password, "email me when they download" (Alex, 21 Oct 2026, roartransfer.com).
alter table public.roar_transfer_bundles add column if not exists title text not null default '';
alter table public.roar_transfer_bundles add column if not exists message text not null default '';
alter table public.roar_transfer_bundles add column if not exists recipients text[] not null default '{}';
alter table public.roar_transfer_bundles add column if not exists password_hash text;
alter table public.roar_transfer_bundles add column if not exists notify boolean not null default false;
alter table public.roar_transfer_bundles add column if not exists notified_at timestamptz;
create index if not exists roar_transfer_bundles_tokens on public.roar_transfer_bundles using gin (tokens);

-- a download can tell the sender: at most one email an hour per upload (roartransfer-notify sends it)
create or replace function public.roar_transfer_hit(t text, dl boolean) returns void
language plpgsql security definer set search_path = public as $$
declare b text;
begin
  update public.roar_transfer_links
  set opens = opens + case when dl then 0 else 1 end,
      downloads = downloads + case when dl then 1 else 0 end,
      last_download = case when dl then now() else last_download end
  where expires_at > now()
    and (token = t or (not dl and token = any (coalesce((select x.tokens from public.roar_transfer_bundles x where x.token = t), '{}'))));
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
revoke all on function public.roar_transfer_hit(text, boolean) from public;
grant execute on function public.roar_transfer_hit(text, boolean) to anon, authenticated, service_role;

-- sending without an account (Alex, 21 Oct: a way to get to know us): link only, 24 hours, up to 1 GB, 3 transfers
-- a day per address. roartransfer-r2 makes these with no account (created_by null) and keeps the address for the limit.
alter table public.roar_transfer_links alter column created_by drop not null;
alter table public.roar_transfer_links add column if not exists ip text;
create index if not exists roar_transfer_links_guest on public.roar_transfer_links (ip, created_at) where created_by is null;
alter table public.roar_transfer_bundles alter column created_by drop not null;
alter table public.roar_transfer_bundles add column if not exists ip text;
create index if not exists roar_transfer_bundles_anon on public.roar_transfer_bundles (ip, created_at) where created_by is null;

-- "Report abuse" on the download page; only the Edge Function writes and reads it, the admins get an email
create table if not exists public.roar_transfer_reports (
  id uuid primary key default gen_random_uuid(),
  token text,
  reason text not null default '',
  ip text,
  created_at timestamptz not null default now()
);
alter table public.roar_transfer_reports enable row level security;
revoke all on public.roar_transfer_reports from anon, authenticated;
