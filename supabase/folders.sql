-- Chat folders kept with the account, so every device has the same ones (19 Oct 2026). Safe to run again.
-- Run by Claude on 19 Oct 2026 (RLS on, one policy: each person reads and writes only their own row).
-- data: { folders: [...custom folders], folderOrder, folderNames, hiddenFolders, folderExtra } as the app keeps them.
create table if not exists public.roar_folder_sync (
  user_id uuid primary key default auth.uid(), -- no foreign key: adding one waits on a lock of auth.users that timed out
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.roar_folder_sync enable row level security;
drop policy if exists roar_folder_sync_own on public.roar_folder_sync;
create policy roar_folder_sync_own on public.roar_folder_sync for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.roar_folder_sync from anon;
revoke all on public.roar_folder_sync from authenticated;
grant select, insert, update on public.roar_folder_sync to authenticated;
