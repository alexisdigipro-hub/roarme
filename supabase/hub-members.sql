-- Hub Members (Alex, 22 Nov): whoever has linked a Production Hub (roar_hub_accounts) marks people from their contacts
-- as members of THEIR hub, each with a category (Pre / Prod / Post). A member gets PROjects without a plan of their own
-- and, put into a project group by that hub's owner (an admin of it), lands in the chats of their category.
-- Members belong to one owner's hub only; nobody else sees or changes them. Safe to run again.

create table if not exists public.roar_hub_members (
  owner uuid not null references auth.users(id) on delete cascade,
  member uuid not null references auth.users(id) on delete cascade,
  channels text[] not null default '{prod}',
  set_at timestamptz not null default now(),
  primary key (owner, member),
  constraint roar_hub_members_self check (owner <> member),
  constraint roar_hub_members_ch check (cardinality(channels) > 0 and channels <@ array['pre', 'prod', 'post']::text[])
);
alter table public.roar_hub_members enable row level security;
revoke all on public.roar_hub_members from anon;
grant select, insert, update, delete on public.roar_hub_members to authenticated;

-- roar_hub_accounts is closed to members, so the check asks a definer function
create or replace function public.roar_has_hub() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roar_hub_accounts where user_id = auth.uid())
$$;
revoke all on function public.roar_has_hub() from public, anon;
grant execute on function public.roar_has_hub() to authenticated;
drop policy if exists roar_hub_members_own on public.roar_hub_members;
create policy roar_hub_members_own on public.roar_hub_members for all to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and public.roar_has_hub());

-- a new member gets PROjects switched on
create or replace function public.roar_hub_member_on() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update roar_profiles set pro_on = true where id = new.member and not pro_on;
  return new;
end $$;
drop trigger if exists roar_hub_member_on on public.roar_hub_members;
create trigger roar_hub_member_on after insert on public.roar_hub_members for each row execute function public.roar_hub_member_on();

-- the category a person has in the hub of one of the group's admins
create or replace function public.roar_hub_channels_for(r uuid, u uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select hm.channels from roar_hub_members hm
  join roar_members a on a.room_id = r and a.user_id = hm.owner and a.role = 'admin'
  where hm.member = u order by hm.set_at desc limit 1
$$;
revoke all on function public.roar_hub_channels_for(uuid, uuid) from public, anon, authenticated;

-- joining a project group: the category's chats, unless an admin already chose
create or replace function public.roar_member_hub_channels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.channels is null and exists (select 1 from roar_pro_projects p where p.room_id = new.room_id) then
    new.channels := roar_hub_channels_for(new.room_id, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists roar_member_hub_channels on public.roar_members;
create trigger roar_member_hub_channels before insert on public.roar_members for each row execute function public.roar_member_hub_channels();

-- a group made a project: its hub members who have no chats chosen get their category's
create or replace function public.roar_project_hub_channels() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update roar_members m set channels = c.ch
  from (select user_id, roar_hub_channels_for(new.room_id, user_id) ch from roar_members where room_id = new.room_id and channels is null) c
  where m.room_id = new.room_id and m.user_id = c.user_id and m.channels is null and c.ch is not null;
  return new;
end $$;
drop trigger if exists roar_project_hub_channels on public.roar_pro_projects;
create trigger roar_project_hub_channels after insert on public.roar_pro_projects for each row execute function public.roar_project_hub_channels();
