-- Who sees a group's earlier messages (Alex, 23 Nov). roar_members.history_from: null = sees everything (as always);
-- a time = sees only messages from then on. Set only by the group's admins (roar_set_history), held by a restrictive
-- policy, so media, files, search and the chat itself all follow it. Safe to run again.

alter table public.roar_members add column if not exists history_from timestamptz;

create or replace function public.roar_hist_ok(u uuid, r uuid, at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from roar_members m where m.room_id = r and m.user_id = u
    and m.history_from is not null and at < m.history_from)
$$;
revoke all on function public.roar_hist_ok(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.roar_hist_ok(uuid, uuid, timestamptz) to authenticated, service_role;

drop policy if exists roar_messages_history_read on public.roar_messages;
create policy roar_messages_history_read on public.roar_messages as restrictive for select to authenticated
  using (public.roar_hist_ok(auth.uid(), room_id, created_at));

-- an admin turns a member's earlier messages on (sees = true) or off (from the time they joined)
create or replace function public.roar_set_history(r uuid, u uuid, sees boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin(r) then raise exception 'Only an admin of the group can choose who sees earlier messages.'; end if;
  update roar_members set history_from = case when sees then null else coalesce(joined_at, now()) end
  where room_id = r and user_id = u;
end $$;
revoke all on function public.roar_set_history(uuid, uuid, boolean) from public, anon;
grant execute on function public.roar_set_history(uuid, uuid, boolean) to authenticated;
