-- Notifications with the app closed (Alex, 18 Oct 2026): Web Push. Settings > Notifications turns it on for a phone or
-- a browser; its address goes in roar_push_subs. Every new message calls the Edge Function roar-push (through pg_net),
-- which sends a notification to everyone in the chat who has it on, does not have RoarMe in front of them right now
-- (roar_profiles.active_until, kept 75 seconds ahead only while RoarMe is shown and focused), has not muted the chat and has not blocked the writer, with their unread count for the icon.
-- The function's keys (VAPID) are made by the function itself the first time and kept in roar_push_conf, which only
-- the server can read. Safe to run again.
alter table public.roar_profiles add column if not exists active_until timestamptz;
grant update (active_until) on public.roar_profiles to authenticated;

create table if not exists public.roar_push_subs (
  endpoint text primary key check (endpoint like 'https://%' and char_length(endpoint) < 1000),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  preview boolean not null default true,
  ua text not null default '' check (char_length(ua) < 300),
  created_at timestamptz not null default now()
);
create index if not exists roar_push_subs_user on public.roar_push_subs (user_id);
alter table public.roar_push_subs enable row level security;
drop policy if exists roar_push_subs_mine on public.roar_push_subs;
create policy roar_push_subs_mine on public.roar_push_subs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists roar_mfa on public.roar_push_subs;
create policy roar_mfa on public.roar_push_subs as restrictive for all to authenticated using (public.roar_aal_ok()) with check (public.roar_aal_ok());
revoke all on public.roar_push_subs from anon;

create table if not exists public.roar_push_conf (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  hook_token uuid not null default gen_random_uuid()
);
alter table public.roar_push_conf enable row level security;
revoke all on public.roar_push_conf from anon, authenticated;

-- who gets a notification for this message (the Edge Function asks, with the server's key)
create or replace function public.roar_push_targets(msg uuid)
returns table (endpoint text, p256dh text, auth text, preview boolean, user_id uuid, unread int)
language sql stable security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth, s.preview, s.user_id,
    (select count(*)::int from roar_members mm join roar_messages x on x.room_id = mm.room_id
       where mm.user_id = s.user_id and not mm.muted and x.created_at > mm.last_read_at
         and x.user_id is distinct from s.user_id and x.kind <> 'system' and x.deleted_at is null)
  from roar_messages m
  join roar_members mem on mem.room_id = m.room_id and mem.user_id <> m.user_id and not mem.muted
  join roar_push_subs s on s.user_id = mem.user_id
  left join roar_profiles p on p.id = mem.user_id
  where m.id = msg and m.kind <> 'system' and m.user_id is not null
    and (p.active_until is null or p.active_until < now())
    and not exists (select 1 from roar_blocks b where b.blocker = mem.user_id and b.blocked = m.user_id)
$$;
revoke all on function public.roar_push_targets(uuid) from public, anon, authenticated;
grant execute on function public.roar_push_targets(uuid) to service_role;

-- every new message knocks on roar-push (it answers only to the token kept in roar_push_conf)
create extension if not exists pg_net with schema extensions;
create or replace function public.roar_push_hook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare tok uuid;
begin
  if new.kind = 'system' or new.user_id is null then return new; end if;
  select hook_token into tok from roar_push_conf where id = 1;
  if tok is null then return new; end if;
  -- only when someone in the chat has notifications on, so a quiet chat costs nothing
  if not exists (select 1 from roar_members mem join roar_push_subs s on s.user_id = mem.user_id
      where mem.room_id = new.room_id and mem.user_id <> new.user_id) then return new; end if;
  perform net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-push',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', tok::text)
  );
  return new;
end $$;
revoke all on function public.roar_push_hook() from public, anon, authenticated;
create or replace trigger roar_push after insert on public.roar_messages for each row execute function public.roar_push_hook();
