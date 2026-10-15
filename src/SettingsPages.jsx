import { useState } from 'react'
import { errText, nameOf, supabase } from './lib.js'
import { Avatar, I, Lens, colorOf, revealFrom, svg } from './ui.jsx'
import { DEFAULTS, REACTIONS, TEXT_SIZES, applyMode, chime, setPrefs, usePrefs } from './prefs.js'
import { WallTiles } from './extras.jsx'

/* Settings as in Telegram (Alex, 16 Oct): a list on the left, the chosen page on the right.
   Anything that needs the database is shown switched off with "Coming soon". */

export const PAGES = [
  ['general', 'General', '#8e8e93', svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>, 16)],
  ['notify', 'Notifications and Sounds', '#ff453a', svg(<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>, 16)],
  ['privacy', 'Privacy and Security', '#0a84ff', svg(<><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>, 16)],
  ['data', 'Data and Storage', '#30d158', svg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>, 16)],
  ['sessions', 'Active Sessions', '#ff9f0a', svg(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>, 16)],
  ['appearance', 'Appearance', '#40c8e0', svg(<><path d="M14.5 4.5l5 5L11 18l-5-5z" /><path d="M6 13c-2 0-3 1.5-3 3.5S2 20 2 20s3.5.5 5-1 1.5-3 0-4" /></>, 16)],
  ['language', 'Language', '#bf5af2', svg(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>, 16)],
  ['folders', 'Chat Folders', '#a78bfa', I.folder],
]
export const pageTitle = (id) => (id === 'profile' ? 'My Profile' : id === 'keys' ? 'Keyboard Shortcuts' : PAGES.find(([k]) => k === id)?.[1] || 'Settings')

const LANGS = [['en', 'English', 'English'], ['el', 'Greek', 'Ελληνικά'], ['de', 'German', 'Deutsch'], ['es', 'Spanish', 'Español'], ['fr', 'French', 'Français'], ['it', 'Italian', 'Italiano'], ['nl', 'Dutch', 'Nederlands'], ['pt', 'Portuguese', 'Português'], ['ru', 'Russian', 'Русский'], ['uk', 'Ukrainian', 'Українська'], ['tr', 'Turkish', 'Türkçe'], ['ar', 'Arabic', 'العربية'], ['zh-CN', 'Chinese', '中文'], ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어']]
const THEMES = [['glass', 'Glass', ['#2c5d93', '#1d2635']], ['studio', 'Studio', ['#d4ff3a', '#121210']], ['sepia', 'Sepia', ['#2f6f7a', '#e8dfcc']], ['mine', 'Mineshaft', ['#b39567', '#2b2b2b']], ['gray', 'Grayscale', ['#4a4a4a', '#222']], ['amoled', 'Amoled', ['#3a5fa0', '#000']], ['night', 'Midnight', ['#4b4f8a', '#1c1c35']]]

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

/* the list in the side panel */
export function SettingsMenu({ me, page, onPage }) {
  return (
    <div className="side-scroll set-menu stagger">
      <button type="button" className={`set-me${page === 'profile' ? ' on' : ''}`} onClick={() => onPage('profile')}>
        <Avatar src={me.avatar_url} name={nameOf(me)} size={60} />
        <span className="set-me-text"><b>{nameOf(me)}</b><small>@{me.username}</small>{me.bio && <small>{me.bio}</small>}</span>
        <i className="set-chev">{I.right}</i>
      </button>
      <div className="set-box">
        <button type="button" className={`set-row set-pick set-nav${page === 'profile' ? ' on' : ''}`} onClick={() => onPage('profile')}><span className="nav-ico" style={{ '--c': '#ff375f' }}>{I.person}</span><span className="set-text">My Profile</span><i className="set-chev">{I.right}</i></button>
      </div>
      <div className="set-box">
        {PAGES.map(([id, label, c, ico]) => (
          <button key={id} type="button" className={`set-row set-pick set-nav${page === id ? ' on' : ''}`} onClick={() => onPage(id)}>
            <span className="nav-ico" style={{ '--c': c }}>{ico}</span><span className="set-text">{label}</span>{id === 'language' && <small className="set-val">English</small>}<i className="set-chev">{I.right}</i>
          </button>
        ))}
      </div>
      <div className="set-box">
        <button type="button" className="set-row set-pick set-nav danger" onClick={() => supabase.auth.signOut()}><span className="nav-ico" style={{ '--c': '#ff453a' }}>{svg(<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />, 16)}</span><span className="set-text">Sign out</span></button>
      </div>
      <p className="set-version">RoarMe 0.1 · web</p>
    </div>
  )
}

/* the page on the right */
export function SettingsPage({ page, chosen, onPage, onBack, profile, folders, onFolders, toast }) {
  const p = usePrefs()
  const title = pageTitle(page)
  return (
    <div className={`set-page${chosen ? ' chosen' : ''}`}>
      <header className="room-head set-head">
        {page === 'keys'
          ? <button type="button" className="round" onClick={() => onPage('general')} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>
          : <button type="button" className="round back" onClick={onBack} aria-label="Back">{svg(<path d="M15 5l-7 7 7 7" />)}</button>}
        <strong>{title}</strong>
      </header>
      <div className="set-body stagger" key={page}>
        {page === 'profile' && profile}
        {page === 'general' && <General p={p} onKeys={() => onPage('keys')} />}
        {page === 'keys' && <Keys p={p} />}
        {page === 'notify' && <Notify p={p} />}
        {page === 'privacy' && <Privacy toast={toast} />}
        {page === 'data' && <Data p={p} />}
        {page === 'sessions' && <Sessions toast={toast} />}
        {page === 'appearance' && <Appearance p={p} />}
        {page === 'language' && <Language p={p} />}
        {page === 'folders' && <Folders p={p} folders={folders} onFolders={onFolders} />}
        {page !== 'profile' && <button type="button" className="btn set-reset" onClick={() => { setPrefs(null); toast('Settings back to standard') }} disabled={JSON.stringify(p) === JSON.stringify(DEFAULTS)}>Back to standard</button>}
      </div>
    </div>
  )
}

function General({ p, onKeys }) {
  return (
    <>
      <Box title="Power saving"><Switch on={p.lite} set={(v) => setPrefs({ lite: v })} hint="No animations and no glass blur, easier on the battery">Power Saving Mode</Switch></Box>
      <Box title="Spelling and grammar">
        <Switch on={p.spell} set={(v) => setPrefs({ spell: v })}>Check Spelling While Typing</Switch>
        <Soon hint="Comes with the desktop app">Check Grammar With Spelling</Soon>
        <Soon hint="Comes with the desktop app">Correct Spelling Automatically</Soon>
      </Box>
      <Box title="Emoji">
        <Switch on={p.autoEmoji} set={(v) => setPrefs({ autoEmoji: v })} hint=":) becomes 🙂 and <3 becomes ❤️ when you send">Replace Emoji Automatically</Switch>
        <Switch on={p.bigEmoji} set={(v) => setPrefs({ bigEmoji: v })}>Large Emoji</Switch>
      </Box>
      <Box title="Interface" note="Click on the unread badge to preview chats without marking them as read.">
        <Switch on={p.callsTab} set={(v) => setPrefs({ callsTab: v })}>Show Calls Tab</Switch>
        <Soon hint="Comes with the desktop app">Show Icon in Menu Bar</Soon>
        <Switch on={p.peekBadge} set={(v) => setPrefs({ peekBadge: v })}>Preview Chats</Switch>
      </Box>
      <Box title="Shortcuts"><Nav onClick={onKeys} value="⌘ + /">Keyboard Shortcuts</Nav></Box>
      <Box title="Advanced">
        <Soon>Copy Text Formatting</Soon>
        <Switch on={p.largePhotos} set={(v) => setPrefs({ largePhotos: v })} hint="2560 px instead of 1600 px">Send Large Photos</Switch>
        <Switch on={p.faces} set={(v) => setPrefs({ faces: v })}>Faces Next to Messages in Groups</Switch>
      </Box>
      <Box title="Double click on a message" note={p.doubleTap === 'edit' ? "On someone else's message it replies." : null}>
        {[['reply', 'Reply to Message'], ['edit', 'Edit Message'], ['forward', 'Forward Message'], ['react', 'Add Reaction']].map(([k, l]) => <Check key={k} on={p.doubleTap === k} onClick={() => setPrefs({ doubleTap: k })}>{l}</Check>)}
      </Box>
      <Box title="Quick reaction">
        <div className="set-row set-col"><Lens className="seg seg-emoji" dep={p.quick}>{REACTIONS.map((e) => <button key={e} type="button" className={p.quick === e ? 'on' : ''} onClick={() => setPrefs({ quick: e })}>{e}</button>)}</Lens></div>
      </Box>
      <Box title="Input settings">
        <Check on={p.enterSends} onClick={() => setPrefs({ enterSends: true })}>Send with Enter</Check>
        <Check on={!p.enterSends} onClick={() => setPrefs({ enterSends: false })}>Send with ⌘ / Ctrl + Enter</Check>
      </Box>
      <Box title="Call settings"><Soon arrow>Call Settings</Soon></Box>
      <Box><Switch on={p.peerIds} set={(v) => setPrefs({ peerIds: v })}>Show User IDs in Profile</Switch></Box>
    </>
  )
}

function Keys({ p }) {
  const rows = [['⌘K / Ctrl+K', 'Search chats'], ['⌘/ / Ctrl+/', 'Keyboard shortcuts'], ['Enter', p.enterSends ? 'Send' : 'New line'], [p.enterSends ? 'Shift+Enter' : '⌘ / Ctrl+Enter', p.enterSends ? 'New line' : 'Send'], ['↑', 'Edit your last message'], ['Esc', 'Cancel, close'], ['Right click on a message', 'Message menu'], ['Right click on a chat', 'Chat menu'], ['Double click', { react: 'Quick reaction', reply: 'Reply', edit: 'Edit', forward: 'Forward' }[p.doubleTap]]]
  return <Box>{rows.map(([k, v]) => <div key={k} className="set-row keys"><span className="set-text">{v}</span><kbd>{k}</kbd></div>)}</Box>
}

function Notify({ p }) {
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'none' : Notification.permission)
  const ask = async () => { try { setPerm(await Notification.requestPermission()) } catch { /* not here */ } }
  return (
    <>
      <Box title="Message notifications">
        <div className="set-row">
          <span className="set-text">Desktop notifications<small>{perm === 'granted' ? 'On for this browser' : perm === 'denied' ? 'Blocked. Allow them in the browser settings for this site.' : perm === 'none' ? 'This browser has no notifications' : 'Allow RoarMe to show new messages'}</small></span>
          {perm === 'default' && <button type="button" className="btn btn-main btn-sm" onClick={ask}>Allow</button>}
          {perm === 'granted' && <i className="set-tick">{I.check}</i>}
        </div>
        <Switch on={p.notifyPreview} set={(v) => setPrefs({ notifyPreview: v })} hint="Off: only the name, never the text">Message Preview</Switch>
        <Soon>Notifications With the App Closed</Soon>
      </Box>
      <Box title="Sounds">
        <div className="set-row">
          <span className="set-text">Sound When a Message Arrives</span>
          <button type="button" className="link" onClick={chime}>Play</button>
          <span className="switch"><input type="checkbox" checked={p.sound} onChange={(e) => setPrefs({ sound: e.target.checked })} /><span /></span>
        </div>
        <Soon arrow>Choose a Sound</Soon>
      </Box>
      <Box title="Badge"><Soon hint="Comes with the desktop app">Unread Count on the App Icon</Soon></Box>
    </>
  )
}

function Privacy({ toast }) {
  const [pw, setPw] = useState({ a: '', b: '', open: false, busy: false, err: '' })
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
      <Box title="Security">
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
        <Soon arrow>Two-Step Verification</Soon>
        <Soon arrow>Passcode Lock</Soon>
        <Soon arrow>Blocked Users</Soon>
      </Box>
      <Box title="Privacy">
        <Soon arrow hint="Everybody · coming soon">Last Seen and Online</Soon>
        <Soon arrow hint="Everybody · coming soon">Profile Photo</Soon>
        <Soon arrow hint="Everybody · coming soon">Who Can Add Me to Groups</Soon>
        <Soon arrow hint="Everybody · coming soon">Who Can Call Me</Soon>
      </Box>
      <Box title="Account"><Soon arrow>Delete My Account</Soon></Box>
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
        <Soon arrow hint="Photos, videos and files · coming soon">In Private Chats</Soon>
        <Soon arrow hint="Photos, videos and files · coming soon">In Groups</Soon>
      </Box>
      <Box title="Auto-play media">
        <Soon>Videos</Soon>
        <Soon>GIFs</Soon>
      </Box>
    </>
  )
}

const deviceOf = () => {
  const u = navigator.userAgent
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Computer'
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser'
  return { os, br }
}
function Sessions({ toast }) {
  const d = deviceOf()
  const endOthers = async () => {
    if (!window.confirm('Sign out on every other device? This one stays signed in.')) return
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    toast(error ? errText(error) : 'All other devices are signed out')
  }
  return (
    <>
      <Box title="This device" note="Signs you out on all devices except this one.">
        <div className="set-row set-dev">
          <span className="nav-ico" style={{ '--c': '#0a84ff' }}>{svg(<><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 20h8" /></>, 16)}</span>
          <span className="set-text"><b>{d.os}</b><small>RoarMe web · {d.br}</small></span>
          <small className="set-online">online</small>
        </div>
        <button type="button" className="set-row set-pick danger" onClick={endOthers}><span className="set-text">Terminate All Other Sessions</span></button>
      </Box>
      <Box title="Active sessions"><Soon hint="The list of your other devices is coming soon">Other Devices</Soon></Box>
      <Box title="Automatically terminate old sessions"><Soon arrow hint="6 months · coming soon">If Inactive For</Soon></Box>
    </>
  )
}

function Appearance({ p }) {
  return (
    <>
      <Box title="Colour theme">
        <div className={`set-preview${p.compact ? ' compact' : ''}`} data-bg={p.background} style={{ '--fs': `${TEXT_SIZES[p.textSize] || 15.5}px` }}>
          <span className="pv mine">Good morning! 👋</span>
          <span className="pv"><i>Good morning! 👋</i>Do you know what time it is?</span>
          <span className="pv mine">It's morning in Tokyo 😎</span>
        </div>
        <div className="set-row set-col">
          <div className="themes">
            {THEMES.map(([k, l, [a, b]], i) => {
              const ready = i < 2
              return (
                <button key={k} type="button" className={`theme-tile t-${k}${p.theme === k ? ' on' : ''}`} disabled={!ready} title={ready ? l : 'Coming soon'}
                  onClick={(e) => revealFrom(e, () => { document.documentElement.dataset.theme = k; setPrefs({ theme: k }) })}>
                  <span className="theme-sw" style={{ background: b }}><i style={{ background: i === 0 ? 'rgba(255,255,255,.18)' : i === 1 ? 'rgba(255,255,255,.14)' : `${a}55` }} /><i style={{ background: a }} /></span>
                  <small>{l}</small>
                </button>
              )
            })}
          </div>
          <small className="muted">Glass: soft frosted panels. Studio: sharp, graphic, with a side rail. Both have dark and light. More themes are coming soon.</small>
        </div>
      </Box>
      <Box>
        <div className="set-row set-col">
          <span className="set-text">Dark Mode<small>Auto follows the computer, dark at night if the computer does</small></span>
          <Lens className="seg" dep={p.mode}>{[['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']].map(([k, l]) => <button key={k} type="button" className={p.mode === k ? 'on' : ''} onClick={(e) => revealFrom(e, () => { applyMode(k)(); setPrefs({ mode: k }) })}>{l}</button>)}</Lens>
        </div>
        <Switch on={p.compact} set={(v) => setPrefs({ compact: v })}>Compact Spacing</Switch>
        <Soon arrow>Your Name Colour</Soon>
      </Box>
      <Box title="Chat wallpaper" note="One chat can have its own from its ⋯ menu.">
        <div className="set-row set-col"><WallTiles value={p.background} onPick={(k) => setPrefs({ background: k })} /></div>
      </Box>
      <Box title="Text size">
        <div className="set-row set-size">
          <small>A</small>
          <input type="range" min="0" max={TEXT_SIZES.length - 1} step="1" value={p.textSize} onChange={(e) => setPrefs({ textSize: Number(e.target.value) })} />
          <b>A</b>
        </div>
      </Box>
    </>
  )
}

function Language({ p }) {
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(false)
  const to = LANGS.find(([k]) => k === p.translateTo)
  const list = LANGS.filter(([, a, b]) => !q.trim() || `${a} ${b}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <>
      <Box title="Translate messages" note="Translate opens the message in Google Translate.">
        <Nav onClick={() => setPick((v) => !v)} value={to ? to[1] : 'Greek ↔ English'}>Translate To</Nav>
        {pick && (
          <>
            <Check on={!to} onClick={() => { setPrefs({ translateTo: 'auto' }); setPick(false) }}>Greek ↔ English</Check>
            {LANGS.map(([k, a]) => <Check key={k} on={p.translateTo === k} onClick={() => { setPrefs({ translateTo: k }); setPick(false) }}>{a}</Check>)}
          </>
        )}
        <Soon>Translate Entire Chats</Soon>
      </Box>
      <Box title="Interface language" note="RoarMe speaks English for now. More languages are coming soon.">
        <div className="set-row"><label className="search set-search">{I.search}<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" /></label></div>
        {list.map(([k, a, b]) => (
          <div key={k} className={`set-row${k === 'en' ? '' : ' is-off'}`}><span className="set-text">{a}<small>{b}</small></span>{k === 'en' && <i className="set-tick">{I.check}</i>}</div>
        ))}
      </Box>
    </>
  )
}

function Folders({ p, folders, onFolders }) {
  return (
    <>
      <div className="set-hero"><span className="set-hero-ico">{I.folder}</span><p>Create folders for different groups of chats and quickly switch between them.</p></div>
      <Box title="Folders" note="Edit folders to rename them, choose their chats or remove them.">
        {folders.map((f) => (
          <button key={f.id} type="button" className={`set-row set-pick${f.custom ? '' : ' set-fixed'}`} onClick={() => f.custom && onFolders('folders')}>
            <span className="fold-ico">{f.id === 'all' ? I.chats : f.id === 'unread' ? I.unread : f.id === 'groups' ? I.people : f.id === 'archived' ? I.archive : I.folder}</span>
            <span className="set-text">{f.name}{f.custom && <small>{f.rooms.length} chat{f.rooms.length === 1 ? '' : 's'}</small>}</span>
            {f.custom && <><i className="fold-dot" style={{ background: colorOf(f.id) }} /><i className="set-chev">{I.right}</i></>}
          </button>
        ))}
        <button type="button" className="set-row set-pick set-add" onClick={() => onFolders('newfolder')}><span className="set-text">Add a Custom Folder</span><i className="set-chev">{I.right}</i></button>
      </Box>
      <Box note="Display folder names for each chat in the chat list."><Switch on={p.folderTags} set={(v) => setPrefs({ folderTags: v })}>Show Folder Tags</Switch></Box>
      <Box title="Tabs view" note="If you have many folders, try moving tabs to the left.">
        <div className="set-row tabs-view">
          {[['top', 'Tabs at the top'], ['left', 'Tabs on the left']].map(([k, l]) => (
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
