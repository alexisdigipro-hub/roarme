-- RoarTransfer Studio: your own name and picture from the Roar Account (Alex, 8 Nov). roar_profiles cannot be read directly.
create or replace function public.roarstudio_me() returns table (display_name text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.display_name, p.avatar_url from roar_profiles p where p.id = auth.uid()
$$;
revoke all on function public.roarstudio_me() from public, anon;
grant execute on function public.roarstudio_me() to authenticated;
