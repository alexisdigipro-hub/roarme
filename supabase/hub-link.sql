-- A project linked to a TML Hub (Alex, 22 Nov 2026: "every location made in RoarMe goes straight into the hub").
-- The hub's key is kept here, read only by the Edge Function roar-hub (service role); members see only that the
-- project is linked and the hub's name. Safe to run again.

create table if not exists public.roar_hub_links (
  room_id uuid primary key references public.roar_rooms(id) on delete cascade,
  hub_key text not null,
  hub_name text not null default '',
  synced text[] not null default '{}',
  set_by uuid,
  set_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);
alter table public.roar_hub_links enable row level security;
revoke all on public.roar_hub_links from anon, authenticated;

create or replace function public.roar_hub_state(r uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when roar_is_member(r) then (
    select jsonb_build_object('hub', hub_name, 'at', set_at, 'synced', coalesce(array_length(synced, 1), 0), 'last', last_sync_at, 'error', last_error)
    from roar_hub_links where room_id = r) end
$$;
revoke all on function public.roar_hub_state(uuid) from public, anon;
grant execute on function public.roar_hub_state(uuid) to authenticated;
