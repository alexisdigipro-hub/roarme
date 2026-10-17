-- Encrypted Chat (Alex, 17 Oct): end-to-end encryption for one chat, switched on for a while and off again.
-- Every device (the Mac or Windows app, a browser, a phone) makes its own key pair the first time it opens
-- RoarMe; the private half never leaves that device, the public half is kept here. Turning Encrypted Chat on
-- makes one new key for that stretch and seals a copy of it for each device of everyone in the chat, so only
-- those devices can open it. What is written while it is on is locked on the device before it is sent: the
-- server keeps sealed keys and locked text only and cannot read either. Safe to run again.

-- ---------- the devices and their public keys ----------
create table if not exists public.roar_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  public_key text not null check (length(public_key) < 400),
  label text not null default '' check (length(label) <= 60),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists roar_devices_user on public.roar_devices (user_id);

-- someone one shares a chat with (security definer, so the policy does not loop through roar_members)
create or replace function public.roar_shares_room(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from roar_members a join roar_members b on b.room_id = a.room_id where a.user_id = auth.uid() and b.user_id = u)
$$;

alter table public.roar_devices enable row level security;
drop policy if exists roar_devices_read on public.roar_devices;
create policy roar_devices_read on public.roar_devices for select to authenticated using (user_id = auth.uid() or public.roar_shares_room(user_id));
drop policy if exists roar_devices_insert on public.roar_devices;
create policy roar_devices_insert on public.roar_devices for insert to authenticated with check (user_id = auth.uid());
drop policy if exists roar_devices_update on public.roar_devices;
create policy roar_devices_update on public.roar_devices for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists roar_devices_delete on public.roar_devices;
create policy roar_devices_delete on public.roar_devices for delete to authenticated using (user_id = auth.uid());
revoke all on public.roar_devices from anon;
revoke update on public.roar_devices from authenticated;
grant select, insert, delete on public.roar_devices to authenticated;
grant update (last_seen, label) on public.roar_devices to authenticated;

-- ---------- each stretch of Encrypted Chat, and its key sealed for each device ----------
create table if not exists public.roar_e2e_sessions (
  id uuid primary key,
  room_id uuid not null references public.roar_rooms(id) on delete cascade,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_by uuid references auth.users(id) on delete set null,
  ended_at timestamptz
);
create unique index if not exists roar_e2e_one_on on public.roar_e2e_sessions (room_id) where ended_at is null;

create table if not exists public.roar_e2e_keys (
  session_id uuid not null references public.roar_e2e_sessions(id) on delete cascade,
  device_id uuid not null references public.roar_devices(id) on delete cascade,
  sealed text not null check (length(sealed) < 1000),
  primary key (session_id, device_id)
);

alter table public.roar_e2e_sessions enable row level security;
alter table public.roar_e2e_keys enable row level security;
drop policy if exists roar_e2e_sessions_read on public.roar_e2e_sessions;
create policy roar_e2e_sessions_read on public.roar_e2e_sessions for select to authenticated using (public.roar_is_member(room_id));
-- a device reads only the copies sealed for itself
drop policy if exists roar_e2e_keys_read on public.roar_e2e_keys;
create policy roar_e2e_keys_read on public.roar_e2e_keys for select to authenticated
  using (exists (select 1 from public.roar_devices d where d.id = device_id and d.user_id = auth.uid()));
-- turning it on and off goes only through the functions below
revoke all on public.roar_e2e_sessions, public.roar_e2e_keys from anon;
revoke insert, update, delete on public.roar_e2e_sessions, public.roar_e2e_keys from authenticated;
grant select on public.roar_e2e_sessions, public.roar_e2e_keys to authenticated;

-- ---------- on and off, each with a line in the chat ----------
-- the app makes the key and seals it for every device; here the stretch, the sealed copies and the line are kept
-- together, so nobody sees it on before the keys are there
create or replace function public.roar_e2e_start(r uuid, sid uuid, keys jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_member(r) then raise exception 'You are not in this chat'; end if;
  if exists (select 1 from roar_e2e_sessions where room_id = r and ended_at is null) then raise exception 'Encrypted Chat is already on'; end if;
  if jsonb_typeof(keys) <> 'array' or jsonb_array_length(keys) = 0 or jsonb_array_length(keys) > 500 then raise exception 'No keys to share'; end if;
  insert into roar_e2e_sessions (id, room_id, started_by) values (sid, r, auth.uid());
  -- only devices of people in this chat
  insert into roar_e2e_keys (session_id, device_id, sealed)
    select sid, d.id, x->>'sealed'
    from jsonb_array_elements(keys) x
    join roar_devices d on d.id = (x->>'device')::uuid
    where exists (select 1 from roar_members m where m.room_id = r and m.user_id = d.user_id)
    on conflict do nothing;
  if not exists (select 1 from roar_e2e_keys k join roar_devices d on d.id = k.device_id where k.session_id = sid and d.user_id = auth.uid()) then
    raise exception 'This device has no key';
  end if;
  insert into roar_messages (room_id, user_id, kind, body) values (r, auth.uid(), 'system', 'e2e:on');
  return sid;
end $$;

create or replace function public.roar_e2e_end(r uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not roar_is_member(r) then raise exception 'You are not in this chat'; end if;
  update roar_e2e_sessions set ended_at = now(), ended_by = auth.uid() where room_id = r and ended_at is null;
  if found then insert into roar_messages (room_id, user_id, kind, body) values (r, auth.uid(), 'system', 'e2e:off'); end if;
end $$;

revoke all on function public.roar_shares_room(uuid), public.roar_e2e_start(uuid, uuid, jsonb), public.roar_e2e_end(uuid) from public, anon;
grant execute on function public.roar_shares_room(uuid), public.roar_e2e_start(uuid, uuid, jsonb), public.roar_e2e_end(uuid) to authenticated;
