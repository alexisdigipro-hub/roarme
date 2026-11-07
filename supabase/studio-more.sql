-- RoarStudio, the next round (Alex, 7 Nov 2026, from mixup.media's pages: "New file / playlist / folder, organisation
-- settings, storage, notifications, upload naming"). Safe to run again. Only roarstudio_* here.

-- folders inside a project (one level is what the page shows; parent_id keeps room for more)
create table if not exists public.roarstudio_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  parent_id uuid references public.roarstudio_folders(id) on delete cascade,
  name text not null default 'New folder',
  position int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.roarstudio_tracks add column if not exists folder_id uuid references public.roarstudio_folders(id) on delete set null;
create index if not exists roarstudio_folders_project on public.roarstudio_folders(project_id);

-- playlists: tracks in an order, played one after the other (the newest version of each), with their own share link
create table if not exists public.roarstudio_playlists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  title text not null default 'New playlist',
  items uuid[] not null default '{}',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists roarstudio_playlists_project on public.roarstudio_playlists(project_id);
alter table public.roarstudio_shares add column if not exists playlist_id uuid references public.roarstudio_playlists(id) on delete cascade;
alter table public.roarstudio_shares drop constraint if exists roarstudio_shares_kind;
alter table public.roarstudio_shares add constraint roarstudio_shares_kind check (kind in ('review', 'finals', 'playlist'));

-- the studio of an owner: name, square logo and wide banner (small images as data URLs, made by the page), defaults
create table if not exists public.roarstudio_studios (
  owner uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  logo text,
  banner text,
  invite_role text not null default 'commenter' check (invite_role in ('editor', 'commenter', 'listener')),
  link_comment boolean not null default true,
  link_approve boolean not null default false,
  link_download boolean not null default false,
  hide_versions boolean not null default false,
  updated_at timestamptz not null default now()
);

-- each person's own choices: emails and upload naming
create table if not exists public.roarstudio_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_notes boolean not null default true,
  notify_approvals boolean not null default true,
  notify_versions boolean not null default true,
  notify_shared boolean not null default true,
  digest boolean not null default false,
  upload_naming boolean not null default false,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- what happened, for the emails: written by triggers, sent in groups by the Edge Function roarstudio (notify-sweep)
create table if not exists public.roarstudio_events (
  id bigserial primary key,
  project_id uuid not null references public.roarstudio_projects(id) on delete cascade,
  kind text not null check (kind in ('note', 'version', 'approve', 'final', 'shared')),
  actor uuid,
  actor_name text,
  target uuid,
  track_id uuid,
  version_id uuid,
  body text,
  created_at timestamptz not null default now()
);
create index if not exists roarstudio_events_time on public.roarstudio_events(created_at);

-- the key the database shows the Edge Function when the clock asks it to send the emails
create table if not exists public.roarstudio_conf (id int primary key default 1 check (id = 1), hook_token uuid not null default gen_random_uuid());
insert into public.roarstudio_conf (id) values (1) on conflict (id) do nothing;

alter table public.roarstudio_folders enable row level security;
alter table public.roarstudio_playlists enable row level security;
alter table public.roarstudio_studios enable row level security;
alter table public.roarstudio_prefs enable row level security;
alter table public.roarstudio_events enable row level security;
alter table public.roarstudio_conf enable row level security;

drop policy if exists rs_folders_read on public.roarstudio_folders;
create policy rs_folders_read on public.roarstudio_folders for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_folders_write on public.roarstudio_folders;
create policy rs_folders_write on public.roarstudio_folders for all using (public.roarstudio_can(project_id, 'editor')) with check (public.roarstudio_can(project_id, 'editor'));
drop policy if exists rs_playlists_read on public.roarstudio_playlists;
create policy rs_playlists_read on public.roarstudio_playlists for select using (public.roarstudio_can(project_id, 'listener'));
drop policy if exists rs_playlists_write on public.roarstudio_playlists;
create policy rs_playlists_write on public.roarstudio_playlists for all using (public.roarstudio_can(project_id, 'editor')) with check (public.roarstudio_can(project_id, 'editor'));
-- a studio's look is seen by everyone in its projects; written by its owner
drop policy if exists rs_studios_read on public.roarstudio_studios;
create policy rs_studios_read on public.roarstudio_studios for select using (owner = auth.uid() or exists (select 1 from public.roarstudio_projects p where p.owner = roarstudio_studios.owner and public.roarstudio_can(p.id, 'listener')));
drop policy if exists rs_studios_write on public.roarstudio_studios;
create policy rs_studios_write on public.roarstudio_studios for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists rs_prefs_own on public.roarstudio_prefs;
create policy rs_prefs_own on public.roarstudio_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- events and conf: no policies, only the Edge Function (service role) reads them

-- triggers that write the events
create or replace function public.roarstudio_ev_note() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into roarstudio_events(project_id, kind, actor, actor_name, track_id, version_id, body)
  select new.project_id, 'note', new.author, new.guest_name, v.track_id, new.version_id, left(new.body, 400)
  from roarstudio_versions v where v.id = new.version_id;
  return new;
end $$;
drop trigger if exists roarstudio_ev_note on public.roarstudio_comments;
create trigger roarstudio_ev_note after insert on public.roarstudio_comments for each row execute function public.roarstudio_ev_note();

create or replace function public.roarstudio_ev_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into roarstudio_events(project_id, kind, actor, track_id, version_id, body) values (new.project_id, 'version', new.uploaded_by, new.track_id, new.id, new.file_name);
  else
    if new.approved_at is not null and old.approved_at is null then
      insert into roarstudio_events(project_id, kind, actor_name, track_id, version_id) values (new.project_id, 'approve', new.approved_by, new.track_id, new.id);
    end if;
    if new.final_at is not null and old.final_at is null then
      insert into roarstudio_events(project_id, kind, actor_name, track_id, version_id) values (new.project_id, 'final', new.final_by, new.track_id, new.id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists roarstudio_ev_version on public.roarstudio_versions;
create trigger roarstudio_ev_version after insert or update on public.roarstudio_versions for each row execute function public.roarstudio_ev_version();

create or replace function public.roarstudio_ev_member() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'owner' then
    insert into roarstudio_events(project_id, kind, actor, target) values (new.project_id, 'shared', new.added_by, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists roarstudio_ev_member on public.roarstudio_members;
create trigger roarstudio_ev_member after insert on public.roarstudio_members for each row execute function public.roarstudio_ev_member();

-- every 5 minutes the clock asks the Edge Function to send what is waiting
create or replace function public.roarstudio_notify_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare tok uuid;
begin
  if auth.uid() is not null then raise exception 'not allowed'; end if;
  if not exists (select 1 from roarstudio_events where created_at > now() - interval '2 days') then return; end if;
  select hook_token into tok from roarstudio_conf where id = 1;
  perform net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roarstudio',
    body := jsonb_build_object('action', 'notify-sweep'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-roarstudio-hook', tok::text)
  );
end $$;
revoke all on function public.roarstudio_notify_tick() from public, anon, authenticated;
create extension if not exists pg_cron;
select cron.unschedule('roarstudio-notify') where exists (select 1 from cron.job where jobname = 'roarstudio-notify');
select cron.schedule('roarstudio-notify', '*/5 * * * *', $$select public.roarstudio_notify_tick()$$);

-- the members' emails for the notification emails (only the Edge Function, as service role, may call it)
create or replace function public.roarstudio_member_emails(ps uuid[])
returns table (project_id uuid, user_id uuid, email text, name text)
language sql stable security definer set search_path = public as $$
  select m.project_id, m.user_id, u.email::text, coalesce(nullif(pr.display_name, ''), pr.username, split_part(u.email, '@', 1))
  from roarstudio_members m join auth.users u on u.id = m.user_id left join roar_profiles pr on pr.id = m.user_id
  where m.project_id = any(ps)
$$;
revoke all on function public.roarstudio_member_emails(uuid[]) from public, anon, authenticated;

-- a project's cover picture (Alex, 7 Nov: "upload a photo for the cover, scale, crop"): a square JPEG made by the page
alter table public.roarstudio_projects add column if not exists cover text;

-- activity (Alex, 7 Nov, mixup's Notifications panel): views, plays and downloads through links are events too, and
-- members of a project read its events (the bell in RoarStudio); a private notepad per person and file
alter table public.roarstudio_events drop constraint if exists roarstudio_events_kind_check;
alter table public.roarstudio_events add constraint roarstudio_events_kind_check check (kind in ('note', 'version', 'approve', 'final', 'shared', 'view', 'stream', 'download'));
drop policy if exists rs_events_read on public.roarstudio_events;
create policy rs_events_read on public.roarstudio_events for select using (public.roarstudio_can(project_id, 'listener'));
create index if not exists roarstudio_events_project on public.roarstudio_events(project_id, created_at desc);
create table if not exists public.roarstudio_notepads (
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.roarstudio_tracks(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);
alter table public.roarstudio_notepads enable row level security;
drop policy if exists rs_notepads_own on public.roarstudio_notepads;
create policy rs_notepads_own on public.roarstudio_notepads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- the studio's own background for the pages it sends (Alex, 7 Nov: "a logo, a background of their own on the Finals")
alter table public.roarstudio_studios add column if not exists backdrop text;

-- the credits of a project's Finals (Alex, 7 Nov: "credits on the final folder, a template: music, lyrics, the video's credits"):
-- { template: music | video | photo | custom, rows: [{ role, name }], lyrics, notes }, written by editors, shown on Finals links
alter table public.roarstudio_projects add column if not exists credits jsonb;
