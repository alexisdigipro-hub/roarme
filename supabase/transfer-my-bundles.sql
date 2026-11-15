-- My transfers by upload (Alex, 15 Nov 2026: "if I send 10 files, show me one link for the 10, not one by one"):
-- the uploads of more than one file that the signed-in account made, with their files' tokens, so the site and the
-- iPhone app show each as one row with the upload's own link, and who each went to by email (all uploads, with
-- recipients, since 15 Nov). Safe to run again.
drop function if exists public.roar_my_bundles();
create function public.roar_my_bundles()
returns table(token text, tokens text[], title text, created_at timestamptz, expires_at timestamptz, recipients text[])
language sql stable security definer set search_path = public as $$
  select b.token, b.tokens::text[], b.title, b.created_at, b.expires_at, coalesce(b.recipients::text[], '{}')
  from public.roar_transfer_bundles b
  where auth.uid() is not null and b.created_by = auth.uid()
  order by b.created_at desc
  limit 2000
$$;
revoke all on function public.roar_my_bundles() from public, anon;
grant execute on function public.roar_my_bundles() to authenticated;
