// What the RoarMe site may ask of the Mac/Windows app (Settings > General and Notifications):
// the unread count on the icon, the paw in the menu bar, opening at login, running with the window closed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roarDesktop', {
  platform: process.platform,
  arch: process.arch, // arm64 on a Mac with Apple chips, for the right download
  setBadge: (n) => ipcRenderer.send('roar:badge', Number(n) || 0),
  getSettings: () => ipcRenderer.invoke('roar:get'),
  setSetting: (key, value) => ipcRenderer.invoke('roar:set', key, value),
})
