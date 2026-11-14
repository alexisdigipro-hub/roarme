-- Find friends from the phone's contacts, by email and by phone number (Alex, 14 Nov 2026, before the App Store).
-- Emails and numbers live only in Supabase's own auth.users, confirmed there (the 6-digit email code at sign-up, or an
-- SMS code once phone sign-in is on). Here only a SHA-256 of each is kept: of the email in small letters, and of the
-- number's digits, country code first, no '+', as auth.users keeps it. So a phone can ask "which of these hashes are
-- on RoarMe?" without ever sending its contacts' addresses or numbers. Nobody can read the tables; the functions below
-- answer, a limited number of times a day, and only for people who leave "Let people find me" on. Safe to run again.

create table if not exists public.roar_contact_index (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('email', 'phone')),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  primary key (user_id, kind)
);
create index if not exists roar_contact_index_hash on public.roar_contact_index (hash);
alter table public.roar_contact_index enable row level security;
revoke all on public.roar_contact_index from anon, authenticated;

create table if not exists public.roar_contact_findable (
  user_id uuid primary key references auth.users(id) on delete cascade,
  findable boolean not null default true
);
alter table public.roar_contact_findable enable row level security;
revoke all on public.roar_contact_findable from anon, authenticated;

create or replace function public.roar_hash(s text) returns text
language sql immutable as $$ select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;

-- the hashes follow the confirmed email and number in auth.users: set, changed, or gone
create or replace function public.roar_contact_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(new.email, ''))); d text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
begin
  if e = '' or new.email_confirmed_at is null then
    delete from public.roar_contact_index where user_id = new.id and kind = 'email';
  else
    insert into public.roar_contact_index (user_id, kind, hash) values (new.id, 'email', public.roar_hash(e))
    on conflict (user_id, kind) do update set hash = excluded.hash;
  end if;
  if d = '' or new.phone_confirmed_at is null then
    delete from public.roar_contact_index where user_id = new.id and kind = 'phone';
  else
    insert into public.roar_contact_index (user_id, kind, hash) values (new.id, 'phone', public.roar_hash(d))
    on conflict (user_id, kind) do update set hash = excluded.hash;
  end if;
  return new;
end $$;
revoke all on function public.roar_contact_sync() from public, anon, authenticated;
drop trigger if exists roar_contact_sync on auth.users;
create trigger roar_contact_sync after insert or update of email, email_confirmed_at, phone, phone_confirmed_at on auth.users
  for each row execute function public.roar_contact_sync();

-- everyone who already has a confirmed email or number
insert into public.roar_contact_index (user_id, kind, hash)
  select id, 'email', public.roar_hash(lower(trim(email))) from auth.users where coalesce(email, '') <> '' and email_confirmed_at is not null
on conflict (user_id, kind) do update set hash = excluded.hash;
insert into public.roar_contact_index (user_id, kind, hash)
  select id, 'phone', public.roar_hash(regexp_replace(phone, '\D', '', 'g')) from auth.users where coalesce(phone, '') <> '' and phone_confirmed_at is not null
on conflict (user_id, kind) do update set hash = excluded.hash;

-- how many hashes a person may ask about in a day (a whole address book once, not a sweep)
create table if not exists public.roar_contact_lookups (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.roar_contact_lookups enable row level security;
revoke all on public.roar_contact_lookups from anon, authenticated;

-- which of these hashes (of the phone's contacts' emails and numbers) are on RoarMe and may be found:
-- not me, not blocked either way, not suspended
create or replace function public.roar_find_contacts(hashes text[])
returns table (hash text, id uuid, username text, display_name text, avatar_url text)
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); asked int; used int;
begin
  if me is null or not public.roar_aal_ok() then raise exception 'Sign in first'; end if;
  hashes := array(select distinct h from unnest(coalesce(hashes, '{}')) h where h ~ '^[0-9a-f]{64}$');
  asked := coalesce(array_length(hashes, 1), 0);
  if asked = 0 then return; end if;
  if asked > 5000 then raise exception 'Too many at once'; end if;
  insert into public.roar_contact_lookups (user_id, day, n) values (me, current_date, asked)
  on conflict (user_id, day) do update set n = public.roar_contact_lookups.n + excluded.n
  returning n into used;
  if used > 15000 then raise exception 'That is enough for today. Try again tomorrow.'; end if;
  return query
    select x.hash, p.id, p.username, p.display_name, p.avatar_url
    from public.roar_contact_index x
    join public.roar_profiles p on p.id = x.user_id
    where x.hash = any(hashes) and x.user_id <> me
      and coalesce((select f.findable from public.roar_contact_findable f where f.user_id = x.user_id), true)
      and not exists (select 1 from public.roar_suspended s where s.user_id = x.user_id)
      and not exists (select 1 from public.roar_blocks b where (b.blocker = x.user_id and b.blocked = me) or (b.blocker = me and b.blocked = x.user_id));
end $$;
revoke all on function public.roar_find_contacts(text[]) from public, anon;
grant execute on function public.roar_find_contacts(text[]) to authenticated;

-- Settings: whether people may find me by my email or number
create or replace function public.roar_findable() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select findable from public.roar_contact_findable where user_id = auth.uid()), true)
$$;
revoke all on function public.roar_findable() from public, anon;
grant execute on function public.roar_findable() to authenticated;

create or replace function public.roar_set_findable(on_ boolean) returns void
language sql security definer set search_path = public as $$
  insert into public.roar_contact_findable (user_id, findable) values (auth.uid(), on_)
  on conflict (user_id) do update set findable = excluded.findable
$$;
revoke all on function public.roar_set_findable(boolean) from public, anon;
grant execute on function public.roar_set_findable(boolean) to authenticated;
