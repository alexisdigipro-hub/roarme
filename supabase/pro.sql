-- RoarMe Pro (Alex, 22 Nov 2026): a group can be a project. Its stage, due date, brief, a few fields of its own
-- (Client, Budget, ...) and its tasks live in one row per group; every member of the group reads and changes it.
-- The chat itself is untouched: turning Pro off only hides this, and the row stays for when it is turned on again.
-- Safe to run again.

create table if not exists public.roar_pro_projects (
  room_id uuid primary key references public.roar_rooms(id) on delete cascade,
  status text not null default 'prep',
  due date,
  brief text not null default '',
  fields jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[]'::jsonb,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.roar_pro_projects drop constraint if exists roar_pro_projects_status_ok;
alter table public.roar_pro_projects add constraint roar_pro_projects_status_ok check (status in ('prep', 'shoot', 'post', 'done'));
alter table public.roar_pro_projects drop constraint if exists roar_pro_projects_size_ok;
alter table public.roar_pro_projects add constraint roar_pro_projects_size_ok check (
  char_length(brief) <= 4000 and jsonb_typeof(fields) = 'array' and jsonb_typeof(tasks) = 'array'
  and pg_column_size(fields) <= 16000 and pg_column_size(tasks) <= 64000);

alter table public.roar_pro_projects enable row level security;

drop policy if exists roar_pro_projects_read on public.roar_pro_projects;
create policy roar_pro_projects_read on public.roar_pro_projects for select to authenticated
  using (public.roar_is_member(room_id));

drop policy if exists roar_pro_projects_add on public.roar_pro_projects;
create policy roar_pro_projects_add on public.roar_pro_projects for insert to authenticated
  with check (public.roar_is_member(room_id)
    and exists (select 1 from public.roar_rooms r where r.id = room_id and r.kind = 'group'));

drop policy if exists roar_pro_projects_change on public.roar_pro_projects;
create policy roar_pro_projects_change on public.roar_pro_projects for update to authenticated
  using (public.roar_is_member(room_id)) with check (public.roar_is_member(room_id));

drop policy if exists roar_pro_projects_drop on public.roar_pro_projects;
create policy roar_pro_projects_drop on public.roar_pro_projects for delete to authenticated
  using (public.roar_is_member(room_id));

revoke all on public.roar_pro_projects from anon;
grant select, insert, update, delete on public.roar_pro_projects to authenticated;

create or replace function public.roar_pro_projects_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists roar_pro_projects_touch on public.roar_pro_projects;
create trigger roar_pro_projects_touch before insert or update on public.roar_pro_projects
  for each row execute function public.roar_pro_projects_touch();

-- changes arrive live in everyone's panel
do $$ begin
  alter publication supabase_realtime add table public.roar_pro_projects;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- The workspace (Alex, 22 Nov): stages of one's own, a date whose name changes, Location Scout
alter table public.roar_pro_projects add column if not exists stages jsonb;
alter table public.roar_pro_projects add column if not exists date_label text not null default 'Shoot Date';
alter table public.roar_pro_projects add column if not exists scouts jsonb not null default '[]'::jsonb;
alter table public.roar_pro_projects alter column status set default 'prep';
alter table public.roar_pro_projects drop constraint if exists roar_pro_projects_status_ok;
alter table public.roar_pro_projects add constraint roar_pro_projects_status_ok check (char_length(status) between 1 and 40);
alter table public.roar_pro_projects drop constraint if exists roar_pro_projects_more_ok;
alter table public.roar_pro_projects add constraint roar_pro_projects_more_ok check (
  char_length(date_label) <= 30 and jsonb_typeof(scouts) = 'array' and pg_column_size(scouts) <= 200000
  and (stages is null or (jsonb_typeof(stages) = 'array' and pg_column_size(stages) <= 4000)));

-- Ordinos made in Roardino from the project (Alex, 22 Nov): their links and details
alter table public.roar_pro_projects add column if not exists ordinos jsonb not null default '[]'::jsonb;
alter table public.roar_pro_projects drop constraint if exists roar_pro_projects_ordinos_ok;
alter table public.roar_pro_projects add constraint roar_pro_projects_ordinos_ok check (jsonb_typeof(ordinos) = 'array' and pg_column_size(ordinos) <= 60000);

-- The project's cover (Alex, 22 Nov): one's own picture (a public link in roar-avatars) and which picture the cover shows
alter table public.roar_pro_projects add column if not exists cover text;
alter table public.roar_pro_projects add column if not exists cover_pick int not null default 0;

-- A project's admin side (Alex, 22 Nov): budget, expenses, who worked and their fees. Only the group's admins read or
-- change it, so it is a table of its own (the project row is read by every member).
create table if not exists public.roar_pro_admin (
  room_id uuid primary key references public.roar_rooms(id) on delete cascade,
  budget numeric,
  currency text not null default 'EUR',
  expenses jsonb not null default '[]'::jsonb,
  crew jsonb not null default '[]'::jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table public.roar_pro_admin drop constraint if exists roar_pro_admin_ok;
alter table public.roar_pro_admin add constraint roar_pro_admin_ok check (
  jsonb_typeof(expenses) = 'array' and jsonb_typeof(crew) = 'array' and char_length(currency) <= 8
  and pg_column_size(expenses) <= 200000 and pg_column_size(crew) <= 100000);
alter table public.roar_pro_admin enable row level security;
drop policy if exists roar_pro_admin_all on public.roar_pro_admin;
create policy roar_pro_admin_all on public.roar_pro_admin for all to authenticated
  using (public.roar_is_admin(room_id)) with check (public.roar_is_admin(room_id));
revoke all on public.roar_pro_admin from anon;
grant select, insert, update, delete on public.roar_pro_admin to authenticated;
drop trigger if exists roar_pro_admin_touch on public.roar_pro_admin;
create trigger roar_pro_admin_touch before insert or update on public.roar_pro_admin
  for each row execute function public.roar_pro_projects_touch();

-- Who besides the group's admins may open Admin (Alex, 22 Nov: "specific members"): access, a list the group's admins set
alter table public.roar_pro_admin add column if not exists access uuid[] not null default '{}';
drop policy if exists roar_pro_admin_all on public.roar_pro_admin;
drop policy if exists roar_pro_admin_read on public.roar_pro_admin;
create policy roar_pro_admin_read on public.roar_pro_admin for select to authenticated
  using (public.roar_is_admin(room_id) or (auth.uid() = any(access) and public.roar_is_member(room_id)));
drop policy if exists roar_pro_admin_add on public.roar_pro_admin;
create policy roar_pro_admin_add on public.roar_pro_admin for insert to authenticated
  with check (public.roar_is_admin(room_id));
drop policy if exists roar_pro_admin_change on public.roar_pro_admin;
create policy roar_pro_admin_change on public.roar_pro_admin for update to authenticated
  using (public.roar_is_admin(room_id) or (auth.uid() = any(access) and public.roar_is_member(room_id)))
  with check (public.roar_is_admin(room_id) or (auth.uid() = any(access) and public.roar_is_member(room_id)));
drop policy if exists roar_pro_admin_drop on public.roar_pro_admin;
create policy roar_pro_admin_drop on public.roar_pro_admin for delete to authenticated
  using (public.roar_is_admin(room_id));
-- only the group's admins change who has access
create or replace function public.roar_pro_admin_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.access is distinct from old.access and not roar_is_admin(new.room_id) then
    raise exception 'Only an admin of the group can change who sees Admin';
  end if;
  return new;
end $$;
drop trigger if exists roar_pro_admin_guard on public.roar_pro_admin;
create trigger roar_pro_admin_guard before update on public.roar_pro_admin
  for each row execute function public.roar_pro_admin_guard();
