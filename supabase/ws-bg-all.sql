-- One Workspace background for every project (Alex, 25 Nov). Safe to run again.
alter table public.roar_profiles add column if not exists ws_bg_all text;
alter table public.roar_profiles add column if not exists ws_bg_all_op int not null default 40;
