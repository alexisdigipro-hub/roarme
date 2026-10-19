-- A chat with RoarMe waiting for everyone (Alex, 19 Oct 2026): every account, the ones there now and every new one,
-- finds in Messages a chat with the official RoarMe account and a welcome that says ideas and questions go there.
-- Not for the admins (they answer RoarMe's chats in their RoarMe Inbox) nor for RoarMe itself. Run after official.sql.
-- Safe to run again: someone who already has a chat with RoarMe gets nothing more.
create or replace function public.roar_welcome(u uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o uuid := roar_official_id();
  k text;
  r uuid;
begin
  if o is null or u is null or u = o or exists (select 1 from roar_admins where user_id = u) then return null; end if;
  k := least(u::text, o::text) || ':' || greatest(u::text, o::text);
  if exists (select 1 from roar_rooms where direct_key = k) then return null; end if;
  insert into roar_rooms (kind, direct_key, created_by) values ('direct', k, o) returning id into r;
  insert into roar_members (room_id, user_id, role, last_read_at) values (r, o, 'admin', now()), (r, u, 'admin', now() - interval '1 second')
    on conflict do nothing;
  insert into roar_messages (room_id, user_id, kind, body) values (r, o, 'text',
'Καλώς ήρθες στο RoarMe! 🦁

Αυτή είναι η συζήτησή σου με την ομάδα του RoarMe. Αν θέλεις να προτείνεις κάτι, να ρωτήσεις κάτι ή να μας πεις τι σου άρεσε και τι σε δυσκόλεψε, γράψε μας εδώ: είναι ο πιο άμεσος δρόμος και απαντάμε εμείς.

Welcome to RoarMe! This is your chat with the RoarMe team. Ideas, questions, anything that bugs you: write to us here, it is the quickest way and we answer.');
  return r;
end $$;
revoke all on function public.roar_welcome(uuid) from public, anon, authenticated;

-- every new account, as soon as it has its profile
create or replace function public.roar_welcome_new() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform roar_welcome(new.id);
  return new;
end $$;
revoke all on function public.roar_welcome_new() from public, anon, authenticated;
create or replace trigger roar_welcome after insert on public.roar_profiles for each row execute function public.roar_welcome_new();

-- and everyone already here
select public.roar_welcome(id) from public.roar_profiles;
