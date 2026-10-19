-- The official RoarMe account (Alex, 19 Oct 2026). Safe to run again.
-- roar_official lists the accounts that get the official mark beside their name; everyone may read it, nobody may
-- change it from the app. The account itself (@roarme, roarme@themadlions.com, the app's icon as its picture) is made
-- by the Edge Function roar-official, called once from here; calling it again only refreshes its picture and profile.
create table if not exists public.roar_official (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null default 'RoarMe'
);
alter table public.roar_official enable row level security;
drop policy if exists roar_official_read on public.roar_official;
create policy roar_official_read on public.roar_official for select to authenticated using (true);
revoke all on public.roar_official from anon;
revoke insert, update, delete on public.roar_official from authenticated;
grant select on public.roar_official to authenticated;

select net.http_post(
  url := 'https://bzmjhbnwhdwmncxkqkdl.supabase.co/functions/v1/roar-official',
  body := '{}'::jsonb,
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-roar-hook', (select hook_token::text from public.roar_push_conf))
);
