-- Notices (Alex, 22 Nov, C of https://claude.ai/artifact/VqQdFtcDsKBi25eA1YBard): a slim line in a project's chat that
-- only the person it concerns sees, with the message sound and a notification: put on a task, a task of theirs marked
-- done by someone else, a task of theirs due tomorrow. roar_messages.only_for: null for everyone, else that one person
-- (and its sender). Safe to run again.

alter table public.roar_messages add column if not exists only_for uuid;

drop policy if exists roar_messages_only_for on public.roar_messages;
create policy roar_messages_only_for on public.roar_messages as restrictive for select to authenticated
  using (only_for is null or only_for = auth.uid() or user_id = auth.uid());

create or replace function public.roar_badge_counts(ids uuid[])
 returns table(user_id uuid, n integer) language sql stable security definer set search_path to 'public' as $function$
  select m.user_id, least(count(x.id), 9999)::int
  from roar_members m
  join roar_messages x on x.room_id = m.room_id and x.created_at > m.last_read_at
    and x.user_id is distinct from m.user_id and x.deleted_at is null and x.kind <> 'system'
    and (x.only_for is null or x.only_for = m.user_id)
  where m.user_id = any(ids)
    and not coalesce(m.archived, false)
    and not (coalesce(m.muted, false) and (m.muted_until is null or m.muted_until > now()))
    and roar_sees(m.user_id, x.room_id, x.channel)
  group by m.user_id
$function$;

create or replace function public.roar_my_rooms()
 returns table(room_id uuid, kind text, title text, avatar_url text, last_message_at timestamp with time zone, muted boolean, archived boolean, last_read_at timestamp with time zone, role text, unread integer, last_body text, last_kind text, last_user uuid, last_deleted boolean, members uuid[], project boolean, channels text[])
 language sql stable security definer set search_path to 'public' as $function$
  select r.id, r.kind, r.title, r.avatar_url, r.last_message_at, m.muted, m.archived, m.last_read_at, m.role,
    (select count(*)::int from roar_messages x where x.room_id = r.id and x.created_at > m.last_read_at
       and x.user_id is distinct from auth.uid() and x.deleted_at is null and (x.only_for is null or x.only_for = auth.uid())
       and (pp.room_id is null or roar_sees(auth.uid(), r.id, x.channel))),
    l.body, l.kind, l.user_id, l.deleted_at is not null,
    (select array_agg(mm.user_id) from roar_members mm where mm.room_id = r.id),
    pp.room_id is not null,
    case when pp.room_id is null then null when m.role = 'admin' then '{pre,prod,post}'::text[] else coalesce(m.channels, '{prod}') end
  from roar_members m
  join roar_rooms r on r.id = m.room_id
  left join roar_pro_projects pp on pp.room_id = r.id
  left join lateral (select y.body, y.kind, y.user_id, y.deleted_at from roar_messages y where y.room_id = r.id
    and (y.only_for is null or y.only_for = auth.uid())
    and (pp.room_id is null or roar_sees(auth.uid(), r.id, y.channel)) order by y.created_at desc limit 1) l on true
  where m.user_id = auth.uid()
  order by r.last_message_at desc
$function$;

create or replace function public.roar_push_targets(msg uuid)
 returns table(endpoint text, p256dh text, auth text, preview boolean, user_id uuid, unread integer, mention boolean)
 language sql stable security definer set search_path to 'public' as $function$
  with m as (select * from roar_messages where id = msg and kind <> 'system' and user_id is not null),
  men as (select public.roar_mentioned(m.room_id, m.body, m.user_id) as uid from m where m.body like '%@%')
  select s.endpoint, s.p256dh, s.auth, s.preview, s.user_id,
    (select count(*)::int from roar_members mm join roar_messages x on x.room_id = mm.room_id
       where mm.user_id = s.user_id and (not mm.muted or mm.muted_until < now()) and x.created_at > mm.last_read_at
         and x.user_id is distinct from s.user_id and x.kind <> 'system' and x.deleted_at is null
         and (x.only_for is null or x.only_for = s.user_id) and roar_sees(s.user_id, x.room_id, x.channel)),
    mem.user_id in (select uid from men)
  from m
  join roar_members mem on mem.room_id = m.room_id and mem.user_id <> m.user_id
  join roar_push_subs s on s.user_id = mem.user_id
  left join roar_profiles p on p.id = mem.user_id
  where (not mem.muted or mem.muted_until < now() or mem.user_id in (select uid from men))
    and (p.active_until is null or p.active_until < now())
    and not exists (select 1 from roar_blocks b where b.blocker = mem.user_id and b.blocked = m.user_id)
    and roar_sees(mem.user_id, m.room_id, m.channel)
    and (m.only_for is null or m.only_for = mem.user_id)
$function$;

-- a task of yours due tomorrow: once a day, 08:00 Athens, a notice from the group's first admin
create or replace function public.roar_task_due_notices() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record; who uuid; adm uuid; ch text;
begin
  for r in select p.room_id, t as task from roar_pro_projects p, jsonb_array_elements(coalesce(p.tasks, '[]'::jsonb)) t
    where t->>'due' = to_char((now() at time zone 'Europe/Athens')::date + 1, 'YYYY-MM-DD') and coalesce(t->>'s', 'todo') <> 'done'
  loop
    select m.user_id into adm from roar_members m where m.room_id = r.room_id and m.role = 'admin' order by m.joined_at limit 1;
    if adm is null then continue; end if;
    for who in select (jsonb_array_elements_text(coalesce(r.task->'who', '[]'::jsonb)))::uuid loop
      if not exists (select 1 from roar_members m where m.room_id = r.room_id and m.user_id = who) then continue; end if;
      if exists (select 1 from roar_messages x where x.room_id = r.room_id and x.only_for = who and x.file->'notice'->>'k' = 'due'
                 and x.file->'notice'->>'task' = r.task->>'id' and x.created_at > now() - interval '20 hours') then continue; end if;
      select case when m.role = 'admin' then 'pre' else coalesce((coalesce(m.channels, '{prod}'))[1], 'prod') end into ch
        from roar_members m where m.room_id = r.room_id and m.user_id = who;
      insert into roar_messages (room_id, user_id, kind, body, channel, only_for, file)
      values (r.room_id, adm, 'text', 'A task of yours is due tomorrow: ' || coalesce(r.task->>'t', ''), ch, who,
        jsonb_build_object('notice', jsonb_build_object('k', 'due', 'task', r.task->>'id', 'title', r.task->>'t')));
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.roar_task_due_notices() from public, anon, authenticated;
select cron.unschedule('roar-task-due') where exists (select 1 from cron.job where jobname = 'roar-task-due');
select cron.schedule('roar-task-due', '0 6 * * *', $c$ select public.roar_task_due_notices(); $c$);
