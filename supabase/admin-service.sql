-- Settings > Admin > Service and Backup (Alex, 27 Nov 2026: "a button that does a general service when I press it ...
-- and a button under it that makes a backup"). Only the admins (roar_is_admin()) get an answer. Safe to run again.

-- every run of the Service (the button, or Claude's weekly look at the code) and what it found
create table if not exists roar_service_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null default 'button',   -- 'button' | 'weekly' (Claude's look at the code, written from its session)
  by_user uuid,
  report jsonb not null default '{}'
);
alter table roar_service_runs enable row level security;
revoke all on roar_service_runs from anon, authenticated;

-- one pass over the database: security, attacks, fake profiles, spam, health; a report of green / yellow / red
create or replace function roar_admin_service()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  sec jsonb; atk jsonb; fake jsonb; spam jsonb; health jsonb; data jsonb; rep jsonb;
  su_hour int; su_day int; su_avg numeric;
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;

  -- security: every table behind its rules, every privileged function with a fixed search path, which buckets are open
  sec := jsonb_build_object(
    'no_rls', (select coalesce(jsonb_agg(tablename order by tablename), '[]') from pg_tables where schemaname = 'public' and not rowsecurity),
    'loose_functions', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
    'public_buckets', (select coalesce(jsonb_agg(id order by id), '[]') from storage.buckets where public),
    'admins', (select count(*) from roar_admins)
  );

  -- attacks: sudden waves of sign-ups, someone sending far too fast
  select count(*) into su_hour from auth.users where created_at > now() - interval '1 hour';
  select count(*) into su_day from auth.users where created_at > now() - interval '1 day';
  select coalesce(count(*) / 30.0, 0) into su_avg from auth.users where created_at > now() - interval '30 days';
  atk := jsonb_build_object(
    'signups_hour', su_hour, 'signups_day', su_day, 'signups_avg_day', round(su_avg, 1),
    'fast_senders', (select coalesce(jsonb_agg(x), '[]') from (
       select m.user_id id, p.username, count(*) n from roar_messages m left join roar_profiles p on p.id = m.user_id
       where m.created_at > now() - interval '1 hour' group by m.user_id, p.username having count(*) >= 200 order by n desc limit 20) x)
  );

  -- fake profiles: new accounts with no name or picture, or a name of letters and a run of digits, that reach out to
  -- people who never answer, or that others block or report
  fake := (select coalesce(jsonb_agg(x order by x.score desc), '[]') from (
    select p.id, p.username, p.display_name, p.created_at,
      (select count(*) from roar_rooms r where r.kind = 'direct' and r.created_by = p.id) dms,
      (select count(*) from roar_rooms r where r.kind = 'direct' and r.created_by = p.id
         and not exists (select 1 from roar_messages m where m.room_id = r.id and m.user_id <> p.id)) unanswered,
      (select count(*) from roar_blocks b where b.blocked = p.id) blocked_by,
      (select count(*) from roar_reports rp where rp.reported = p.id) reported,
      (case when coalesce(p.display_name, '') = '' then 1 else 0 end
       + case when coalesce(p.avatar_url, '') = '' then 1 else 0 end
       + case when p.username ~ '^[a-z_.]+[0-9]{3,}$' then 2 else 0 end
       + least(3, (select count(*) from roar_blocks b where b.blocked = p.id))::int
       + least(3, (select count(*) from roar_reports rp where rp.reported = p.id))::int * 2
       + least(3, (select count(*) from roar_rooms r where r.kind = 'direct' and r.created_by = p.id
           and not exists (select 1 from roar_messages m where m.room_id = r.id and m.user_id <> p.id)))::int) score
    from roar_profiles p
    where p.created_at > now() - interval '30 days' and not exists (select 1 from roar_admins a where a.user_id = p.id)
      and not exists (select 1 from roar_suspended s where s.user_id = p.id)
  ) x where x.score >= 3);

  -- spam: the same words sent into many chats in a day, links from accounts a few days old
  spam := jsonb_build_object(
    'same_text', (select coalesce(jsonb_agg(x), '[]') from (
       select m.user_id id, p.username, left(m.body, 80) body, count(distinct m.room_id) rooms
       from roar_messages m left join roar_profiles p on p.id = m.user_id
       where m.created_at > now() - interval '1 day' and m.kind = 'text' and length(coalesce(m.body, '')) >= 8 and m.deleted_at is null
       group by m.user_id, p.username, m.body having count(distinct m.room_id) >= 5 order by rooms desc limit 20) x),
    'new_links', (select coalesce(jsonb_agg(x), '[]') from (
       select m.user_id id, p.username, count(*) n
       from roar_messages m join roar_profiles p on p.id = m.user_id
       where m.created_at > now() - interval '1 day' and p.created_at > now() - interval '3 days' and m.body ~* 'https?://'
       group by m.user_id, p.username having count(*) >= 5 order by n desc limit 20) x)
  );

  -- health: errors from devices, reports waiting, scheduled jobs that failed in the last day
  health := jsonb_build_object(
    'errors_new', (select count(*) from roar_app_errors where not seen),
    'errors_week', (select coalesce(sum(hits), 0) from roar_app_errors where last_at > now() - interval '7 days'),
    'reports_open', (select count(*) from roar_reports where handled_at is null),
    'reports_old', (select count(*) from roar_reports where handled_at is null and created_at < now() - interval '24 hours'),
    'jobs_failed', (select coalesce(jsonb_agg(x), '[]') from (
       select j.jobname, count(*) n, max(d.start_time) last from cron.job_run_details d join cron.job j on j.jobid = d.jobid
       where d.status = 'failed' and d.start_time > now() - interval '1 day' group by j.jobname order by n desc) x),
    'blocked_accounts', (select count(*) from roar_suspended)
  );

  -- the data: people, chats, messages, files, the database's size
  data := jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts_week', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'chats', (select count(*) from roar_rooms),
    'messages', (select count(*) from roar_messages),
    'messages_day', (select count(*) from roar_messages where created_at > now() - interval '1 day'),
    'files_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0) from storage.objects where bucket_id in ('roar-files', 'roar-avatars', 'roar-walls')),
    'db_mb', (select round(pg_database_size(current_database()) / 1048576.0)),
    'orphan_push', (select count(*) from roar_push_subs s where not exists (select 1 from auth.users u where u.id = s.user_id)),
    'old_seen_errors', (select count(*) from roar_app_errors where seen and last_at < now() - interval '30 days')
  );

  rep := jsonb_build_object('at', now(), 'security', sec, 'attacks', atk, 'fake', fake, 'spam', spam, 'health', health, 'data', data,
    'last_weekly', (select jsonb_build_object('at', at, 'report', report) from roar_service_runs where kind = 'weekly' order by at desc limit 1),
    'backups', (select count(*) from roar_backups));
  insert into roar_service_runs (kind, by_user, report) values ('button', auth.uid(), rep);
  delete from roar_service_runs where kind = 'button' and id not in (select id from roar_service_runs where kind = 'button' order by at desc limit 30);
  return rep;
end $$;

-- the tidy-up the Service may do by itself: notification records of accounts that are gone, errors looked at long ago
create or replace function roar_admin_service_clean()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a int; b int;
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  delete from roar_push_subs s where not exists (select 1 from auth.users u where u.id = s.user_id);
  get diagnostics a = row_count;
  delete from roar_app_errors where seen and last_at < now() - interval '30 days';
  get diagnostics b = row_count;
  return jsonb_build_object('push', a, 'errors', b);
end $$;

create or replace function roar_admin_service_runs()
returns table (id bigint, at timestamptz, kind text, report jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return query select r.id, r.at, r.kind, r.report from roar_service_runs r order by r.at desc limit 20;
end $$;

-- Backup: a copy of every RoarMe table (and the accounts' id, email, phone and dates) kept inside the database, the
-- newest 10, made by the button and once a day by pg_cron 'roar-backup'; Download hands it to the computer as one file.
-- Supabase's own daily backups (the Pro plan) stand behind this; this one is ours to keep and take away.
create table if not exists roar_backups (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null default 'auto',
  tables int,
  rows bigint,
  bytes bigint,
  data jsonb not null
);
alter table roar_backups enable row level security;
revoke all on roar_backups from anon, authenticated;

create or replace function roar_backup_make(k text default 'auto')
returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; d jsonb := '{}'; n bigint := 0; c int := 0; part jsonb; rid bigint; sz bigint;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'roar\_%'
             and tablename not in ('roar_backups', 'roar_service_runs', 'roar_app_error_log') order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %I x', t.tablename) into part;
    d := d || jsonb_build_object(t.tablename, part);
    n := n + jsonb_array_length(part); c := c + 1;
  end loop;
  d := d || jsonb_build_object('auth_users', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'email', email, 'phone', phone,
         'created_at', created_at, 'last_sign_in_at', last_sign_in_at)), '[]') from auth.users));
  sz := octet_length(d::text);
  insert into roar_backups (kind, tables, rows, bytes, data) values (k, c, n, sz, d) returning id into rid;
  delete from roar_backups where id not in (select id from roar_backups order by at desc limit 10);
  return jsonb_build_object('id', rid, 'tables', c, 'rows', n, 'bytes', sz);
end $$;
revoke all on function roar_backup_make(text) from public, anon, authenticated;

create or replace function roar_admin_backup()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return roar_backup_make('button');
end $$;

create or replace function roar_admin_backups()
returns table (id bigint, at timestamptz, kind text, tables int, rows bigint, bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return query select b.id, b.at, b.kind, b.tables, b.rows, b.bytes from roar_backups b order by b.at desc;
end $$;

create or replace function roar_admin_backup_get(i bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return (select jsonb_build_object('at', at, 'kind', kind, 'data', data) from roar_backups where id = i);
end $$;

do $$ declare f text; begin
  foreach f in array array['roar_admin_service()', 'roar_admin_service_clean()', 'roar_admin_service_runs()', 'roar_admin_backup()',
                           'roar_admin_backups()', 'roar_admin_backup_get(bigint)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('roar-backup') where exists (select 1 from cron.job where jobname = 'roar-backup');
    perform cron.schedule('roar-backup', '41 2 * * *', $c$select roar_backup_make('auto')$c$);
  end if;
end $$;
