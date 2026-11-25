// Where one was, kept across a reload (Alex, 25 Nov: "swipe to refresh on any page refreshes and stays on that page").
// Written all the time to sessionStorage (this tab only); read back only when the page was reloaded (our pull to
// refresh, Safari's own pull, or a reload for a new version), so a fresh start still opens on the chats.
const KEY = 'roarme-stay'
let reloaded = false
try { reloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload' } catch { /* old browser */ }
let kept = {}
try { if (reloaded) kept = JSON.parse(sessionStorage.getItem(KEY) || '{}') || {} } catch { kept = {} }
let now = { ...kept }
export const stayGet = (k, dflt) => (kept[k] !== undefined && kept[k] !== null ? kept[k] : dflt)
export const stayUsed = (k) => { delete kept[k] }
export const staySet = (k, v) => {
  now[k] = v
  try { sessionStorage.setItem(KEY, JSON.stringify(now)) } catch { /* private window */ }
}
