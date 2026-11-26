/* The Workspace in a window of its own (Alex, 26 Nov: "an extra window that snaps to the chat, but can stand apart too"),
   only in the computer apps (desktop/main.js roar:ws-*). The second window loads RoarMe with #ws=<room>: it shows that
   group's Workspace alone (html.ws-pop), while the main window keeps the chat and leaves the Workspace out of its pane. */
const m = typeof location !== 'undefined' && location.hash.match(/^#ws=([0-9a-f-]{36})$/)
export const POP_ROOM = m ? m[1] : ''
if (POP_ROOM) {
  document.documentElement.classList.add('ws-pop')
  history.replaceState(null, '', location.pathname + location.search)
}
const api = () => (typeof window !== 'undefined' && window.roarDesktop && window.roarDesktop.ws) || null
export const wsCan = () => !!api()
export const wsOpen = (room) => api()?.open(room)
export const wsDock = () => api()?.dock()
export const wsFocus = (room) => api()?.focus(room)
// the rooms whose Workspace stands in its own window now, as the main window hears it
export function wsWatch(fn) {
  const a = api()
  if (!a) return () => {}
  a.list().then((l) => fn(l || [])).catch(() => {})
  return a.on((l) => fn(l || []))
}
