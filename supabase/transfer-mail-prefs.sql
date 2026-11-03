-- Emails from RoarTransfer that a person can turn off (Alex, 3 Nov 2026: "every email an app sends, a setting to turn it off").
-- downloads: "Someone just downloaded" (roartransfer-notify); received: "X sent you files on your page" (roartransfer-r2,
-- Receive files). Both on until a person turns one off in roartransfer.com > My transfers > Emails from RoarTransfer.
-- No row means both on. Sign-up and password emails always go. Can be run again.
create table if not exists public.roar_transfer_mail_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  downloads boolean not null default true,
  received boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.roar_transfer_mail_prefs enable row level security;
drop policy if exists roar_transfer_mail_prefs_read on public.roar_transfer_mail_prefs;
create policy roar_transfer_mail_prefs_read on public.roar_transfer_mail_prefs for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_transfer_mail_prefs_insert on public.roar_transfer_mail_prefs;
create policy roar_transfer_mail_prefs_insert on public.roar_transfer_mail_prefs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists roar_transfer_mail_prefs_update on public.roar_transfer_mail_prefs;
create policy roar_transfer_mail_prefs_update on public.roar_transfer_mail_prefs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.roar_transfer_mail_prefs from anon;
grant select, insert, update on public.roar_transfer_mail_prefs to authenticated;
