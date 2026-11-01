-- Security and speed pass (Alex, 21 Oct 2026: "look at it all, and for security holes"). Safe to run again.

-- 1. roar_people (the profile view everyone reads) answered writes too: being a simple view owned by postgres,
--    a signed-in person could change or delete anyone's name, @username, bio or colour through it.
--    It is for reading only; one's own profile is changed in roar_profiles under its own policies.
revoke insert, update, delete, truncate, references, trigger on public.roar_people from authenticated, anon, public;

-- 2. trigger functions are not something to call over the API
--    (the hub's guard functions named here were removed on 1 Nov 2026 by hub-unlink.sql)

-- 3. deleting messages (cleanup deletes thousands at a time) looked through every message for replies and hides
--    to that message: now an index finds them
create index if not exists roar_messages_reply_to on public.roar_messages (reply_to) where reply_to is not null;
create index if not exists roar_messages_user on public.roar_messages (user_id);
create index if not exists roar_msg_hides_message on public.roar_msg_hides (message_id);
create index if not exists roar_reminders_message on public.roar_reminders (message_id);
create index if not exists roar_rooms_pinned_message on public.roar_rooms (pinned_message_id) where pinned_message_id is not null;
create index if not exists roar_scheduled_reply_to on public.roar_scheduled (reply_to) where reply_to is not null;

-- 4. Two-Step Verification held only on the tables: with a password alone (no 6-digit code) one could still read
--    chat files, open admin pages and see one's RoarTransfer links. Now the file check, the admin checks and the
--    transfer list ask for the code too (roar_aal_ok: the code given, or no authenticator set up; not blocked).
create or replace function public.roar_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select public.roar_aal_ok() and exists (select 1 from public.roar_admins where user_id = auth.uid())
$$;
create or replace function public.roar_is_admin(r uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.roar_aal_ok() and exists (select 1 from roar_members where room_id = r and user_id = auth.uid() and role = 'admin')
$$;
create or replace function public.roar_file_ok(objname text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(objname, '/', 1);
begin
  if f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return roar_aal_ok() and roar_is_member(f::uuid);
end $$;
create or replace function public.roar_own_transfer(objname text) returns boolean language sql stable set search_path = public as $$
  select auth.uid() is not null and public.roar_aal_ok()
    and split_part(objname, '/', 1) = 'u'
    and split_part(objname, '/', 2) = auth.uid()::text
    and split_part(objname, '/', 3) <> ''
$$;
create or replace function public.roar_my_transfers()
 returns table(path text, name text, size bigint, type text, created_at timestamptz, expires timestamptz, source text, room_kind text, room_title text, token text, opens bigint, downloads bigint, last_download timestamptz, stopped boolean, deleted boolean)
 language sql stable security definer set search_path = public as $$
  select t.path, t.name, t.size, t.type, t.created_at, t.expires, t.source, t.room_kind, t.room_title, t.token,
    t.opens, t.downloads, t.last_download, t.stopped, t.deleted
  from public.roar_transfer_items() t
  where auth.uid() is not null and public.roar_aal_ok() and t.user_id = auth.uid()
  order by t.created_at desc
  limit 1000
$$;
-- NOT YET APPLIED (the database tool asks for a person's confirmation for anything that deletes accounts):
-- deleting one's own account asks for the code too. Run this one by hand in the Supabase SQL editor.
create or replace function public.roar_delete_me() returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.roar_aal_ok() then raise exception 'not allowed'; end if;
  delete from roar_rooms r where r.kind = 'direct' and r.direct_key like '%' || me::text || '%';
  delete from auth.users where id = me;
end $$;

-- 5. one's own "Encrypted Chat on / off" lines in a chat could be edited afterwards (turning "off" back into "on");
--    a reaction could be moved into a chat one is not in
alter policy roar_messages_update on public.roar_messages
  using (user_id = (select auth.uid()) and kind <> 'system') with check (user_id = (select auth.uid()) and kind <> 'system');
alter policy roar_reactions_change on public.roar_reactions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and roar_is_member(room_id)
    and exists (select 1 from roar_messages m where m.id = roar_reactions.message_id and m.room_id = roar_reactions.room_id));
