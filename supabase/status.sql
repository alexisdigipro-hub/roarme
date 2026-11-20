-- Status (Alex, 20 Nov, from Discord's "Change online status"): each person picks how they show to others.
--   presence: 'online' (as before), 'away' (a moon on the picture), 'dnd' (Do Not Disturb: a red sign, and their
--   notifications come with no sound and no banner on every device), 'invisible' (they look offline: no dot, no last seen).
--   status_emoji / status_text: a custom status, e.g. "🎬 Shooting, answering tonight", until status_until (null = never).
-- Others read all this through roar_people: an invisible person shows as 'offline' with no last seen, and a custom status
-- whose time has passed shows as empty. Safe to run again.

alter table public.roar_profiles add column if not exists presence text not null default 'online';
alter table public.roar_profiles add column if not exists status_emoji text not null default '';
alter table public.roar_profiles add column if not exists status_text text not null default '';
alter table public.roar_profiles add column if not exists status_until timestamptz;

do $$ begin
  alter table public.roar_profiles add constraint roar_profiles_presence_ck check (presence in ('online', 'away', 'dnd', 'invisible'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.roar_profiles add constraint roar_profiles_status_len_ck check (char_length(status_text) <= 80 and char_length(status_emoji) <= 16);
exception when duplicate_object then null; end $$;

-- the same view as before, its columns in the same order, with the status at the end
create or replace view public.roar_people with (security_barrier = true) as
select id,
  username,
  display_name,
  bio,
  name_color,
  created_at,
  case
    when id <> auth.uid() and presence = 'invisible' then null::timestamptz
    when roar_can_see(id, privacy ->> 'last_seen') then last_seen
    else null::timestamptz
  end as last_seen,
  case when roar_can_see(id, privacy ->> 'photo') then avatar_url else ''::text end as avatar_url,
  case when id = auth.uid() then privacy else '{}'::jsonb end as privacy,
  case when id = auth.uid() then presence when presence = 'invisible' then 'offline' else presence end as presence,
  case when status_until is null or status_until > now() then status_emoji else '' end as status_emoji,
  case when status_until is null or status_until > now() then status_text else '' end as status_text,
  case when status_until is null or status_until > now() then status_until else null end as status_until
from public.roar_profiles p;

grant select on public.roar_people to authenticated;
