// What the RoarMe site may ask of the Mac/Windows app (Settings > General and Notifications):
// the unread count on the icon, the paw in the menu bar, opening at login, running with the window closed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roarDesktop', {
  platform: process.platform,
  arch: process.arch, // arm64 on a Mac with Apple chips, for the right download
  setBadge: (n) => ipcRenderer.send('roar:badge', Number(n) || 0),
  getSettings: () => ipcRenderer.invoke('roar:get'),
  setSetting: (key, value) => ipcRenderer.invoke('roar:set', key, value),
  // updates (1.4.9 on): the app downloads a new version by itself; the page shows it and offers Restart
  update: {
    state: () => ipcRenderer.invoke('roar:update-state'),
    check: () => ipcRenderer.invoke('roar:update-check'),
    install: () => ipcRenderer.invoke('roar:update-install'),
    on: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('roar:update', h); return () => ipcRenderer.removeListener('roar:update', h) },
  },
})
