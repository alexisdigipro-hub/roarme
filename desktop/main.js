// ROAR for Mac and Windows (Alex, 16 Oct): the chat from alexisdigipro-hub.github.io/roarme, live, in an
// app of its own. Nothing of the chat is kept in the app, so every change to the site reaches it on the
// next start without a new install. Links that leave ROAR open in the computer's own browser.
// The app adds what a browser cannot: the unread count on its icon, a paw in the menu bar, opening at
// login, and staying on (with notifications and calls) when its window is closed.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, session } = require('electron')
const fs = require('fs')
const path = require('path')

const HOME = 'https://alexisdigipro-hub.github.io/roarme/'
const ALLOWED = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']

let win = null
let tray = null
let quitting = false
let unread = 0

const inApp = (url) => typeof url === 'string' && url.startsWith(HOME)

// the app's own settings, in its folder on the computer
const file = () => path.join(app.getPath('userData'), 'roar-settings.json')
const DEFAULTS = { tray: true, keepRunning: true }
let settings = { ...DEFAULTS }
const loadSettings = () => { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) } } catch { settings = { ...DEFAULTS } } }
const saveSettings = () => { try { fs.writeFileSync(file(), JSON.stringify(settings)) } catch { /* read-only */ } }

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => show())

// no white title bar (Alex, 16 Oct): on a Mac the three buttons sit on ROAR's own dark band, on Windows the
// window buttons sit on a dark strip; the site leaves room for them (html[data-desktop] in styles.css)
const frame = process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
  : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1b1e23', symbolColor: '#eef0f3', height: 32 } }
const look = { backgroundColor: '#1b1e23', autoHideMenuBar: true, ...frame, webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'preload.js') } }

function guard(w) {
  // a chat opened "In Window" gets a window of its own; anything else opens in the browser
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 780, ...look } }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!inApp(url)) { e.preventDefault(); shell.openExternal(url) }
  })
  w.webContents.on('did-create-window', (child) => guard(child))
}

function open() {
  win = new BrowserWindow({ width: 1240, height: 840, minWidth: 760, minHeight: 540, title: 'ROAR', ...look })
  win.loadURL(HOME)
  guard(win)
  // closing the window keeps ROAR on in the background, so messages and calls still arrive
  win.on('close', (e) => {
    if (!quitting && settings.keepRunning) { e.preventDefault(); win.hide() }
  })
  win.on('closed', () => { win = null })
}
function show() {
  if (!win) open()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'trayTemplate.png'))
  img.setTemplateImage(true)
  return img
}
function updateTray() {
  if (settings.tray && !tray) {
    tray = new Tray(trayIcon())
    tray.setToolTip('ROAR')
    tray.on('click', show)
  }
  if (!settings.tray && tray) { tray.destroy(); tray = null }
  if (tray) {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: unread ? `Open ROAR (${unread} unread)` : 'Open ROAR', click: show },
      { type: 'separator' },
      { label: 'Quit ROAR', click: () => { quitting = true; app.quit() } },
    ]))
    if (process.platform === 'darwin') tray.setTitle(unread ? String(unread) : '')
  }
}

ipcMain.on('roar:badge', (_e, n) => {
  unread = Math.max(0, Math.min(9999, n | 0))
  app.setBadgeCount(unread)
  updateTray()
})
ipcMain.handle('roar:get', () => ({ ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin, platform: process.platform }))
ipcMain.handle('roar:set', (_e, key, value) => {
  if (key === 'openAtLogin') app.setLoginItemSettings({ openAtLogin: !!value, openAsHidden: true })
  else if (key in DEFAULTS) { settings[key] = !!value; saveSettings(); updateTray() }
  return { ...settings, openAtLogin: app.getLoginItemSettings().openAtLogin, platform: process.platform }
})

app.whenReady().then(() => {
  loadSettings()
  // voice messages, calls, notifications and copy/paste, for ROAR only
  session.defaultSession.setPermissionRequestHandler((contents, permission, done) => {
    done(ALLOWED.includes(permission) && inApp(contents.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) => ALLOWED.includes(permission) && (!contents || inApp(contents.getURL())))
  open()
  updateTray()
  app.on('activate', show)
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.keepRunning) app.quit()
})
