-- Errors from people's devices (Alex, 27 Nov 2026: "when the app breaks for someone, we should know at once").
-- The app (src/errlog.js) sends what went wrong: the message, where in the code, which page, which device and which
-- build. Never a message's words, never a file. The same error is one row that counts its hits. Only the admins read
-- it (Settings > Admin > Errors). Safe to run again.

create table if not exists roar_app_errors (
  id bigserial primary key,
  sig text not null,
  msg text,
  stack text,
  place text,
  device text,
  build text,
  user_id uuid,
  hits int not null default 1,
  people int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  seen boolean not null default false
);
create unique index if not exists roar_app_errors_sig on roar_app_errors (sig);
alter table roar_app_errors enable row level security;
revoke all on roar_app_errors from anon, authenticated;

-- who reported which error today, so one phone in a loop cannot flood it (40 a day) and people are counted once
create table if not exists roar_app_error_log (
  user_id uuid not null,
  day date not null default current_date,
  sig text not null,
  primary key (user_id, day, sig)
);
alter table roar_app_error_log enable row level security;
revoke all on roar_app_error_log from anon, authenticated;

create or replace function roar_report_error(m text, st text, pl text, dev text, b text)
returns void language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  s text;
  fresh boolean;
begin
  if u is null then return; end if;
  if (select count(*) from roar_app_error_log where user_id = u and day = current_date) >= 40 then return; end if;
  m := left(coalesce(m, ''), 500);
  st := left(coalesce(st, ''), 4000);
  -- the same error is the same message and the same first line of where it happened, whatever the build
  s := md5(m || '|' || regexp_replace(split_part(st, E'\n', 2), '[-_.][A-Za-z0-9_-]{6,}\.js', '.js', 'g'));
  insert into roar_app_error_log (user_id, sig) values (u, s) on conflict do nothing;
  fresh := found;
  insert into roar_app_errors (sig, msg, stack, place, device, build, user_id)
  values (s, m, st, left(pl, 200), left(dev, 200), left(b, 100), u)
  on conflict (sig) do update set
    hits = roar_app_errors.hits + 1,
    people = roar_app_errors.people + case when fresh then 1 else 0 end,
    last_at = now(), seen = false,
    stack = excluded.stack, place = excluded.place, device = excluded.device, build = excluded.build, user_id = excluded.user_id;
end $$;
revoke all on function roar_report_error(text, text, text, text, text) from public, anon;
grant execute on function roar_report_error(text, text, text, text, text) to authenticated;

create or replace function roar_admin_errors()
returns table (id bigint, msg text, stack text, place text, device text, build text, hits int, people int,
  first_at timestamptz, last_at timestamptz, seen boolean, username text)
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  return query select e.id, e.msg, e.stack, e.place, e.device, e.build, e.hits, e.people, e.first_at, e.last_at, e.seen, p.username
    from roar_app_errors e left join roar_profiles p on p.id = e.user_id
    order by e.seen, e.last_at desc limit 300;
end $$;
revoke all on function roar_admin_errors() from public, anon;
grant execute on function roar_admin_errors() to authenticated;

create or replace function roar_admin_error_seen(i bigint, s boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  update roar_app_errors set seen = s where i is null or id = i;
end $$;
revoke all on function roar_admin_error_seen(bigint, boolean) from public, anon;
grant execute on function roar_admin_error_seen(bigint, boolean) to authenticated;

-- the log of who reported what is kept a week
create or replace function roar_app_errors_tidy() returns void language sql security definer set search_path = public as $$
  delete from roar_app_error_log where day < current_date - 7;
$$;
revoke all on function roar_app_errors_tidy() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('roar-app-errors-tidy') where exists (select 1 from cron.job where jobname = 'roar-app-errors-tidy');
    perform cron.schedule('roar-app-errors-tidy', '17 3 * * *', 'select roar_app_errors_tidy()');
  end if;
end $$;
