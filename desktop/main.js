// ROAR for Mac and Windows (Alex, 16 Oct): the chat from alexisdigipro-hub.github.io/roarme, live, in an
// app of its own. Nothing of the chat is kept in the app, so every change to the site reaches it on the
// next start without a new install. Links that leave ROAR open in the computer's own browser.
const { app, BrowserWindow, shell, session } = require('electron')

const HOME = 'https://alexisdigipro-hub.github.io/roarme/'
const ALLOWED = ['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']

let win = null

const inApp = (url) => typeof url === 'string' && url.startsWith(HOME)

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

const look = { backgroundColor: '#1b1e23', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true } }

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
  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  // voice messages, notifications and copy/paste, for ROAR only
  session.defaultSession.setPermissionRequestHandler((contents, permission, done) => {
    done(ALLOWED.includes(permission) && inApp(contents.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((contents, permission) => ALLOWED.includes(permission) && (!contents || inApp(contents.getURL())))
  open()
  app.on('activate', () => {
    if (win) win.show()
    else open()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
