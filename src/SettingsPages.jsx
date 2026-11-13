import { useEffect, useMemo, useRef, useState } from 'react'
import { errText, foldHas, nameOf, supabase } from './lib.js'
import { Avatar, FOOT_I, I, Lens, Modal, Slide, NAME_COLORS, Wordmark, colorOf, revealFrom, svg } from './ui.jsx'
import { ACCENTS, HALO_ACCENTS, DEFAULTS, FONTS, REACTIONS, SOUNDS, TEXT_SIZES, applyMode, chime, dressTheme, haloish, inThemeLab, setPrefs, usePrefs, wearTheme } from './prefs.js'
import { WallTiles } from './extras.jsx'
import { ThemeEditor } from './themeEditor.jsx'
import { useWalls, wallLook } from './walls.js'
import { LegalDoc, legalTitle } from './legal.jsx'
import { checkCode, clearLock, getLock, lockNow, setLockAfter, setLockCode } from './lock.jsx'
import { LANGS as UI_LANGS, lang, locale } from './i18n.js'
import { Admin } from './admin.jsx'
import { MyTransfers } from './transfer.jsx'
import { badgeSupported, isIOS, isStandalone, onPhone, pushIsOn, pushOff, pushOn, pushSupported, pushTest } from './push.js'
import { InstallGuide, appVersion, fetchLatest, startDownload, thisComputer, useAppUpdate } from './update.jsx'

/* Settings as in Telegram (Alex, 16 Oct): a list on the left, the chosen page on the right.
   Anything that needs the database is shown switched off with "Coming soon".
   Tidied on 19 Oct (Alex: "more beautiful, better organised"): the pages in groups, a Chats page for how
   messages are typed and read, every page opening with its icon and one line on what it holds. */

// id, title, colour, icon, the line under the icon at the top of the page, the group in the list
export const PAGES = [
  ['general', 'General', '#8e8e93', svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>, 16), 'The app, what is turned on, the language and the shortcuts.', 1],
  // Features (Alex, 7 Nov: "you have to hunt for Tasks to turn it on"): the parts of RoarMe you can add or take away
  ['features', 'Features', '#ffd60a', svg(<><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><path d="M16.5 13.5v6M13.5 16.5h6" /></>, 16), 'Turn on the parts of RoarMe you use. Each one you turn on gets its place in the bar at the foot.', 1],
  ['chats', 'Chats', '#5e5ce6', svg(<path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z" />, 16), 'Typing and reading, folders, auto-reply, data and storage.', 2],
  ['appearance', 'Appearance', '#40c8e0', svg(<><path d="M14.5 4.5l5 5L11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5.5 5-1 1.5-3 0-4" /></>, 16), 'Theme, colours, text and wallpaper.', 1],
  ['notify', 'Notifications and Sounds', '#ff453a', svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 16), 'What reaches you, and how it sounds.', 1],
  ['language', 'Language', '#bf5af2', svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>, 16), 'The language of RoarMe and of translations.', 1],
  ['transfer', 'RoarTransfer', '#ff6b57', I.transfer, 'Everything you sent with RoarTransfer: where it went, how long it stays, who opened and downloaded it.', 3],
  ['folders', 'Chat Folders', '#a78bfa', I.folder, 'Create folders for different groups of chats and quickly switch between them.', 2],
  ['autoreply', 'Auto-Reply', '#64d2ff', svg(<><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v5h-5" /><path d="M8.5 12.5h7M8.5 9.5h4" /></>, 16), 'An answer that goes out by itself while you are busy.', 2],
  ['data', 'Data and Storage', '#30d158', svg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>, 16), 'How photos are sent and what loads by itself.', 2],
  ['privacy', 'Privacy and Security', '#0a84ff', svg(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>, 16), 'Who sees what, your devices, and how your account stays safe.', 4],
  ['sessions', 'Active Sessions', '#ff9f0a', svg(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>, 16), 'Every device signed in to your account.', 4],
]
// the page a page is reached from, for Back and for the way it slides
const PARENT = { features: 'general', language: 'general', keys: 'general', folders: 'chats', autoreply: 'chats', data: 'chats', sessions: 'privacy' }
const parentOf = (id) => (id?.startsWith('folder:') ? 'folders' : PARENT[id] || '')
// pages that are no longer doors of their own in the menu: they open from inside General, Chats or Privacy and Security
const SUBS = { general: 'App, Features, Language', chats: 'Folders, Auto-Reply, Data and Storage', privacy: 'Privacy, Active Sessions' }
const TUCKED = ['features', 'language', 'transfer', 'folders', 'autoreply', 'data', 'sessions']
export const pageTitle = (id) => (id === 'folder:new' ? 'New Folder' : id?.startsWith('folder:') ? 'Edit Folder' : id === 'profile' ? 'My Profile' : id === 'keys' ? 'Keyboard Shortcuts' : id === 'admin' ? 'Admin' : PAGES.find(([k]) => k === id)?.[1] || 'Settings')

// the top of a page: its icon in its colour and what it holds
// a settings page opens with its title alone (Alex, 12 Nov): the large sign and the line under it are gone
const Hero = () => null


const Switch = ({ on, set, children, hint }) => (
  <label className="set-row">
    <span className="set-text">{children}{hint && <small>{hint}</small>}</span>
    <span className="switch"><input type="checkbox" checked={!!on} onChange={(e) => set(e.target.checked)} /><span /></span>
  </label>
)
const Soon = ({ children, hint = 'Coming soon', arrow }) => (
  <div className="set-row is-off"><span className="set-text">{children}<small>{hint}</small></span>{arrow ? <i className="set-chev">{I.right}</i> : <span className="switch"><input type="checkbox" disabled /><span /></span>}</div>
)
const Check = ({ on, onClick, children }) => (
  <button type="button" className="set-row set-pick" onClick={onClick}><span className="set-text">{children}</span>{on && <i className="set-tick">{I.check}</i>}</button>
)
const Nav = ({ onClick, children, value }) => (
  <button type="button" className="set-row set-pick" onClick={onClick}><span className="set-text">{children}</span>{value && <small className="set-val">{value}</small>}<i className="set-chev">{I.right}</i></button>
)
const Box = ({ title, note, children }) => (
  <section className="set-sec">
    {title && <h4>{title}</h4>}
    <div className="set-box">{children}</div>
    {note && <p className="set-note">{note}</p>}
  </section>
)

/* Call Settings: which microphone, camera and speakers a call uses */
function CallDevices({ p }) {
  const [list, setList] = useState(null)
  const [asked, setAsked] = useState(false)
  const load = async () => {
    try { setList(await navigator.mediaDevices.enumerateDevices()) } catch { setList([]) }
  }
  useEffect(() => { load() }, [])
  const ask = async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); s.getTracks().forEach((t) => t.stop()) } catch { /* said no */ }
    setAsked(true)
    load()
  }
  const of = (kind) => (list || []).filter((d) => d.kind === kind)
  const named = (list || []).some((d) => d.label)
  const pick = (kind, key, label) => (
    <div className="set-row set-col">
      <span className="set-text">{label}</span>
      <select className="input set-select" value={p[key] || ''} onChange={(e) => setPrefs({ [key]: e.target.value })}>
        <option value="">The device's own choice</option>
        {of(kind).map((d, n) => <option key={d.deviceId || n} value={d.deviceId}>{d.label || `${label} ${n + 1}`}</option>)}
      </select>
    </div>
  )
  return (
    <Box title="Call devices" note="What voice and video calls use on this device.">
      {!named && <button type="button" className="set-row set-pick" onClick={ask}><span className="set-text">Show My Devices<small>{asked ? 'Allow the microphone and camera to see their names' : 'RoarMe asks once for the microphone and camera'}</small></span><i className="set-chev">{I.right}</i></button>}
      {pick('audioinput', 'micId', 'Microphone')}
      {pick('videoinput', 'camId', 'Camera')}
      {'setSinkId' in HTMLMediaElement.prototype && pick('audiooutput', 'speakerId', 'Speakers')}
    </Box>
  )
}

/* the Mac/Windows app's own settings, when RoarMe runs inside it (desktop/preload.js) */
function useDesktop() {
  const api = typeof window !== 'undefined' ? window.roarDesktop : null
  const [s, setS] = useState({})
  useEffect(() => { if (api) api.getSettings().then(setS) }, [api])
  return { on: !!api, s, set: async (k, v) => { if (api) setS(await api.setSetting(k, v)) } }
}

/* the list in the side panel */
export function SettingsMenu({ me, page, onPage, onMedia, onRoarMe, onInbox, inboxCount = 0 }) {
  const p = usePrefs()
  return (
    <div className="side-scroll set-menu stagger">
      <button type="button" className={`set-me${page === 'profile' ? ' on' : ''}`} onClick={() => onPage('profile')}>
        <Avatar src={me.avatar_url} name={nameOf(me)} size={60} />
        <span className="set-me-text"><b>{nameOf(me)}</b><small>@{me.username}</small>{me.bio && <small>{me.bio}</small>}</span>
        <i className="set-chev">{I.right}</i>
      </button>
      {/* the RoarMe account, run from your own profile (Alex, 19 Oct: "here in my profile, no other profile"): the admins
          read who writes to RoarMe and answer as RoarMe. My Profile itself is the card above. */}
      {onInbox && (
        <div className="set-box">
          <button type="button" className="set-row set-pick set-nav" onClick={onInbox}><span className="nav-ico" style={{ '--c': '#d40000' }}>{I.chats}</span><span className="set-text">RoarMe<small>Who writes to RoarMe · you answer as RoarMe</small></span>{inboxCount > 0 && <i className="set-count">{inboxCount}</i>}<i className="set-chev">{I.right}</i></button>
        </div>
      )}
      {/* the menu, tidied (Alex, 12 Nov: "not so many menus"): six doors. General holds Features and Language, Chats holds
          Chat Folders, Auto-Reply and Data and Storage, Privacy and Security holds Active Sessions; those pages are still
          there and are reached from inside. RoarTransfer's list is in AllMedia > Transfers. */}
      {[1, 2, 4].map((g) => (
        <div key={g} className="set-box">
          {PAGES.filter((x) => x[5] === g && !TUCKED.includes(x[0])).map(([id, label, c, ico]) => (
            <button key={id} type="button" className={`set-row set-pick set-nav${page === id ? ' on' : ''}`} onClick={() => onPage(id)}>
              <span className="nav-ico" style={{ '--c': c }}>{ico}</span><span className="set-text">{label}{SUBS[id] && <small>{SUBS[id]}</small>}</span>{id === 'language' && <small className="set-val" data-raw="">{lang() === 'el' ? 'Ελληνικά' : 'English'}</small>}{id === 'features' && <small className="set-val">{[p.callsTab && 'Calls', p.tasksTab && 'Tasks'].filter(Boolean).flatMap((x, n) => (n ? [' · ', <span key={x}>{x}</span>] : [<span key={x}>{x}</span>]))}{!p.callsTab && !p.tasksTab && <span>Off</span>}</small>}<i className="set-chev">{I.right}</i>
            </button>
          ))}
          {/* everything shared in all chats, out of the bar at the foot and in here (Alex, 19 Oct) */}
          {g === 2 && onMedia && <button type="button" className="set-row set-pick set-nav" onClick={onMedia}><span className="nav-ico" style={{ '--c': '#ff9f0a' }}>{I.media}</span><span className="set-text">AllMedia<small>Photos, videos, files and links from all chats</small></span><i className="set-chev">{I.right}</i></button>}
        </div>
      ))}
      {/* the RoarMe team's own chat: feedback, ideas, questions (Alex, 19 Oct) */}
      {(onRoarMe || inThemeLab(me)) && (
        <div className="set-box">
          {onRoarMe && <button type="button" className="set-row set-pick set-nav set-roarme" onClick={onRoarMe}><span className="nav-ico" style={{ '--c': '#d40000' }}>{I.chats}</span><span className="set-text">RoarMe · Feedback &amp; Help<small>Write to the RoarMe team</small></span><i className="set-chev">{I.right}</i></button>}
          {inThemeLab(me) && <button type="button" className={`set-row set-pick set-nav${page === 'admin' ? ' on' : ''}`} onClick={() => onPage('admin')}><span className="nav-ico" style={{ '--c': '#d40000' }}>{I.people}</span><span className="set-text">Admin<small>Only you see this</small></span><i className="set-chev">{I.right}</i></button>}
        </div>
      )}
      <div className="set-box">
        <button type="button" className="set-row set-pick set-nav danger" onClick={() => { if (window.confirm('Sign out of RoarMe on this device?')) supabase.auth.signOut() }}><span className="nav-ico" style={{ '--c': '#ff453a' }}>{svg(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />, 16)}</span><span className="set-text">Sign Out</span></button>
      </div>
      <p className="set-version"><Wordmark by /><span>{`RoarMe ${appVersion() ? `${appVersion()} ` : ''}· ${!navigator.userAgent.includes('Electron') ? 'web' : /Windows/.test(navigator.userAgent) ? 'Windows app' : 'Mac app'}`}</span></p>
    </div>
  )
}

/* the page on the right */
export function SettingsPage({ page, chosen, onPage, onBack, onFolderDone, profile, folders, onFolders, onFolderMenu, folderKit, toast, me, setMe }) {
  const p = usePrefs()
  const title = pageTitle(page)
  // going in slides the page from the right, going back up from the left
  const lastPage = useRef(page)
  const goingBack = useMemo(() => parentOf(lastPage.current) === page, [page]) // kept while the page stays, so the slide is not started again
  useEffect(() => { lastPage.current = page }, [page])
  return (
    <div className={`set-page${chosen ? ' chosen' : ''}`}>
      <header className="room-head set-head">
        {/* back goes one step up: a page reached from inside another returns to that one, not to the menu (Alex, 12 Nov) */}
        {parentOf(page)
          ? <button type="button" className="round" onClick={() => onPage(parentOf(page))} aria-label="Back" data-back="">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
          : <button type="button" className="round back" onClick={onBack} aria-label="Back" data-back="">{svg(<path d="M15 5l-7 7 7 7" />)}</button>}
        <strong>{title}</strong>
        {/* the folder is kept as it is typed; the tick takes you out (Alex, 21 Oct) */}
        {page.startsWith('folder:') && <button type="button" className="round set-done" onClick={() => (onFolderDone ? onFolderDone() : onPage('folders'))} aria-label="Done" title="Done">{svg(<path d="M5 12.5l4.5 4.5L19 7.5" />)}</button>}
      </header>
      <div className={`set-body stagger${goingBack ? ' back' : ''}`} key={page}>
        <Hero id={page} />
        {page === 'profile' && profile}
        {page === 'general' && <><General p={p} onKeys={() => onPage('keys')} toast={toast} /><Features p={p} /><Language p={p} /></>}
        {page === 'features' && <Features p={p} />}
        {page === 'chats' && (
          <>
            <div className="set-box">
              {['folders', 'autoreply'].map((id) => { const pg = PAGES.find(([k]) => k === id); return (
                <button key={id} type="button" className="set-row set-pick set-nav" onClick={() => onPage(id)}>
                  <span className="nav-ico" style={{ '--c': pg[2] }}>{pg[3]}</span><span className="set-text">{pg[1]}</span><i className="set-chev">{I.right}</i>
                </button>
              ) })}
            </div>
            <Chats p={p} />
            <Data p={p} toast={toast} />
          </>
        )}
        {page === 'keys' && <Keys p={p} />}
        {page === 'notify' && <Notify p={p} toast={toast} />}
        {page === 'autoreply' && <AutoReply toast={toast} />}
        {page === 'privacy' && <><Privacy me={me} setMe={setMe} toast={toast} /><Sessions me={me} setMe={setMe} toast={toast} /></>}
        {page === 'data' && <Data p={p} toast={toast} />}
        {page === 'sessions' && <Sessions me={me} setMe={setMe} toast={toast} />}
        {page === 'appearance' && <Appearance p={p} toast={toast} me={me} setMe={setMe} />}
        {page === 'language' && <Language p={p} />}
        {page === 'admin' && inThemeLab(me) && <Admin />}
        {page === 'transfer' && <MyTransfers toast={toast} />}
        {page === 'folders' && <Folders p={p} folders={folders} onFolders={onFolders} onFolderMenu={onFolderMenu} />}
        {page.startsWith('folder:') && folderKit && (READY_FOLDERS[page.slice(7)]
          ? <ReadyFolderEdit key={page} id={page.slice(7)} p={p} onDone={() => onPage('folders')} toast={toast} />
          : <FolderEdit key={page} id={page.slice(7)} kit={folderKit} onDone={() => onPage('folders')} toast={toast} />)}
      </div>
    </div>
  )
}

/* Check for Updates (Alex, 18 Oct). From 1.4.9 the app itself looks, downloads the new version in the background and
   offers Restart to update; an older app only learns that one is out and gets the download, one last time by hand */
function CheckUpdates({ onDownload }) {
  const desk = typeof window !== 'undefined' ? window.roarDesktop?.update : null
  const [st, setSt] = useState({ status: 'idle', note: '' })
  useEffect(() => {
    if (!desk) return undefined
    return desk.on((s) => {
      if (s.status === 'downloading') setSt({ status: 'busy', note: `Downloading RoarMe ${s.version}… ${s.progress || 0}%` })
      else if (s.status === 'ready') setSt({ status: 'ready', note: `RoarMe ${s.version} is ready`, version: s.version })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const check = async () => {
    setSt({ status: 'busy', note: 'Checking…' })
    try {
      if (desk) {
        const s = await desk.check()
        if (s?.status === 'ready') setSt({ status: 'ready', note: `RoarMe ${s.version} is ready`, version: s.version })
        else if (s?.status === 'downloading') setSt({ status: 'busy', note: `Downloading RoarMe ${s.version}… ${s.progress || 0}%` })
        else if (s?.status === 'error') setSt({ status: 'idle', note: `Could not check: ${s.error}` })
        else setSt({ status: 'idle', note: 'You have the newest RoarMe' })
      } else {
        const r = await fetchLatest()
        setSt(r.newer ? { status: 'old', note: `RoarMe ${r.version} is out`, version: r.version } : { status: 'idle', note: 'You have the newest RoarMe' })
      }
    } catch (e) { setSt({ status: 'idle', note: `Could not check: ${e.message}` }) }
  }
  return (
    <div className="set-row">
      <span className="set-text">Check for Updates<small>{st.note || 'Looks for a new version now'}</small></span>
      {st.status === 'ready' && desk
        ? <button type="button" className="btn btn-main btn-sm" onClick={() => { setSt({ ...st, status: 'busy', note: 'Restarting…' }); desk.install() }}>Restart to update</button>
        : st.status === 'old'
          ? <button type="button" className="btn btn-main btn-sm" onClick={() => onDownload(thisComputer() || 'mac-arm')}>Download</button>
          : <button type="button" className="btn btn-sm" disabled={st.status === 'busy'} onClick={check}>{st.status === 'busy' ? 'Checking…' : 'Check'}</button>}
    </div>
  )
}

function General({ p, onKeys, toast }) {
  const desk = useDesktop()
  const upd = useAppUpdate()
  const [guide, setGuide] = useState('')
  const get = (kind) => { startDownload(kind); setGuide(kind) }
  // every setting kept on this device back to the start, but never the language (that would need a restart)
  const same = Object.keys(DEFAULTS).every((k) => k === 'lang' || JSON.stringify(p[k]) === JSON.stringify(DEFAULTS[k]))
  const reset = () => {
    if (!window.confirm('Reset all settings on this device?')) return
    setPrefs({ ...DEFAULTS, lang: p.lang })
    toast('Settings are back to how RoarMe starts')
  }
  return (
    <>
      {guide && <InstallGuide kind={guide} update={desk.on} onClose={() => setGuide('')} />}
      {/* on a phone the downloads for Mac and Windows have no place; it says how RoarMe becomes an app here (Alex, 18 Oct) */}
      {!desk.on && onPhone() ? (
        <Box title="RoarMe app" note={isStandalone() ? '' : isIOS() ? 'In Safari: Share > Add to Home Screen, then open RoarMe from the Home Screen.' : 'In the browser menu: Add to Home Screen or Install app.'}>
          <div className="set-row"><span className="set-text">{isStandalone() ? 'On your Home Screen' : 'Add RoarMe to the Home Screen'}<small>{isStandalone() ? 'RoarMe opens as an app of its own' : 'An app of its own, with notifications when it is closed'}</small></span>{isStandalone() && <i className="set-tick">{I.check}</i>}</div>
        </Box>
      ) : (
      <Box title="RoarMe app" note={desk.on ? 'For this computer.' : 'The app keeps RoarMe on for messages and calls with the window closed, and always runs the newest version.'}>
        {desk.on ? (
          <>
            <div className="set-row"><span className="set-text">Version {upd.installed || '–'}<small>{upd.ready ? `RoarMe ${upd.latest} is out` : upd.latest ? 'Up to date' : 'The newest version is checked when RoarMe opens'}</small></span>{upd.ready && <button type="button" className="btn btn-main set-upd" onClick={() => get(thisComputer() || 'mac-arm')}>{I.download}<span>Download</span></button>}</div>
            <CheckUpdates onDownload={get} />
            <Switch on={desk.s.openAtLogin} set={(v) => desk.set('openAtLogin', v)} hint="Starts quietly in the background">Open When the Computer Starts</Switch>
            <Switch on={desk.s.keepRunning} set={(v) => desk.set('keepRunning', v)} hint="Closing the window keeps RoarMe on for messages and calls">Keep Running When Closed</Switch>
          </>
        ) : (
          <>
            <button type="button" className="set-row set-pick" onClick={() => get('mac-arm')}><span className="set-text">Download for Mac (Apple Silicon)<small>M1, M2, M3, M4</small></span><i className="set-chev">{I.download}</i></button>
            <button type="button" className="set-row set-pick" onClick={() => get('mac-intel')}><span className="set-text">Download for Mac (Intel)</span><i className="set-chev">{I.download}</i></button>
            <button type="button" className="set-row set-pick" onClick={() => get('win')}><span className="set-text">Download for Windows</span><i className="set-chev">{I.download}</i></button>
          </>
        )}
      </Box>
      )}
      <Box title="Advanced">
        {!onPhone() && <Nav onClick={onKeys} value="⌘ /">Keyboard Shortcuts</Nav>}
        <Switch on={p.peerIds} set={(v) => setPrefs({ peerIds: v })} hint="Each person's RoarMe ID at the foot of their profile">Show User IDs in Profile</Switch>
      </Box>
      <Box note="Everything on this page and on Features, Chats, Appearance, Notifications, Data and Folders goes back to how RoarMe starts. The language, your account and your chats stay as they are.">
        <button type="button" className="set-row set-pick danger" disabled={same} onClick={reset}><span className="set-text">Reset All Settings</span></button>
      </Box>
    </>
  )
}

/* Features (Alex, 7 Nov): Calls and Tasks in one place, each switched on or off with what it does said plainly;
   on, it gets its button in the bar at the foot. Calls keeps the microphone, camera and speakers under it */
function Features({ p }) {
  return (
    <>
      <Box title="Calls" note="Voice and video calls, one to one. Off: the Calls tab leaves the bar at the foot; the call buttons in a chat stay.">
        <Switch on={p.callsTab} set={(v) => setPrefs({ callsTab: v })} hint="Recent calls and Create New Call, in the bar at the foot">Calls Tab</Switch>
      </Box>
      <CallDevices p={p} />
      <Box title="Tasks" note="Off: nothing of your tasks is lost. They come back when you turn it on.">
        <Switch on={p.tasksTab} set={(v) => setPrefs({ tasksTab: v })} hint="To-dos for you and others, reminders and a calendar, in the bar at the foot">Tasks</Switch>
      </Box>
    </>
  )
}

/* how messages are typed, sent and read (out of General, 19 Oct) */
function Chats({ p }) {
  const tap = onPhone() ? 'Double tap on a message' : 'Double click on a message'
  return (
    <>
      <Box title="Typing">
        <Check on={p.enterSends} onClick={() => setPrefs({ enterSends: true })}>Send with Enter<small>{onPhone() ? 'The send button works too' : 'Shift + Enter for a new line'}</small></Check>
        <Check on={!p.enterSends} onClick={() => setPrefs({ enterSends: false })}>{onPhone() ? 'Send with the Send Button' : 'Send with ⌘ / Ctrl + Enter'}<small>Enter for a new line</small></Check>
        <Switch on={p.spell} set={(v) => setPrefs({ spell: v })}>Check Spelling While Typing</Switch>
        <Switch on={p.autoEmoji} set={(v) => setPrefs({ autoEmoji: v })} hint=":) becomes 🙂 and <3 becomes ❤️ when you send">Replace Emoji Automatically</Switch>
        <Switch on={p.copyFormat !== false} set={(v) => setPrefs({ copyFormat: v })} hint="**bold**, _italic_, ~~strike~~, `code`, ||spoiler|| stay when you copy">Copy Text Formatting</Switch>
      </Box>
      <Box title={tap} note={p.doubleTap === 'edit' ? "On someone else's message it replies." : null}>
        {[['react', 'Add Reaction'], ['reply', 'Reply to Message'], ['edit', 'Edit Message'], ['forward', 'Forward Message']].map(([k, l]) => <Check key={k} on={p.doubleTap === k} onClick={() => setPrefs({ doubleTap: k })}>{l}</Check>)}
      </Box>
      <Box title="Quick reaction" note={`The reaction a ${onPhone() ? 'double tap' : 'double click'} adds.`}>
        <div className="set-row set-col"><Lens className="seg seg-emoji" dep={p.quick}>{REACTIONS.map((e) => <button key={e} type="button" className={p.quick === e ? 'on' : ''} onClick={() => setPrefs({ quick: e })}>{e}</button>)}</Lens></div>
      </Box>
      <Box title="Messages">
        <Switch on={p.bigEmoji} set={(v) => setPrefs({ bigEmoji: v })} hint="A message of only emoji shows them big">Large Emoji</Switch>
        <Switch on={p.faces} set={(v) => setPrefs({ faces: v })} hint="Who wrote what, at a glance">Faces Next to Messages in Groups</Switch>
      </Box>
      <Box title="Chat list">
        <Switch on={p.listPreview} set={(v) => setPrefs({ listPreview: v })} hint="The last message under each chat's name">Show Last Message</Switch>
        <Switch on={p.peekBadge} set={(v) => setPrefs({ peekBadge: v })} hint={onPhone() ? 'Tap the unread count to read a chat without marking it as read' : 'Click the unread count to read a chat without marking it as read'}>Preview Chats</Switch>
      </Box>
    </>
  )
}

function Keys({ p }) {
  const rows = [['⌘K / Ctrl+K', 'Search chats'], ['⌘/ / Ctrl+/', 'Keyboard shortcuts'], ['Enter', p.enterSends ? 'Send' : 'New line'], [p.enterSends ? 'Shift+Enter' : '⌘ / Ctrl+Enter', p.enterSends ? 'New line' : 'Send'], ['↑', 'Edit your last message'], ['Esc', 'Cancel, close'], ['Right click on a message', 'Message menu'], ['Right click on a chat', 'Chat menu'], ['Double click', { react: 'Quick reaction', reply: 'Reply', edit: 'Edit', forward: 'Forward' }[p.doubleTap]]]
  return <Box>{rows.map(([k, v]) => <div key={k} className="set-row keys"><span className="set-text">{v}</span><kbd>{k}</kbd></div>)}</Box>
}

/* notifications with RoarMe closed on a phone or in a browser (Web Push, src/push.js) */
function PushSwitch({ p, toast }) {
  const [on, setOn] = useState(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  useEffect(() => { pushIsOn().then(setOn).catch(() => setOn(false)) }, [])
  if (!pushSupported()) {
    return <Soon hint={isIOS() && !isStandalone() ? 'On iPhone: Share > Add to Home Screen, then open RoarMe from there' : 'This browser cannot get them'}>Notifications With the App Closed</Soon>
  }
  const set = async (v) => {
    if (busy) return
    setBusy(true)
    try {
      if (v) { await pushOn(p.notifyPreview); toast('Notifications are on for this device') } else { await pushOff(); toast('Notifications are off for this device') }
      setOn(v)
    } catch (e) { toast(e?.message || 'That did not work') }
    setBusy(false)
  }
  // a test from the server, 5 seconds later, so there is time to close RoarMe or lock the phone
  const test = async () => {
    setTesting(true)
    toast('Close RoarMe now: the test comes in 5 seconds')
    try {
      const res = await pushTest()
      toast(res.map((r) => `${r.device}: ${r.status >= 200 && r.status < 300 ? 'sent ✓' : `${r.status} ${r.said}`}`).join(' · ') || 'No device answered')
    } catch (e) { toast(e?.message || 'That did not work') }
    setTesting(false)
  }
  return (
    <>
      <Switch on={!!on} set={set} hint={busy ? 'One moment…' : 'New messages reach this device even when RoarMe is closed'}>Notifications With the App Closed</Switch>
      {on && (
        <div className="set-row">
          <span className="set-text">Test Notification<small>Comes 5 seconds after you press, so you can close RoarMe first</small></span>
          <button type="button" className="btn btn-sm" disabled={testing} onClick={test}>{testing ? '…' : 'Send Test'}</button>
        </div>
      )}
    </>
  )
}

function Notify({ p, toast }) {
  const desk = useDesktop()
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'none' : Notification.permission)
  const ask = async () => { try { setPerm(await Notification.requestPermission()) } catch { /* not here */ } }
  return (
    <>
      <Box title="Message notifications">
        <div className="set-row">
          <span className="set-text">{onPhone() ? 'Notifications' : 'Desktop Notifications'}<small>{perm === 'granted' ? 'On for this browser' : perm === 'denied' ? 'Blocked. Allow them in the browser settings for this site.' : perm === 'none' ? 'This browser has no notifications' : 'Allow RoarMe to show new messages'}</small></span>
          {perm === 'default' && <button type="button" className="btn btn-main btn-sm" onClick={ask}>Allow</button>}
          {perm === 'granted' && <i className="set-tick">{I.check}</i>}
        </div>
        <Switch on={p.notifyPreview} set={(v) => setPrefs({ notifyPreview: v })} hint="Off: only the name, never the text">Message Preview</Switch>
        {desk.on
          ? <Switch on={desk.s.keepRunning} set={(v) => desk.set('keepRunning', v)} hint="Closing the window keeps RoarMe on, so messages and calls still reach you">Notifications With the App Closed</Switch>
          : <PushSwitch p={p} toast={toast} />}
      </Box>
      <Box title="Sounds">
        <Switch on={p.sound} set={(v) => { setPrefs({ sound: v }); if (v) chime() }} hint="While RoarMe is open">Sound When a Message Arrives</Switch>
        {p.sound && (
          <div className="set-row set-col">
            <span className="set-text">Sound<small>Tap one to hear it</small></span>
            <Lens className="seg seg-wrap" dep={p.soundKind}>{SOUNDS.map(([k, l]) => <button key={k} type="button" className={p.soundKind === k ? 'on' : ''} onClick={() => { setPrefs({ soundKind: k }); chime(k) }}>{l}</button>)}</Lens>
          </div>
        )}
      </Box>
      <Box title="Email">
        <EmailReminders />
      </Box>
      <Box title="App icon">
        {desk.on || badgeSupported()
          ? <Switch on={p.badge !== false} set={(v) => setPrefs({ badge: v })} hint={desk.on ? '' : 'On the Home Screen icon'}>Unread Count on the App Icon</Switch>
          : <Soon hint={isIOS() && !isStandalone() ? 'Add RoarMe to the Home Screen first' : 'Not in this browser'}>Unread Count on the App Icon</Soon>}
      </Box>
    </>
  )
}

/* Auto-reply (Alex, 18 Oct; supabase/autoreply.sql): someone who writes to you one to one gets your text back by
   itself, once per chat every 12 hours, while it is on (until a time, if one is set) */
const pad2 = (n) => String(n).padStart(2, '0')
const localIn = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
function AutoReply({ toast }) {
  const [row, setRow] = useState(null) // null loading · false not available · the saved settings
  const [body, setBody] = useState('')
  const load = async () => {
    const { data, error } = await supabase.from('roar_autoreply').select('enabled, body, away_only, until').maybeSingle()
    if (error) { setRow(false); return }
    const r = data || { enabled: false, body: '', away_only: false, until: null }
    setRow(r); setBody(r.body)
  }
  useEffect(() => { load() }, [])
  const save = async (patch, done) => {
    const next = { ...row, ...patch }
    setRow(next)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('roar_autoreply').upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() })
    if (error) { toast(errText(error)); load() } else if (done) toast(done)
  }
  if (row === null) return <p className="muted pf-empty">Loading…</p>
  if (row === false) return <Box><Soon hint="Not available right now">Auto-Reply</Soon></Box>
  const over = row.until && new Date(row.until) < new Date()
  const on = row.enabled && !over
  return (
    <>
      <Box note="Someone who writes to you in a one-to-one chat gets this back by itself, once per chat every 12 hours. Groups never get it.">
        <Switch on={on} set={(v) => { if (v && !body.trim()) { toast('Write the reply first'); return } save({ enabled: v, body: body.trim(), ...(v && over ? { until: null } : {}) }, v ? 'Auto-reply is on' : 'Auto-reply is off') }} hint={on ? 'On' : over ? 'Ended by itself' : 'Off'}>Auto-Reply</Switch>
        <div className="set-row set-col">
          <span className="set-text">Message</span>
          <textarea className="set-area" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="I am on set today. I will get back to you after 20:00." />
          {body.trim() !== (row.body || '') && <button type="button" className="btn btn-main btn-sm set-save" onClick={() => save({ body: body.trim(), ...(body.trim() ? {} : { enabled: false }) }, 'Saved')}>Save</button>}
        </div>
      </Box>
      <Box>
        <Switch on={row.away_only} set={(v) => save({ away_only: v })} hint="Only while RoarMe has not been open on any of your devices for 10 minutes">Only When I'm Away</Switch>
        <Switch on={!!row.until} set={(v) => save({ until: v ? new Date(Date.now() + 864e5).toISOString() : null })} hint="It turns itself off at that time">Turn Off By Itself</Switch>
        {row.until && (
          <div className="set-row">
            <span className="set-text">Until</span>
            <input className="set-when" type="datetime-local" value={localIn(new Date(row.until))} onChange={(e) => { const d = new Date(e.target.value); if (!Number.isNaN(d.getTime())) save({ until: d.toISOString() }) }} />
          </div>
        )}
      </Box>
    </>
  )
}

/* Email reminders (Alex, 18 Oct; supabase/email.sql): from noreply@themadlions.com when there are new messages and
   one has been away, at most one every 3 hours, never the text. On unless turned off here or from the email's own link */
function EmailReminders() {
  const [on, setOn] = useState(null)
  useEffect(() => {
    supabase.from('roar_email_prefs').select('enabled').maybeSingle().then(({ data, error }) => setOn(error ? null : data ? data.enabled : true))
  }, [])
  const set = async (v) => {
    setOn(v)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('roar_email_prefs').update({ enabled: v }).eq('user_id', user.id).select('user_id')
    const e2 = !error && !data?.length ? (await supabase.from('roar_email_prefs').insert({ user_id: user.id, enabled: v })).error : error
    if (e2) setOn(!v)
  }
  if (on === null) return <Soon hint="Not available right now">Email Me About Unread Messages</Soon>
  return <Switch on={on} set={set} hint="When you have been away, at most one every 3 hours. Never the text of a message">Email Me About Unread Messages</Switch>
}

/* Two-Step Verification: an authenticator app (Google Authenticator, 1Password, Authy…) gives a code after the password */
function TwoStep({ toast }) {
  const [state, setState] = useState(null) // null loading · { on, factorId } · { setup: { id, qr, secret } }
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const load = async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    const f = (data?.totp || []).find((x) => x.status === 'verified')
    setState(f ? { on: true, factorId: f.id } : { on: false })
  }
  useEffect(() => { load() }, [])
  const start = async () => {
    setErr('')
    // leftovers from a setup that was not finished
    const { data: all } = await supabase.auth.mfa.listFactors()
    for (const f of (all?.all || []).filter((x) => x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `RoarMe ${new Date().toISOString().slice(0, 16)}` })
    if (error) { setErr(errText(error)); return }
    setState({ setup: { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret } })
  }
  const confirm = async () => {
    setErr('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: state.setup.id, code: code.trim() })
    if (error) { setErr(errText(error)); return }
    setCode(''); toast('Two-step verification is on'); load()
  }
  const turnOff = async () => {
    if (!window.confirm('Turn off two-step verification? Signing in will need only your password.')) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: state.factorId })
    if (error) { toast(errText(error)); return }
    await supabase.auth.refreshSession()
    toast('Two-step verification is off'); load()
  }
  return (
    <Box title="Two-step verification" note="After your password, RoarMe also asks for a 6-digit code from an authenticator app on your phone.">
      {state === null && <div className="set-row"><span className="set-text muted">Loading…</span></div>}
      {state?.on === true && (
        <div className="set-row">
          <span className="set-text">Two-Step Verification<small>On · an authenticator app is linked</small></span>
          <button type="button" className="btn btn-sm btn-danger" onClick={turnOff}>Turn off</button>
        </div>
      )}
      {state?.on === false && <Nav onClick={start} value="Off">Two-Step Verification</Nav>}
      {state?.setup && (
        <div className="set-row set-col mfa-setup">
          <span className="set-text">1. Scan this with your authenticator app<small>Or type the key by hand</small></span>
          <img className="mfa-qr" src={state.setup.qr} alt="QR code for your authenticator app" />
          <code className="mfa-secret">{state.setup.secret}</code>
          <span className="set-text">2. Type the 6-digit code it shows</span>
          <input className="input mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" />
          <span className="set-acts"><button type="button" className="btn" onClick={() => { setState({ on: false }); setCode('') }}>Cancel</button><button type="button" className="btn btn-main" disabled={code.length !== 6} onClick={confirm}>Turn on</button></span>
        </div>
      )}
      {err && <div className="set-row"><p className="auth-err">{err}</p></div>}
    </Box>
  )
}

/* Passcode Lock: a code on this device; RoarMe locks itself after a while away */
function Passcode({ toast }) {
  const [lock, setL] = useState(getLock)
  const [form, setForm] = useState(null) // null · { a, b, old }
  useEffect(() => {
    const on = () => setL(getLock())
    window.addEventListener('roarme-lock', on)
    return () => window.removeEventListener('roarme-lock', on)
  }, [])
  const save = async () => {
    if (!/^\d{4,8}$/.test(form.a)) { toast('4 to 8 digits'); return }
    if (form.a !== form.b) { toast('The two codes do not match'); return }
    if (lock && !(await checkCode(form.old))) { toast('The current passcode is not right'); return }
    await setLockCode(form.a, lock?.after || 5)
    setForm(null); toast(lock ? 'Passcode changed' : 'Passcode on')
  }
  const off = async () => {
    const old = window.prompt('Your current passcode')
    if (old === null) return
    if (!(await checkCode(old))) { toast('The passcode is not right'); return }
    clearLock(); toast('Passcode off')
  }
  return (
    <Box title="Passcode lock" note="Kept on this device only. If you forget it, sign out and in again.">
      {!form && !lock && <Nav onClick={() => setForm({ a: '', b: '', old: '' })} value="Off">Passcode Lock</Nav>}
      {!form && lock && (
        <>
          <div className="set-row set-col">
            <span className="set-text">Lock After<small>Away from RoarMe, or not touching it, this long</small></span>
            <Lens className="seg" dep={lock.after}>{[[1, '1 min'], [5, '5 min'], [60, '1 hour'], [300, '5 hours']].map(([v, t]) => <button key={v} type="button" className={lock.after === v ? 'on' : ''} onClick={() => setLockAfter(v)}>{t}</button>)}</Lens>
          </div>
          <button type="button" className="set-row set-pick" onClick={lockNow}><span className="set-text">Lock Now</span></button>
          <button type="button" className="set-row set-pick" onClick={() => setForm({ a: '', b: '', old: '' })}><span className="set-text">Change Passcode</span></button>
          <button type="button" className="set-row set-pick danger" onClick={off}><span className="set-text">Turn Passcode Off</span></button>
        </>
      )}
      {form && (
        <div className="set-row set-col">
          {lock && <input className="input" type="password" inputMode="numeric" value={form.old} onChange={(e) => setForm((f) => ({ ...f, old: e.target.value.replace(/\D/g, '') }))} placeholder="Current passcode" />}
          <input className="input" type="password" inputMode="numeric" autoFocus value={form.a} onChange={(e) => setForm((f) => ({ ...f, a: e.target.value.replace(/\D/g, '').slice(0, 8) }))} placeholder="New passcode, 4 to 8 digits" />
          <input className="input" type="password" inputMode="numeric" value={form.b} onChange={(e) => setForm((f) => ({ ...f, b: e.target.value.replace(/\D/g, '').slice(0, 8) }))} placeholder="Once more" onKeyDown={(e) => e.key === 'Enter' && save()} />
          <span className="set-acts"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="button" className="btn btn-main" onClick={save}>Save</button></span>
        </div>
      )}
    </Box>
  )
}

/* my profile changed in the database, read back through roar_people */
export async function saveMe(me, setMe, patch) {
  const { error } = await supabase.from('roar_profiles').update(patch).eq('id', me.id)
  if (error) return errText(error)
  const { data } = await supabase.from('roar_people').select('*').eq('id', me.id).single()
  if (data) setMe(data)
  return ''
}

function Privacy({ me, setMe, toast }) {
  const [pw, setPw] = useState({ a: '', b: '', open: false, busy: false, err: '' })
  const priv = me.privacy || {}
  const setPriv = async (k, v) => {
    const e = await saveMe(me, setMe, { privacy: { ...priv, [k]: v } })
    toast(e || 'Saved')
  }
  const [blocks, setBlocks] = useState([])
  const loadBlocks = async () => {
    const { data } = await supabase.from('roar_blocks').select('blocked')
    const ids = (data || []).map((b) => b.blocked)
    if (!ids.length) { setBlocks([]); return }
    const { data: ppl } = await supabase.from('roar_people').select('id, username, display_name, avatar_url').in('id', ids)
    setBlocks(ppl || [])
  }
  useEffect(() => { loadBlocks() }, [])
  const unblock = async (b) => {
    const { error } = await supabase.from('roar_blocks').delete().eq('blocker', me.id).eq('blocked', b.id)
    if (error) toast(errText(error)); else { toast(`${nameOf(b)} unblocked`); loadBlocks() }
  }
  const [gone, setGone] = useState({ open: false, typed: '', busy: false })
  const [legal, setLegal] = useState('')
  const deleteMe = async () => {
    setGone((g) => ({ ...g, busy: true }))
    const { error } = await supabase.rpc('roar_delete_me')
    if (error) { toast(errText(error)); setGone((g) => ({ ...g, busy: false })); return }
    await supabase.auth.signOut()
  }
  const save = async () => {
    if (pw.a.length < 8) { setPw((s) => ({ ...s, err: 'At least 8 characters.' })); return }
    if (pw.a !== pw.b) { setPw((s) => ({ ...s, err: 'The two do not match.' })); return }
    setPw((s) => ({ ...s, busy: true, err: '' }))
    const { error } = await supabase.auth.updateUser({ password: pw.a })
    if (error) { setPw((s) => ({ ...s, busy: false, err: errText(error) })); return }
    setPw({ a: '', b: '', open: false, busy: false, err: '' })
    toast('Password changed')
  }
  return (
    <>
      <Box title="Who can see and reach me" note="My contacts: people you have a chat with.">
        {[['last_seen', 'Last Seen and Online'], ['photo', 'Profile Photo'], ['groups', 'Who Can Add Me to Groups'], ['calls', 'Who Can Call Me']].map(([k, l]) => (
          <div key={k} className="set-row set-col">
            <span className="set-text">{l}</span>
            <Lens className="seg" dep={priv[k] || 'everybody'}>{[['everybody', 'Everybody'], ['contacts', 'My contacts'], ['nobody', 'Nobody']].map(([v, t]) => <button key={v} type="button" className={(priv[k] || 'everybody') === v ? 'on' : ''} onClick={() => setPriv(k, v)}>{t}</button>)}</Lens>
          </div>
        ))}
      </Box>
      <Box title="Blocked users" note={blocks.length ? 'They cannot message or call you, or add you to groups.' : 'To block someone, open their profile from your chat with them.'}>
        {blocks.map((b) => (
          <div key={b.id} className="set-row">
            <Avatar src={b.avatar_url} name={nameOf(b)} size={36} />
            <span className="set-text">{nameOf(b)}<small>@{b.username}</small></span>
            <button type="button" className="btn btn-sm" onClick={() => unblock(b)}>Unblock</button>
          </div>
        ))}
        {!blocks.length && <div className="set-row"><span className="set-text muted">Nobody is blocked</span></div>}
      </Box>
      <Box title="Password">
        {!pw.open
          ? <Nav onClick={() => setPw((s) => ({ ...s, open: true }))}>Change Password</Nav>
          : (
            <div className="set-row set-col">
              <span className="set-text">New password</span>
              <input className="input" type="password" autoFocus value={pw.a} onChange={(e) => setPw((s) => ({ ...s, a: e.target.value }))} placeholder="At least 8 characters" autoComplete="new-password" />
              <input className="input" type="password" value={pw.b} onChange={(e) => setPw((s) => ({ ...s, b: e.target.value }))} placeholder="Once more" autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && save()} />
              {pw.err && <p className="auth-err">{pw.err}</p>}
              <span className="set-acts"><button type="button" className="btn" onClick={() => setPw({ a: '', b: '', open: false, busy: false, err: '' })}>Cancel</button><button type="button" className="btn btn-main" onClick={save} disabled={pw.busy}>{pw.busy ? '…' : 'Save'}</button></span>
            </div>
          )}
      </Box>
      <TwoStep toast={toast} />
      <Passcode toast={toast} />
      <Box title="Legal" note="No ads, no trackers, no selling of your data.">
        <Nav onClick={() => setLegal('privacy')}>{legalTitle('privacy')}</Nav>
        <Nav onClick={() => setLegal('terms')}>{legalTitle('terms')}</Nav>
      </Box>
      {legal && <Modal title={legalTitle(legal)} onClose={() => setLegal('')} wide><LegalDoc doc={legal} /></Modal>}
      <Box title="Account" note="Your profile, chats and pictures go for good. Messages you sent in groups stay, without your name.">
        {!gone.open
          ? <button type="button" className="set-row set-pick danger" onClick={() => setGone({ open: true, typed: '', busy: false })}><span className="set-text">Delete My Account</span></button>
          : (
            <div className="set-row set-col">
              <span className="set-text">Type your username to confirm<small>@{me.username}</small></span>
              <input className="input" autoFocus value={gone.typed} onChange={(e) => setGone((g) => ({ ...g, typed: e.target.value }))} placeholder={me.username} />
              <span className="set-acts"><button type="button" className="btn" onClick={() => setGone({ open: false, typed: '', busy: false })}>Cancel</button><button type="button" className="btn btn-danger" disabled={gone.typed.replace(/^@/, '') !== me.username || gone.busy} onClick={deleteMe}>{gone.busy ? '…' : 'Delete for good'}</button></span>
            </div>
          )}
      </Box>
    </>
  )
}

// how much room RoarMe's saved data takes on this device, and a way to empty what can be fetched again
function Storage({ toast }) {
  const [use, setUse] = useState(null)
  const look = () => navigator.storage?.estimate?.().then((e) => setUse(e?.usage ?? null)).catch(() => setUse(null))
  useEffect(() => { look() }, [])
  const clear = async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))) } catch { /* no cache storage here */ }
    try { sessionStorage.clear() } catch { /* private window */ }
    await look()
    toast?.('Cache cleared')
  }
  const mb = use == null ? '' : use > 1e9 ? `${(use / 1e9).toFixed(1)} GB` : `${Math.max(0.1, use / 1e6).toFixed(1)} MB`
  return (
    <Box title="Storage" note="What RoarMe keeps on this device to open faster. Your chats and files stay safe on the server.">
      <div className="set-row"><span className="set-text">Storage Usage</span><small className="set-val" data-raw="">{mb || '…'}</small></div>
      <button type="button" className="set-row set-pick" onClick={clear}><span className="set-text">Clear Cache<small>Frees the room; things load again when you open them</small></span></button>
    </Box>
  )
}
function Data({ p, toast }) {
  return (
    <>
      <Storage toast={toast} />
      <Box title="Sending">
        <Switch on={p.compress} set={(v) => setPrefs({ compress: v })} hint="Photos go smaller and faster. You can change it each time you send.">Compress Photos</Switch>
        <Switch on={p.largePhotos} set={(v) => setPrefs({ largePhotos: v })} hint="2560 px instead of 1600 px">Send Large Photos</Switch>
      </Box>
      <Box title="Automatic media download">
        <Switch on={p.dlPrivate !== false} set={(v) => setPrefs({ dlPrivate: v })} hint="Off: a photo or video loads when you tap it">In Private Chats</Switch>
        <Switch on={p.dlGroups !== false} set={(v) => setPrefs({ dlGroups: v })} hint="Off: a photo or video loads when you tap it">In Groups</Switch>
      </Box>
      <Box title="Auto-play media">
        <Switch on={p.autoplayVideos} set={(v) => setPrefs({ autoplayVideos: v })} hint="Silent, on a loop, as they come into view">Videos</Switch>
        <Switch on={p.autoplayGifs !== false} set={(v) => setPrefs({ autoplayGifs: v })} hint="Off: a GIF moves when you tap it">GIFs</Switch>
      </Box>
      <Box title="Other">
        <Switch on={p.pauseOnRec !== false} set={(v) => setPrefs({ pauseOnRec: v })} hint="A song or a voice message that is playing stops while you record">Pause Music While Recording</Switch>
        <Switch on={!!p.callLessData} set={(v) => setPrefs({ callLessData: v })} hint="Video calls go out smaller (360p), for weak networks. From your next call">Use Less Data for Calls</Switch>
      </Box>
    </>
  )
}

const deviceOf = (u = navigator.userAgent) => {
  u = u || ''
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Device'
  const br = /Electron\//.test(u) ? 'RoarMe app' : /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'
  return { os, br }
}
const ago = (iso) => {
  const m = (Date.now() - new Date(iso).getTime()) / 60000
  return m < 2 ? 'now' : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
}
function Sessions({ me, setMe, toast }) {
  const [list, setList] = useState(null)
  const load = async () => {
    const { data, error } = await supabase.rpc('roar_my_sessions')
    setList(error ? [] : data || [])
  }
  useEffect(() => { load() }, [])
  const here = (list || []).find((x) => x.current)
  const others = (list || []).filter((x) => !x.current)
  const endOne = async (x) => {
    const d = deviceOf(x.user_agent)
    if (!window.confirm(`Sign out ${d.os} · ${d.br}?`)) return
    const { error } = await supabase.rpc('roar_end_session', { sid: x.id })
    if (error) toast(errText(error)); else { toast('Signed out there'); load() }
  }
  const endOthers = async () => {
    if (!window.confirm('Sign out on every other device? This one stays signed in.')) return
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    toast(error ? errText(error) : 'All other devices are signed out')
    load()
  }
  const days = Number(me.privacy?.session_days) || 180
  const setDays = async (v) => { const e = await saveMe(me, setMe, { privacy: { ...(me.privacy || {}), session_days: v } }); toast(e || 'Saved') }
  const row = (x, mine) => {
    const d = deviceOf(x?.user_agent)
    return (
      <div key={x?.id || 'here'} className="set-row set-dev">
        <span className="nav-ico" style={{ '--c': mine ? '#0a84ff' : '#636366' }}>{svg(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>, 16)}</span>
        <span className="set-text"><b>{d.os} · {d.br}</b><small>{[x?.ip, x && !mine ? `active ${ago(x.last_active)}` : ''].filter(Boolean).join(' · ') || ' '}</small></span>
        {mine ? <small className="set-online">online</small> : <button type="button" className="btn btn-sm btn-danger" onClick={() => endOne(x)}>Sign out</button>}
      </div>
    )
  }
  return (
    <>
      <Box title="This device">
        {row(here || null, true)}
        {others.length > 0 && <button type="button" className="set-row set-pick danger" onClick={endOthers}><span className="set-text">Terminate All Other Sessions<small>Signs you out everywhere except here</small></span></button>}
      </Box>
      <Box title="Active sessions">
        {list === null && <div className="set-row"><span className="set-text muted">Loading…</span></div>}
        {list && !others.length && <div className="set-row"><span className="set-text muted">No other devices</span></div>}
        {others.map((x) => row(x, false))}
      </Box>
      <Box title="Sign out old devices by itself" note="A device that has not opened RoarMe for this long is signed out by itself.">
        <div className="set-row set-col">
          <span className="set-text">If Inactive For</span>
          <Lens className="seg" dep={days}>{[[30, '1 month'], [90, '3 months'], [180, '6 months'], [365, '1 year']].map(([v, t]) => <button key={v} type="button" className={days === v ? 'on' : ''} onClick={() => setDays(v)}>{t}</button>)}</Lens>
        </div>
      </Box>
    </>
  )
}

// what Reset Appearance puts back
const LOOK_KEYS = ['theme', 'mode', 'accent', 'accentHex', 'myBubble', 'theirBubble', 'bubbleR', 'chatTheme', 'font', 'textSize', 'uiText', 'listPanel', 'listPanelOp', 'listPanelFill', 'listPanelGrain', 'density', 'radius', 'compact', 'background', 'appBackground', 'appWallStrength', 'accentOpacity', 'wallStrength', 'glassBubbles', 'motion', 'focusRings', 'lite']
const hasChatWalls = () => { try { return Object.keys(JSON.parse(localStorage.getItem('roarme-walls') || '{}')).length > 0 } catch { return false } }
/* Chat Theme (Alex, 9 Nov): ready-made ones, one's own colours for the messages and the accent, and the message corners */
function ChatTheme({ p }) {
  const [editing, setEditing] = useState(false)
  return (
    <Box title="Chat theme" note="Your own colours for the messages. The wallpaper is below.">
      {/* the ready-made chat themes are gone (Alex, 12 Nov); one's own colours stay, and one tap goes back to the theme's */}
      {(p.chatTheme || p.myBubble || p.theirBubble || p.accentHex) && (
        <button type="button" className="set-row set-pick" onClick={() => setPrefs({ chatTheme: '', myBubble: '', theirBubble: '', accentHex: '' })}>
          <span className="set-text">Back to the Theme's Own<small>The theme's own colours for the messages</small></span>
        </button>
      )}
      <button type="button" className="set-row set-pick set-nav" onClick={() => setEditing(true)}>
        <span className="set-text">{haloish(p.theme) ? 'Message Colours' : 'Edit Your Theme'}<small>{haloish(p.theme) ? 'Your own colours for your messages and theirs' : 'Background, accent and the colour of the messages'}</small></span>
        <span className="te-dots"><i style={{ background: p.myBubble || '#2a2a2c' }} /><i style={{ background: p.theirBubble || '#ffffff' }} /><i style={{ background: p.accentHex || 'var(--accent)' }} /></span>
        <i className="set-chev">{I.right}</i>
      </button>
      {editing && <ThemeEditor p={p} onClose={() => setEditing(false)} />}
      <div className="set-row set-col">
        <span className="set-text">Message Corners<small>{p.bubbleR ? (p.bubbleR <= 1 ? 'Square' : `${p.bubbleR} px`) : "The theme's own"}</small></span>
        {/* square at the left end, round at the right (Alex, 12 Nov); the theme's own corners are a button of their own */}
        <Slide min={1} max={25} step={1} value={p.bubbleR || 17} onChange={(n) => setPrefs({ bubbleR: n })} aria-label="Message Corners" />
        <span className="range-labels"><small>Square</small><small>Round</small></span>
        {!!p.bubbleR && <button type="button" className="pill-btn corners-own" onClick={() => setPrefs({ bubbleR: 0 })}>Theme's Own</button>}
      </div>
    </Box>
  )
}

// the size of every letter in RoarMe (Alex, 13 Nov): the number follows the hand, the app changes when the hand lets go,
// so the slider does not move under the finger while it is dragged
function AppTextSize({ p }) {
  const at = Math.min(130, Math.max(85, Number(p.uiText) || 100))
  const [v, setV] = useState(at)
  useEffect(() => setV(at), [at])
  return (
    <div className="set-row set-col">
      <span className="set-text">App Text Size<small>{`${v}%`}</small><small>All of RoarMe's letters; it changes when you let go</small></span>
      <div className="set-size">
        <small>A</small>
        <Slide min={85} max={130} step={5} value={at} onChange={setV} onDone={(n) => setPrefs({ uiText: n })} aria-label="App Text Size" />
        <b>A</b>
      </div>
    </div>
  )
}

function Appearance({ p, toast, me, setMe }) {
  const look = wallLook(p.background, useWalls(true), p.wallStrength)
  const listLook = wallLook(p.appBackground || p.background, useWalls(true), p.appBackground ? p.appWallStrength ?? p.wallStrength : p.wallStrength)
  const pickName = (c) => saveMe(me, setMe, { name_color: c }).then((e) => toast(e || 'Saved'))
  const menuPv = <div className="pv-menu" aria-hidden="true"><span>{FOOT_I.contacts}<b>Contacts</b></span><span>{FOOT_I.calls}<b>Calls</b></span><span className="on">{FOOT_I.messages}<b>Messages</b></span><span>{FOOT_I.settings}<b>Settings</b></span></div>
  // Colours: one message of yours, the Send button and the menu, the three places the accent shows
  const colourPv = (
    <div className="pv-wrap" aria-hidden="true">
      <div className="set-preview live pv-short" data-bg={look['data-bg']} data-img={look['data-img']} data-own={look['data-own']} data-wop={look['data-wop']} style={look.style}>
        <span className="pv mine">Yes, on set at 10 👍</span>
        <span className="pv-compose"><span>Write a message…</span><i /></span>
      </div>
      {menuPv}
    </div>
  )
  // Messages: a little chat with the wallpaper, the message colours and corners, the text size and Compact Messages
  const chatPv = (
    <div className={`set-preview live${p.compact ? ' compact' : ''}`} aria-hidden="true" data-bg={look['data-bg']} data-img={look['data-img']} data-own={look['data-own']} data-wop={look['data-wop']} style={{ '--fs': `${TEXT_SIZES[p.textSize] || 14.5}px`, ...look.style }}>
      <span className="pv-head"><i className="pv-ava">GK</i><span><b>Giorgos</b><small>online</small></span></span>
      <span className="pv">Are we shooting at 10?</span>
      <span className="pv mine"><i>Are we shooting at 10?</i>Yes, on set at 10 👍</span>
      <span className="pv mine">Bring the lights 💡</span>
      <span className="pv-compose"><span>Write a message…</span><i /></span>
    </div>
  )
  // the chat list on the app's background, with the real rows' classes so the panel's own rules draw it; with the
  // menu under it, it is the whole app in small
  const listPv = (n, menu) => (
    <div className="set-preview lp-prev" aria-hidden="true" data-bg={listLook['data-bg']} data-img={listLook['data-img']} data-own={listLook['data-own']} data-wop={listLook['data-wop']} style={listLook.style}>
      <div className="rooms-pager"><div className="rooms">
        {[['Giorgos Kanellos', '10:42', 'On set at 10, bring the lights', 2], ['Film Crew', '09:15', 'Maria: the call sheet is ready', 0], ['Eleni Marou', 'Tue', 'See you at the edit', 0]].slice(0, n).map(([nm, tm, m, u]) => (
          <div key={nm} className="room">
            <Avatar name={nm} size={54} />
            <span className="room-main">
              <span className="room-top"><strong>{nm}</strong><small data-raw="">{tm}</small></span>
              <span className="room-bottom"><span className="room-prev">{m}</span>{u > 0 && <span className="badge">{u}</span>}</span>
            </span>
          </div>
        ))}
      </div></div>
      {menu && menuPv}
    </div>
  )
  return (
    <>
      {/* grouped by what is being changed, each group with its own preview right where the hand is (Alex, 13 Nov:
          "group everything as it should be, and whatever I change I see a preview at the place I change it"); the one
          preview stuck to the top of the page (12 Nov) is gone */}
      <h3 className="set-group">Colours</h3>
      <Box>
        {colourPv}
        <div className="set-row set-col">
          <span className="set-text">Day and Night<small>Auto follows the device: light by day, dark at night if the device does so</small></span>
          <Lens className="seg" dep={`${p.mode}${p.theme}`}>{[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => <button key={k} type="button" className={p.mode === k ? 'on' : ''} onClick={(e) => revealFrom(e, () => { applyMode(k)(); setPrefs({ mode: k }) })}>{l}</button>)}</Lens>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Accent Colour<small>{p.accent ? (haloish(p.theme) ? HALO_ACCENTS : ACCENTS).find(([k]) => k === p.accent)?.[1] || "The theme's own colour" : "The theme's own colour"}</small></span>
          {haloish(p.theme)
            ? (
              // Halo's own palette (Alex, 12 Nov): the orange it is made with and five colours, each with its gradient
              <div className="accents halo-accents">
                <button type="button" className={`acc acc-halo${!HALO_ACCENTS.some(([k]) => k === p.accent) ? ' on' : ''}`} style={{ '--c': '#f47318', background: 'linear-gradient(135deg, #ff9a3c, #f47318)' }} title="Orange" onClick={() => setPrefs({ accent: '', accentHex: '' })}><small>Orange</small></button>
                {HALO_ACCENTS.map(([k, l, c, , [a, b]]) => <button key={k} type="button" className={`acc acc-halo${p.accent === k ? ' on' : ''}`} style={{ '--c': c, background: `linear-gradient(135deg, ${a}, ${b})` }} title={l} onClick={() => setPrefs({ accent: k, accentHex: '' })}><small>{l}</small></button>)}
              </div>
            )
            : (
              <div className="accents">
                <button type="button" className={`acc acc-auto${!p.accent ? ' on' : ''}`} title="Theme colour" onClick={() => setPrefs({ accent: '', accentHex: '' })}><small>Theme</small></button>
                {ACCENTS.map(([k, l, c]) => <button key={k} type="button" className={`acc${p.accent === k ? ' on' : ''}${k === 'white' ? ' acc-white' : k === 'black' ? ' acc-black' : ''}`} style={{ '--c': c }} title={l} onClick={() => setPrefs({ accent: k, accentHex: '' })}><small>{l}</small></button>)}
              </div>
            )}
        </div>
        <div className="set-row set-col">
          <span className="set-text">Accent Opacity<small>{`${Math.min(100, Math.max(30, Number(p.accentOpacity) || 100))}%`}</small><small>Lower lets the wallpaper through your messages and the coloured buttons</small></span>
          <Slide min={30} max={100} step={1} value={Math.min(100, Math.max(30, Number(p.accentOpacity) || 100))} onChange={(n) => setPrefs({ accentOpacity: n })} aria-label="Accent Opacity" />
        </div>
        <Switch on={p.glassBubbles !== false} set={(v) => setPrefs({ glassBubbles: v })} hint="Your messages and the buttons see-through, with a thin edge in your colour. Off: filled with your colour">Glass Look</Switch>
      </Box>
      <h3 className="set-group">Messages</h3>
      {chatPv}
      <ChatTheme p={p} />
      <Box title="Text and spacing">
        <div className="set-row set-col">
          <span className="set-text">Message Text Size<small>{`${TEXT_SIZES[p.textSize] || 14.5} px`}</small></span>
          <div className="set-size">
            <small>A</small>
            <Slide min={0} max={TEXT_SIZES.length - 1} step={1} value={p.textSize} onChange={(n) => setPrefs({ textSize: n })} aria-label="Text Size" />
            <b>A</b>
          </div>
        </div>
        <Switch on={p.compact} set={(v) => setPrefs({ compact: v })} hint="Messages in a chat sit closer together">Compact Messages</Switch>
      </Box>
      <Box title="Chat wallpaper" note="Pick one, any colour, or a photo of your own. One chat can have its own from its ⋯ menu > Change Wallpaper.">
        <div className="set-row set-col"><WallTiles value={p.background} toast={toast} onPick={(k) => setPrefs({ background: k })} /></div>
      </Box>
      <h3 className="set-group">Chat List</h3>
      <Box title="Panel" note="The sheet of glass the chats stand on in the list.">
        {listPv(3, false)}
        <Switch on={p.listPanel !== false} set={(v) => setPrefs({ listPanel: v })} hint="Off, the chats stand straight on the background">Panel Behind the Chats</Switch>
        {p.listPanel !== false && (
          <div className="set-row set-col">
            <span className="set-text">Panel Opacity<small>{`${Math.min(100, Math.max(0, Number(p.listPanelOp ?? 50)))}%`}</small></span>
            <Slide min={0} max={100} step={1} value={Math.min(100, Math.max(0, Number(p.listPanelOp ?? 50)))} onChange={(n) => setPrefs({ listPanelOp: n })} aria-label="Panel Opacity" />
          </div>
        )}
        {p.listPanel !== false && (
          <div className="set-row set-col">
            <span className="set-text">Panel Colour<small>{p.listPanelFill === 'orange' ? 'Orange' : HALO_ACCENTS.find(([k]) => k === p.listPanelFill)?.[1] || 'Plain glass'}</small></span>
            <div className="accents halo-accents">
              <button type="button" className={`acc acc-halo acc-plain${!p.listPanelFill ? ' on' : ''}`} style={{ '--c': '#b9b9c6', background: 'linear-gradient(135deg, #ffffff, #d9d9e2)' }} title="Plain glass" onClick={() => setPrefs({ listPanelFill: '' })}><small>Plain glass</small></button>
              <button type="button" className={`acc acc-halo${p.listPanelFill === 'orange' ? ' on' : ''}`} style={{ '--c': '#f47318', background: 'linear-gradient(135deg, #ff9a3c, #f47318)' }} title="Orange" onClick={() => setPrefs({ listPanelFill: 'orange' })}><small>Orange</small></button>
              {HALO_ACCENTS.map(([k, l, c, , [a, b]]) => <button key={k} type="button" className={`acc acc-halo${p.listPanelFill === k ? ' on' : ''}`} style={{ '--c': c, background: `linear-gradient(135deg, ${a}, ${b})` }} title={l} onClick={() => setPrefs({ listPanelFill: k })}><small>{l}</small></button>)}
            </div>
          </div>
        )}
        {p.listPanel !== false && <Switch on={!!p.listPanelGrain} set={(v) => setPrefs({ listPanelGrain: v })} hint="A fine grain over the panel">Panel Texture</Switch>}
        <div className="set-row set-col">
          <span className="set-text">Spacing<small>How much room the chat list, menus and settings get</small></span>
          <Lens className="seg" dep={p.density || 'standard'}>{[['relaxed', 'Relaxed'], ['standard', 'Standard'], ['tight', 'Tight']].map(([k, l]) => <button key={k} type="button" className={(p.density || 'standard') === k ? 'on' : ''} onClick={() => setPrefs({ density: k })}>{l}</button>)}</Lens>
        </div>
      </Box>
      <h3 className="set-group">The Whole App</h3>
      {haloish(p.theme) && (
        <Box title="App background" note="What sits behind the chat list, Contacts, Calls and Settings: a wallpaper, any colour or your own photo, with a strength of its own.">
          {listPv(2, true)}
          <Switch on={!p.appBackground} set={(v) => setPrefs({ appBackground: v ? '' : p.background || 'soft' })} hint="The app wears the chat wallpaper above">Same as Chats</Switch>
          {!!p.appBackground && <div className="set-row set-col"><WallTiles value={p.appBackground} toast={toast} onPick={(k) => setPrefs({ appBackground: k })} strength={p.appWallStrength ?? p.wallStrength} onStrength={(n) => setPrefs({ appWallStrength: n })} /></div>}
        </Box>
      )}
      <Box title="Text">
        <AppTextSize p={p} />
        <div className="set-row set-col">
          <span className="set-text">Font<small>DM Sans and Space Grotesk have no Greek letters; Greek in them is shown in the device's own font</small></span>
          <select className="input set-select" value={p.font || 'system'} onChange={(e) => setPrefs({ font: e.target.value })}>{FONTS.map(([k, l, f]) => <option key={k} value={k} style={{ fontFamily: f }}>{l}</option>)}</select>
        </div>
      </Box>
      <h3 className="set-group">More</h3>
      <Box title="Effects">
        <Switch on={p.motion !== false} set={(v) => setPrefs({ motion: v })} hint={p.lite ? 'Off while Power Saving Mode is on' : 'Fluid transitions for messages, menus and windows'}>Smooth Animations</Switch>
        <Switch on={p.focusRings} set={(v) => setPrefs({ focusRings: v })} hint="A clear ring around whatever the keyboard is on">Bold Focus Rings</Switch>
        <Switch on={p.lite} set={(v) => setPrefs({ lite: v })} hint="No animations and no glass blur, easier on the battery">Power Saving Mode</Switch>
      </Box>
      <Box title="Your name in groups">
        <div className="set-preview live pv-short pv-nocompose" aria-hidden="true" data-bg={look['data-bg']} data-img={look['data-img']} data-own={look['data-own']} data-wop={look['data-wop']} style={look.style}>
          <span className="pv"><b className="pv-name" data-raw="" style={{ color: me.name_color || colorOf(me.id) }}>{nameOf(me)}</b>Are we shooting at 10?</span>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Name Colour<small>How your name shows to others in groups</small></span>
          <div className="accents">
            <button type="button" className={`acc acc-auto${!me.name_color ? ' on' : ''}`} title="Automatic" onClick={() => pickName('')}><small>Auto</small></button>
            {/* the second, lighter green is not offered (Alex, 12 Nov); names still take it by themselves */}
            {NAME_COLORS.filter((c) => c !== '#aed581').map((c) => <button key={c} type="button" className={`acc${me.name_color === c ? ' on' : ''}`} style={{ '--c': c }} onClick={() => pickName(c)}><small>{c}</small></button>)}
          </div>
        </div>
      </Box>
      {/* the look back to how RoarMe starts (Alex, 9 Nov): theme, day and night, accent, text, wallpaper, layout and
          effects; every chat's own wallpaper goes too. Nothing else: chats, folders, sounds and the rest stay */}
      <Box note="Theme, day and night, accent, text, wallpaper, layout and effects go back to how RoarMe starts. Each chat's own wallpaper goes too.">
        <button type="button" className="set-row set-pick danger" disabled={LOOK_KEYS.every((k) => JSON.stringify(p[k]) === JSON.stringify(DEFAULTS[k])) && !hasChatWalls()} onClick={() => {
          if (!window.confirm('Reset the look of RoarMe on this device?')) return
          setPrefs(Object.fromEntries(LOOK_KEYS.map((k) => [k, DEFAULTS[k]])))
          try { localStorage.removeItem('roarme-walls') } catch { /* private window */ }
          toast('The look is back to how RoarMe starts')
        }}><span className="set-text">Reset Appearance</span></button>
      </Box>
    </>
  )
}

function Language({ p }) {
  const ui = p.lang === 'el' ? 'el' : 'en'
  const setUi = (k) => { if (k === ui) return; setPrefs({ lang: k }); setTimeout(() => window.location.reload(), 150) }
  return (
    <>
      <Box title="Interface language" note="RoarMe restarts in the language you pick.">
        {UI_LANGS.map(([k, a, b]) => <Check key={k} on={ui === k} onClick={() => setUi(k)}><span data-raw="">{b}</span><small data-raw="">{a}</small></Check>)}
      </Box>
    </>
  )
}

/* the ready-made folders: name, icon, what they hold. They can be renamed, and all but All deleted (Alex, 16 Oct) */
const READY_FOLDERS = {
  all: ['All', I.chats, 'Every chat'],
  unread: ['Unread', I.unread, 'Chats with unread messages'],
  groups: ['Groups', I.people, 'Every group'],
  archived: ['Archived', I.archive, 'Chats you archived'],
}
function ReadyFolderEdit({ id, p, onDone, toast }) {
  const [name, setName] = useState(p.folderNames?.[id] || READY_FOLDERS[id][0])
  const keep = (v) => {
    setName(v)
    const names = { ...(p.folderNames || {}) }
    if (v.trim() && v.trim() !== READY_FOLDERS[id][0]) names[id] = v.trim(); else delete names[id]
    setPrefs({ folderNames: names })
  }
  const remove = () => {
    if (!window.confirm(`Delete the folder ${name.trim() || READY_FOLDERS[id][0]}? The chats in it stay.`)) return
    setPrefs({ hiddenFolders: [...new Set([...(p.hiddenFolders || []), id])] })
    toast?.('Folder deleted')
    onDone()
  }
  return (
    <>
      <Box title="Folder name" note={`A ready-made folder: ${READY_FOLDERS[id][2].toLowerCase()}.`}>
        <div className="set-row"><input className="fold-name" value={name} onChange={(e) => keep(e.target.value)} placeholder={READY_FOLDERS[id][0]} maxLength={40} /></div>
      </Box>
      {id !== 'all' && (
        <Box note="It can be brought back from Recommended folders.">
          <button type="button" className="set-row set-pick danger" onClick={remove}><span className="set-text">Delete Folder</span></button>
        </Box>
      )}
    </>
  )
}

/* One folder, like Telegram's folder settings (Alex, 16 Oct): its name, the chats and kinds of chats it
   includes, the chats it leaves out, and Delete. Every change is kept at once; a new folder is kept as soon
   as it has a name. */
function FolderEdit({ id, kit, onDone, toast }) {
  const [fid] = useState(() => (id === 'new' ? crypto.randomUUID() : id))
  const saved = kit.folders.find((f) => f.id === fid)
  const [draft, setDraft] = useState(() => (saved ? { exclude: [], types: {}, ...saved } : { id: fid, name: '', rooms: kit.seed || [], exclude: [], types: {} }))
  const [pick, setPick] = useState('') // 'in' | 'out': the chats picker
  const [q, setQ] = useState('')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; if (saved) return }
    if (!draft.name.trim()) return
    const clean = { ...draft, name: draft.name.trim() }
    kit.setFolders((list) => (list.some((f) => f.id === fid) ? list.map((f) => (f.id === fid ? clean : f)) : [...list, clean]))
  }, [draft])
  if (id !== 'new' && !saved) return <p className="muted">This folder is gone.</p>
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const roomOf = (rid) => kit.rooms.find((r) => r.room_id === rid)
  const types = draft.types || {}
  const flipChat = (rid, side) => {
    const inn = draft.rooms.includes(rid), out = draft.exclude.includes(rid)
    if (side === 'in') set({ rooms: inn ? draft.rooms.filter((x) => x !== rid) : [...draft.rooms, rid], exclude: draft.exclude.filter((x) => x !== rid) })
    else set({ exclude: out ? draft.exclude.filter((x) => x !== rid) : [...draft.exclude, rid], rooms: draft.rooms.filter((x) => x !== rid) })
  }
  const remove = () => {
    if (!saved && !draft.name.trim()) { onDone(); return }
    if (!window.confirm(`Delete the folder ${draft.name.trim() || ''}? The chats in it stay.`)) return
    kit.setFolders((list) => list.filter((f) => f.id !== fid))
    kit.onDeleted?.(fid)
    toast?.('Folder deleted')
    onDone()
  }
  const chatRow = (rid, side) => {
    const r = roomOf(rid)
    if (!r) return null
    return (
      <div key={rid} className="set-row fold-chat">
        {kit.face(r, 32)}
        <span className="set-text" data-raw="">{kit.titleOf(r)}</span>
        <button type="button" className="fold-x" onClick={() => flipChat(rid, side)} aria-label="Remove" title="Remove">{I.x}</button>
      </div>
    )
  }
  const typeRow = (k, label, ico) => (
    <div key={k} className="set-row fold-chat">
      <span className="fold-type">{ico}</span>
      <span className="set-text">{label}</span>
      <button type="button" className="fold-x" onClick={() => set({ types: { ...types, [k]: false } })} aria-label="Remove" title="Remove">{I.x}</button>
    </div>
  )
  const t = q.trim()
  const list = kit.rooms.filter((r) => !t || foldHas(kit.titleOf(r), t))
  return (
    <>
      <Box title="Folder name">
        <div className="set-row"><input className="fold-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Folder name" autoFocus={!saved} maxLength={40} /></div>
      </Box>
      <Box title="Included chats" note="Choose chats or types of chats that will appear in this folder.">
        <button type="button" className="set-row set-pick set-add" onClick={() => { setQ(''); setPick('in') }}><i className="fold-plus">{I.plus}</i><span className="set-text">Add Chats</span></button>
        {types.private && typeRow('private', 'Private chats', I.person)}
        {types.groups && typeRow('groups', 'Groups', I.people)}
        {draft.rooms.map((rid) => chatRow(rid, 'in'))}
      </Box>
      <Box title="Excluded chats" note="Chats that never appear in this folder, even when their type is included.">
        <button type="button" className="set-row set-pick set-add" onClick={() => { setQ(''); setPick('out') }}><i className="fold-plus">{I.plus}</i><span className="set-text">Add Chats</span></button>
        {draft.exclude.map((rid) => chatRow(rid, 'out'))}
      </Box>
      <Box>
        <button type="button" className="set-row set-pick danger" onClick={remove}><span className="set-text">{saved ? 'Delete Folder' : 'Cancel'}</span></button>
      </Box>
      {pick && (
        <Modal title={pick === 'in' ? 'Included chats' : 'Excluded chats'} onClose={() => setPick('')} foot={<button type="button" className="btn btn-main" onClick={() => setPick('')}>Done</button>}>
          <input className="input fold-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" autoFocus />
          {pick === 'in' && !t && (
            <>
              <p className="fold-pick-h">Chat types</p>
              <div className="people">
                {[['private', 'Private chats', I.person], ['groups', 'Groups', I.people]].map(([k, l, ico]) => (
                  <button key={k} type="button" className="person" onClick={() => set({ types: { ...types, [k]: !types[k] } })}>
                    <span className="fold-type">{ico}</span><span className="person-text"><b>{l}</b></span><span className={`tick${types[k] ? ' on' : ''}`} />
                  </button>
                ))}
              </div>
              <p className="fold-pick-h">Chats</p>
            </>
          )}
          <div className="people">
            {list.map((r) => {
              const on = (pick === 'in' ? draft.rooms : draft.exclude).includes(r.room_id)
              return (
                <button key={r.room_id} type="button" className="person" onClick={() => flipChat(r.room_id, pick)}>
                  {kit.face(r, 40)}
                  <span className="person-text"><b data-raw="">{kit.titleOf(r)}</b><small>{r.kind === 'group' ? 'Group' : 'Private chat'}</small></span>
                  <span className={`tick${on ? ' on' : ''}`} />
                </button>
              )
            })}
            {!list.length && <p className="muted">Nothing found.</p>}
          </div>
        </Modal>
      )}
    </>
  )
}

/* Drag a folder up or down to change the order of the tabs; a right click on one opens Edit / Delete
   (Alex, 16 Oct). The order is kept in prefs.folderOrder and the chat list's tabs follow it. */
function Folders({ p, folders, onFolders, onFolderMenu }) {
  const [list, setList] = useState(folders)
  const listRef = useRef(list)
  listRef.current = list
  const key = folders.map((f) => `${f.id}:${f.name}:${f.rooms?.length || 0}`).join('|')
  useEffect(() => { if (!drag.current?.moved) setList(folders) }, [key])
  const drag = useRef(null)
  const rowsRef = useRef(null)
  const [dragId, setDragId] = useState('')
  const [dy, setDy] = useState(0)
  useEffect(() => { if (drag.current) drag.current.lock = false }, [list]) // a swap waits for the rows to move
  // slide a folder to the left and Delete shows behind it, like Telegram (Alex, 21 Oct); All cannot go
  const [swipe, setSwipe] = useState({ id: '', x: 0, open: false })
  const DEL_W = 88
  const down = (e, f) => {
    if (e.button !== 0) return
    if (swipe.open && swipe.id !== f.id) setSwipe({ id: '', x: 0, open: false })
    const base = swipe.open && swipe.id === f.id ? -DEL_W : 0
    drag.current = { id: f.id, y0: e.clientY, x0: e.clientX, moved: false, side: false, base }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      let off = ev.clientY - d.y0
      const sx = ev.clientX - d.x0
      if (d.side) { ev.preventDefault(); setSwipe({ id: d.id, x: Math.max(-DEL_W - 30, Math.min(0, d.base + sx)), open: false }); return }
      if (!d.moved && f.id !== 'all' && Math.abs(sx) > 8 && Math.abs(sx) > Math.abs(off) * 1.2) { d.side = true; d.moved = true; return }
      if (!d.moved) { if (Math.abs(off) < 6) return; d.moved = true; setDragId(d.id) }
      ev.preventDefault()
      if (d.lock) { setDy(off); return }
      // pass a neighbour's middle and the two swap places
      const rows = [...(rowsRef.current?.querySelectorAll('[data-fid]') || [])]
      const at = rows.findIndex((r) => r.dataset.fid === d.id)
      const next = rows[at + 1], prev = rows[at - 1]
      if ((next && off > next.offsetHeight / 2) || (prev && off < -prev.offsetHeight / 2)) d.lock = true
      if (next && off > next.offsetHeight / 2) { d.y0 += next.offsetHeight; off -= next.offsetHeight; setList((l) => { const n = [...l]; const i = n.findIndex((x) => x.id === d.id); [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n }) }
      else if (prev && off < -prev.offsetHeight / 2) { d.y0 -= prev.offsetHeight; off += prev.offsetHeight; setList((l) => { const n = [...l]; const i = n.findIndex((x) => x.id === d.id); [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n }) }
      setDy(off)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      const d = drag.current
      setDragId(''); setDy(0)
      if (d?.side) {
        setSwipe((w) => (w.x < -DEL_W / 2 ? { id: d.id, x: -DEL_W, open: true } : { id: '', x: 0, open: false }))
        setTimeout(() => { drag.current = null }, 0)
        return
      }
      if (d?.moved) {
        setPrefs({ folderOrder: listRef.current.map((x) => x.id) })
        setTimeout(() => { drag.current = null }, 0) // the click that ends a drag opens nothing
      } else drag.current = null
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  return (
    <>
      <Box title="Folders" note={onPhone() ? 'Drag a folder to change the order of the tabs. Tap one to edit it.' : 'Drag a folder to change the order of the tabs. Click one to edit it, right click for more.'}>
        <div ref={rowsRef} className="fold-rows">
        {list.map((f) => {
          const sx = swipe.id === f.id ? swipe.x : 0
          return (
          <div key={f.id} data-fid={f.id} className={`fold-swipe${dragId === f.id ? ' dragging' : ''}`} style={dragId === f.id ? { transform: `translateY(${dy}px)` } : undefined}>
          {sx < 0 && <button type="button" className="fold-del" style={{ width: Math.max(DEL_W, -sx) }} onClick={() => { setSwipe({ id: '', x: 0, open: false }); onFolders(`delete:${f.id}`) }}>{I.trash}<span>Delete</span></button>}
          <button type="button" className={`set-row set-pick fold-row${f.custom ? '' : ' set-fixed'}${dragId === f.id ? ' dragging' : ''}`} style={sx ? { transform: `translateX(${sx}px)`, transition: drag.current?.side ? 'none' : undefined } : undefined}
            onPointerDown={(e) => down(e, f)}
            onContextMenu={(e) => { e.preventDefault(); onFolderMenu?.(f, e) }}
            onClick={() => { if (drag.current?.moved) return; if (swipe.open) { setSwipe({ id: '', x: 0, open: false }); return } onFolders(`folder:${f.id}`) }}>
            <span className="fold-grip" aria-hidden="true">{svg(<><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>)}</span>
            <span className="fold-ico">{f.id === 'all' ? I.chats : f.id === 'unread' ? I.unread : f.id === 'groups' ? I.people : f.id === 'archived' ? I.archive : I.folder}</span>
            <span className="set-text">{f.name}{f.custom && <small>{`${f.rooms.length} chat${f.rooms.length === 1 ? '' : 's'}`}</small>}</span>
            {f.custom && <><i className="fold-dot" style={{ background: colorOf(f.id) }} /><i className="set-chev">{I.right}</i></>}
          </button>
          </div>
          )
        })}
        </div>
        <button type="button" className="set-row set-pick set-add" onClick={() => onFolders('newfolder')}><span className="set-text">Add a Custom Folder</span><i className="set-chev">{I.right}</i></button>
      </Box>
      {(p.hiddenFolders || []).length > 0 && (
        <Box title="Recommended folders" note="Ready-made folders you deleted. Add one to bring it back.">
          {(p.hiddenFolders || []).filter((id) => READY_FOLDERS[id]).map((id) => (
            <div key={id} className="set-row">
              <span className="fold-ico">{READY_FOLDERS[id][1]}</span>
              <span className="set-text">{p.folderNames?.[id] || READY_FOLDERS[id][0]}<small>{READY_FOLDERS[id][2]}</small></span>
              <button type="button" className="btn btn-sm" onClick={() => setPrefs({ hiddenFolders: (p.hiddenFolders || []).filter((x) => x !== id) })}>Add</button>
            </div>
          ))}
        </Box>
      )}
      <Box><Switch on={!!p.folderAlone} set={(v) => setPrefs({ folderAlone: v })} hint="An unread chat shows only in Unread, a chat you put in a folder only there, a group only in Groups; All keeps the rest">Each Chat in One Folder</Switch></Box>
      <Box><Switch on={p.folderTags} set={(v) => setPrefs({ folderTags: v })} hint="The folder names of each chat, in the chat list">Show Folder Tags</Switch></Box>
    </>
  )
}
