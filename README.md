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
Shown but not working yet ("coming soon"): voice and video calls,
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

## Deleting calls (17 Oct)
Calls tab > Recent Calls: a bin on each call (on hover on a computer, always on a phone) and **Clear all** beside the
title. For you only: the other person keeps theirs (as on WhatsApp). `supabase/call-hides.sql` (roar_call_hides:
who hid which call; each sees and adds only their own, and only for calls they were in; run by Claude, tested).

## The phone, tidied (17 Oct)
Alex: "on the phone the pages are loose, things run off left and right, things don't show". Checked screen by screen
at 390 and 360 px (the app run locally with a small React stand-in and sample chats, since the build tools can't be
installed here), and fixed in one block at the end of styles.css ("The phone, tidied"), phone only:
windows never wider than the screen (profile, group, invite, schedule call were); the chat head keeps the name
(search and video call move into ⋯, `.only-phone` items); the writing box gets the room (smaller round buttons,
RoarTransfer moves from beside the clip into the + window on a phone); rows of tabs fit or scroll with a soft edge;
notes sit above the bottom bar; long settings titles fit beside Back; themes wrap; the + window shows whole words;
contacts keep the add button; a button's word never breaks. The computer is unchanged.

## New app versions and how to install them (17 Oct)
- **A newer Mac / Windows app:** the app tells the page its version in the user agent (`RoarMe/1.4.6`, also the
  versions already installed). The page compares it with the newest release on GitHub (its name now carries the
  version: `RoarMe 1.4.6 · build 16`, from desktop/package.json, desktop.yml) at most every 3 hours. When a newer
  one is out, a glass card at the bottom right: "New RoarMe app: x" with **Download** and × (later, until the next
  version). Settings > General > RoarMe app shows the version and the same Download.
- **So each new desktop build must raise `version` in desktop/package.json**, or nobody is told.
- **No paw in the menu bar (Alex, 18 Oct):** Settings has no Show Icon in Menu Bar any more, and the page turns the
  paw off in any app that still shows it (Chat.jsx). The desktop code for it stays, unused.
- **The paw's menu (desktop 1.4.10):** the menu bar / tray menu shows the version and Check for Updates, which turns
  into Downloading… with its percent and then Restart to Update (x).
- **Updates by themselves (desktop 1.4.9 on, Alex 18 Oct):** the app checks the newest release on opening and every 2
  hours (desktop/updater.js), downloads the installer for its computer in the background, then shows "RoarMe x is
  ready · Restart to update" (and a notification). Restart swaps the app: on a Mac a small script waits for RoarMe to
  close, copies the new RoarMe.app from the .dmg over the old one (the old stays if anything fails) and opens it; on
  Windows the installer runs silently (/S --force-run). Quitting with an update waiting installs it too. Electron's own
  updater is not used because on a Mac it needs a paid Apple certificate. Versions up to 1.4.8 get the old card
  (Download + steps) once more.
- **Installing:** macOS stops a non-App-Store app the first time before it can show anything, so the steps open the
  moment Download is pressed (in the card, in Settings > General, and the downloads there in the browser): open the
  .dmg and drag to Applications (Cmd+Q and Replace on an update), open it and press Done, System Settings >
  Privacy & Security > Open Anyway, password, Open Anyway again. Windows: More info > Run anyway. The right Mac
  file is picked by the chip (WebGL renderer; the app now also tells `arch`).

## Admin, only for Alex (17 Oct)
Settings > Admin (shown only to Alex): three numbers (accounts, files sent, space in chats now), then People | Files
with a search. **People:** every account, also those without a username yet, with email, when they joined and were
last seen, messages, files and space sent, chats. **Files:** every file sent, newest first, 100 at a time (More):
name, size, type, who, in a group (its name) or a one-to-one chat, when, RoarTransfer until when, deleted.
Never the text of messages and never the files themselves. The database is the guard: `supabase/admin.sql`
(roar_admins with Alex's id, and the functions roar_is_admin, roar_admin_users, roar_admin_files, which refuse
anyone else; run by Claude, tested as Alex and as mits). The Privacy Policy says so (EN and EL).

## Two themes for everyone, the rest in Alex's lab (17 Oct)
Everyone sees two themes: **Simba** (the ember theme, the main one) and **Pumba** (the prism theme); the keys in the
code stay `ember` and `prism`. Glass, Aura, Studio, Aurum and Lions show only for Alex (`THEME_LAB` in src/prefs.js,
his account id), tagged "Only you", so we can keep working on them. Anyone else left on one of them moves to Simba
once signed in (App.jsx, `themeFor`). A first start opens Simba with the **red** accent (DEFAULTS.accent 'red'), which is Rosso Corsa #D40000, the Ferrari red of the site and the icon.
White joined the accents.

## The RoarMe mark (17 Oct)
Alex's logo, five bars leaning; the app icon in Rosso Corsa #D40000 (the site's Ferrari red) on #202020, redrawn as a vector (`Mark` in src/ui.jsx, checked by laying
it over his picture). It is the icon everywhere: the tab (public/icon.svg), the phone's home screen
(public/apple-touch-icon.png, icon-512.png), the Mac and Windows app (desktop/build/icon.png, a rounded tile)
(since 18 Oct, desktop 1.4.8, the icon is in the Simba look: the same five bars in a red gradient with a soft red glow, on
graphite glass with a lit top and a bright edge; the phone's copy is a full square, the phone rounds it) and the Mac menu bar (desktop/trayTemplate*.png, a black silhouette macOS tints). In the app it is white (#f2f2f2, his white version; the text colour in light mode) and sits above
ROARME (the bar shows the letters alone, 17.46px, Alex), with a soft white glow, on the opening, sign-in, lock, empty chat,
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
end-to-end encrypted unless Encrypted Chat is on (see below).

## Beta (18 Oct)
RoarMe says it is in beta: a small red-edged "beta" tag beside ROARME in the app (side panel, opening, Settings), the
version line in Settings reads "RoarMe 1.4.7 beta · Mac app", and the update card "New RoarMe app: 1.4.7 beta". The
desktop installers are named with their version and "beta" (`RoarMe-1.4.7-beta-Mac-arm64.dmg`, `-Mac-x64.dmg`,
`-Windows-Setup.exe`; desktop/package.json artifactName) and the release is "RoarMe 1.4.7 beta · build N". The release
job also puts a copy under the old plain names, so links made before keep working; the app and the RoarMe page take
the newest release's own files from the GitHub API (`dlUrl` in src/update.jsx) and fall back to the plain names.

## Encrypted Chat (17 Oct)
End-to-end encryption for one chat, on for a while and off again (Alex: "να υπάρχει αλλά όχι συνέχεια"). In a chat:
⋯ > **Encrypted Chat** opens a window that says what it does, and who in the chat has not opened the new RoarMe yet
(they could not read it); **Turn on**. While it is on: a lock by the name in the head, a glass bar over the writing
box with **Turn off**, a lock on each locked message, a line in the middle ("You turned on Encrypted Chat") for
everyone, text only (photos, files, places, voice and RoarTransfer wait until it is off; calls work as always),
no Forward and no Translate on locked messages, Edit only while the same stretch is still on.
How (`src/e2e.js`, `supabase/encrypted-chat.sql`, run by Claude and tested): every device (the Mac or Windows app, a
browser) makes its own ECDH P-256 key pair the first time RoarMe opens; the private half stays in that device's
IndexedDB and cannot be read out, the public half goes to roar_devices (seen only by people one shares a chat with).
Turning it on makes one AES-256-GCM key for that stretch and seals a copy for every device of everyone in the chat
(seen in the last 90 days), sent with roar_e2e_start together with the stretch and the line in the chat; a device can
read only its own copy (roar_e2e_keys). Text is locked on the device before it is sent (body
`e2e1.<stretch>.<iv>.<locked>`, the chat and stretch bound in); the server keeps the locked text only, the list,
notifications, search and Peek say "Encrypted message". Turning it off (roar_e2e_end) goes back to normal; what was
locked stays locked and opens on the devices that were in it. A device added later (a new computer, a cleared
browser, a private window) has no key: the bar says so and it cannot read or write there while it is on.
Honest limits: protects against anyone reading the database or the server (admins included); there is no safety
number to check yet, so it trusts the server to hand over the right public keys.

## Later: more end-to-end encryption (talked through with Alex, 17 Oct)
Plan agreed in principle: a key pair per user made on the device, a key per chat wrapped for each member, messages,
photos, voice and files up to 50 MB encrypted on the device before upload, a recovery code to open the history on a
new device (lost code and devices = lost history), a new chat key when someone leaves a group. Search and the Media
page would then decrypt on the device. Old messages stay as they are. Step two, optional: RoarTransfer with the key in
the download link (as Firefox Send did). Not the full Signal protocol; the privacy policy must say exactly what it is.

## Email reminders for unread messages (18 Oct)
When someone has new messages and has been away from RoarMe for 10 minutes, one email from
noreply@themadlions.com says how many and from which chats (never the text), in RoarMe's look, with Open RoarMe.
At most one every 3 hours, only messages from the last 2 days, never muted chats. Settings > Notifications and Sounds >
Email turns them off (on by default), and so does the link at the foot of each email (also the mail apps' one-click
unsubscribe). `supabase/email.sql` (table `roar_email_prefs`, functions `roar_email_due` / `roar_email_sent` /
`roar_email_off`, pg_cron job `roar-email` every 10 minutes) and the Edge Function `supabase/functions/roar-email`
(deployed, verify_jwt off; design in `template.mjs`). It sends through Resend: the domain themadlions.com is verified
there and its API key is the function secret `RESEND_API_KEY` (set by Alex in Supabase, never in the repo). Without
the key the function does nothing.

## Check for Updates (18 Oct)
Settings > General > RoarMe app has a Check for Updates row. In the Mac / Windows app from 1.4.9 it asks the app's own
updater to look now (desktop/updater.js `roar:update-check`): it downloads a newer version in the background, shows the
progress and offers Restart to update. An older app (no updater) asks GitHub for the newest release right away
(`fetchLatest()` in src/update.jsx, which also refreshes the half-hour memory) and offers the download.

## Tasks in the foot bar (18 Oct)
The Tasks button moved from the chat list's head to the bar at the foot, beside Settings (with its count, red when a
request waits for your answer). It opens and closes the Tasks panel; inside a chat on a phone the Tasks button stays.

## Scheduled messages (18 Oct)
As in Telegram: write a message, then hold Send (right click on a computer) > Schedule Message: Day, Time and Repeat
(Never, Daily, Weekly, Biweekly, Monthly, Every 3 / 6 Months, Yearly), and the button says when it goes ("Send on 19 Oct
2026 at 09:00"). `src/scheduled.jsx`. The text waits in `roar_scheduled` and a pg_cron job (`roar-scheduled`, every
minute, `roar_send_scheduled()`) sends it in your name, so RoarMe can be closed; a repeating one moves to its next time
(counted from the first, so the 31st stays the 31st), one in a chat with Encrypted Chat on waits until it is off, one
from someone who left the chat goes. A clock with a count in the writing box opens Scheduled Messages: each with Send Now,
Edit (text, day, time, repeat) and Delete. Text only. Each person sees only their own (RLS). `supabase/scheduled.sql`
(run by Claude 18 Oct and tested). A message that goes out by itself (scheduled or auto-reply, `file.scheduled` /
`file.auto`) does not mark the chat read for its writer (`roar_touch_room`).

## Auto-reply (18 Oct)
Settings > Auto-Reply: on/off, the text, Only When I'm Away (RoarMe not open on any device for 10 minutes, from
`last_seen`) and Turn Off By Itself (a date and time). Someone who writes to you one to one gets the text back, once per
chat every 12 hours; groups never. It is a normal message from you marked `file.auto`, shown with "Auto-reply ·" beside
its time. Trigger `roar_autoreply` on roar_messages (`roar_autoreply_send()`), tables `roar_autoreply` and
`roar_autoreply_sent`. `supabase/autoreply.sql` (run by Claude 18 Oct and tested).

## Calendar under Tasks (18 Oct)
The calendar button at the top of the Tasks panel shows a month at the foot of the panel, under the list, and hides it
again (Alex: on the same page, not another one; `src/calendar.jsx`; remembered per device):
soft day tiles, Monday first, today in the accent colour, and a dot per kind on each day: tasks by due date (accent),
scheduled calls from the chats' call cards (green) and your scheduled messages with their repeats (blue). The chosen
day lists them: a task opens its window, a call goes to its card in the chat, a message to its chat. ‹ › move a month,
Today comes back.

## Group admins (18 Oct)
A group's card > Members shows an Admin tag; an admin has Make Admin / Remove Admin beside each person (and Step Down
for themselves while another admin stays) next to Remove. `roar_set_admin(r, person, admin)` in `supabase/admins.sql`
(run by Claude 18 Oct); the role column is not writable by members themselves. Removing people, adding them and
deleting the group were already there (`supabase/round1.sql`).

## Notifications with the app closed (18 Oct)
Web Push on phones and browsers: Settings > Notifications > Notifications With the App Closed (`src/push.js`). Turning
it on asks for permission, registers `public/sw.js` (notifications only, nothing kept offline) and signs the browser up
with the server's public key; the address goes in `roar_push_subs`. Every new message calls the Edge Function
`roar-push` through pg_net (trigger `roar_push`, only when someone in the chat has it on), which asks
`roar_push_targets()` who should get it (in the chat, not the writer, chat not muted, writer not blocked, not in RoarMe
in the last 75 seconds) and sends each an encrypted notification (RFC 8291 aes128gcm, checked against the RFC's test
vector; VAPID signed) with the title, the text (or "New message" when Message Preview is off; "Encrypted message" for
Encrypted Chat) and their unread count, which the service worker puts on the Home Screen icon. A tap opens that chat
(`#c=<room>`, or a message to an open RoarMe). Addresses the push service says are gone (404/410) are removed. The
server's keys are made by the function itself and kept in `roar_push_conf` (server only). iPhone: Web Push needs RoarMe
on the Home Screen (Share > Add to Home Screen, iOS 16.4+), so `public/manifest.webmanifest` makes it an app of its own;
Settings says so in Safari. The Mac/Windows app keeps its own notifications. `supabase/push.sql` (run by Claude 18 Oct;
the function was tested end to end with a test address).

## Phone check (18 Oct)
Alex: "a general check of the app on mobile". The built app run locally at iPhone sizes (14 Pro, SE) with sample chats
answered in place of Supabase, screen by screen. Fixed: the bar at the foot (Contacts 18 px, Tasks 20 px against 22 px
for the rest put their words higher: every icon 22 px now, also on a computer); from the Home Screen the app runs up
under the clock with no black band and stops above the home bar so the foot bar is not cut (`viewport-fit=cover`,
`black-translucent`, safe-area padding on `.app` and windows); the send window's seven tiles go four to a row with
whole words; messages and cards use more of a narrow screen; on the smallest iPhones the chat's head buttons are smaller
so the name shows, and the foot bar's words are smaller; Settings > General on a phone says how to put RoarMe on the
Home Screen instead of offering Mac and Windows downloads; Auto-Reply has no "Back to standard"; a group admin's tag sits
beside the name.

## Media keeps the bar at the foot (18 Oct)
On a phone the Media page used to replace the chat list together with its bar at the foot, with a Back button; now
the media fill the screen and the bar (Contacts, Chats, Media, Calls, Tasks, Settings) stays under them, so one tap
goes anywhere (styles.css, "Media on a phone keeps the bar"). The Tasks panel has no "New task…" at its foot any more:
the + in its head adds one.
