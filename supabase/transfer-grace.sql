-- One last download after a link has ended (Alex, 26 Oct 2026: "when a link I sent has expired, if they sign up they
-- can open it once more"). For 24 hours after a link from an account (not FastTransfer) ends, its files stay in R2
-- (roartransfer-r2's sweep keeps them) and the download page says: sign up free and download it one last time. A
-- signed-in person then gets one download of each file: one row here per file and person, used_at set when they take
-- it. Only the Edge Function roar-transfer-get reads and writes it. Safe to run again.
create table if not exists public.roar_transfer_claims (
  id uuid primary key default gen_random_uuid(),
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (token, user_id)
);
alter table public.roar_transfer_claims enable row level security;
revoke all on public.roar_transfer_claims from anon, authenticated;
