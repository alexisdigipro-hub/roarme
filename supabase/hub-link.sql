-- RoarMe <-> THEMADLIONS Hub: linking accounts (Alex, 20 Oct 2026, phase 1 of moving the hub's chat onto RoarMe).
-- Safe to run again.
--
-- How a link is made, without any sign-in token ever leaving its own app:
--   1. The hub opens RoarMe in a small window (?link=hub&state=…). The person signs in to RoarMe as usual
--      (with their 6-digit code if they use one) and sees what linking means. Nothing happens until Approve.
--   2. Approve calls roar_hub_link_code(state): a random one-time code, good for 5 minutes, tied to this account.
--   3. RoarMe hands only that code back to the hub window. The hub's server redeems it with the edge function
--      roar-hub-link, which knows the shared secret kept in roar_hub_conf (no app user can read it).
--   4. The link lives in roar_hub_links. The person sees it in Settings and can remove it there at any time;
--      without a row here the hub can do nothing for that account (later phases check this row every time).

create table if not exists public.roar_hub_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hub text not null default 'themadlions',
  hub_user_id uuid not null,
  hub_name text not null default '',
  linked_at timestamptz not null default now(),
  unique (hub, hub_user_id)
);
alter table public.roar_hub_links enable row level security;
drop policy if exists roar_hub_links_read on public.roar_hub_links;
create policy roar_hub_links_read on public.roar_hub_links for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_hub_links_unlink on public.roar_hub_links;
create policy roar_hub_links_unlink on public.roar_hub_links for delete to authenticated using (user_id = auth.uid() and public.roar_aal_ok());
-- no insert or update policy: only the roar-hub-link function (service role) writes a link

create table if not exists public.roar_hub_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.roar_hub_link_codes enable row level security;
-- no policies at all: nobody reads or writes this table from the app

create table if not exists public.roar_hub_conf (
  id int primary key default 1 check (id = 1),
  secret text not null
);
alter table public.roar_hub_conf enable row level security;
-- no policies: only the service role reads the shared secret

create or replace function public.roar_hub_link_code(link_state text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null or not public.roar_aal_ok() then raise exception 'not allowed'; end if;
  if link_state is null or link_state !~ '^[A-Za-z0-9_-]{24,64}$' then raise exception 'bad request'; end if;
  if (select count(*) from roar_hub_link_codes where user_id = me and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many tries, wait a while';
  end if;
  delete from roar_hub_link_codes where created_at < now() - interval '1 day';
  c := encode(extensions.gen_random_bytes(24), 'hex');
  insert into roar_hub_link_codes (code, user_id, state) values (c, me, link_state);
  return c;
end $$;
revoke all on function public.roar_hub_link_code(text) from public, anon;
grant execute on function public.roar_hub_link_code(text) to authenticated;
