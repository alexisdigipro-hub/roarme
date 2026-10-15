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
