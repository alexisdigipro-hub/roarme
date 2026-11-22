-- PROjects: three chats in one project group (Alex, 22 Nov: "this group with three chat tabs only, PRE PRODUCTION -
-- PRODUCTION - POST PRODUCTION, each seen by different people; the admins set it; only pre production sees the Workspace").
-- A message carries its tab (channel: 'pre' | 'prod' | 'post'; null = 'pre', so every older message is in PRE PRODUCTION).
-- A member sees the tabs in roar_members.channels (null = PRODUCTION, so a new member starts there); the group's admins see
-- all three and the Workspace. Held by the server: a restrictive policy, the list, the badge and the notifications.
-- Safe to run again.

alter table public.roar_messages add column if not exists channel text;
do $$ begin
  alter table public.roar_messages add constraint roar_messages_channel_ok check (channel is null or channel in ('pre', 'prod', 'post'));
exception when duplicate_object then null; end $$;
alter table public.roar_members add column if not exists channels text[];
alter table public.roar_members add column if not exists cur_channel text;
create index if not exists roar_messages_room_channel on public.roar_messages (room_id, channel);

-- who was in a project group before the tabs keeps what they saw (all of it was PRE PRODUCTION); done once
do $$ begin
  if not exists (select 1 from public.roar_members where channels is not null) then
    update public.roar_members m set channels = '{pre}'
    where m.role <> 'admin' and exists (select 1 from public.roar_pro_projects p where p.room_id = m.room_id);
  end if;
end $$;

-- may person u see tab ch of room r (any message of a group that is not a project)
create or replace function public.roar_sees(u uuid, r uuid, ch text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from roar_pro_projects p where p.room_id = r) then true
    else exists (select 1 from roar_members m where m.room_id = r and m.user_id = u
      and (m.role = 'admin' or coalesce(ch, 'pre') = any(coalesce(m.channels, '{prod}'))))
  end
$$;
revoke all on function public.roar_sees(uuid, uuid, text) from public, anon;
grant execute on function public.roar_sees(uuid, uuid, text) to authenticated, service_role;

-- a new message goes into the tab its sender has open (roar_members.cur_channel), else the first they may write in
create or replace function public.roar_message_channel() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record; allowed text[];
begin
  if new.channel is not null or new.user_id is null then return new; end if;
  if not exists (select 1 from roar_pro_projects p where p.room_id = new.room_id) then return new; end if;
  select role, channels, cur_channel into m from roar_members where room_id = new.room_id and user_id = new.user_id;
  if m is null then return new; end if;
  allowed := case when m.role = 'admin' then '{pre,prod,post}'::text[] else coalesce(m.channels, '{prod}') end;
  new.channel := case when m.cur_channel = any(allowed) then m.cur_channel else allowed[1] end;
  return new;
end $$;
drop trigger if exists roar_message_channel on public.roar_messages;
create trigger roar_message_channel before insert on public.roar_messages for each row execute function public.roar_message_channel();

drop policy if exists roar_messages_channel_read on public.roar_messages;
create policy roar_messages_channel_read on public.roar_messages as restrictive for select to authenticated using (public.roar_sees(auth.uid(), room_id, channel));
drop policy if exists roar_messages_channel_write on public.roar_messages;
create policy roar_messages_channel_write on public.roar_messages as restrictive for insert to authenticated with check (public.roar_sees(auth.uid(), room_id, channel));

-- the tab one has open (the app sets it when a tab is chosen)
grant update (cur_channel) on public.roar_members to authenticated;

-- an admin of the group gives a member their tabs
create or replace function public.roar_set_channels(r uuid, u uuid, chans text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin(r) then raise exception 'Only an admin of the group can choose who sees which chat.'; end if;
  update roar_members set channels = (select coalesce(array_agg(distinct c order by c), '{}') from unnest(chans) c where c in ('pre', 'prod', 'post'))
  where room_id = r and user_id = u;
end $$;
revoke all on function public.roar_set_channels(uuid, uuid, text[]) from public, anon;
grant execute on function public.roar_set_channels(uuid, uuid, text[]) to authenticated;

-- the Workspace (the project's row) only for its admins and who sees PRE PRODUCTION
drop policy if exists roar_pro_projects_pre on public.roar_pro_projects;
create policy roar_pro_projects_pre on public.roar_pro_projects as restrictive for all to authenticated
  using (public.roar_sees(auth.uid(), room_id, 'pre')) with check (public.roar_sees(auth.uid(), room_id, 'pre'));

-- the chat list: only messages one may see count and show; it also says whether the group is a project and one's tabs
drop function if exists public.roar_my_rooms();
create function public.roar_my_rooms()
returns table(room_id uuid, kind text, title text, avatar_url text, last_message_at timestamptz, muted boolean, archived boolean,
  last_read_at timestamptz, role text, unread integer, last_body text, last_kind text, last_user uuid, last_deleted boolean,
  members uuid[], project boolean, channels text[])
language sql stable security definer set search_path = public as $$
  select r.id, r.kind, r.title, r.avatar_url, r.last_message_at, m.muted, m.archived, m.last_read_at, m.role,
    (select count(*)::int from roar_messages x where x.room_id = r.id and x.created_at > m.last_read_at
       and x.user_id is distinct from auth.uid() and x.deleted_at is null and (pp.room_id is null or roar_sees(auth.uid(), r.id, x.channel))),
    l.body, l.kind, l.user_id, l.deleted_at is not null,
    (select array_agg(mm.user_id) from roar_members mm where mm.room_id = r.id),
    pp.room_id is not null,
    case when pp.room_id is null then null when m.role = 'admin' then '{pre,prod,post}'::text[] else coalesce(m.channels, '{prod}') end
  from roar_members m
  join roar_rooms r on r.id = m.room_id
  left join roar_pro_projects pp on pp.room_id = r.id
  left join lateral (select y.body, y.kind, y.user_id, y.deleted_at from roar_messages y where y.room_id = r.id
    and (pp.room_id is null or roar_sees(auth.uid(), r.id, y.channel)) order by y.created_at desc limit 1) l on true
  where m.user_id = auth.uid()
  order by r.last_message_at desc
$$;
revoke all on function public.roar_my_rooms() from public, anon;
grant execute on function public.roar_my_rooms() to authenticated;

-- notifications: only to who may see the message's tab
create or replace function public.roar_push_targets(msg uuid)
returns table(endpoint text, p256dh text, auth text, preview boolean, user_id uuid, unread integer, mention boolean)
language sql stable security definer set search_path = public as $$
  with m as (select * from roar_messages where id = msg and kind <> 'system' and user_id is not null),
  men as (select public.roar_mentioned(m.room_id, m.body, m.user_id) as uid from m where m.body like '%@%')
  select s.endpoint, s.p256dh, s.auth, s.preview, s.user_id,
    (select count(*)::int from roar_members mm join roar_messages x on x.room_id = mm.room_id
       where mm.user_id = s.user_id and (not mm.muted or mm.muted_until < now()) and x.created_at > mm.last_read_at
         and x.user_id is distinct from s.user_id and x.kind <> 'system' and x.deleted_at is null and roar_sees(s.user_id, x.room_id, x.channel)),
    mem.user_id in (select uid from men)
  from m
  join roar_members mem on mem.room_id = m.room_id and mem.user_id <> m.user_id
  join roar_push_subs s on s.user_id = mem.user_id
  left join roar_profiles p on p.id = mem.user_id
  where (not mem.muted or mem.muted_until < now() or mem.user_id in (select uid from men))
    and (p.active_until is null or p.active_until < now())
    and not exists (select 1 from roar_blocks b where b.blocker = mem.user_id and b.blocked = m.user_id)
    and roar_sees(mem.user_id, m.room_id, m.channel)
$$;

-- the number on the icon
create or replace function public.roar_badge_counts(ids uuid[])
returns table(user_id uuid, n integer)
language sql stable security definer set search_path = public as $$
  select m.user_id, least(count(x.id), 9999)::int
  from roar_members m
  join roar_messages x on x.room_id = m.room_id and x.created_at > m.last_read_at
    and x.user_id is distinct from m.user_id and x.deleted_at is null and x.kind <> 'system'
  where m.user_id = any(ids)
    and not coalesce(m.archived, false)
    and not (coalesce(m.muted, false) and (m.muted_until is null or m.muted_until > now()))
    and roar_sees(m.user_id, x.room_id, x.channel)
  group by m.user_id
$$;
