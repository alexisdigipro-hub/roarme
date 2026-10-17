-- Security check of 17 Oct 2026. Safe to run again.
-- 1. who talks to whom and who blocked whom: only answerable about yourself
create or replace function public.roar_are_contacts(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (a, b)
    and exists (select 1 from roar_rooms r where r.kind = 'direct' and r.direct_key = least(a::text, b::text) || ':' || greatest(a::text, b::text))
$$;
create or replace function public.roar_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and auth.uid() in (a, b)
    and exists (select 1 from roar_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;
-- 2. a message always gets the server's time (no backdating, no future dates that dodged Auto-Delete)
create or replace function public.roar_message_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $$;
drop trigger if exists roar_message_stamp on public.roar_messages;
create trigger roar_message_stamp before insert on public.roar_messages for each row execute function public.roar_message_stamp();
-- 3. sizes, and pictures only from RoarMe's own storage (an outside address would reveal viewers' IP addresses)
alter table public.roar_messages drop constraint if exists roar_body_size;
alter table public.roar_messages add constraint roar_body_size check (length(coalesce(body, '')) <= 20000);
alter table public.roar_profiles drop constraint if exists roar_profile_sizes;
alter table public.roar_profiles add constraint roar_profile_sizes check (length(coalesce(display_name, '')) <= 64 and length(coalesce(bio, '')) <= 300);
alter table public.roar_profiles drop constraint if exists roar_avatar_own;
alter table public.roar_profiles add constraint roar_avatar_own check (coalesce(avatar_url, '') = '' or avatar_url like 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/storage/v1/object/public/roar-avatars/%');
alter table public.roar_rooms drop constraint if exists roar_room_sizes;
alter table public.roar_rooms add constraint roar_room_sizes check (length(coalesce(title, '')) <= 80);
alter table public.roar_rooms drop constraint if exists roar_room_avatar_own;
alter table public.roar_rooms add constraint roar_room_avatar_own check (coalesce(avatar_url, '') = '' or avatar_url like 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/storage/v1/object/public/roar-avatars/%');
-- 4. buckets: chat files up to 50 MB (bigger go by RoarTransfer and expire), profile pictures 5 MB, images only
update storage.buckets set file_size_limit = 52428800 where id = 'roar-files';
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'] where id = 'roar-avatars';
