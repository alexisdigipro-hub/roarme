-- RoarMe <-> THEMADLIONS Hub, "Sign in with THEMADLIONS Hub" (Alex, 20 Oct 2026: one account for the team, the hub's
-- email and password). Safe to run again. Needs hub-link.sql.
--
-- The Edge Function roar-hub-signin does the work with the service role; these helpers are for it alone.
-- The hub's account is the source: a team member's RoarMe account is found by its hub link, else by the same
-- email, else made (no password of its own: they always come in through the hub). No password ever moves.
-- Since this, the link is the team's: only a hub administrator removes it, not the person in RoarMe's Settings.

-- the RoarMe account with this email, if any
create or replace function public.roar_hub_user_by_email(mail text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(mail)) limit 1
$$;
revoke all on function public.roar_hub_user_by_email(text) from public, anon, authenticated;
grant execute on function public.roar_hub_user_by_email(text) to service_role;

-- a free @username made from a name or an email (a-z, 0-9, _; 3 to 24 long), with a number added when taken
create or replace function public.roar_hub_free_username(base text) returns text
language plpgsql stable security definer set search_path = public as $$
declare b text; u text; n int := 1;
begin
  b := lower(coalesce(base, ''));
  b := replace(replace(replace(b, 'ού', 'ou'), 'ου', 'ou'), 'μπ', 'b');
  b := translate(b, 'αάβγδεέζηήθιίϊΐκλμνξοόπρσςτυύϋΰφχψωώ', 'aavgdeeziitiiiiklmnxooprsstyyyyfxpoo');
  b := regexp_replace(b, '[^a-z0-9]+', '_', 'g');
  b := trim(both '_' from b);
  if length(b) < 3 then b := 'member'; end if;
  b := left(b, 20);
  u := b;
  while exists (select 1 from roar_profiles where lower(username) = u) loop
    n := n + 1;
    u := left(b, 20) || n::text;
  end loop;
  return u;
end $$;
revoke all on function public.roar_hub_free_username(text) from public, anon, authenticated;
grant execute on function public.roar_hub_free_username(text) to service_role;

-- the person can no longer remove the hub link themselves (a hub administrator does, from the hub)
drop policy if exists roar_hub_links_unlink on public.roar_hub_links;
