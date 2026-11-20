-- Locked Message (Alex, 20 Nov: "a message that opens when it should: locked until a time, or until you reach a place").
-- The message in roar_messages carries only '🔒 Locked message' and file.capsule (when / where, never the words); the words
-- live here, and nobody reads this table directly: roar_capsule_open gives them to a member of the chat only when the time
-- has come or the device says it is within the place's radius (the sender always sees their own). The place is checked
-- from the coordinates the device sends, so it is a promise between friends, not a vault. Safe to run again.

create table if not exists public.roar_capsules (
  message_id uuid primary key references public.roar_messages(id) on delete cascade,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  open_at timestamptz,
  lat double precision,
  lng double precision,
  radius_m integer check (radius_m is null or radius_m between 20 and 50000),
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  check (open_at is not null or (lat is not null and lng is not null and radius_m is not null))
);
alter table public.roar_capsules enable row level security;
revoke all on public.roar_capsules from anon, authenticated;

-- the sender puts the words in, once, right after sending the message
create or replace function public.roar_capsule_put(msg uuid, words text, at timestamptz, la double precision, lo double precision, r integer)
returns void language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select id, room_id, user_id into m from roar_messages where id = msg;
  if m.id is null or m.user_id <> auth.uid() then raise exception 'not your message'; end if;
  insert into roar_capsules (message_id, room_id, user_id, body, open_at, lat, lng, radius_m)
  values (msg, m.room_id, m.user_id, words, at, la, lo, r)
  on conflict (message_id) do nothing;
end $$;

-- the words, when they may be read; else null with why in the second column
create or replace function public.roar_capsule_open(msg uuid, la double precision default null, lo double precision default null)
returns table (body text, why text) language plpgsql security definer set search_path = public as $$
declare c record; d double precision;
begin
  select * into c from roar_capsules where message_id = msg;
  if c.message_id is null then return query select null::text, 'gone'; return; end if;
  if not roar_is_member(c.room_id) then return query select null::text, 'no'; return; end if;
  if c.user_id = auth.uid() then return query select c.body, 'mine'; return; end if;
  if c.open_at is not null and now() >= c.open_at then
    update roar_capsules set opened_at = coalesce(opened_at, now()) where message_id = msg;
    return query select c.body, 'time'; return;
  end if;
  if c.lat is not null and la is not null and lo is not null then
    d := 6371000 * 2 * asin(sqrt(power(sin(radians(la - c.lat) / 2), 2) + cos(radians(c.lat)) * cos(radians(la)) * power(sin(radians(lo - c.lng) / 2), 2)));
    if d <= c.radius_m then
      update roar_capsules set opened_at = coalesce(opened_at, now()) where message_id = msg;
      return query select c.body, 'place'; return;
    end if;
    return query select null::text, 'far:' || round(d)::text; return;
  end if;
  return query select null::text, 'locked';
end $$;

revoke all on function public.roar_capsule_put(uuid, text, timestamptz, double precision, double precision, integer) from public, anon;
revoke all on function public.roar_capsule_open(uuid, double precision, double precision) from public, anon;
grant execute on function public.roar_capsule_put(uuid, text, timestamptz, double precision, double precision, integer) to authenticated;
grant execute on function public.roar_capsule_open(uuid, double precision, double precision) to authenticated;
