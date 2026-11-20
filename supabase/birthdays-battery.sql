-- Birthdays and battery (Alex, 20 Nov). Safe to run again.
-- Birthdays: day and month (the year is optional and only ever shown to oneself), seen by My Contacts or Nobody
--   (birthday_vis). Contacts see them through roar_people, which feeds the slim "Today is X's birthday" bar on Messages.
-- Battery: Settings > Privacy and Security > Share Battery (privacy.battery: everybody / contacts / nobody, nobody when
--   not set). The device writes its level and whether it charges; others see it through roar_people only as allowed.

alter table public.roar_profiles add column if not exists birth_day smallint check (birth_day between 1 and 31);
alter table public.roar_profiles add column if not exists birth_month smallint check (birth_month between 1 and 12);
alter table public.roar_profiles add column if not exists birth_year smallint check (birth_year between 1900 and 2100);
alter table public.roar_profiles add column if not exists birthday_vis text not null default 'contacts';
do $$ begin
  alter table public.roar_profiles add constraint roar_profiles_bday_vis_ck check (birthday_vis in ('contacts', 'nobody'));
exception when duplicate_object then null; end $$;
alter table public.roar_profiles add column if not exists battery_level smallint check (battery_level between 0 and 100);
alter table public.roar_profiles add column if not exists battery_charging boolean;
alter table public.roar_profiles add column if not exists battery_at timestamptz;

-- the same view as before, its columns in the same order, with the birthday and the battery at the end
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
  case when status_until is null or status_until > now() then status_until else null end as status_until,
  case when id = auth.uid() or (birthday_vis = 'contacts' and roar_are_contacts(id, auth.uid())) then birth_day end as birth_day,
  case when id = auth.uid() or (birthday_vis = 'contacts' and roar_are_contacts(id, auth.uid())) then birth_month end as birth_month,
  case when id = auth.uid() then birth_year end as birth_year,
  case when id = auth.uid() then birthday_vis else '' end as birthday_vis,
  case when roar_can_see(id, coalesce(privacy ->> 'battery', 'nobody')) then battery_level end as battery_level,
  case when roar_can_see(id, coalesce(privacy ->> 'battery', 'nobody')) then battery_charging end as battery_charging,
  case when roar_can_see(id, coalesce(privacy ->> 'battery', 'nobody')) then battery_at end as battery_at
from public.roar_profiles p;

grant select on public.roar_people to authenticated;
