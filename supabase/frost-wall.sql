-- Frost's warm stone wall as a wallpaper in Roar (Alex, 14 Nov). Built in, drawn by themes-glass.css ([data-bg='stone']).
-- Safe to run again.
insert into public.roar_wallpapers (key, name, position) values ('stone', 'Frost', 8)
on conflict (key) do nothing;
