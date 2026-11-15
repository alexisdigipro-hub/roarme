-- RoarTransfer security check, 15 Nov 2026. Safe to run again.
-- 1. A link row made straight from the app (RoarMe's own transfer.jsx) can only be the plain kind: Supabase storage,
--    no download limit, no pay lock, and no "." or ".." pieces in its path (they could aim it at someone else's file).
drop policy if exists roar_transfer_links_insert on public.roar_transfer_links;
create policy roar_transfer_links_insert on public.roar_transfer_links for insert to authenticated
  with check (created_by = auth.uid() and (public.roar_file_ok(path) or public.roar_own_transfer(path))
    and path !~ '(^|/)\.\.?(/|$)' and store = 'supabase' and max_downloads is null and coalesce(pay_lock, false) = false
    and expires_at <= now() + interval '3 days 1 hour');

-- 2. What the Privacy Policy promises about keeping data, done once a day:
--    a transfer's record (title, message, recipients, IP, opens and downloads) 30 days after its link ends,
--    Receive files messages after 60 days, sign-up and reset requests after 30 days, claims after 60 days,
--    abuse reports after 12 months, visit counts after 13 months.
create or replace function public.roar_transfer_forget() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.roar_transfer_bundles b where b.expires_at < now() - interval '30 days'
    and not exists (select 1 from public.roar_transfer_links l where l.token = any(b.tokens::text[]) and l.expires_at > now() - interval '30 days');
  delete from public.roar_transfer_events e where e.at < now() - interval '30 days'
    and not exists (select 1 from public.roar_transfer_links l where l.token = e.token)
    and not exists (select 1 from public.roar_transfer_bundles b where b.token = e.token);
  delete from public.roar_transfer_inbox where created_at < now() - interval '60 days';
  delete from public.roar_transfer_claims where created_at < now() - interval '60 days';
  delete from public.roar_transfer_auth_log where created_at < now() - interval '30 days';
  delete from public.roar_transfer_reports where created_at < now() - interval '12 months';
  delete from public.roar_site_visits where at < now() - interval '13 months';
end $$;
revoke all on function public.roar_transfer_forget() from public, anon, authenticated;

select cron.unschedule('roar-transfer-forget') where exists (select 1 from cron.job where jobname = 'roar-transfer-forget');
select cron.schedule('roar-transfer-forget', '23 3 * * *', 'select public.roar_transfer_forget()');
