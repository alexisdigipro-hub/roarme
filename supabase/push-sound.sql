-- RoarMe: the sound an iPhone's notifications play (Alex, 14 Nov: "each one's own sound").
-- One column on roar_push_subs: the message sound picked in Settings > Notifications and Sounds (glass, chime, pop, ping,
-- drop, bells, roar), or 'off' while Sound When a Message Arrives is off. roar-push plays that file from inside the app.
-- Safe to run again.
alter table public.roar_push_subs add column if not exists sound text;
alter table public.roar_push_subs drop constraint if exists roar_push_subs_sound_ok;
alter table public.roar_push_subs add constraint roar_push_subs_sound_ok
  check (sound is null or sound in ('glass', 'chime', 'pop', 'ping', 'drop', 'bells', 'roar', 'off'));
