-- RoarTransfer Pro (Alex, 23 Oct 2026: "make my account Pro, so we add things there and see them"). Who is Pro: the
-- admins (roar_admins) always, and anyone with a row here whose `until` is empty or still ahead (for when Pro is sold).
-- First Pro feature, "Receive files": a Pro picks a short name (slug) and gets roartransfer.com/u/<slug>, a page where
-- anyone, without an account, sends files to them. Those files go to R2 under pro/<owner>/inbox/, are kept 30 days,
-- belong to the owner, and each drop is one row in roar_transfer_inbox with one link (a bundle) for all its files.
-- Only the Edge Function roartransfer-r2 (service role) writes these; the owner reads them through it. Safe to run again.

create table if not exists public.roar_transfer_pro (
  user_id uuid primary key references auth.users (id) on delete cascade,
  slug text unique,
  name text,
  until timestamptz,
  created_at timestamptz not null default now()
);
alter table public.roar_transfer_pro enable row level security;
revoke all on public.roar_transfer_pro from anon, authenticated;

create table if not exists public.roar_transfer_inbox (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users (id) on delete cascade,
  bundle text not null,
  sender_name text not null default '',
  sender_email text not null default '',
  message text not null default '',
  files int not null default 0,
  bytes bigint not null default 0,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists roar_transfer_inbox_owner on public.roar_transfer_inbox (owner, created_at desc);
alter table public.roar_transfer_inbox enable row level security;
revoke all on public.roar_transfer_inbox from anon, authenticated;

-- files received are not "sent": My transfers leaves them out (they are in Received)
create or replace function public.roar_my_transfers()
 returns table(path text, name text, size bigint, type text, created_at timestamptz, expires timestamptz, source text, room_kind text, room_title text, token text, opens bigint, downloads bigint, last_download timestamptz, stopped boolean, deleted boolean)
 language sql stable security definer set search_path to 'public'
as $function$
  select t.path, t.name, t.size, t.type, t.created_at, t.expires, t.source, t.room_kind, t.room_title, t.token,
    t.opens, t.downloads, t.last_download, t.stopped, t.deleted
  from public.roar_transfer_items() t
  where auth.uid() is not null and public.roar_aal_ok() and t.user_id = auth.uid() and t.path not like 'pro/%/inbox/%'
  order by t.created_at desc
  limit 1000
$function$;
