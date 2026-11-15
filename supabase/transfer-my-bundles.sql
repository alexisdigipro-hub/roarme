-- My transfers by upload (Alex, 15 Nov 2026: "if I send 10 files, show me one link for the 10, not one by one"):
-- the uploads of more than one file that the signed-in account made, with their files' tokens, so the site and the
-- iPhone app show each as one row with the upload's own link. Safe to run again.
create or replace function public.roar_my_bundles()
returns table(token text, tokens text[], title text, created_at timestamptz, expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.token, b.tokens::text[], b.title, b.created_at, b.expires_at
  from public.roar_transfer_bundles b
  where auth.uid() is not null and b.created_by = auth.uid() and coalesce(array_length(b.tokens, 1), 0) > 1
  order by b.created_at desc
  limit 1000
$$;
revoke all on function public.roar_my_bundles() from public, anon;
grant execute on function public.roar_my_bundles() to authenticated;
