-- RoarTransfer security check, 15 Nov 2026 (safe to run again): only a Pro (or an admin) can put pictures in the public
-- bucket roartransfer-brand (their brand's logo and backgrounds), so it cannot be used as free picture hosting by any
-- RoarMe account. Taking pictures away stays open to their owner.
create or replace function public.roar_transfer_pro_me() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from public.roar_admins a where a.user_id = auth.uid())
    or exists (select 1 from public.roar_transfer_pro p where p.user_id = auth.uid() and (p.until is null or p.until > now())))
$$;
revoke all on function public.roar_transfer_pro_me() from public, anon;
grant execute on function public.roar_transfer_pro_me() to authenticated;

drop policy if exists "roartransfer brand insert own" on storage.objects;
create policy "roartransfer brand insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = auth.uid()::text and public.roar_transfer_pro_me());
drop policy if exists "roartransfer brand update own" on storage.objects;
create policy "roartransfer brand update own" on storage.objects for update to authenticated
  using (bucket_id = 'roartransfer-brand' and (storage.foldername(name))[1] = auth.uid()::text and public.roar_transfer_pro_me());
