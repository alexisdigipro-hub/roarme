-- Change the picture of one's own photo or video message (Alex, 21 Nov: Edit > Edit Photo / Replace Photo). The file
-- column is not open to UPDATE (schema.sql grants only body, edited_at, deleted_at), so this does it for the sender
-- alone: the message must be theirs, not deleted, not encrypted, a photo or a video, and the new file must lie in that
-- chat's own folder of roar-files (it was just put there by the app). Safe to run again.
create or replace function public.roar_replace_media(msg uuid, f jsonb, k text)
returns void language plpgsql security definer set search_path = public as $$
declare m record; pre text;
begin
  select id, room_id, user_id, kind, file, body, deleted_at into m from roar_messages where id = msg;
  if m.id is null or m.user_id <> auth.uid() then raise exception 'not your message'; end if;
  if m.deleted_at is not null then raise exception 'deleted'; end if;
  if coalesce(m.body, '') like 'e2e1.%' then raise exception 'encrypted'; end if;
  if not (m.kind = 'image' or coalesce(m.file->>'type', '') like 'video/%') then raise exception 'not a photo or video'; end if;
  if k not in ('image', 'file') or jsonb_typeof(f) <> 'object' then raise exception 'bad file'; end if;
  if not (k = 'image' or coalesce(f->>'type', '') like 'video/%') then raise exception 'only a photo or a video'; end if;
  pre := m.room_id::text || '/';
  if coalesce(f->>'path', '') not like pre || '%' or f ? 'bucket' or (f ? 'thumb' and coalesce(f->>'thumb', '') not like pre || '%') then raise exception 'bad file'; end if;
  update roar_messages set file = f, kind = k, edited_at = now() where id = msg;
end $$;
revoke all on function public.roar_replace_media(uuid, jsonb, text) from public, anon;
grant execute on function public.roar_replace_media(uuid, jsonb, text) to authenticated;
