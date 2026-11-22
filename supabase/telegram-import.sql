-- Import from Telegram (Alex, 22 Nov 2026: "can all the chats and files come out of Telegram and into RoarMe? for all users").
-- A member of a chat with one person, or an admin of a group, brings that chat's Telegram history in. Every imported
-- message keeps its own date and carries file.imported { src, by, as? }, which the app shows as "imported"; it can be put
-- in the name of a member of this chat, or kept under the Telegram name (as) when that person is not here.
-- Imported messages ring nobody, send no auto-reply and do not move the chat up or change what was read.
-- Safe to run again.

create table if not exists public.roar_import_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.roar_import_log enable row level security;
revoke all on public.roar_import_log from anon, authenticated;

-- the four triggers of roar_messages stand aside while an import runs (roar.importing is set only inside roar_import_messages)
create or replace function public.roar_importing() returns boolean
language sql stable set search_path = public as $$
  select coalesce(current_setting('roar.importing', true), '') = '1'
$$;

create or replace function public.roar_message_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if roar_importing() and coalesce(new.file, '{}'::jsonb) ? 'imported' then
    new.created_at := least(coalesce(new.created_at, now()), now());
    new.edited_at := null;
    new.deleted_at := null;
    return new;
  end if;
  new.created_at := case when coalesce(new.file, '{}'::jsonb) ? 'auto' then clock_timestamp() else now() end;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $$;

create or replace function public.roar_touch_room() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if roar_importing() then return new; end if;
  update roar_rooms set last_message_at = new.created_at where id = new.room_id;
  if not (coalesce(new.file, '{}'::jsonb) ?| array['scheduled', 'auto']) then
    update roar_members set last_read_at = new.created_at where room_id = new.room_id and user_id = new.user_id;
  end if;
  return new;
end $$;

create or replace function public.roar_push_hook() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare tok uuid;
begin
  if roar_importing() then return new; end if;
  if new.kind = 'system' or new.user_id is null then return new; end if;
  select hook_token into tok from roar_push_conf where id = 1;
  if tok is null then return new; end if;
  if not exists (select 1 from roar_members mem join roar_push_subs s on s.user_id = mem.user_id
      where mem.room_id = new.room_id and mem.user_id <> new.user_id) then return new; end if;
  perform net.http_post(
    url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-push',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', tok::text)
  );
  return new;
end $$;

create or replace function public.roar_autoreply_send() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  a record;
begin
  if roar_importing() then return new; end if;
  if new.kind = 'system' or new.user_id is null or coalesce(new.file, '{}'::jsonb) ?| array['auto', 'scheduled'] then return new; end if;
  if not exists (select 1 from roar_rooms where id = new.room_id and kind = 'direct') then return new; end if;
  select m.user_id into o from roar_members m where m.room_id = new.room_id and m.user_id <> new.user_id limit 1;
  if o is null then return new; end if;
  select * into a from roar_autoreply where user_id = o and enabled and body <> '' and (until is null or until > now());
  if not found then return new; end if;
  -- away: RoarMe has not been in front of them for 10 minutes
  if a.away_only and exists (select 1 from roar_profiles where id = o and (active_until > now() - interval '10 minutes')) then return new; end if;
  if exists (select 1 from roar_autoreply_sent where user_id = o and room_id = new.room_id and sent_at > now() - interval '12 hours') then return new; end if;
  if exists (select 1 from roar_blocks where (blocker = o and blocked = new.user_id) or (blocker = new.user_id and blocked = o)) then return new; end if;
  if exists (select 1 from roar_e2e_sessions where room_id = new.room_id and ended_at is null) then return new; end if;
  insert into roar_autoreply_sent (user_id, room_id, sent_at) values (o, new.room_id, now())
    on conflict (user_id, room_id) do update set sent_at = excluded.sent_at;
  insert into roar_messages (room_id, user_id, kind, body, file) values (new.room_id, o, 'text', a.body, '{"auto": true}'::jsonb);
  return new;
end $$;

-- rows: [{ id, user_id?, as?, kind, body, at, reply_to?, file? }], at most 200 a call, 150,000 a day
create or replace function public.roar_import_messages(r uuid, rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  x jsonb; f jsonb; clean jsonb; u uuid; k text; d timestamptz; rep uuid; mid uuid; tag jsonb;
  n int := 0; len int; today int; key text;
begin
  if me is null or not roar_aal_ok() then raise exception 'Sign in first'; end if;
  if not roar_is_member(r) then raise exception 'You are not in this chat'; end if;
  if exists (select 1 from roar_rooms where id = r and kind = 'group') and not roar_is_admin(r) then
    raise exception 'Only an admin of the group can import its history';
  end if;
  if roar_blocked_in(r) then raise exception 'You cannot write in this chat'; end if;
  if exists (select 1 from roar_e2e_sessions where room_id = r and ended_at is null) then
    raise exception 'Turn Encrypted Chat off first';
  end if;
  if jsonb_typeof(rows) is distinct from 'array' then raise exception 'Nothing to import'; end if;
  len := jsonb_array_length(rows);
  if len = 0 then return 0; end if;
  if len > 200 then raise exception 'Too many messages in one go'; end if;
  insert into roar_import_log (user_id, day, n) values (me, current_date, len)
    on conflict (user_id, day) do update set n = roar_import_log.n + excluded.n returning roar_import_log.n into today;
  if today > 150000 then raise exception 'That is enough for today. The import goes on from where it stopped tomorrow.'; end if;

  perform set_config('roar.importing', '1', true);
  for x in select * from jsonb_array_elements(rows) loop
    begin
      mid := (x->>'id')::uuid;
      d := (x->>'at')::timestamptz;
    exception when others then continue;
    end;
    if mid is null or d is null then continue; end if;
    u := null;
    begin u := nullif(x->>'user_id', '')::uuid; exception when others then u := null; end;
    tag := jsonb_build_object('src', 'telegram', 'by', me);
    if u is null or not exists (select 1 from roar_members where room_id = r and user_id = u) then
      u := me;
      if coalesce(x->>'as', '') <> '' then tag := tag || jsonb_build_object('as', left(x->>'as', 80)); end if;
    end if;
    k := coalesce(x->>'kind', 'text');
    if k not in ('text', 'image', 'file', 'voice') then k := 'text'; end if;
    f := case when jsonb_typeof(x->'file') = 'object' then x->'file' else '{}'::jsonb end;
    -- only what a plain message carries, and only files of this chat's own folder
    clean := '{}'::jsonb;
    foreach key in array array['path', 'name', 'size', 'type', 'thumb', 'dur', 'peaks', 'round', 'asFile', 'location'] loop
      if f ? key then clean := clean || jsonb_build_object(key, f->key); end if;
    end loop;
    if clean ? 'path' and split_part(clean->>'path', '/', 1) <> r::text then continue; end if;
    if clean ? 'thumb' and split_part(clean->>'thumb', '/', 1) <> r::text then clean := clean - 'thumb'; end if;
    if k in ('image', 'file', 'voice') and not (clean ? 'path') then k := 'text'; end if;
    if pg_column_size(clean) > 20000 then clean := clean - 'peaks'; end if;
    rep := null;
    begin rep := nullif(x->>'reply_to', '')::uuid; exception when others then rep := null; end;
    if rep is not null and not exists (select 1 from roar_messages where id = rep and room_id = r) then rep := null; end if;
    insert into roar_messages (id, room_id, user_id, kind, body, file, reply_to, created_at)
      values (mid, r, u, k, left(coalesce(x->>'body', ''), 20000), clean || jsonb_build_object('imported', tag), rep, d)
      on conflict (id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  perform set_config('roar.importing', '0', true);
  return n;
end $$;
revoke all on function public.roar_import_messages(uuid, jsonb) from public, anon;
grant execute on function public.roar_import_messages(uuid, jsonb) to authenticated;
