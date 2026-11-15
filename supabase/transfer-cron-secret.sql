-- RoarTransfer security check, 15 Nov 2026 (safe to run again). roar-transfer-sweep and roartransfer-notify take no
-- sign-in, so anyone could call them: the sweep over and over (each call lists the whole R2 bucket), the notify to send a
-- "Downloaded" email again. Now the database's own callers (pg_cron, roar_transfer_hit) send a secret kept in Vault in
-- the header x-roar-cron, and both functions ask roar_cron_ok() before doing anything. Nobody ever types the secret.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'roar_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'roar_cron_secret', 'RoarTransfer: pg_cron and triggers to Edge Functions');
  end if;
end $$;

create or replace function public.roar_cron_ok(s text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(s, '') <> '' and s = (select decrypted_secret from vault.decrypted_secrets where name = 'roar_cron_secret' limit 1)
$$;
revoke all on function public.roar_cron_ok(text) from public, anon, authenticated;
grant execute on function public.roar_cron_ok(text) to service_role;

create or replace function public.roar_cron_headers() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('Content-Type', 'application/json',
    'x-roar-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'roar_cron_secret' limit 1))
$$;
revoke all on function public.roar_cron_headers() from public, anon, authenticated;

select cron.unschedule('roar-transfer-sweep') where exists (select 1 from cron.job where jobname = 'roar-transfer-sweep');
select cron.schedule('roar-transfer-sweep', '7 * * * *', $c$
  select net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-transfer-sweep',
    headers := public.roar_cron_headers(),
    body := '{}'::jsonb
  )
$c$);

create or replace function public.roar_transfer_hit(t text, dl boolean, country text default null, agent text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
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
        headers := public.roar_cron_headers(),
        body := jsonb_build_object('bundle', b, 'file', t));
    end if;
  end if;
end $function$;
