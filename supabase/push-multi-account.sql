-- One device, several RoarMe accounts (Alex, 26 Nov): the same phone or browser may now be kept for each account
-- signed in on it, so every account's notifications reach it. Safe to run again.
do $$
begin
  if exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.roar_push_subs'::regclass and c.contype = 'p'
    group by c.conname having count(*) = 1
  ) then
    alter table public.roar_push_subs drop constraint roar_push_subs_pkey;
    alter table public.roar_push_subs add constraint roar_push_subs_pkey primary key (endpoint, user_id);
  end if;
end $$;
