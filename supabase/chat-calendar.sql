-- The chat's calendar (Alex, 25 Nov, sample https://claude.ai/artifact/PQ57XutzNJ5LWw6HLJ7bDc, "βάλ' το").
-- roar_chat_days: every day of a chat that has messages one can see, its first message (to go to it) and its newest
-- photo or video (to show in the day's circle). roar_clear_days: Clear History for the chosen days, for me (hidden for
-- me) and, when asked, my own messages of those days deleted for everyone. Both run as the caller, so every rule of
-- roar_messages (channels, earlier history, notices) and roar_msg_hides holds. Safe to run again.
create or replace function public.roar_chat_days(r uuid, tz text default 'UTC')
returns table (day date, n int, first_id uuid, pic jsonb)
language sql stable security invoker set search_path = public as $$
  with m as (
    select id, kind, file, created_at, (created_at at time zone coalesce(nullif(tz, ''), 'UTC'))::date as d
    from roar_messages
    where room_id = r and deleted_at is null and kind <> 'system'
      and not exists (select 1 from roar_msg_hides h where h.message_id = roar_messages.id and h.user_id = auth.uid())
  )
  select d, count(*)::int,
    (array_agg(id order by created_at))[1],
    (array_agg(file order by created_at desc) filter (where (kind = 'image' or (kind = 'file' and file->>'type' like 'video/%'))
      and coalesce((file->>'asFile')::boolean, false) = false and coalesce((file->>'round')::boolean, false) = false and file ? 'path'))[1]
  from m group by d order by d
$$;

create or replace function public.roar_clear_days(r uuid, days date[], everyone boolean default false, tz text default 'UTC')
returns int language plpgsql security invoker set search_path = public as $$
declare me uuid := auth.uid(); k int;
begin
  if me is null or coalesce(array_length(days, 1), 0) = 0 or array_length(days, 1) > 400 then return 0; end if;
  insert into roar_msg_hides (user_id, message_id, room_id)
    select me, id, r from roar_messages
    where room_id = r and deleted_at is null
      and (created_at at time zone coalesce(nullif(tz, ''), 'UTC'))::date = any(days)
  on conflict do nothing;
  get diagnostics k = row_count;
  if everyone then
    update roar_messages set deleted_at = now(), body = ''
      where room_id = r and user_id = me and deleted_at is null
        and (created_at at time zone coalesce(nullif(tz, ''), 'UTC'))::date = any(days);
  end if;
  return k;
end $$;
revoke all on function public.roar_chat_days(uuid, text) from public, anon;
revoke all on function public.roar_clear_days(uuid, date[], boolean, text) from public, anon;
grant execute on function public.roar_chat_days(uuid, text) to authenticated;
grant execute on function public.roar_clear_days(uuid, date[], boolean, text) to authenticated;
