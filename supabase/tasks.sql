-- Tasks (Alex, 18 Oct 2026): a small task manager beside the chats, opened from the Tasks button, never posted
-- into a conversation. A task goes to yourself or to someone you share a chat with (your Contacts); for someone
-- else it waits until they accept or decline it. Only the one who gave it and the one it is for can see it.
-- Safe to run again.
create table if not exists public.roar_tasks (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assignee     uuid not null references auth.users(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 300),
  notes        text not null default '' check (length(notes) <= 4000),
  due          date,
  priority     text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status       text not null default 'pending' check (status in ('pending', 'open', 'doing', 'done', 'declined')),
  subtasks     jsonb not null default '[]'::jsonb check (jsonb_typeof(subtasks) = 'array' and octet_length(subtasks::text) <= 20000),
  decline_note text not null default '' check (length(decline_note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index if not exists roar_tasks_assignee on public.roar_tasks (assignee, status);
create index if not exists roar_tasks_creator on public.roar_tasks (created_by, status);
alter table public.roar_tasks enable row level security;

drop policy if exists roar_tasks_read on public.roar_tasks;
create policy roar_tasks_read on public.roar_tasks for select to authenticated
  using (created_by = (select auth.uid()) or assignee = (select auth.uid()));
drop policy if exists roar_tasks_insert on public.roar_tasks;
create policy roar_tasks_insert on public.roar_tasks for insert to authenticated
  with check (created_by = (select auth.uid()));
drop policy if exists roar_tasks_update on public.roar_tasks;
create policy roar_tasks_update on public.roar_tasks for update to authenticated
  using (created_by = (select auth.uid()) or assignee = (select auth.uid()))
  with check (created_by = (select auth.uid()) or assignee = (select auth.uid()));
drop policy if exists roar_tasks_delete on public.roar_tasks;
create policy roar_tasks_delete on public.roar_tasks for delete to authenticated
  using (created_by = (select auth.uid()));
-- the same second-factor rule as the rest of RoarMe
drop policy if exists roar_mfa on public.roar_tasks;
create policy roar_mfa on public.roar_tasks as restrictive for all to authenticated
  using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_tasks from anon;

-- who may give a task to whom: yourself, or someone you share a chat with and neither has blocked
create or replace function public.roar_task_can_give(person uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    person = auth.uid()
    or (public.roar_shares_room(person)
        and not exists (select 1 from roar_blocks where (blocker = auth.uid() and blocked = person) or (blocker = person and blocked = auth.uid())))
  )
$$;
revoke all on function public.roar_task_can_give(uuid) from public, anon;
grant execute on function public.roar_task_can_give(uuid) to authenticated;

-- the rules the app cannot be trusted to keep
create or replace function public.roar_tasks_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); giver boolean; taker boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := me; new.created_at := now(); new.updated_at := now(); new.done_at := null; new.decline_note := '';
    if not public.roar_task_can_give(new.assignee) then raise exception 'roar: a task can go only to you or to someone you share a chat with'; end if;
    new.status := case when new.assignee = me then 'open' else 'pending' end;
    return new;
  end if;

  giver := old.created_by = me; taker := old.assignee = me;
  new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at; new.updated_at := now();
  if not giver then
    -- the one it is for moves it along; what it is and who it is for stay the giver's
    new.title := old.title; new.notes := old.notes; new.due := old.due; new.priority := old.priority; new.assignee := old.assignee;
  end if;
  if not taker then new.decline_note := old.decline_note; end if;

  if new.assignee <> old.assignee then
    -- given to someone else: asked again from the start
    if not public.roar_task_can_give(new.assignee) then raise exception 'roar: a task can go only to you or to someone you share a chat with'; end if;
    new.status := case when new.assignee = me then 'open' else 'pending' end;
    new.decline_note := ''; new.done_at := null;
  elsif new.status <> old.status then
    if old.status = 'pending' then
      if not taker or new.status not in ('open', 'declined') then raise exception 'roar: only the person it is for can accept or decline it'; end if;
    elsif old.status = 'declined' then
      raise exception 'roar: a declined task can only be given to someone again';
    elsif new.status = 'declined' then
      if not taker then raise exception 'roar: only the person it is for can decline it'; end if;
    elsif new.status = 'pending' then
      raise exception 'roar: not allowed';
    end if;
    new.done_at := case when new.status = 'done' then now() else null end;
  end if;
  return new;
end $$;
drop trigger if exists roar_tasks_guard on public.roar_tasks;
create trigger roar_tasks_guard before insert or update on public.roar_tasks
  for each row execute function public.roar_tasks_guard();
revoke all on function public.roar_tasks_guard() from public, anon, authenticated;

-- live: a new task, an answer or a tick reaches the other person at once
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'roar_tasks') then
    alter publication supabase_realtime add table public.roar_tasks;
  end if;
end $$;

-- live updates carry the previous status too, so RoarMe can tell "accepted" or "finished" apart
alter table public.roar_tasks replica identity full;
