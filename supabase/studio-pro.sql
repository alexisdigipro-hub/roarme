-- RoarTransfer Studio Pro (Alex, 8 Nov 2026: "let me make people Pro in the Studio, as in RoarTransfer, from Admin").
-- Who is Studio Pro: the admins (roar_admins) always, and anyone with a row here whose `until` is empty (always) or still
-- ahead. Studio Pro includes RoarTransfer Pro: giving Studio Pro also gives roar_transfer_pro up to the same date (a
-- longer RoarTransfer Pro is kept); `transfer_until` remembers what was given, so taking Studio Pro away ends only that.
-- Only the roarstudio Edge Function (service role) writes here. Safe to run again.
create table if not exists public.roarstudio_pro (
  user_id uuid primary key references auth.users (id) on delete cascade,
  until timestamptz,
  transfer_until timestamptz,
  gave_transfer boolean not null default false,
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.roarstudio_pro enable row level security;
revoke all on public.roarstudio_pro from anon, authenticated;

-- The list for when paying opens (Alex, 8 Nov 2026: "next to Coming soon, something like pre-order / leave your name").
-- Filled from the pricing pages through the roarstudio function (action 'waitlist'); Admin > Waiting list reads it.
create table if not exists public.roarstudio_waitlist (
  id bigint generated always as identity primary key,
  email text not null check (char_length(email) between 5 and 200),
  plan text not null check (plan in ('transfer-pro', 'studio-pro')),
  billing text check (billing in ('month', 'year')),
  lang text,
  created_at timestamptz not null default now(),
  unique (email, plan)
);
alter table public.roarstudio_waitlist enable row level security;
revoke all on public.roarstudio_waitlist from anon, authenticated;

-- an account's id from its email, for Admin > Studio Pro (listing every user through the auth API fails on this project)
create or replace function public.roarstudio_user_by_email(e text) returns uuid
language sql security definer set search_path = '' stable as $$
  select id from auth.users where lower(email) = lower(trim(e)) limit 1
$$;
revoke all on function public.roarstudio_user_by_email(text) from public, anon, authenticated;
grant execute on function public.roarstudio_user_by_email(text) to service_role;
