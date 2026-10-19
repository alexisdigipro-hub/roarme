import { useEffect, useRef, useState } from 'react'
import { errText, nameOf, supabase } from './lib.js'
import { Avatar, I, Lens, Modal, NAME_COLORS, Wordmark, colorOf, revealFrom, svg } from './ui.jsx'
import { ACCENTS, DEFAULTS, FONTS, PUBLIC_THEMES, REACTIONS, SOUNDS, TEXT_SIZES, applyMode, chime, inThemeLab, setPrefs, usePrefs } from './prefs.js'
import { WallTiles } from './extras.jsx'
import { LegalDoc, legalTitle } from './legal.jsx'
import { checkCode, clearLock, getLock, lockNow, setLockAfter, setLockCode } from './lock.jsx'
import { LANGS as UI_LANGS, lang, locale } from './i18n.js'
import { Admin } from './admin.jsx'
import { badgeSupported, isIOS, isStandalone, onPhone, pushIsOn, pushOff, pushOn, pushSupported, pushTest } from './push.js'
import { InstallGuide, appVersion, fetchLatest, startDownload, thisComputer, useAppUpdate } from './update.jsx'

/* Settings as in Telegram (Alex, 16 Oct): a list on the left, the chosen page on the right.
   Anything that needs the database is shown switched off with "Coming soon".
   Tidied on 19 Oct (Alex: "more beautiful, better organised"): the pages in groups, a Chats page for how
   messages are typed and read, every page opening with its icon and one line on what it holds. */

// id, title, colour, icon, the line under the icon at the top of the page, the group in the list
export const PAGES = [
  ['general', 'General', '#8e8e93', svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>, 16), 'The RoarMe app, calls and the basics.', 1],
  ['chats', 'Chats', '#5e5ce6', svg(<path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z" />, 16), 'How you type, send and read messages.', 1],
  ['appearance', 'Appearance', '#40c8e0', svg(<><path d="M14.5 4.5l5 5L11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5.5 5-1 1.5-3 0-4" /></>, 16), 'Theme, colours, text and wallpaper.', 1],
  ['notify', 'Notifications and Sounds', '#ff453a', svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 16), 'What reaches you, and how it sounds.', 1],
  ['language', 'Language', '#bf5af2', svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>, 16), 'The language of RoarMe and of translations.', 1],
  ['folders', 'Chat Folders', '#a78bfa', I.folder, 'Create folders for different groups of chats and quickly switch between them.', 2],
  ['autoreply', 'Auto-Reply', '#64d2ff', svg(<><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v5h-5" /><path d="M8.5 12.5h7M8.5 9.5h4" /></>, 16), 'An answer that goes out by itself while you are busy.', 2],
  ['data', 'Data and Storage', '#30d158', svg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>, 16), 'How photos are sent and what loads by itself.', 2],
  ['privacy', 'Privacy and Security', '#0a84ff', svg(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>, 16), 'Who sees what, and how your account stays safe.', 3],
  ['sessions', 'Active Sessions', '#ff9f0a', svg(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>, 16), 'Every device signed in to your account.', 3],
]
export const pageTitle = (id) => (id === 'folder:new' ? 'New Folder' : id?.startsWith('folder:') ? 'Edit Folder' : id === 'profile' ? 'My Profile' : id === 'keys' ? 'Keyboard Shortcuts' : id === 'admin' ? 'Admin' : PAGES.find(([k]) => k === id)?.[1] || 'Settings')

// the top of a page: its icon in its colour and what it holds
const Hero = ({ id }) => {
  const pg = PAGES.find(([k]) => k === id)
  if (!pg) return null
  return <div className="set-hero"><span className="set-hero-ico" style={{ '--c': pg[2] }}>{pg[3]}</span><p>{pg[4]}</p></div>
}

const THEMES = [['ember', 'Simba', ['#ff6b57', 'linear-gradient(180deg, #3a4049, #1b1e23)']], ['glass', 'Glass', ['#2c5d93', '#1d2635']], ['aura', 'Aura', ['#3b6ff5', 'linear-gradient(135deg, #7c3aed, #1d4ed8 45%, #06b6d4)']], ['studio', 'Studio', ['#d4ff3a', '#121210']], ['prism', 'Pumba', ['#ff5d4a', 'linear-gradient(180deg, #555963, #2c2e34)']], ['aurum', 'Aurum', ['linear-gradient(180deg, #f8d29a, #e79a3d)', 'linear-gradient(180deg, #2a2927, #141414)']], ['lions', 'Lions', ['#d40000', 'radial-gradient(circle at 85% 0%, rgba(212, 0, 0, .35), transparent 60%), #0b0b0c']]]

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
    <Box title="Calls" note="What voice and video calls use on this device.">
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
      {[1, 2, 3].map((g) => (
        <div key={g} className="set-box">
          {PAGES.filter((x) => x[5] === g).map(([id, label, c, ico]) => (
            <button key={id} type="button" className={`set-row set-pick set-nav${page === id ? ' on' : ''}`} onClick={() => onPage(id)}>
              <span className="nav-ico" style={{ '--c': c }}>{ico}</span><span className="set-text">{label}</span>{id === 'language' && <small className="set-val" data-raw="">{lang() === 'el' ? 'Ελληνικά' : 'English'}</small>}{id === 'appearance' && <small className="set-val">{THEMES.find(([k]) => k === p.theme)?.[1]}</small>}<i className="set-chev">{I.right}</i>
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
      <p className="set-version"><Wordmark by /><span>{`RoarMe ${appVersion() ? `${appVersion()} ` : ''}beta · ${!navigator.userAgent.includes('Electron') ? 'web' : /Windows/.test(navigator.userAgent) ? 'Windows app' : 'Mac app'}`}</span></p>
    </div>
  )
}

/* the page on the right */
export function SettingsPage({ page, chosen, onPage, onBack, profile, folders, onFolders, onFolderMenu, folderKit, toast, me, setMe }) {
  const p = usePrefs()
  const title = pageTitle(page)
  return (
    <div className={`set-page${chosen ? ' chosen' : ''}`}>
      <header className="room-head set-head">
        {page === 'keys' || page.startsWith('folder:')
          ? <button type="button" className="round" onClick={() => onPage(page === 'keys' ? 'general' : 'folders')} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
          : <button type="button" className="round back" onClick={onBack} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>}
        <strong>{title}</strong>
      </header>
      <div className="set-body stagger" key={page}>
        <Hero id={page} />
        {page === 'profile' && profile}
        {page === 'general' && <General p={p} onKeys={() => onPage('keys')} toast={toast} />}
        {page === 'chats' && <Chats p={p} />}
        {page === 'keys' && <Keys p={p} />}
        {page === 'notify' && <Notify p={p} toast={toast} />}
        {page === 'autoreply' && <AutoReply toast={toast} />}
        {page === 'privacy' && <Privacy me={me} setMe={setMe} toast={toast} />}
        {page === 'data' && <Data p={p} />}
        {page === 'sessions' && <Sessions me={me} setMe={setMe} toast={toast} />}
        {page === 'appearance' && <Appearance p={p} toast={toast} me={me} setMe={setMe} />}
        {page === 'language' && <Language p={p} />}
        {page === 'admin' && inThemeLab(me) && <Admin />}
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
            <div className="set-row"><span className="set-text">Version {upd.installed ? `${upd.installed} beta` : '–'}<small>{upd.ready ? `RoarMe ${upd.latest} is out` : upd.latest ? 'Up to date' : 'The newest version is checked when RoarMe opens'}</small></span>{upd.ready && <button type="button" className="btn btn-main set-upd" onClick={() => get(thisComputer() || 'mac-arm')}>{I.download}<span>Download</span></button>}</div>
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
      <CallDevices p={p} />
      <Box title="Battery">
        <Switch on={p.lite} set={(v) => setPrefs({ lite: v })} hint="No animations and no glass blur, easier on the battery">Power Saving Mode</Switch>
      </Box>
      <Box title="Advanced">
        {!onPhone() && <Nav onClick={onKeys} value="⌘ /">Keyboard Shortcuts</Nav>}
        <Switch on={p.peerIds} set={(v) => setPrefs({ peerIds: v })} hint="Each person's RoarMe ID at the foot of their profile">Show User IDs in Profile</Switch>
      </Box>
      <Box note="Everything on this page and on Chats, Appearance, Notifications, Data and Folders goes back to how RoarMe starts. The language, your account and your chats stay as they are.">
        <button type="button" className="set-row set-pick danger" disabled={same} onClick={reset}><span className="set-text">Reset All Settings</span></button>
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
        <Switch on={p.callsTab} set={(v) => setPrefs({ callsTab: v })} hint="Calls next to Contacts, Chats and Settings at the foot">Show Calls Tab</Switch>
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

function Data({ p }) {
  return (
    <>
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

function Appearance({ p, toast, me, setMe }) {
  const lab = inThemeLab(me)
  const pickName = (c) => saveMe(me, setMe, { name_color: c }).then((e) => toast(e || 'Saved'))
  return (
    <>
      <Box title="Theme" note={`Simba is the main one: graphite glass with a glowing accent. Pumba: slate with a neon edge and a coral glow.${lab ? ' Only you see the others, to work on them.' : ''}`}>
        <div className={`set-preview${p.compact ? ' compact' : ''}`} data-bg={p.background} style={{ '--fs': `${TEXT_SIZES[p.textSize] || 15.5}px` }}>
          <span className="pv mine">Good morning! 👋</span>
          <span className="pv"><i>Good morning! 👋</i>Do you know what time it is?</span>
          <span className="pv mine">It's morning in Tokyo 😎</span>
        </div>
        <div className="set-row set-col">
          <div className="themes">
            {THEMES.filter(([k]) => PUBLIC_THEMES.includes(k) || lab).map(([k, l, [a, b]]) => {
              const only = !PUBLIC_THEMES.includes(k)
              return (
                <button key={k} type="button" className={`theme-tile t-${k}${p.theme === k ? ' on' : ''}${only ? ' lab' : ''}`} title={only ? `${l} · only you see it` : l}
                  onClick={(e) => { if (p.theme === k) return; revealFrom(e, () => { document.documentElement.dataset.theme = k; setPrefs({ theme: k }) }); toast(`Theme updated: ${l}`) }}>
                  <span className="theme-sw" style={{ background: b }}><i style={{ background: k === 'glass' ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.3)' }} /><i style={{ background: k === 'aura' ? 'linear-gradient(135deg, #1fb6e8, #3b6ff5)' : a, boxShadow: k === 'ember' ? '0 0 10px #ff6b57' : k === 'prism' ? '0 0 10px #ff4b3e' : k === 'aurum' ? '0 0 10px rgba(240, 166, 74, .8)' : k === 'lions' ? '0 0 10px rgba(212, 0, 0, .8)' : 'none' }} />{k === 'prism' && <b className="theme-rim" />}</span>
                  <small>{l}</small>
                  {only && <em className="theme-lab">Only you</em>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Day and Night<small>Auto follows the device: light by day, dark at night if the device does so</small></span>
          <Lens className="seg" dep={p.mode}>{[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => <button key={k} type="button" className={p.mode === k ? 'on' : ''} onClick={(e) => revealFrom(e, () => { applyMode(k)(); setPrefs({ mode: k }) })}>{l}</button>)}</Lens>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Accent Colour<small>{p.accent ? ACCENTS.find(([k]) => k === p.accent)?.[1] : "The theme's own colour"}</small></span>
          <div className="accents">
            <button type="button" className={`acc acc-auto${!p.accent ? ' on' : ''}`} title="Theme colour" onClick={() => setPrefs({ accent: '' })}><small>Theme</small></button>
            {ACCENTS.map(([k, l, c]) => <button key={k} type="button" className={`acc${p.accent === k ? ' on' : ''}${k === 'white' ? ' acc-white' : ''}`} style={{ '--c': c }} title={l} onClick={() => setPrefs({ accent: k })}><small>{l}</small></button>)}
          </div>
        </div>
      </Box>
      <Box title="Text">
        <div className="set-row set-col">
          <span className="set-text">Text Size</span>
          <div className="set-size">
            <small>A</small>
            <input type="range" min="0" max={TEXT_SIZES.length - 1} step="1" value={p.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
            <b>A</b>
          </div>
        </div>
        <div className="set-row set-col">
          <span className="set-text">Font</span>
          <select className="input set-select" value={p.font || 'system'} onChange={(e) => setPrefs({ font: e.target.value })}>{FONTS.map(([k, l, f]) => <option key={k} value={k} style={{ fontFamily: f }}>{l}</option>)}</select>
        </div>
      </Box>
      <Box title="Chat wallpaper" note="One chat can have its own from its ⋯ menu.">
        <div className="set-row set-col"><WallTiles value={p.background} onPick={(k) => setPrefs({ background: k })} /></div>
      </Box>
      <Box title="Layout">
        <div className="set-row set-col">
          <span className="set-text">Spacing<small>How much room the chat list, menus and settings get</small></span>
          <Lens className="seg" dep={p.density || 'standard'}>{[['relaxed', 'Relaxed'], ['standard', 'Standard'], ['tight', 'Tight']].map(([k, l]) => <button key={k} type="button" className={(p.density || 'standard') === k ? 'on' : ''} onClick={() => setPrefs({ density: k })}>{l}</button>)}</Lens>
        </div>
        <Switch on={p.compact} set={(v) => setPrefs({ compact: v })} hint="Messages in a chat sit closer together">Compact Messages</Switch>
        {p.theme === 'ember' && (
          <div className="set-row set-col">
            <span className="set-text">Corner Radius<small>{p.radius || 12} px</small></span>
            <input type="range" min="4" max="16" step="2" value={p.radius || 12} onChange={(e) => setPrefs({ radius: Number(e.target.value) })} />
            <span className="range-labels"><small>4</small><small>8</small><small>12</small><small>16</small></span>
          </div>
        )}
      </Box>
      <Box title="Effects">
        <Switch on={p.glassBubbles !== false} set={(v) => setPrefs({ glassBubbles: v })} hint="Your messages and the buttons see-through, with a thin edge in your colour. Off: filled with your colour">Glass Look</Switch>
        <Switch on={p.motion !== false} set={(v) => setPrefs({ motion: v })} hint={p.lite ? 'Off while Power Saving Mode is on' : 'Fluid transitions for messages, menus and windows'}>Smooth Animations</Switch>
        <Switch on={p.focusRings} set={(v) => setPrefs({ focusRings: v })} hint="A clear ring around whatever the keyboard is on">Bold Focus Rings</Switch>
      </Box>
      <Box title="Your name in groups">
        <div className="set-row set-col">
          <span className="set-text">Name Colour<small>How your name shows to others in groups</small></span>
          <div className="accents">
            <button type="button" className={`acc acc-auto${!me.name_color ? ' on' : ''}`} title="Automatic" onClick={() => pickName('')}><small>Auto</small></button>
            {NAME_COLORS.map((c) => <button key={c} type="button" className={`acc${me.name_color === c ? ' on' : ''}`} style={{ '--c': c }} onClick={() => pickName(c)}><small>{c}</small></button>)}
          </div>
        </div>
      </Box>
    </>
  )
}

function Language({ p }) {
  const ui = p.lang === 'el' ? 'el' : 'en'
  const setUi = (k) => { if (k === ui) return; setPrefs({ lang: k }); setTimeout(() => window.location.reload(), 150) }
  const to = p.translateTo === 'el' || p.translateTo === 'en' ? p.translateTo : 'auto'
  return (
    <>
      <Box title="Interface language" note="RoarMe restarts in the language you pick.">
        {UI_LANGS.map(([k, a, b]) => <Check key={k} on={ui === k} onClick={() => setUi(k)}><span data-raw="">{b}</span><small data-raw="">{a}</small></Check>)}
      </Box>
      <Box title="Translate messages" note="Translate opens the message in Google Translate.">
        {[['auto', 'Greek ↔ English'], ['el', 'Into Greek'], ['en', 'Into English']].map(([k, l]) => <Check key={k} on={to === k} onClick={() => setPrefs({ translateTo: k })}>{l}</Check>)}
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
  const t = q.trim().toLowerCase()
  const list = kit.rooms.filter((r) => !t || kit.titleOf(r).toLowerCase().includes(t))
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
  const down = (e, f) => {
    if (e.button !== 0) return
    drag.current = { id: f.id, y0: e.clientY, moved: false }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      let off = ev.clientY - d.y0
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
        {list.map((f) => (
          <button key={f.id} type="button" data-fid={f.id} className={`set-row set-pick fold-row${f.custom ? '' : ' set-fixed'}${dragId === f.id ? ' dragging' : ''}`} style={dragId === f.id ? { transform: `translateY(${dy}px)` } : undefined}
            onPointerDown={(e) => down(e, f)}
            onContextMenu={(e) => { e.preventDefault(); onFolderMenu?.(f, e) }}
            onClick={() => { if (drag.current?.moved) return; onFolders(`folder:${f.id}`) }}>
            <span className="fold-grip" aria-hidden="true">{svg(<><circle cx="9" cy="6" r="1.2" /><circle cx="15" cy="6" r="1.2" /><circle cx="9" cy="12" r="1.2" /><circle cx="15" cy="12" r="1.2" /><circle cx="9" cy="18" r="1.2" /><circle cx="15" cy="18" r="1.2" /></>)}</span>
            <span className="fold-ico">{f.id === 'all' ? I.chats : f.id === 'unread' ? I.unread : f.id === 'groups' ? I.people : f.id === 'archived' ? I.archive : I.folder}</span>
            <span className="set-text">{f.name}{f.custom && <small>{`${f.rooms.length} chat${f.rooms.length === 1 ? '' : 's'}`}</small>}</span>
            {f.custom && <><i className="fold-dot" style={{ background: colorOf(f.id) }} /><i className="set-chev">{I.right}</i></>}
          </button>
        ))}
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
      <Box><Switch on={p.folderTags} set={(v) => setPrefs({ folderTags: v })} hint="The folder names of each chat, in the chat list">Show Folder Tags</Switch></Box>
      <Box title="Tabs view" note="At the bottom, the folders sit right above Contacts, Chats and Settings.">
        <div className="set-row tabs-view">
          {[['top', 'Tabs at the top'], ['bottom', 'Tabs at the bottom']].map(([k, l]) => (
            <button key={k} type="button" className={`tv-tile${p.folderTabs === k ? ' on' : ''}`} onClick={() => setPrefs({ folderTabs: k })}>
              <span className={`tv-pic ${k}`}><i className="tv-bar" /><i className="tv-tabs"><b /><b /><b /></i><i className="tv-row" /><i className="tv-row" /></span>
              <small>{l}</small>
            </button>
          ))}
        </div>
      </Box>
    </>
  )
}
