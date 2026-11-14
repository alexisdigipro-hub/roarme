-- Sign in with a phone number and find friends from the phone's contacts (Alex, 14 Nov 2026, before the App Store).
-- The number itself lives only in Supabase's own auth.users (set by the SMS code at sign-up, or added later in
-- Settings > Privacy and Security). Here only a SHA-256 of its digits is kept (country code first, no '+', as auth.users
-- keeps it), so a phone can ask "which of these hashes are on RoarMe?" without ever sending its contacts' numbers.
-- Nobody can read the table; the functions below answer, a limited number of times a day, and only for people who
-- leave "Let people find me by my number" on. Safe to run again.

create table if not exists public.roar_phone_index (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  findable boolean not null default true
);
alter table public.roar_phone_index enable row level security;
revoke all on public.roar_phone_index from anon, authenticated;

-- the hash follows the confirmed number in auth.users: set, changed, or gone
create or replace function public.roar_phone_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if d = '' or new.phone_confirmed_at is null then
    delete from public.roar_phone_index where user_id = new.id;
    return new;
  end if;
  insert into public.roar_phone_index (user_id, hash) values (new.id, encode(sha256(convert_to(d, 'UTF8')), 'hex'))
  on conflict (user_id) do update set hash = excluded.hash;
  return new;
end $$;
revoke all on function public.roar_phone_sync() from public, anon, authenticated;
drop trigger if exists roar_phone_sync on auth.users;
create trigger roar_phone_sync after insert or update of phone, phone_confirmed_at on auth.users
  for each row execute function public.roar_phone_sync();

-- whoever already has a confirmed number
insert into public.roar_phone_index (user_id, hash)
  select id, encode(sha256(convert_to(regexp_replace(phone, '\D', '', 'g'), 'UTF8')), 'hex')
  from auth.users where coalesce(phone, '') <> '' and phone_confirmed_at is not null
on conflict (user_id) do update set hash = excluded.hash;

-- how many hashes a person may ask about in a day (a whole address book once, not a sweep of every number)
create table if not exists public.roar_phone_lookups (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.roar_phone_lookups enable row level security;
revoke all on public.roar_phone_lookups from anon, authenticated;

-- which of these hashes (of the phone's contacts) are on RoarMe and may be found: not me, not blocked either way
create or replace function public.roar_find_by_phones(hashes text[])
returns table (hash text, id uuid, username text, display_name text, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); asked int; used int;
begin
  if me is null or not public.roar_aal_ok() then raise exception 'Sign in first'; end if;
  hashes := array(select distinct h from unnest(coalesce(hashes, '{}')) h where h ~ '^[0-9a-f]{64}$');
  asked := coalesce(array_length(hashes, 1), 0);
  if asked = 0 then return; end if;
  if asked > 5000 then raise exception 'Too many numbers at once'; end if;
  insert into public.roar_phone_lookups (user_id, day, n) values (me, current_date, asked)
  on conflict (user_id, day) do update set n = public.roar_phone_lookups.n + excluded.n
  returning n into used;
  if used > 10000 then raise exception 'That is enough for today. Try again tomorrow.'; end if;
  return query
    select x.hash, p.id, p.username, p.display_name, p.avatar_url
    from public.roar_phone_index x
    join public.roar_profiles p on p.id = x.user_id
    where x.hash = any(hashes) and x.findable and x.user_id <> me
      and not exists (select 1 from public.roar_suspended s where s.user_id = x.user_id)
      and not exists (select 1 from public.roar_blocks b where (b.blocker = x.user_id and b.blocked = me) or (b.blocker = me and b.blocked = x.user_id));
end $$;
revoke all on function public.roar_find_by_phones(text[]) from public, anon;
grant execute on function public.roar_find_by_phones(text[]) to authenticated;

-- Settings: whether I have a confirmed number, and whether people may find me by it
create or replace function public.roar_my_phone()
returns table (has_phone boolean, findable boolean)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roar_phone_index where user_id = auth.uid()),
         coalesce((select findable from public.roar_phone_index where user_id = auth.uid()), true)
$$;
revoke all on function public.roar_my_phone() from public, anon;
grant execute on function public.roar_my_phone() to authenticated;

create or replace function public.roar_phone_findable(on_ boolean)
returns void language sql security definer set search_path = public as $$
  update public.roar_phone_index set findable = on_ where user_id = auth.uid()
$$;
revoke all on function public.roar_phone_findable(boolean) from public, anon;
grant execute on function public.roar_phone_findable(boolean) to authenticated;
