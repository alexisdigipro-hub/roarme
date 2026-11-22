-- Production Hub (Alex, 22 Nov 2026: "the key goes in RoarMe's Settings, Production Hub; every group in PROJECTS is a
-- project of the hub, both ways"). The hub's key is kept per account (roar_hub_accounts), read only by the Edge
-- Function roar-hub (service role); each project group is tied to one hub project (roar_hub_links). Members see only
-- that a group is tied and the hub's name. Safe to run again.

create table if not exists public.roar_hub_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hub_key text not null,
  hub_name text not null default '',
  set_at timestamptz not null default now()
);
alter table public.roar_hub_accounts enable row level security;
revoke all on public.roar_hub_accounts from anon, authenticated;

create table if not exists public.roar_hub_links (
  room_id uuid primary key references public.roar_rooms(id) on delete cascade,
  hub_key text,
  hub_name text not null default '',
  synced text[] not null default '{}',
  set_by uuid,
  set_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);
alter table public.roar_hub_links alter column hub_key drop not null;
alter table public.roar_hub_links add column if not exists owner uuid references auth.users(id) on delete cascade;
alter table public.roar_hub_links add column if not exists hub_project text;
alter table public.roar_hub_links add column if not exists base jsonb not null default '{}'::jsonb;
alter table public.roar_hub_links enable row level security;
revoke all on public.roar_hub_links from anon, authenticated;

-- a group tied the first way (its own key, 22 Nov afternoon) becomes its admin's account link
insert into public.roar_hub_accounts (user_id, hub_key, hub_name, set_at)
  select distinct on (set_by) set_by, hub_key, hub_name, set_at from public.roar_hub_links
  where hub_key is not null and set_by is not null order by set_by, set_at desc
  on conflict (user_id) do nothing;
update public.roar_hub_links set owner = set_by, hub_key = null where hub_key is not null and owner is null;

create or replace function public.roar_hub_state(r uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when roar_is_member(r) then (
    select jsonb_build_object('hub', hub_name, 'project', hub_project is not null, 'at', set_at, 'synced', coalesce(array_length(synced, 1), 0), 'last', last_sync_at, 'error', last_error)
    from roar_hub_links where room_id = r) end
$$;
revoke all on function public.roar_hub_state(uuid) from public, anon;
grant execute on function public.roar_hub_state(uuid) to authenticated;

-- my own Production Hub, for Settings
create or replace function public.roar_hub_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('hub', a.hub_name, 'at', a.set_at, 'projects', (select count(*) from roar_hub_links l where l.owner = a.user_id and l.hub_project is not null))
  from roar_hub_accounts a where a.user_id = auth.uid()
$$;
revoke all on function public.roar_hub_me() from public, anon;
grant execute on function public.roar_hub_me() to authenticated;
