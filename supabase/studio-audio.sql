-- RoarTransfer Studio: the sound tools (Alex, 8 Nov 2026). Safe to run again.
-- a note over a stretch (0:42 to 0:58), a spoken note (a short recording in R2: studio/<project>/voice/…)
alter table public.roarstudio_comments add column if not exists end_sec real;
alter table public.roarstudio_comments add column if not exists voice text;
alter table public.roarstudio_comments add column if not exists voice_sec real;
-- the true peak (4x oversampled, dBTP) for the streaming check
alter table public.roarstudio_versions add column if not exists true_peak real;
-- stems: the parts of a version (vocals, drums, bass…), played together with mute and solo
create table if not exists public.roarstudio_stems (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.roarstudio_versions(id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  name text not null default 'Stem',
  file_key text not null,
  size bigint,
  mime text,
  position integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists roarstudio_stems_version on public.roarstudio_stems(version_id, position, created_at);
alter table public.roarstudio_stems enable row level security;
drop policy if exists rs_stems_read on public.roarstudio_stems;
create policy rs_stems_read on public.roarstudio_stems for select to authenticated using (public.roarstudio_can(project_id, 'listener'));
-- a spoken note may come without words
alter table public.roarstudio_comments drop constraint if exists roarstudio_comments_body_check;
alter table public.roarstudio_comments add constraint roarstudio_comments_body_check check (char_length(body) <= 4000 and (char_length(body) >= 1 or voice is not null));
-- links can approve by default (Alex, 8 Nov), and the links already sent get it too
alter table public.roarstudio_studios alter column link_approve set default true;
update public.roarstudio_studios set link_approve = true where link_approve = false;
update public.roarstudio_shares set can_approve = true where coalesce(kind, 'review') in ('review', 'playlist') and can_approve = false;
