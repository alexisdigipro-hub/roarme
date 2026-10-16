-- RoarTransfer (16 Oct 2026): files over 50 MB, up to 3 GB, kept 3 days. Safe to run again.
insert into storage.buckets (id, name, public, file_size_limit)
values ('roar-transfers', 'roar-transfers', false, 3221225472)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists roar_transfers_read on storage.objects;
create policy roar_transfers_read on storage.objects for select to authenticated
  using (bucket_id = 'roar-transfers' and public.roar_file_ok(name));
drop policy if exists roar_transfers_write on storage.objects;
create policy roar_transfers_write on storage.objects for insert to authenticated
  with check (bucket_id = 'roar-transfers' and public.roar_file_ok(name));

-- what is older than 3 days; only the sweep (service role) may ask
create or replace function public.roar_expired_transfers() returns setof text
language sql stable security definer set search_path = public, storage as $$
  select name from storage.objects
  where bucket_id = 'roar-transfers' and created_at < now() - interval '3 days'
  limit 500
$$;
revoke all on function public.roar_expired_transfers() from public, anon, authenticated;
grant execute on function public.roar_expired_transfers() to service_role;

-- every hour the Edge Function roar-transfer-sweep removes them
create extension if not exists pg_net with schema extensions;
select cron.unschedule('roar-transfer-sweep') where exists (select 1 from cron.job where jobname = 'roar-transfer-sweep');
select cron.schedule('roar-transfer-sweep', '7 * * * *', $$
  select net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-transfer-sweep',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
$$);

-- RoarTransfer download links (16 Oct 2026): a short token per file; the Edge Function roar-transfer-get turns it into
-- a download for anyone with the link until the file expires. Only members of the chat can make one.
create table if not exists public.roar_transfer_links (
  token text primary key check (token ~ '^[A-Za-z0-9]{10,32}$'),
  path text not null,
  name text not null default '',
  size bigint not null default 0,
  type text not null default '',
  expires_at timestamptz not null,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.roar_transfer_links enable row level security;
drop policy if exists roar_transfer_links_insert on public.roar_transfer_links;
create policy roar_transfer_links_insert on public.roar_transfer_links for insert to authenticated
  with check (created_by = auth.uid() and public.roar_file_ok(path) and expires_at <= now() + interval '3 days 1 hour');
drop policy if exists roar_transfer_links_read on public.roar_transfer_links;
create policy roar_transfer_links_read on public.roar_transfer_links for select to authenticated
  using (public.roar_file_ok(path));
grant select, insert on public.roar_transfer_links to authenticated;
revoke all on public.roar_transfer_links from anon;
