// RoarMe for Mac and Windows (Alex, 16 Oct): the chat from alexisdigipro-hub.github.io/roarme, live, in an
// app of its own. Nothing of the chat is kept in the app, so every change to the site reaches it on the
// next start without a new install. Links that leave RoarMe open in the computer's own browser.
// The app adds what a browser cannot: the unread count on its icon, a paw in the menu bar, opening at
// login, and staying on (with notifications and calls) when its window is closed.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, powerSaveBlocker, screen, shell, session } = require('electron')
// RoarMe is dark: the glass under the window is dark too, even when the Mac is in light mode (Alex, 16 Oct:
// the strip while resizing came out white)
nativeTheme.themeSource = 'dark'
// draw with the graphics card wherever it can, so the page keeps up while the window is resized
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('ignore-gpu-blocklist')
const fs = require('fs')
const path = require('path')
const updater = require('./updater')

const HOME = 'https://alexisdigipro-hub.github.io/roarme/'
const ALLOWED = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen', 'geolocation']

let win = null
let tray = null
let quitting = false
let unread = 0

const inApp = (url) => typeof url === 'string' && url.startsWith(HOME)
// only web and mail links leave the app for the browser; any other kind (file:, smb:, custom app links) is ignored,
// so a link in a message can never start a program on the computer (security check, 17 Oct)
// roarmail:// too (Oct 2026): a task made from an email links back to it in RoarMail, which only opens that email
const openOutside = (url) => { if (/^(https?:|mailto:|roarmail:\/\/message\/)/i.test(String(url))) shell.openExternal(url) }

/* roarme:// links (Oct 2026, for RoarMail): roarme://c/<chat> opens that chat, roarme://m/<chat>/<message> that chat at
   that message, roarme:// alone just the app. They become the page's own #c= / #m= links; nothing else in them is used. */
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const linkHash = (url) => {
  const s = String(url || '').toLowerCase()
  if (!s.startsWith('roarme:')) return null
  const c = s.match(new RegExp(`^roarme://c/(${ID})/?$`))
  if (c) return `#c=${c[1]}`
  const m = s.match(new RegExp(`^roarme://m/(${ID})/(${ID})/?$`))
  if (m) return `#m=${m[1]}/${m[2]}`
  return ''
}
let pendingHash = ''
function openLink(url) {
  const h = linkHash(url)
  if (h === null) return
  show()
  if (!h) return
  if (win && !win.webContents.isLoading() && win.webContents.getURL().startsWith(HOME)) {
    win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(h)}`).catch(() => {})
  } else pendingHash = h
}

// the app's own settings, in its folder on the computer
const file = () => path.join(app.getPath('userData'), 'roar-settings.json')
const DEFAULTS = { tray: true, keepRunning: true }
let settings = { ...DEFAULTS }
const loadSettings = () => { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) } } catch { settings = { ...DEFAULTS } } }
const saveSettings = () => { try { fs.writeFileSync(file(), JSON.stringify(settings)) } catch { /* read-only */ } }

if (!app.requestSingleInstanceLock()) app.quit()
// a second start (Windows and Linux bring roarme:// links this way) shows the window that is already open
app.on('second-instance', (_e, argv) => { const l = argv.find((a) => /^roarme:/i.test(a)); if (l) openLink(l); else show() })
// a Mac brings them here, also when the link started the app
app.on('open-url', (e, url) => { e.preventDefault(); if (app.isReady()) openLink(url); else pendingHash = linkHash(url) || '' })
if (process.defaultApp) { if (process.argv.length >= 2) app.setAsDefaultProtocolClient('roarme', process.execPath, [path.resolve(process.argv[1])]) }
else app.setAsDefaultProtocolClient('roarme')

// no white title bar (Alex, 16 Oct): on a Mac the three buttons sit on RoarMe's own dark band, on Windows the
// window buttons sit on a dark strip; the site leaves room for them (html[data-desktop] in styles.css)
const frame = process.platform === 'darwin'
  ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 10 } }
  : { titleBarStyle: 'hidden', titleBarOverlay: { color: '#1b1e23', symbolColor: '#eef0f3', height: 32 } }
// An opaque window the colour of RoarMe's graphite: a see-through (vibrancy) window made resizing slower and showed
// white on a light Mac (Alex, 16 Oct), so the window is solid and the page itself is kept light to repaint.
const glassy = { backgroundColor: '#24282f' }
const look = { ...glassy, autoHideMenuBar: true, show: false, ...frame, webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') } }

// the band for the window buttons, put in by the app itself so it never depends on what the browser kept
const BAR = process.platform === 'darwin' ? 30 : 32
const BAND_CSS = `html, body { overflow: hidden; overscroll-behavior: none; }
#root { height: 100% !important; margin-top: 0 !important; padding-top: ${BAR}px !important; }
body::after { content: ''; position: fixed; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 999; -webkit-app-region: drag; }
.modal-back, .call, .lock, .viewer { -webkit-app-region: no-drag; }`
function band(w) {
  w.webContents.on('dom-ready', () => {
    w.webContents.insertCSS(BAND_CSS).catch(() => {})
    w.webContents.executeJavaScript(`document.documentElement.dataset.desktop = ${JSON.stringify(process.platform)}`).catch(() => {})
  })
}

function guard(w) {
  band(w)
  // a chat opened "In Window" gets a window of its own; anything else opens in the browser
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 900, height: 780, ...look, show: true } }
    openOutside(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (!inApp(url)) { e.preventDefault(); openOutside(url) }
  })
  w.webContents.on('did-create-window', (child) => guard(child))
}

/* the window's size (Alex, 17 Oct): a first start opens it wide, as Alex keeps his (about 1430 x 830 on a 13" Mac):
   the screen's width less a 20 px margin each side (at most 1440), in his proportions (1.72 : 1), centred. After that
   it opens where and as big as it was left. */
const firstBounds = () => {
  const wa = screen.getPrimaryDisplay().workArea
  const width = Math.max(760, Math.min(1440, wa.width - 40))
  const height = Math.max(540, Math.min(Math.round(width / 1.72), wa.height - 40))
  return { width, height, x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2) }
}
const savedBounds = () => {
  const b = settings.bounds
  if (!b || !(b.width >= 760 && b.height >= 540)) return null
  // only if it is still on a screen (a second monitor may be gone)
  const on = screen.getAllDisplays().some(({ workArea: a }) => b.x + 80 > a.x && b.x + 80 < a.x + a.width && b.y + 20 >= a.y && b.y + 20 < a.y + a.height)
  return on ? b : null
}
let boundsTimer = 0
const keepBounds = () => {
  clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    if (!win || win.isMinimized() || win.isFullScreen()) return
    settings.bounds = win.isMaximized() ? { ...(settings.bounds || win.getNormalBounds()), maximized: true } : { ...win.getBounds(), maximized: false }
    saveSettings()
  }, 400)
}

function open() {
  const b = savedBounds() || firstBounds()
  win = new BrowserWindow({ width: b.width, height: b.height, x: b.x, y: b.y, minWidth: 760, minHeight: 540, title: 'RoarMe', ...look })
  if (b.maximized) win.maximize()
  win.on('resize', keepBounds)
  win.on('move', keepBounds)
  // shown once the page has painted, so it opens on RoarMe and not on an empty frame
  win.once('ready-to-show', () => win?.show())
  setTimeout(() => { if (win && !win.isVisible()) win.show() }, 3000) // a slow or missing network still gets a window
  win.loadURL(HOME)
  // a roarme:// link that came before the page was there
  win.webContents.on('did-finish-load', () => {
    if (!pendingHash) return
    const h = pendingHash; pendingHash = ''
    win?.webContents.executeJavaScript(`location.hash = ${JSON.stringify(h)}`).catch(() => {})
  })
  guard(win)
  // closing the window keeps RoarMe on in the background, so messages and calls still arrive
  win.on('close', (e) => {
    if (!quitting && settings.keepRunning) { e.preventDefault(); win.hide() }
  })
  win.on('closed', () => { win = null })
  // with the window closed or minimised macOS would put RoarMe to sleep (App Nap) and its connection with it, so no
  // message or sound came (Alex, 18 Oct): while it is out of sight it is kept awake, which costs next to nothing
  win.on('hide', awake)
  win.on('minimize', awake)
  win.on('show', asleepOk)
  win.on('restore', asleepOk)
}
let blocker = -1
function awake() { if (blocker < 0 || !powerSaveBlocker.isStarted(blocker)) blocker = powerSaveBlocker.start('prevent-app-suspension') }
function asleepOk() { if (blocker >= 0 && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker); blocker = -1 }
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
    tray.setToolTip('RoarMe')
    tray.on('click', show)
  }
  if (!settings.tray && tray) { tray.destroy(); tray = null }
  if (tray) {
    // the update in the paw's menu too (1.4.10): checking, downloading with its percent, Restart to update
    const u = updater.getState()
    const upd = u.status === 'ready' ? { label: `Restart to Update (${u.version})`, click: () => updater.restart(() => { quitting = true }) }
      : u.status === 'downloading' ? { label: `Downloading RoarMe ${u.version}… ${u.progress || 0}%`, enabled: false }
      : u.status === 'checking' ? { label: 'Checking for Updates…', enabled: false }
      : { label: 'Check for Updates', click: () => updater.check() }
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: unread ? `Open RoarMe (${unread} unread)` : 'Open RoarMe', click: show },
      { type: 'separator' },
      upd,
      { label: `Version ${app.getVersion()} beta`, enabled: false },
      { type: 'separator' },
      { label: 'Quit RoarMe', click: () => { quitting = true; app.quit() } },
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

app.whenReady().then(async () => {
  loadSettings()
  // started by a roarme:// link (Windows)
  const startLink = process.argv.find((a) => /^roarme:/i.test(a))
  if (startLink) pendingHash = linkHash(startLink) || ''
  // always the latest RoarMe: nothing old from the last time is reused
  await session.defaultSession.clearCache().catch(() => {})
  // voice messages, calls, notifications, copy/paste and your location (Send My Location), for RoarMe only
  session.defaultSession.setPermissionRequestHandler((contents, permission, done) => {
    done(ALLOWED.includes(permission) && inApp(contents.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) => ALLOWED.includes(permission) && (!contents || inApp(contents.getURL())))
  open()
  updateTray()
  app.on('activate', show)
  // new versions download by themselves; the page offers Restart to update (updater.js)
  updater.start(ipcMain, () => { quitting = true }, updateTray)
})

app.on('before-quit', () => { quitting = true })
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !settings.keepRunning) app.quit()
})
