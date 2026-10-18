import { useEffect, useState } from 'react'
import { I, Modal } from './ui.jsx'

/* The Mac and Windows app, newer versions and how to install them (Alex, 17 Oct).
   - The app tells the page its version in the browser's user agent ("RoarMe/1.4.5"), even the versions already
     installed, so the page compares it with the newest release on GitHub (its name carries the version) and, when
     there is a newer one, shows a card with Download.
   - macOS stops an app that is not from the App Store the first time ("cannot verify"), before it can show anything,
     so the steps (Done, then System Settings > Privacy & Security > Open Anyway) open the moment Download is pressed,
     and stay on screen while one installs. Windows has its own (More info > Run anyway). */

const REPO = 'alexisdigipro-hub/roarme'
export const DL = {
  'mac-arm': `https://github.com/${REPO}/releases/latest/download/RoarMe-Mac-arm64.dmg`,
  'mac-intel': `https://github.com/${REPO}/releases/latest/download/RoarMe-Mac-x64.dmg`,
  win: `https://github.com/${REPO}/releases/latest/download/RoarMe-Windows-Setup.exe`,
}
const LATEST = 'roarme-latest-release'
/* the installers carry their version and "beta" in the name (RoarMe-1.4.7-beta-Mac-arm64.dmg, Alex 18 Oct), so the
   links come from the newest release's own files; the plain names above stay on each release as a fallback */
const FILE_OF = { 'mac-arm': /Mac-arm64\.dmg$/, 'mac-intel': /Mac-x64\.dmg$/, win: /Windows-Setup\.exe$/ }
export const BETA = 'beta'
const cachedFiles = () => { try { return JSON.parse(localStorage.getItem(LATEST) || 'null')?.files || {} } catch { return {} } }
export const dlUrl = (kind, files = cachedFiles()) => {
  const re = FILE_OF[kind] || FILE_OF['mac-arm']
  const names = Object.keys(files).filter((n) => re.test(n))
  const named = names.find((n) => /\d+\.\d+\.\d+/.test(n)) || names[0]
  return named ? files[named] : DL[kind] || DL['mac-arm']
}
const SKIP = 'roarme-update-skip'

/* the installed app's version, or '' in a browser */
export const appVersion = () => {
  if (typeof navigator === 'undefined' || !/Electron\//.test(navigator.userAgent)) return ''
  return (navigator.userAgent.match(/(?:RoarMe|roar)\/(\d+\.\d+\.\d+)/i) || [])[1] || ''
}
const newer = (a, b) => {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) }
  return false
}

/* which computer this is: a Mac with Apple chips, an Intel Mac, Windows */
export const thisComputer = () => {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'win'
  if (!/Mac/i.test(ua)) return ''
  if (window.roarDesktop?.arch) return window.roarDesktop.arch === 'arm64' ? 'mac-arm' : 'mac-intel'
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    if (/Apple M\d|Apple GPU/i.test(r)) return 'mac-arm'
    if (/Intel|AMD|Radeon|NVIDIA/i.test(r)) return 'mac-intel'
  } catch { /* no WebGL */ }
  return 'mac-arm' // most Macs today
}

/* the newest release (looked up at most every half hour) */
export function useLatestRelease() {
  const [latest, setLatest] = useState(() => { try { return JSON.parse(localStorage.getItem(LATEST) || 'null') } catch { return null } })
  useEffect(() => {
    // looked up at most every half hour, so a new version is noticed the same afternoon (Alex, 18 Oct)
    if (latest && latest.files && Date.now() - latest.at < 30 * 60e3) return undefined
    let alive = true
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const version = (String(d?.name || '').match(/(\d+\.\d+\.\d+)/) || [])[1] || ''
        if (!alive || !d) return
        const files = Object.fromEntries((d.assets || []).map((a) => [a.name, a.browser_download_url]))
        const v = { at: Date.now(), version, tag: d.tag_name, date: d.published_at, files }
        try { localStorage.setItem(LATEST, JSON.stringify(v)) } catch { /* private window */ }
        setLatest(v)
      })
      .catch(() => {})
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return latest
}

export function useAppUpdate() {
  const latest = useLatestRelease()
  const installed = appVersion()
  const ready = !!(installed && latest?.version && newer(latest.version, installed))
  return { installed, latest: latest?.version || '', ready }
}

/* the steps to install, for the computer it is for; Download starts as the window opens */
export function InstallGuide({ kind, onClose, update = false }) {
  const mac = kind !== 'win'
  const steps = mac ? [
    [I.download, 'Open the download', 'Open the RoarMe .dmg file from your Downloads and drag RoarMe onto Applications.' + (update ? ' Quit RoarMe first (Cmd+Q) and press Replace.' : '')],
    [I.play, 'Open RoarMe', 'Open it from Applications. The first time the Mac says it cannot check the app: press Done (not Move to Bin).'],
    [I.gear, 'Privacy & Security', 'Open System Settings > Privacy & Security and scroll down to Security, where it says RoarMe was blocked.'],
    [I.check, 'Open Anyway', 'Press Open Anyway, type your Mac password, then Open Anyway once more. From then on RoarMe opens like any app.'],
  ] : [
    [I.download, 'Open the download', 'Open the RoarMe Setup .exe file from your Downloads.' + (update ? ' Close RoarMe first.' : '')],
    [I.info, 'Windows protected your PC', 'If this blue window comes up, press More info, then Run anyway.'],
    [I.check, 'Done', 'RoarMe installs and opens by itself. From then on it opens like any app.'],
  ]
  return (
    <Modal title={update ? 'Update RoarMe' : `Install RoarMe on ${mac ? 'a Mac' : 'Windows'}`} onClose={onClose}>
      <div className="inst">
        <p className="inst-lead">{mac
          ? 'The download has started. RoarMe is not from the App Store, so the first time the Mac asks you to allow it. Four steps, once:'
          : 'The download has started. The first time, Windows asks you to allow it:'}</p>
        <ol className="inst-steps">
          {steps.map(([ico, t, d], n) => (
            <li key={t}><i>{ico}<b>{n + 1}</b></i><span><b>{t}</b><small>{d}</small></span></li>
          ))}
        </ol>
        <div className="inst-acts">
          <a className="btn" href={dlUrl(kind)} target="_blank" rel="noopener noreferrer">{I.download}<span>Download again</span></a>
          {mac && <a className="btn" href={dlUrl(kind === 'mac-intel' ? 'mac-arm' : 'mac-intel')} target="_blank" rel="noopener noreferrer"><span>{kind === 'mac-intel' ? 'Mac with Apple chip?' : 'Older Mac with Intel?'}</span></a>}
          <button type="button" className="btn btn-main" onClick={onClose}>Got it</button>
        </div>
      </div>
    </Modal>
  )
}

/* start the download and show the steps */
export const startDownload = (kind) => { window.open(dlUrl(kind), '_blank', 'noopener') }

/* the card in the app when a newer Mac or Windows app is out */
export function UpdateCard() {
  // 1.4.9 on: the app downloads a new version by itself and only asks for a restart (desktop/updater.js)
  const desk = typeof window !== 'undefined' ? window.roarDesktop?.update : null
  const [us, setUs] = useState(null)
  useEffect(() => {
    if (!desk) return undefined
    desk.state().then(setUs).catch(() => {})
    return desk.on(setUs)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const { installed, latest, ready } = useAppUpdate()
  const [skip, setSkip] = useState(() => { try { return localStorage.getItem(SKIP) || '' } catch { return '' } })
  const [guide, setGuide] = useState('')
  if (desk) {
    if (!us || (us.status !== 'downloading' && us.status !== 'ready' && us.status !== 'installing')) return null
    const done = us.status !== 'downloading'
    return (
      <div className="upd" role="status">
        <i className="upd-ico">{I.download}</i>
        <span className="upd-text">
          <b>{done ? `RoarMe ${us.version} is ready` : `Downloading RoarMe ${us.version}`}</b>
          <small>{done ? 'Restart to update. It takes a few seconds and RoarMe opens again.' : `${us.progress || 0}%`}</small>
        </span>
        {done && <button type="button" className="btn btn-main upd-go" disabled={us.status === 'installing'} onClick={() => { setUs({ ...us, status: 'installing' }); desk.install() }}>{I.download}<span>{us.status === 'installing' ? 'Restarting…' : 'Restart to update'}</span></button>}
      </div>
    )
  }
  if (!ready && !guide) return null
  const kind = thisComputer() || 'mac-arm'
  const later = () => { try { localStorage.setItem(SKIP, latest) } catch { /* private window */ } setSkip(latest) }
  return (
    <>
      {ready && skip !== latest && !guide && (
        <div className="upd" role="status">
          <i className="upd-ico">{I.download}</i>
          <span className="upd-text"><b>{`New RoarMe app: ${latest} ${BETA}`}</b><small>You have {installed}. Download it one last time: from 1.4.9 on, RoarMe updates itself.</small></span>
          <button type="button" className="btn btn-main upd-go" onClick={() => { startDownload(kind); setGuide(kind) }}>{I.download}<span>Download</span></button>
          <button type="button" className="upd-x" onClick={later} aria-label="Later" title="Later">{I.x}</button>
        </div>
      )}
      {guide && <InstallGuide kind={guide} update onClose={() => { setGuide(''); later() }} />}
    </>
  )
}
