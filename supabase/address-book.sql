-- RoarMe's address book (Alex, 22 Nov: "contacts as a real database for each user, in the cloud, to take them out
-- whenever they want or join them with another app"): each person keeps their own contacts, also people who are not
-- on RoarMe. Only the owner reads or writes their rows. Safe to run again.
create table if not exists public.roar_book (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  nickname text not null default '',
  company text not null default '',
  job_title text not null default '',
  photo_url text not null default '',
  phones jsonb not null default '[]'::jsonb,      -- [{ label, value }]
  emails jsonb not null default '[]'::jsonb,      -- [{ label, value }]
  addresses jsonb not null default '[]'::jsonb,   -- [{ label, street, city, postcode, country }]
  websites jsonb not null default '[]'::jsonb,    -- [{ label, value }]
  socials jsonb not null default '[]'::jsonb,     -- [{ label, value }]
  birth_day smallint check (birth_day between 1 and 31),
  birth_month smallint check (birth_month between 1 and 12),
  birth_year smallint check (birth_year between 1900 and 2100),
  notes text not null default '',
  groups text[] not null default '{}',
  favourite boolean not null default false,
  person uuid references auth.users(id) on delete set null,  -- their RoarMe account, when they have one
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roar_book_size check (
    length(first_name) <= 100 and length(last_name) <= 100 and length(nickname) <= 100 and length(company) <= 150
    and length(job_title) <= 150 and length(notes) <= 4000 and length(photo_url) <= 1000
    and jsonb_array_length(phones) <= 20 and jsonb_array_length(emails) <= 20 and jsonb_array_length(addresses) <= 10
    and jsonb_array_length(websites) <= 10 and jsonb_array_length(socials) <= 20 and coalesce(array_length(groups, 1), 0) <= 30
  )
);
create index if not exists roar_book_owner on public.roar_book (owner);
create index if not exists roar_book_person on public.roar_book (owner, person) where person is not null;

alter table public.roar_book enable row level security;
drop policy if exists roar_book_own on public.roar_book;
create policy roar_book_own on public.roar_book for all to authenticated
  using (owner = auth.uid() and public.roar_aal_ok())
  with check (owner = auth.uid() and public.roar_aal_ok());
revoke all on public.roar_book from anon;
grant select, insert, update, delete on public.roar_book to authenticated;

-- at most 10,000 contacts a person
create or replace function public.roar_book_cap() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.roar_book where owner = new.owner) >= 10000 then
    raise exception 'Your address book is full (10,000 contacts).';
  end if;
  return new;
end $$;
drop trigger if exists roar_book_cap on public.roar_book;
create trigger roar_book_cap before insert on public.roar_book for each row execute function public.roar_book_cap();
revoke all on function public.roar_book_cap() from public, anon, authenticated;
