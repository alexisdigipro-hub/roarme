# RoarMe · instructions for Claude Code

RoarMe is a public chat app (working name), separate from the THEMADLIONS hub (repository
alexisdigipro-hub/themadlions-projects). Owner: Alex Konstantinidis, film director, not a developer.
Talk to him in Greek, friendly and concrete, no em dashes; the app's own text is English.

- React + Vite, plain CSS in src/styles.css, no UI framework. Dark glass look like the hub's chat:
  round glass buttons, pill fields, soft rounded tiles, the chosen item as lighter glass, orange accent.
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
