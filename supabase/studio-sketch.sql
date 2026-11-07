-- RoarTransfer Studio: a drawing on a video note (Alex, 7 Nov 2026): circles, arrows and lines over the frame, kept with the note
-- as strokes in 0..1 of the picture: [{"t":"pen"|"arrow"|"circle","p":[[x,y],...]}]. Safe to run again.
alter table public.roarstudio_comments add column if not exists sketch jsonb;
