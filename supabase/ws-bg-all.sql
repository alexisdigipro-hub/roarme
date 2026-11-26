-- One Workspace background for every project (Alex, 25 Nov). Safe to run again.
alter table public.roar_profiles add column if not exists ws_bg_all text;
alter table public.roar_profiles add column if not exists ws_bg_all_op int not null default 40;

-- Reading it back (26 Nov): roar_profiles gives no SELECT on any column (people are read through roar_people), so the
-- app asks this instead; it returns only the caller's own row.
create or replace function public.roar_ws_bg_all() returns table (url text, op int)
language sql stable security definer set search_path = public as $$
  select ws_bg_all, ws_bg_all_op from public.roar_profiles where id = auth.uid()
$$;
revoke all on function public.roar_ws_bg_all() from public, anon;
grant execute on function public.roar_ws_bg_all() to authenticated;
