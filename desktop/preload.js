// What the RoarMe site may ask of the Mac/Windows app (Settings > General and Notifications):
// the unread count on the icon, the paw in the menu bar, opening at login, running with the window closed.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roarDesktop', {
  platform: process.platform,
  arch: process.arch, // arm64 on a Mac with Apple chips, for the right download
  setBadge: (n) => ipcRenderer.send('roar:badge', Number(n) || 0),
  getSettings: () => ipcRenderer.invoke('roar:get'),
  setSetting: (key, value) => ipcRenderer.invoke('roar:set', key, value),
  // the Mac App Store's copy: updates come from the App Store, so it has no update below and the page offers no downloads
  store: !!process.mas,
  // Touch ID for the passcode lock (Mac only)
  touchId: process.platform === 'darwin' ? { can: () => ipcRenderer.invoke('roar:touchid-can'), ask: () => ipcRenderer.invoke('roar:touchid') } : undefined,
  // updates (1.4.9 on): the app downloads a new version by itself; the page shows it and offers Restart
  update: process.mas ? undefined : {
    state: () => ipcRenderer.invoke('roar:update-state'),
    check: () => ipcRenderer.invoke('roar:update-check'),
    install: () => ipcRenderer.invoke('roar:update-install'),
    on: (fn) => { const h = (_e, s) => fn(s); ipcRenderer.on('roar:update', h); return () => ipcRenderer.removeListener('roar:update', h) },
  },
})
