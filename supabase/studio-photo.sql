-- RoarTransfer Studio: the picture tools (Alex, 8 Nov 2026). Safe to run again.
-- a note on a point of the picture: {"x":0..1,"y":0..1}
alter table public.roarstudio_comments add column if not exists pos jsonb;
-- picks: a heart on a picture, by a member or by someone on a link (one each per picture)
create table if not exists public.roarstudio_picks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  track_id uuid not null references public.roarstudio_tracks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists roarstudio_picks_user on public.roarstudio_picks(track_id, user_id) where user_id is not null;
create unique index if not exists roarstudio_picks_guest on public.roarstudio_picks(track_id, lower(guest_name)) where guest_name is not null;
alter table public.roarstudio_picks enable row level security;
drop policy if exists rs_picks_read on public.roarstudio_picks;
create policy rs_picks_read on public.roarstudio_picks for select to authenticated using (public.roarstudio_can(project_id, 'listener'));
-- the studio's name over pictures seen through review links (Finals stay clean)
alter table public.roarstudio_studios add column if not exists watermark boolean not null default false;
