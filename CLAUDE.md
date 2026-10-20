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
- Linked to the THEMADLIONS hub since 20 Oct 2026 (Alex: the hub's chat moves onto RoarMe, step by step, safely). Phase 1:
  a person links their own account (src/hubLink.jsx, supabase/hub-link.sql, Edge Function roar-hub-link with a shared
  secret in roar_hub_conf). The hub never gets a RoarMe token or the service key; the person can remove the link in
  Settings > Privacy and Security > Linked apps. RoarMe still never touches the hub's tables.
- Phase 2 (20 Oct, applied and tested): project group chats run by the hub. roar_rooms.hub_project marks one;
  supabase/hub-bridge.sql locks it (no admins; add, remove, leave, rename, photo, auto-delete, delete and Encrypted
  Chat refused by guards on roar_members / roar_rooms / roar_e2e_sessions), members are set only by
  roar_hub_sync_project / roar_hub_close_project (service role only) through the Edge Function roar-hub-bridge
  (same x-hub-secret as roar-hub-link). Removing the hub link takes the person out of every project group.
  Not yet in the app's UI: a project group still shows the usual Leave / group menu (they answer with a clear refusal).
- Since 20 Oct (Alex's decision: RoarMe is the team's work tool, one account): **Sign in with THEMADLIONS Hub** on the
  sign-in card (src/hubLink.jsx startHubSignin / takeHubSignin / finishHubSignin, Edge Function roar-hub-signin,
  supabase/hub-signin.sql). The hub is the source of a team member's account: linked one, else same email, else made
  with no password. The person can no longer remove the hub link (only the hub's admin). The desktop app lets
  hub.themadlions.com open in its window (desktop/main.js) so the round trip stays in the app; that needs a desktop release.
- Phase 4 (20 Oct): RoarMe is shown inside the hub's RoarMe page at ?embed=hub (html[data-embed=hub]). takeEmbed /
  embeddedHubSignin / watchHubMember in src/hubLink.jsx: no-click sign-in through postMessage with
  https://hub.themadlions.com only, and a frame signed in as another account than the hub member signs out.
- Phase 6 (20 Oct): the person's hub tasks and calendar, shown only (useHubWork in src/hubLink.jsx, Edge Function
  roar-hub-work -> the hub's roarme-work). Tasks has a THEMADLIONS tab; the calendar shows hub events and tasks; a tap opens the hub.
- Slack features (20 Oct): @all / @here / @role mentions (src/roles.jsx, supabase/mentions.sql: roar_roles, roar_mentioned,
  roar_my_mentions, roar_push_targets now with `mention`) reach people even in a muted chat; Remind Me on a message
  (src/reminders.jsx, supabase/reminders.sql + pg_cron 'roar-reminders', roar-push {reminder}); Tasks > Reminders.
