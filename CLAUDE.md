# RoarMe · instructions for Claude Code

RoarMe is a public chat app (working name), separate from the THEMADLIONS hub (repository
alexisdigipro-hub/themadlions-projects). Owner: Alex Konstantinidis, film director, not a developer.
Talk to him in Greek, friendly and concrete, no em dashes; the app's own text is English.

- React + Vite, plain CSS in src/styles.css, no UI framework. Dark glass look like the hub's chat:
  round glass buttons, pill fields, soft rounded tiles, the chosen item as lighter glass, orange accent.
- **Never a word with an underline as a button** (Alex, 5 Nov, for every site we make): actions are real buttons, a flat matte glass pill or a round glass icon.
- Data in Supabase: only the `roar_*` tables and the `roar-files` / `roar-avatars` buckets; never touch the
  hub's tables. Every database change goes in supabase/schema.sql, written so it can be run again.
- Desktop first (Alex, 15 Oct). Email + password sign-in, @username to be found.
- Pushing to main deploys to GitHub Pages; open a PR, wait for the green build, merge it yourself.
- Since 1 Nov 2026 RoarMe has no tie to the THEMADLIONS hub (the hub has its own chat); supabase/hub-unlink.sql removed
  the pieces (links, project-group guards, hub sign-in, roar_hub_* functions). Accounts and chats stay.
- Slack features (20 Oct): @all / @here / @role mentions (src/roles.jsx, supabase/mentions.sql: roar_roles, roar_mentioned,
  roar_my_mentions, roar_push_targets now with `mention`) reach people even in a muted chat; Remind Me on a message
  (src/reminders.jsx, supabase/reminders.sql + pg_cron 'roar-reminders', roar-push {reminder}); Tasks > Reminders.
- Quote (31 Oct, Alex from Telegram): words picked from a message ride at the top of the reply as "> " lines (src/format.jsx withQuote / splitQuote, read only on a reply); a computer selects them and gets the sel-bar (Copy, Quote), a phone uses the menu's Quote (QuotePick in src/Chat.jsx). No database change.
- Themes (Alex, 31 Oct): only Stone (styles.css) and Simba ('ember', src/themes-simba.css, loaded by prefs.js wearTheme only when worn), each dark and light, for everyone; the other themes were removed and their wearers moved to Stone. The Tasks panel (tasks.jsx, with calendar.jsx) is lazy; what the start needs of Tasks is src/taskCore.js.
- Tasks is off by default (Alex, 7 Nov): Settings > Features > Tasks (prefs.tasksTab, as callsTab) puts it in the bar at the foot and the phone's chat head; whoever already had tasks gets it on once (Chat.jsx).
- Settings menu (Alex, 7 Nov, tidied): 1 General · Features · Appearance · Notifications and Sounds · Language; 2 Chats · Chat Folders · Auto-Reply · Data and Storage; 3 RoarTransfer · AllMedia; 4 Privacy and Security · Active Sessions (SettingsPages.jsx PAGES, the last field is the group). Features holds what can be added or taken away (Calls tab with the call devices, Tasks); a new optional part goes there. Power Saving is in Appearance > Effects.
- Own chat wallpaper (Alex, 8 Nov): besides the built-ins, any colour ('color:#rrggbb') or one's own photo ('img:<url>|<opacity>', uploaded to roar-avatars/<id>/wall-*), in Settings > Appearance > Chat wallpaper (prefs.background) and per chat from ⋯ > Change Wallpaper (localStorage roarme-walls). src/walls.js ownColor / ownPhoto / photoValue / wallLook; extras.jsx WallTiles has the Colour and Your Photo tiles and the Photo Strength slider; CSS at the end of styles.css.
- Nothing of Roardino in RoarMe (Alex, 8 Nov): no Ordino (compose button, attach tile, Roardino window, ordino card; old ordino messages show as their text) and no ?embed=roardino mode (src/embed.js, the html.in-roardino look and the roardino:* messages are gone). Roardino's own table roardino_ordinos stays (it is Roardino's).
- Admin moderation (Alex, 8 Nov; supabase/admin-moderation.sql): an admin's own edits carry no "edited" (Chat.jsx amAdmin); roar_admin_delete_message deletes anyone's message for everyone (message menu: Delete for Everyone (Admin); RoarMe Inbox); roar_official_edit corrects only the official RoarMe account's text messages, quietly (RoarMe Inbox). Nobody can edit another person's words. Careful: roar_admin_delete (u uuid) is a different, older function that deletes a whole account.
- Blur (Alex, 9 Nov: "the heaviest thing, make it much lighter everywhere"): one knob, --blur (10px, phone 6px, no saturate) for every glass surface, and --blur-veil (4px, phone 3px) for full-screen veils (scrim, modal back, viewer, call, chat menu). No hard-coded blur(...) in backdrop-filter; no filter: blur in animations.
- Motion (Alex, 9 Nov: "they go and come back, choppy"): --spring is a smooth ease with no overshoot; the overshoot is only --pop (reactions, big emoji) and the long-press pop. Lists, pages and menus come in as one piece (no row-after-row stagger); one opening animation per thing; entrances short (.22 to .32 s) and small (scale .95 to .98, 6 to 14 px).
