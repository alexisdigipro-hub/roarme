-- Report a message or a person (Alex, 14 Nov 2026, for the App Store: an app where people write to each other must let
-- them report what is objectionable, and someone must look at it). Safe to run again.
--  roar_reports: who reported, whom, which message, why, and the message's words as they were at that moment. Nobody
--    reads or writes the table itself; it is reached only through the functions below.
--  roar_report: any signed-in person, about a message of a chat they are in or about a person; at most 30 a day.
--    The words of an Encrypted Chat message are locked, so only the fact is kept, never the text.
--  roar_admin_reports / roar_admin_report_done: only the admins (roar_is_admin()).
create table if not exists public.roar_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid not null references auth.users(id) on delete cascade,
  reported uuid references auth.users(id) on delete set null,
  message_id uuid,
  room_id uuid,
  reason text not null check (reason in ('spam', 'abuse', 'violence', 'sexual', 'illegal', 'other')),
  note text not null default '' check (length(note) <= 1000),
  body text not null default '',
  kind text not null default '',
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid
);
create index if not exists roar_reports_open on public.roar_reports (created_at desc) where handled_at is null;
create index if not exists roar_reports_by on public.roar_reports (reporter, created_at desc);
alter table public.roar_reports enable row level security;
revoke all on public.roar_reports from anon, authenticated;

create or replace function public.roar_report(p_user uuid, p_message uuid, p_reason text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m record;
  who uuid := p_user;
  txt text := '';
  knd text := '';
  rid uuid := null;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_reason is null or p_reason not in ('spam', 'abuse', 'violence', 'sexual', 'illegal', 'other') then raise exception 'Pick a reason'; end if;
  if (select count(*) from roar_reports where reporter = me and created_at > now() - interval '1 day') >= 30 then
    raise exception 'That is many reports for one day. Try again tomorrow.';
  end if;
  if p_message is not null then
    select x.user_id, x.room_id, x.body, x.kind into m from roar_messages x
      where x.id = p_message and exists (select 1 from roar_members mm where mm.room_id = x.room_id and mm.user_id = me);
    if not found then raise exception 'That message is not in one of your chats'; end if;
    who := m.user_id; rid := m.room_id; knd := coalesce(m.kind, '');
    -- an Encrypted Chat message is locked text the server cannot read: keep none of it
    txt := case when coalesce(m.body, '') like 'e2e1.%' then '' else left(coalesce(m.body, ''), 4000) end;
    if exists (select 1 from roar_reports where reporter = me and message_id = p_message) then return; end if;
  end if;
  if who is null then raise exception 'Nothing to report'; end if;
  if who = me then raise exception 'That is your own'; end if;
  insert into roar_reports (reporter, reported, message_id, room_id, reason, note, body, kind)
    values (me, who, p_message, rid, p_reason, left(coalesce(trim(p_note), ''), 1000), txt, knd);
end $$;

create or replace function public.roar_admin_reports(open_only boolean default true)
returns table (id uuid, created_at timestamptz, reason text, note text, body text, kind text, message_id uuid,
  message_gone boolean, reporter uuid, reporter_username text, reporter_name text, reported uuid,
  reported_username text, reported_name text, reported_avatar text, others bigint, handled_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  select r.id, r.created_at, r.reason, r.note, r.body, r.kind, r.message_id,
    r.message_id is not null and not exists (select 1 from public.roar_messages m where m.id = r.message_id and m.deleted_at is null),
    r.reporter, a.username, a.display_name, r.reported, b.username, b.display_name, b.avatar_url,
    (select count(*) from public.roar_reports o where o.reported = r.reported and o.id <> r.id),
    r.handled_at
  from public.roar_reports r
  left join public.roar_profiles a on a.id = r.reporter
  left join public.roar_profiles b on b.id = r.reported
  where not coalesce(open_only, true) or r.handled_at is null
  order by r.created_at desc
  limit 300;
end $$;

create or replace function public.roar_admin_report_done(r uuid, done boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.roar_reports set handled_at = case when coalesce(done, true) then now() else null end,
    handled_by = case when coalesce(done, true) then auth.uid() else null end where id = r;
end $$;

revoke all on function public.roar_report(uuid, uuid, text, text), public.roar_admin_reports(boolean), public.roar_admin_report_done(uuid, boolean) from public, anon;
grant execute on function public.roar_report(uuid, uuid, text, text), public.roar_admin_reports(boolean), public.roar_admin_report_done(uuid, boolean) to authenticated;
