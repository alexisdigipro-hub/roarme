-- Block and Delete accounts from Settings > Admin (Alex, 19 Oct 2026: "let me block and delete users").
-- Only the accounts in roar_admins can do it, never to themselves, another admin or the official RoarMe account.
--   Block: the account is cut off at once (every table's roar_mfa rule now also says "not blocked", so it reads and
--          writes nothing) and cannot sign in again or renew its sign-in (auth.users.banned_until). Unblock undoes both.
--   Delete: the account goes for good with its one-to-one chats and everything it sent; its files leave storage with
--          the next roar-cleanup run (they are no longer referenced). Groups stay, without its messages.
-- Run after admin.sql. Safe to run again.

create table if not exists public.roar_suspended (
  user_id uuid primary key references auth.users (id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid references auth.users (id) on delete set null
);
alter table public.roar_suspended enable row level security;
revoke all on public.roar_suspended from anon, authenticated;

-- the rule every table already checks (Two-Step Verification) now also shuts out a blocked account
create or replace function public.roar_aal_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select (coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    or not exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified'))
    and not exists (select 1 from public.roar_suspended where user_id = auth.uid())
$$;

-- the app asks once on start, to show "blocked" instead of an empty RoarMe
create or replace function public.roar_am_blocked() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roar_suspended where user_id = auth.uid())
$$;
revoke all on function public.roar_am_blocked() from public, anon;
grant execute on function public.roar_am_blocked() to authenticated;

-- who is blocked, for the Admin page
create or replace function public.roar_admin_blocked() returns setof uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query select user_id from public.roar_suspended;
end $$;
revoke all on function public.roar_admin_blocked() from public, anon;
grant execute on function public.roar_admin_blocked() to authenticated;

-- an account an admin may act on
create or replace function public.roar_admin_target(u uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.roar_is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if u is null or u = auth.uid() then raise exception 'Not your own account'; end if;
  if exists (select 1 from public.roar_admins where user_id = u) then raise exception 'An admin cannot be blocked or deleted here'; end if;
  if exists (select 1 from public.roar_official where user_id = u) then raise exception 'The RoarMe account cannot be blocked or deleted'; end if;
end $$;
revoke all on function public.roar_admin_target(uuid) from public, anon, authenticated;

create or replace function public.roar_admin_block(u uuid, block boolean default true) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.roar_admin_target(u);
  if block then
    insert into public.roar_suspended (user_id, blocked_by) values (u, auth.uid()) on conflict (user_id) do nothing;
    update auth.users set banned_until = now() + interval '100 years' where id = u;
    delete from auth.sessions where user_id = u; -- its sign-ins cannot be renewed
    delete from public.roar_push_subs where user_id = u;
  else
    delete from public.roar_suspended where user_id = u;
    update auth.users set banned_until = null where id = u;
  end if;
end $$;
revoke all on function public.roar_admin_block(uuid, boolean) from public, anon;
grant execute on function public.roar_admin_block(uuid, boolean) to authenticated;

create or replace function public.roar_admin_delete(u uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  dm uuid[];
  mine uuid[];
begin
  perform public.roar_admin_target(u);
  -- its one-to-one chats go whole (both sides), with what hangs on them
  select coalesce(array_agg(r.id), '{}') into dm from public.roar_rooms r
    where r.kind = 'direct' and exists (select 1 from public.roar_members m where m.room_id = r.id and m.user_id = u);
  update public.roar_calls set room_id = null where room_id = any (dm);
  update public.roar_scheduled set reply_to = null where reply_to in (select id from public.roar_messages where room_id = any (dm));
  delete from public.roar_rooms where id = any (dm);
  -- what it sent anywhere else (groups) goes too
  select coalesce(array_agg(id), '{}') into mine from public.roar_messages where user_id = u;
  update public.roar_messages set reply_to = null where reply_to = any (mine);
  update public.roar_rooms set pinned_message_id = null where pinned_message_id = any (mine);
  update public.roar_scheduled set reply_to = null where reply_to = any (mine);
  delete from public.roar_messages where id = any (mine);
  update public.roar_rooms set created_by = null where created_by = u;
  update public.roar_e2e_sessions set started_by = null where started_by = u;
  update public.roar_e2e_sessions set ended_by = null where ended_by = u;
  -- the account itself; everything else of it (profile, memberships, contacts, calls, tasks…) follows
  delete from auth.users where id = u;
end $$;
revoke all on function public.roar_admin_delete(uuid) from public, anon;
grant execute on function public.roar_admin_delete(uuid) to authenticated;
