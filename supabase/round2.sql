-- ROAR, round 2 (16 Oct 2026), already applied: an account with two-step verification sees nothing
-- until its session carries the second step (aal2). Safe to run again on a fresh project after schema.sql.
create or replace function public.roar_aal_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified')
$$;
grant execute on function public.roar_aal_ok() to authenticated;
revoke all on function public.roar_aal_ok() from public, anon;
-- restrictive policies roar_mfa on roar_messages, roar_rooms, roar_members, roar_reactions, roar_blocks,
-- roar_contacts (for all) and roar_profiles (for update): using/with check public.roar_aal_ok();
-- roar_my_rooms() also requires roar_aal_ok().
