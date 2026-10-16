# RoarMe

A chat for everyone, by THEMADLIONS (working name). Sign up with an email, pick a @username, find
people by it, talk one to one or in groups, send photos and files. Desktop first.

- App: React + Vite, plain CSS (`src/`). Live at GitHub Pages from `main` (`.github/workflows/pages.yml`).
- Data: Supabase, tables `roar_*` and storage buckets `roar-files`, `roar-avatars` (`supabase/schema.sql`,
  safe to run again). For now in the THEMADLIONS project, separate from the hub's own tables; before
  going public it moves to a project of its own (change `SUPABASE_URL` / `SUPABASE_KEY` in `src/lib.js`).
- Everyone sees only the chats they are in; this is enforced by the database's row level security.

## What it does (16 Oct)
Everything of the THEMADLIONS chat that does not need new server work: Edit mode on the list (Read,
Archive, Folder, Delete for many chats at once), your own folders, search in chat names and in messages
(⌘K), folder tags, a chat search inside a conversation, pinned message, reactions, reply and replies list,
forward, select, copy text and link, translate, seen-by ticks, @mentions, emoji picker, large emoji,
photos/videos/files with a send window (gallery, camera, file, caption, compression), voice messages,
a media viewer, photos/videos & files of a chat, chat settings (text size, background, compact, Enter
sends, spelling, faces, large photos, quick reaction, double click, sound, folder tags, shortcuts).
Shown but not working yet ("coming soon"): voice and video calls, notifications with the app closed,
more chat colours, removing people from a group and deleting a group.

## Writing and sending (16 Oct)
Select text in the message box and a small bar of round buttons comes up over it: Bold, Italic, Underline,
Strikethrough, Code, Spoiler (press again to take the mark off; keys ⌘B, ⌘I, ⌘U, ⌘E, ⌘⇧X, ⌘⇧P). Underline is
`__text__`. The send window opens on tinted tiles (Gallery, Camera on phones, File, RoarTransfer); once files are
picked they shrink to small pills and the caption and Send come in.

## RoarTransfer (16 Oct)
A file over 50 MB (HD photos and videos, documents, or a video still over 50 MB after Standard shrinks it)
goes by RoarTransfer: up to 3 GB, uploaded in 6 MB pieces that resume after a dropped connection, kept 3 days.
The cloud button beside the clip sends files straight by RoarTransfer, as they are, whatever their size.
In the chat it is a tile with the name, size, "Expires in N days", Download and, for videos, Play (lights off).
Server side: bucket `roar-transfers` with the room's file rules, `roar_expired_transfers()` and an hourly
pg_cron job calling the Edge Function `roar-transfer-sweep` (`supabase/functions/`), which removes what is
older than 3 days. Set up by `supabase/transfers.sql`. Supabase's global upload limit (Storage > Settings)
must be at least 3 GB.

