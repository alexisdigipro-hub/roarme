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

## Media from all chats (17 Oct)
A Media tab in the bar at the foot (`src/media.jsx`): every photo and video, link, song and document from all the
chats one is in, in five tabs (Media, Transfers, Files, Links, Music) with counts and a search, each with who sent it and in
which chat. The list on the left narrows it to one chat. A click opens a photo or video in the viewer (step left and
right), a link in the browser, a document as a download; the chat bubble button goes to the message in its chat.
Expired RoarTransfer files are left out.

## The chat list (17 Oct)
The list shows each chat's name, time and unread badge on one line, without the last message (a draft still shows).
Settings > Interface > Show Last Message brings the last message back under each name.

## Pinned messages (17 Oct)
Pin as many messages as you like (message menu > Pin). A pinned message has a small pin beside its time. The bar
over the chat shows the latest one and how many there are; a click opens a window with all of them (who, when,
the text), where a click goes to the message, × unpins it and "Unpin all" clears them. Table `roar_pins`
(`supabase/pins.sql`); the old single `roar_rooms.pinned_message_id` was moved in and is no longer read.

## RoarTransfer (16 Oct)
A file over 50 MB (HD photos and videos, documents, or a video still over 50 MB after Standard shrinks it)
goes by RoarTransfer: up to 3 GB, uploaded in 6 MB pieces that resume after a dropped connection, kept 3 days.
The cloud button beside the clip (and the RoarTransfer tile in the send window) opens RoarTransfer's own window
(`src/transfer.jsx`), as on WeTransfer: drop or pick files, a meter against 3 GB, the expiry date,
then Transfer. The window shows the upload with a big ring; "Keep chatting" closes it and the upload goes on in the
chat. When done, each file has "Copy download link": a short link (`?t=token`, table `roar_transfer_links`, Edge
Function `roar-transfer-get`) that opens a download page for anyone, no account, until the file expires. Every
transfer tile in the chat has the same link button.
In the chat it is a tile with the name, size, "Expires in N days", Download and, for videos, Play (lights off).
Server side: bucket `roar-transfers` with the room's file rules, `roar_expired_transfers()` and an hourly
pg_cron job calling the Edge Function `roar-transfer-sweep` (`supabase/functions/`), which removes what is
older than 3 days. Set up by `supabase/transfers.sql`. Supabase's global upload limit (Storage > Settings)
must be at least 3 GB.


## Music keeps playing (17 Oct)
A song from a chat plays in the app's one player (`src/player.jsx`), so it goes on when you change chat, open Media or
Settings. While it is on, a bar sits above the chat: play/pause, the title and the chat it came from (a click goes
there), a line to move through it, the time, and × to stop it. On a phone it shows on the chat list too. A voice
message starting pauses the song, and the other way round.

## Two themes for everyone, the rest in Alex's lab (17 Oct)
Everyone sees two themes: **Simba** (the ember theme, the main one) and **Pumba** (the prism theme); the keys in the
code stay `ember` and `prism`. Glass, Aura, Studio, Aurum and Lions show only for Alex (`THEME_LAB` in src/prefs.js,
his account id), tagged "Only you", so we can keep working on them. Anyone else left on one of them moves to Simba
once signed in (App.jsx, `themeFor`). A first start opens Simba with the **red** accent (DEFAULTS.accent 'red').
White joined the accents.

## The RoarMe mark (17 Oct)
Alex's logo, five red bars leaning (#b83032 on #202020), redrawn as a vector (`Mark` in src/ui.jsx, checked by laying
it over his picture). It is the icon everywhere: the tab (public/icon.svg), the phone's home screen
(public/apple-touch-icon.png, icon-512.png), the Mac and Windows app (desktop/build/icon.png, a charcoal rounded
tile) and the Mac menu bar (desktop/trayTemplate*.png, a black silhouette macOS tints). In the app it sits to the
left of ROARME in the bar (24px) and above it, with a soft red glow, on the opening, sign-in, lock, empty chat,
settings, legal and download screens (72px).

## Lions theme (17 Oct)
Settings > Appearance > Lions (Alex: "a theme like our website"): themadlions.com in the app. Near-black #0b0b0c,
Jost, Rosso Corsa #D40000, the two panels as soft solid tiles with a hairline, every control a pill, the chosen
option as white glass with a lit top edge (like the site's EN | GR), tabs, foot labels, dates and settings titles in
spaced capitals, light headings. Light mode is the site's paper (#f3f0e8). Works with the Glass Look on or off.

## Glass look (17 Oct)
Your own messages are a touch of your colour on glass with a thin edge in it, like a RoarTransfer card, the text in the
normal colour (links, ticks, quotes follow). The solid buttons and icon tiles are glass too, in three strengths: the
main action (Download, Send, Join, Read, Save, the primary buttons) strongest, icon tiles lighter, chips lightest.
On by default in every theme but Studio (which keeps its hard look); Settings > General > Interface > Glass Look turns
the filled look back (`html[data-bubbles]`).

## The desktop window (17 Oct)
A first start opens the window as Alex keeps his: the screen's width less 20 px each side (at most 1440), in 1.72 : 1,
centred (about 1430 x 830 on a 13" Mac). After that it opens where and as big as it was left (kept in
roar-settings.json; a place on a monitor that is gone falls back to the first size). The Mac app also asks for the
location once, for Send My Location.

## Back after being away (17 Oct)
When RoarMe opens after being closed (Cmd+Q, the computer off), what came in meanwhile arrives as notifications,
gathered: one per chat ("3 new messages · the last one", the photo of the person or group; a click opens that chat),
or, with news in more than 4 chats, a single "While you were away: 12 new messages in 6 chats: …". Muted and archived
chats stay quiet; with notifications off in the system it is a short note in the app. The app notes on this device,
every 15 seconds and on closing, when it was last open (`roarme-here-<user id>`); the first time, only the last day counts.

## Location and Article (17 Oct)
- The + window is one row of small tiles: Gallery, (Camera on a phone), File, Location, Article. RoarTransfer left it: it has its own button beside the clip.
- Recording a voice message shows the microphone's real loudness as thin bars sliding in from the right (silence is a row of dots), a quiet timer and a plain bin.
- **+ > Location**: a map you move under a pin (drag, pinch, wheel, + and −), a search box for places, and the round target button for where you are (if the computer or phone shares it; the Mac app asks once). The pin's spot is named as the map stops. Send puts a small map with the name in the chat; a tap opens it big, with Google Maps and Apple Maps.
- The map is OpenStreetMap's own tiles (CARTO's ask for a key from other sites and showed "API KEY REQUIRED"); names and search are OpenStreetMap's Nominatim. No key, nothing to pay. They see only the map area and the search, with the IP address (said in the Privacy Policy).
- The message is a text message: body = the place's name, `file.location` = { lat, lng, z, name, addr }.
- **+ > Article**: a big window with a title and the text, and one bar of tools: heading, bold, italic, underline, strike, list, numbered list, checklist, quote, divider, and the eye for a preview. Enter carries a list on; Enter on an empty item ends it. An unsent article stays as a draft on that device.
- In the chat it is a card like the RoarTransfer one (mark, title, first lines, Read, minutes); Read opens it laid out. Edit (from the message menu) opens it again in the same window.
- The message is a text message: body = the title, an empty line, then the text in the usual marks plus line marks (`# `, `## `, `- `, `1. `, `- [ ] `, `> `, `---`); `file.article` only marks it.

## Scheduled calls (17 Oct)
- The card in the chat looks like the RoarTransfer card: the VideoCall / VoiceCall mark, a date tile with the title as the headline, a line that fills up to the start (green while the call runs) with the time left beside it, a Join pill (open from 10 minutes before) and a round button for the calendar.
In a one-to-one chat, ⋯ > Schedule Call (as on WhatsApp): title, note, starts, ends (optional), voice or video. It goes
into the chat as a card (`src/events.jsx`; a text message whose `file.event` holds the details): a calendar leaf,
title, day and time, a countdown, Join (from 10 minutes before until the end; starts the call) and Add to calendar
(an .ics with a 10-minute alert). With the app open, a notice comes when the call starts.

## Invite people (17 Oct)
Everyone has a personal link, `…/roarme/?u=username`, and its QR code (+ > Invite people, or the empty screen). The QR
is drawn in the app (`src/qr.js`, no outside service; checked to read back correctly). Opening the link keeps the
username until the person is signed in (the sign-up form says who invited them), then a chat with them opens by
itself (`src/invite.jsx`). People still find each other only by @username or a link: a new account starts empty.

## Security check (17 Oct)
Applied (`supabase/security-2026-10-17.sql`): roar_are_contacts / roar_blocked_between answer only about yourself
(before, anyone could ask whether any two people chat or blocked each other); messages always get the server's time;
size limits on messages, names, bios and group titles; profile and group pictures must come from RoarMe's own storage
(an outside address would have revealed viewers' IP addresses); roar-files limited to 50 MB, roar-avatars to 5 MB
images. Desktop 1.4.1: only http(s) and mailto links leave the app for the browser.
Still to do in the Supabase dashboard: leaked password protection on, minimum password length 8.
Known and accepted: the roar_people view is SECURITY DEFINER on purpose (it hides last seen and photo per privacy
setting); the roar_* RPCs are meant to be called by signed-in users and check permissions inside; messages are not
end-to-end encrypted (see below).

## Later: end-to-end encryption (talked through with Alex, 17 Oct; not started, "when we are more ready")
Plan agreed in principle: a key pair per user made on the device, a key per chat wrapped for each member, messages,
photos, voice and files up to 50 MB encrypted on the device before upload, a recovery code to open the history on a
new device (lost code and devices = lost history), a new chat key when someone leaves a group. Search and the Media
page would then decrypt on the device. Old messages stay as they are. Step two, optional: RoarTransfer with the key in
the download link (as Firefox Send did). Not the full Signal protocol; the privacy policy must say exactly what it is.
