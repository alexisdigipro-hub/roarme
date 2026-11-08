-- Admin moderation (Alex, 8 Nov 2026). Only the admins (roar_admins, roar_is_admin()) can call these. Safe to run again.
--  roar_admin_delete_message: delete any message for everyone (spam, insults), as one's own Delete for Everyone does:
--    the message stays as "deleted" in the chat, its text gone. System lines (Encrypted Chat on/off) are never touched.
--  roar_official_edit: correct a message of the official RoarMe account, the one the admins answer as. It gets no
--    "edited" mark: these are the admins' own words. Nobody else's messages can be edited, by anyone.
create or replace function public.roar_admin_delete_message(m uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  update roar_messages set deleted_at = now(), body = '' where id = m and kind <> 'system' and deleted_at is null;
end $$;

create or replace function public.roar_official_edit(m uuid, body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_admin() then raise exception 'not allowed'; end if;
  if body is null or length(trim(body)) = 0 or length(body) > 8000 then raise exception 'Write the message'; end if;
  update roar_messages x set body = trim(roar_official_edit.body)
    where x.id = m and x.user_id = roar_official_id() and x.kind = 'text' and x.deleted_at is null;
  if not found then raise exception 'Only RoarMe''s own text messages can be corrected'; end if;
end $$;

revoke all on function public.roar_admin_delete_message(uuid), public.roar_official_edit(uuid, text) from public, anon;
grant execute on function public.roar_admin_delete_message(uuid), public.roar_official_edit(uuid, text) to authenticated;
