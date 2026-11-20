-- The iPhone's own notification sound as a choice (Alex, 20 Nov): roar_push_subs.sound may also be 'iphone',
-- which roar-push sends to Apple as 'default'. Safe to run again.
alter table public.roar_push_subs drop constraint if exists roar_push_subs_sound_ok;
alter table public.roar_push_subs add constraint roar_push_subs_sound_ok
  check (sound is null or sound in ('glass', 'chime', 'pop', 'ping', 'drop', 'bells', 'roar', 'iphone', 'off'));
