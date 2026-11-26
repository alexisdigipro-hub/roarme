-- The sign-in and sign-up page's background (Alex, 26 Nov: "somewhere in admin, change the sign in / sign up background
-- whenever I want"). One row per key ('auth_bg'): the photo's path in the public bucket roar-walls, or null for the
-- built-in streaks. Everyone reads it, signed in or not (the sign-in page has no account yet); only the admins
-- (roar_is_admin()) write it. Safe to run again.
create table if not exists public.roar_app_look (
  key text primary key,
  path text,
  updated_at timestamptz not null default now()
);
alter table public.roar_app_look enable row level security;
drop policy if exists roar_app_look_read on public.roar_app_look;
create policy roar_app_look_read on public.roar_app_look for select to anon, authenticated using (true);
drop policy if exists roar_app_look_write on public.roar_app_look;
create policy roar_app_look_write on public.roar_app_look for all to authenticated
  using (public.roar_is_admin()) with check (public.roar_is_admin());
grant select on public.roar_app_look to anon, authenticated;
grant insert, update, delete on public.roar_app_look to authenticated;
