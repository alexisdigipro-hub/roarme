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
