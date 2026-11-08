-- RoarTransfer Studio review tools from Frame.io (Alex, 8 Nov 2026: "3, 5, 6, 7, 8, 9"). Safe to run again.
-- 5: a picture attached to a note (R2 studio/<project>/att/…), emoji reactions on notes, @mentions (emailed by the roarstudio function)
-- 7: the viewer's own name over videos and pictures seen through review links (studios.watermark_viewer)
-- 9: how much each person watched (roarstudio_watch: furthest point, seconds seen, plays), written only by the function
alter table public.roarstudio_comments add column if not exists attach text;
alter table public.roarstudio_studios add column if not exists watermark_viewer boolean not null default false;

create table if not exists public.roarstudio_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.roarstudio_comments (id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  guest_name text,
  emoji text not null check (emoji in ('👍', '❤️', '🔥', '😂', '👀', '✅')),
  created_at timestamptz not null default now()
);
create unique index if not exists roarstudio_reactions_one on public.roarstudio_reactions (comment_id, coalesce(user_id::text, 'g:' || lower(guest_name)), emoji);
create index if not exists roarstudio_reactions_project on public.roarstudio_reactions (project_id);
alter table public.roarstudio_reactions enable row level security;
drop policy if exists rs_reactions_read on public.roarstudio_reactions;
create policy rs_reactions_read on public.roarstudio_reactions for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_reactions_insert on public.roarstudio_reactions;
create policy rs_reactions_insert on public.roarstudio_reactions for insert with check (user_id = auth.uid() and guest_name is null and public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_reactions_delete on public.roarstudio_reactions;
create policy rs_reactions_delete on public.roarstudio_reactions for delete using (user_id = auth.uid());
grant select, insert, delete on public.roarstudio_reactions to authenticated;

create table if not exists public.roarstudio_watch (
  version_id uuid not null references public.roarstudio_versions (id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects (id) on delete cascade,
  viewer text not null,
  name text,
  user_id uuid references auth.users (id) on delete cascade,
  furthest real not null default 0,
  seen integer not null default 0,
  duration real,
  plays integer not null default 1,
  first_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (version_id, viewer)
);
create index if not exists roarstudio_watch_project on public.roarstudio_watch (project_id);
alter table public.roarstudio_watch enable row level security;
drop policy if exists rs_watch_read on public.roarstudio_watch;
create policy rs_watch_read on public.roarstudio_watch for select using (public.roarstudio_can(project_id, 'editor'));
revoke insert, update, delete on public.roarstudio_watch from anon, authenticated;
grant select on public.roarstudio_watch to authenticated;
