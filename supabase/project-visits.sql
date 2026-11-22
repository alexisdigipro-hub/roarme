-- Who comes into a project and for how long (Alex, 22 Nov 2026: "in Admin's statistics, how often each person came in,
-- how much they worked in it"). One row per person, project and day: how many times the workspace was opened and how
-- many seconds it stood open in sight. Written only through roar_visit (a member, for themselves), read only through
-- roar_visit_stats by those who see the project's Admin (the group's admins and its access list). Safe to run again.

create table if not exists public.roar_room_visits (
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  opens int not null default 0,
  secs int not null default 0,
  last_at timestamptz not null default now(),
  primary key (room_id, user_id, day)
);
alter table public.roar_room_visits enable row level security;
revoke all on public.roar_room_visits from anon, authenticated;

create or replace function public.roar_visit(r uuid, opened boolean, add_secs int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not roar_is_member(r) then return; end if;
  insert into roar_room_visits (room_id, user_id, day, opens, secs, last_at)
    values (r, auth.uid(), current_date, case when opened then 1 else 0 end, greatest(0, least(coalesce(add_secs, 0), 300)), now())
  on conflict (room_id, user_id, day) do update set
    opens = roar_room_visits.opens + case when opened then 1 else 0 end,
    secs = least(roar_room_visits.secs + greatest(0, least(coalesce(add_secs, 0), 300)), 86400),
    last_at = now();
end $$;
revoke all on function public.roar_visit(uuid, boolean, int) from public, anon;
grant execute on function public.roar_visit(uuid, boolean, int) to authenticated;

create or replace function public.roar_visit_stats(r uuid) returns table (user_id uuid, opens bigint, secs bigint, days bigint, week_opens bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.user_id, sum(v.opens), sum(v.secs), count(*), sum(v.opens) filter (where v.day > current_date - 7), max(v.last_at)
  from roar_room_visits v
  where v.room_id = r and (roar_is_admin(r) or exists (select 1 from roar_pro_admin a where a.room_id = r and auth.uid() = any(a.access) and roar_is_member(r)))
  group by v.user_id
$$;
revoke all on function public.roar_visit_stats(uuid) from public, anon;
grant execute on function public.roar_visit_stats(uuid) to authenticated;
