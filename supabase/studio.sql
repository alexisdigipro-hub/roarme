-- RoarStudio (Alex, 7 Nov 2026: "a cloud for music, a branch of RoarTransfer, at studio.roartransfer.com").
-- Projects hold tracks, each track a stack of versions (files in R2 under studio/<project>/…, through the Edge Function
-- roarstudio), notes on a second of a version, people with a role, and share links for people without an account.
-- Only roarstudio_* here; RoarTransfer's and RoarMe's tables are untouched. Safe to run again.

create table if not exists public.roarstudio_projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  artist text not null default '',
  color text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roarstudio_members (
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'commenter' check (role in ('owner', 'editor', 'commenter', 'listener')),
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.roarstudio_tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  title text not null default 'Untitled',
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.roarstudio_versions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.roarstudio_tracks(id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  n int not null default 1,
  label text not null default '',
  file_key text not null,
  file_name text not null default '',
  size bigint not null default 0,
  mime text not null default '',
  duration real,
  lufs real,
  peak_db real,
  sample_rate int,
  channels int,
  peaks jsonb,
  uploaded_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.roarstudio_comments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.roarstudio_versions(id) on delete cascade,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  parent_id uuid references public.roarstudio_comments(id) on delete cascade,
  at_sec real,
  body text not null check (char_length(body) between 1 and 4000),
  author uuid references auth.users(id) on delete set null,
  guest_name text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.roarstudio_shares (
  token text primary key,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  track_id uuid references public.roarstudio_tracks(id) on delete cascade,
  can_comment boolean not null default true,
  can_approve boolean not null default false,
  can_download boolean not null default false,
  password_hash text,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists roarstudio_members_user on public.roarstudio_members(user_id);
create index if not exists roarstudio_tracks_project on public.roarstudio_tracks(project_id);
create index if not exists roarstudio_versions_track on public.roarstudio_versions(track_id);
create index if not exists roarstudio_comments_version on public.roarstudio_comments(version_id);
create index if not exists roarstudio_shares_project on public.roarstudio_shares(project_id);

-- the caller's role in a project: owner, editor, commenter, listener or null
create or replace function public.roarstudio_role(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from roarstudio_projects where id = p and owner = auth.uid()) then 'owner'
    else (select role from roarstudio_members where project_id = p and user_id = auth.uid()) end
$$;
create or replace function public.roarstudio_can(p uuid, need text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(array_position(array['listener','commenter','editor','owner'], public.roarstudio_role(p))
    >= array_position(array['listener','commenter','editor','owner'], need), false)
$$;

-- the owner is a member too, so one query lists everyone
create or replace function public.roarstudio_owner_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into roarstudio_members(project_id, user_id, role, added_by) values (new.id, new.owner, 'owner', new.owner)
  on conflict (project_id, user_id) do update set role = 'owner';
  return new;
end $$;
drop trigger if exists roarstudio_owner_member on public.roarstudio_projects;
create trigger roarstudio_owner_member after insert on public.roarstudio_projects
  for each row execute function public.roarstudio_owner_member();

-- the next version number of a track
create or replace function public.roarstudio_version_n() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.n is null or new.n <= 1 then
    select coalesce(max(n), 0) + 1 into new.n from roarstudio_versions where track_id = new.track_id;
  end if;
  update roarstudio_projects set updated_at = now() where id = new.project_id;
  return new;
end $$;
drop trigger if exists roarstudio_version_n on public.roarstudio_versions;
create trigger roarstudio_version_n before insert on public.roarstudio_versions
  for each row execute function public.roarstudio_version_n();

alter table public.roarstudio_projects enable row level security;
alter table public.roarstudio_members enable row level security;
alter table public.roarstudio_tracks enable row level security;
alter table public.roarstudio_versions enable row level security;
alter table public.roarstudio_comments enable row level security;
alter table public.roarstudio_shares enable row level security;

drop policy if exists rs_projects_read on public.roarstudio_projects;
create policy rs_projects_read on public.roarstudio_projects for select using (owner = auth.uid() or public.roarstudio_can(id, 'listener'));
drop policy if exists rs_projects_insert on public.roarstudio_projects;
create policy rs_projects_insert on public.roarstudio_projects for insert with check (owner = auth.uid());
drop policy if exists rs_projects_update on public.roarstudio_projects;
create policy rs_projects_update on public.roarstudio_projects for update using (public.roarstudio_can(id, 'editor'));
drop policy if exists rs_projects_delete on public.roarstudio_projects;
create policy rs_projects_delete on public.roarstudio_projects for delete using (owner = auth.uid());

drop policy if exists rs_members_read on public.roarstudio_members;
create policy rs_members_read on public.roarstudio_members for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_members_update on public.roarstudio_members;
create policy rs_members_update on public.roarstudio_members for update using (public.roarstudio_can(project_id, 'owner') and role <> 'owner') with check (role <> 'owner');
drop policy if exists rs_members_delete on public.roarstudio_members;
create policy rs_members_delete on public.roarstudio_members for delete using ((public.roarstudio_can(project_id, 'owner') or user_id = auth.uid()) and role <> 'owner');

drop policy if exists rs_tracks_read on public.roarstudio_tracks;
create policy rs_tracks_read on public.roarstudio_tracks for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_tracks_write on public.roarstudio_tracks;
create policy rs_tracks_write on public.roarstudio_tracks for all using (public.roarstudio_can(project_id, 'editor')) with check (public.roarstudio_can(project_id, 'editor'));

-- versions are written by the Edge Function (service role) once the file is in R2; members read, editors rename
drop policy if exists rs_versions_read on public.roarstudio_versions;
create policy rs_versions_read on public.roarstudio_versions for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_versions_update on public.roarstudio_versions;
create policy rs_versions_update on public.roarstudio_versions for update using (public.roarstudio_can(project_id, 'editor'));

drop policy if exists rs_comments_read on public.roarstudio_comments;
create policy rs_comments_read on public.roarstudio_comments for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_comments_insert on public.roarstudio_comments;
create policy rs_comments_insert on public.roarstudio_comments for insert with check (author = auth.uid() and public.roarstudio_can(project_id, 'commenter'));
drop policy if exists rs_comments_update on public.roarstudio_comments;
create policy rs_comments_update on public.roarstudio_comments for update using (author = auth.uid() or public.roarstudio_can(project_id, 'editor'));
drop policy if exists rs_comments_delete on public.roarstudio_comments;
create policy rs_comments_delete on public.roarstudio_comments for delete using (author = auth.uid() or public.roarstudio_can(project_id, 'owner'));

drop policy if exists rs_shares_read on public.roarstudio_shares;
create policy rs_shares_read on public.roarstudio_shares for select using (public.roarstudio_can(project_id, 'editor'));
drop policy if exists rs_shares_delete on public.roarstudio_shares;
create policy rs_shares_delete on public.roarstudio_shares for delete using (public.roarstudio_can(project_id, 'editor'));

-- names and pictures of the people in one's projects (roar_profiles is RoarMe's; read only)
create or replace function public.roarstudio_people(p uuid)
returns table (user_id uuid, role text, name text, avatar text, email text)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, coalesce(nullif(pr.display_name, ''), pr.username, split_part(u.email, '@', 1)), pr.avatar_url,
    case when public.roarstudio_can(p, 'editor') then u.email::text else null end
  from roarstudio_members m join auth.users u on u.id = m.user_id left join roar_profiles pr on pr.id = m.user_id
  where m.project_id = p and public.roarstudio_can(p, 'listener')
  order by array_position(array['owner','editor','commenter','listener'], m.role), m.created_at
$$;

-- add someone by the email of their Roar account (the owner only)
create or replace function public.roarstudio_invite(p uuid, mail text, r text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.roarstudio_can(p, 'owner') then return 'not-allowed'; end if;
  if r not in ('editor', 'commenter', 'listener') then return 'bad-role'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(mail)) limit 1;
  if uid is null then return 'no-account'; end if;
  insert into roarstudio_members(project_id, user_id, role, added_by) values (p, uid, r, auth.uid())
  on conflict (project_id, user_id) do update set role = excluded.role where roarstudio_members.role <> 'owner';
  return 'ok';
end $$;

-- realtime for notes, so a new note appears without a reload
do $$ begin
  alter publication supabase_realtime add table public.roarstudio_comments;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.roarstudio_versions;
exception when others then null; end $$;

grant execute on function public.roarstudio_role(uuid), public.roarstudio_can(uuid, text), public.roarstudio_people(uuid), public.roarstudio_invite(uuid, text, text) to authenticated;
