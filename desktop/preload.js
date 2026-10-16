// What the ROAR site may ask of the Mac/Windows app (Settings > General and Notifications):
// the unread count on the icon, the paw in the menu bar, opening at login, running with the window closed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roarDesktop', {
  setBadge: (n) => ipcRenderer.send('roar:badge', Number(n) || 0),
  getSettings: () => ipcRenderer.invoke('roar:get'),
  setSetting: (key, value) => ipcRenderer.invoke('roar:set', key, value),
})
