-- RoarMe <-> THEMADLIONS Hub, security check (27 Oct 2026). Safe to run again. Needs hub-signin.sql.
-- "Sign in with THEMADLIONS Hub" may take an existing RoarMe account with the member's email only when that email was
-- confirmed by its owner. An unconfirmed account with that email (someone else could have made it) is found by the
-- second helper so the Edge Function roar-hub-signin can remove it and make the member a fresh one.

create or replace function public.roar_hub_user_by_email(mail text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(mail)) and email_confirmed_at is not null limit 1
$$;
revoke all on function public.roar_hub_user_by_email(text) from public, anon, authenticated;
grant execute on function public.roar_hub_user_by_email(text) to service_role;

create or replace function public.roar_hub_unconfirmed_by_email(mail text) returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(mail)) and email_confirmed_at is null limit 1
$$;
revoke all on function public.roar_hub_unconfirmed_by_email(text) from public, anon, authenticated;
grant execute on function public.roar_hub_unconfirmed_by_email(text) to service_role;
