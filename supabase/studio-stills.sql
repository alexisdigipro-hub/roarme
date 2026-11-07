-- RoarTransfer Studio: Stills (Alex, 7 Nov 2026). Grab still on a video saves the frame, with its time written on it,
-- into the Stills tab next to Notes, for everyone on the project and everyone with a review link to see and download.
-- The pictures are in R2 (studio/<project>/stills/<id>.jpg); only the roarstudio Edge Function writes and deletes rows.
-- Safe to run again.
create table if not exists public.roarstudio_stills (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.roarstudio_versions(id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  at_sec real not null default 0,
  file_key text not null,
  width integer,
  height integer,
  size bigint,
  author uuid references auth.users(id) on delete set null,
  guest_name text,
  created_at timestamptz not null default now()
);
create index if not exists roarstudio_stills_version on public.roarstudio_stills(version_id, created_at);
alter table public.roarstudio_stills enable row level security;
drop policy if exists rs_stills_read on public.roarstudio_stills;
create policy rs_stills_read on public.roarstudio_stills for select to authenticated using (public.roarstudio_can(project_id, 'listener'));
