-- RoarTransfer from RoarMail (Oct 2026): a big email attachment goes up to roar-transfers and the email carries a
-- RoarTransfer link instead of the file. A file sent by mail belongs to no chat, so besides the chat folder
-- (<room id>/…, roar_file_ok) a person may also use their own folder u/<their id>/… . Same bucket, same 3-day sweep
-- (roar-transfer-sweep), same public page (?t=<token>, roar-transfer-get): only who may write and read changes.
-- Safe to run again.

-- true when the path is in the caller's own folder: u/<auth.uid()>/<file>
create or replace function public.roar_own_transfer(objname text) returns boolean
language sql stable set search_path = public as $$
  select auth.uid() is not null
    and split_part(objname, '/', 1) = 'u'
    and split_part(objname, '/', 2) = auth.uid()::text
    and split_part(objname, '/', 3) <> ''
$$;
revoke all on function public.roar_own_transfer(text) from public, anon;
grant execute on function public.roar_own_transfer(text) to authenticated;

drop policy if exists roar_transfers_read on storage.objects;
create policy roar_transfers_read on storage.objects for select to authenticated
  using (bucket_id = 'roar-transfers' and (public.roar_file_ok(name) or public.roar_own_transfer(name)));
drop policy if exists roar_transfers_write on storage.objects;
create policy roar_transfers_write on storage.objects for insert to authenticated
  with check (bucket_id = 'roar-transfers' and (public.roar_file_ok(name) or public.roar_own_transfer(name)));

drop policy if exists roar_transfer_links_insert on public.roar_transfer_links;
create policy roar_transfer_links_insert on public.roar_transfer_links for insert to authenticated
  with check (created_by = auth.uid() and (public.roar_file_ok(path) or public.roar_own_transfer(path))
    and expires_at <= now() + interval '3 days 1 hour');
drop policy if exists roar_transfer_links_read on public.roar_transfer_links;
create policy roar_transfer_links_read on public.roar_transfer_links for select to authenticated
  using (public.roar_file_ok(path) or public.roar_own_transfer(path));
