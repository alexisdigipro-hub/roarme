/* What each Mac / Windows app version brings, a few words a line (Alex, 19 Oct: "every update says what changed, in
   short bullets"). Shown in the update card before Restart to update, and once after it as "Updated to RoarMe x".
   Add the new version here, at the top, whenever desktop/package.json goes up: the release's text is made from it too
   (.github/workflows/desktop.yml). */
export const CHANGES = {
  '1.4.11': [
    'Messages, sounds and notifications arrive with the window closed',
    'Send Test in Settings > Notifications',
  ],
  '1.4.10': [
    'Version and Check for Updates in the menu bar',
  ],
  '1.4.9': [
    'RoarMe updates itself: Restart to update',
  ],
}
export const notesFor = (v) => CHANGES[v] || []
