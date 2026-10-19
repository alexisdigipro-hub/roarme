-- Edit Contact (19 Oct 2026): my own name, photo and note for someone, only I see them. Safe to run again.
-- roar_contacts (owner, person, photo_url, nickname, updated_at) already existed with RLS owner = auth.uid();
-- the note is new. Run by Claude on 19 Oct 2026.
alter table public.roar_contacts add column if not exists note text not null default '';
