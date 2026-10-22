-- Chat wallpapers run from Admin (Alex, 22 Oct 2026: "upload more, change them, see the ones there are now").
-- roar_wallpapers lists every wallpaper the pickers show, in order: the eight built-in ones (drawn by the app's CSS,
-- no image) and the photos Alex uploads to the public bucket roar-walls. Everyone reads it; only the accounts in
-- roar_admins (roar_is_admin()) add, rename, hide, reorder, replace or delete. Safe to run again.

create table if not exists public.roar_wallpapers (
  key text primary key,
  name text not null default 'Wallpaper',
  path text,                     -- the photo in roar-walls; null for a built-in one
  position int not null default 0,
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.roar_wallpapers (key, name, position) values
  ('soft', 'Plain', 0), ('dots', 'Pattern', 1), ('grid', 'Grid', 2), ('night', 'Night', 3),
  ('ocean', 'Ocean', 4), ('dusk', 'Dusk', 5), ('forest', 'Forest', 6), ('ember', 'Ember', 7)
on conflict (key) do nothing;

alter table public.roar_wallpapers enable row level security;
drop policy if exists roar_wallpapers_read on public.roar_wallpapers;
create policy roar_wallpapers_read on public.roar_wallpapers for select using (true);
drop policy if exists roar_wallpapers_admin on public.roar_wallpapers;
create policy roar_wallpapers_admin on public.roar_wallpapers for all to authenticated
  using (public.roar_is_admin()) with check (public.roar_is_admin());
grant select on public.roar_wallpapers to anon, authenticated;
grant insert, update, delete on public.roar_wallpapers to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('roar-walls', 'roar-walls', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists roar_walls_admin_ins on storage.objects;
create policy roar_walls_admin_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'roar-walls' and public.roar_is_admin());
drop policy if exists roar_walls_admin_upd on storage.objects;
create policy roar_walls_admin_upd on storage.objects for update to authenticated
  using (bucket_id = 'roar-walls' and public.roar_is_admin()) with check (bucket_id = 'roar-walls' and public.roar_is_admin());
drop policy if exists roar_walls_admin_del on storage.objects;
create policy roar_walls_admin_del on storage.objects for delete to authenticated
  using (bucket_id = 'roar-walls' and public.roar_is_admin());
