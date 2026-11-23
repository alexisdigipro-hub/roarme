// What's New (Alex, 22 Nov: "after an update, a small window once that says what changed, in bullets, minimal; closed, it
// does not come back; and a history of updates somewhere low in Settings"). NEWS is newest first; the window shows the
// newest entry once per device (localStorage roarme-news-seen), Settings > What's New lists them all.
// Every change people will notice adds a line to the newest entry, in its section (Everywhere, On a phone, On a
// computer; Alex, 22 Nov), or a new entry on a new day.
import { useEffect, useState } from 'react'
import { Modal } from './ui.jsx'

export const NEWS = [
  {
    id: '2026-11-22',
    date: '22 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'PROjects: a gold PROjects folder. Turn a group into a project from its long-press menu.',
        'Production Hub: link RoarMe to your production hub in Settings, PROjects. Projects stay the same on both sides, and PROjects is free for now.',
        'From the Hub: a project shows the hub\'s cover picture, its locations\' photos and its songs, which play in RoarMe.',
        'Archived Projects: delivered projects fold away at the foot of PROjects.',
        'PROjects is off to start: turn it on in Settings, PROjects, and the gold folder shows.',
        'Project chats: a project group has three chats, Pre Production, Production and Post Production. Admins choose who sees which; only Pre Production sees the Workspace.',
        'Project Settings on one page: Mark as Delivered on top, the details in one line, the stage as three choices.',
        'Unlink: untie a project from the hub in its settings. Deleting on one side only unlinks the other.',
        'Hub Member: with your hub linked, make a contact a member of your hub from their card and pick their category; put in a project group, they land in that category\'s chats.',
        'Add people suggests the people you talk to from the first letter.',
        'Banner: a project\'s cover banner is off to start; turn it on in Project Settings, More.',
        'Send from the Workspace: photos, videos, files, songs, places, links, locations and the ordino have a send arrow: pick Pre Production, Production or Post Production, or another chat or person.',
        'Hub Member is on a person\'s page too.',
        'Ordinos from the Hub show in the project by themselves, and Add Ordino Link puts in any ordino\'s link.',
        'Workspace background: upload your own picture in Project Settings, crop it and set its opacity; the whole team sees it.',
        'Appearance on one page: one preview on top shows every change, then Colour, Messages and App.',
        'Every member of a project sees its Overview, to look and listen.',
        'Hub Members join every new project in their category.',
        'Notices: when you are put on a task, a task of yours is done, or it is due tomorrow, a slim line comes into the project\'s chat for you alone, with the sound.',
        'A project has its own workspace: media, files, Location Scout, calls, links, tasks, and Admin for budget and fees.',
        'The project\u2019s Overview gives a taste of everything: small thumbnails, then the latest documents, locations, links and tasks.',
        'The project\u2019s banner is calmer: its name on your own photo or the theme\u2019s colour, the shoot day under it.',
        'Songs show their real waveform, finer, read from the sound itself.',
        'Project tasks are one list: each task has its own status, due date, priority, people and subtasks; Completed folds away.',
        'Type @ in a new task to give it to someone in the group.',
        'A project\u2019s Files has a menu of the kinds there are: PDF, Documents, Music and the rest.',
        'Production Hub, in Settings: link RoarMe to your production hub once, and every project here is a project there, both ways, with tasks, locations, stage and shoot day kept the same.',
        'Project settings are a page now. Project Info holds the details, brief, stage and the Shoot Day.',
        'Your address book: contacts with phones, emails, addresses and groups, import and export as .vcf.',
        'Archived is a drawer icon, always at the right end of the folder bar.',
        'Five new colours in Appearance.',
        'A project\u2019s Admin shows its People: how often each one came in, for how long, and what they sent. Its parts fold away with an arrow.',
        'Customer Service, in Settings, for the messages people send to RoarMe.',
        'This page, with what each update brought.',
      ] },
      { title: 'On a phone', items: [
        'In a project\u2019s chat the head shows the project\u2019s title and Project side by side; Project opens the workspace.',
        'The workspace pages fit the screen, with a slide between tabs.',
        'The number of unread messages on RoarMe\u2019s icon.',
      ] },
      { title: 'On a computer', items: [
        'A right click on a chat shows only its menu, with Preview Messages in it.',
        'Import from Telegram: bring a chat\u2019s history and files into RoarMe, from the profile\u2019s More.',
        'Anything dropped into a chat is sent straight away.',
        'A project\u2019s chat keeps its full name in the head, and the workspace stays beside it even in a narrow window.',
        'A tap on a project chat\u2019s name shows or hides the Workspace beside it.',
        'The Workspace\u2019s tabs are plain words, in your order.',
      ] },
    ],
  },
  {
    id: '2026-11-21',
    date: '21 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'The photo and video editor: crop, draw, adjust, looks, and trim for videos.',
        '\u201ctyping\u2026\u201d in the chat list and in the chat\u2019s head.',
        'Videos play in the chat by themselves, muted, and open full screen with a tap.',
        'Long-press menus redrawn, with the background softly blurred.',
      ] },
      { title: 'On a phone', items: [
        'RoarMe\u2019s own camera, with photo, video and dual, and pro controls.',
        'Pinch to zoom the photo library.',
      ] },
    ],
  },
  {
    id: '2026-11-20',
    date: '20 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'Your status: Online, Away, Do Not Disturb, Invisible, or a status of your own.',
        'Hold Send for Send Without Sound, Schedule Message and Locked Message.',
        'Birthdays: a small bar on the day, with Wish.',
        'Share Battery, if you want your contacts to see it.',
      ] },
    ],
  },
]

const SEEN = 'roarme-news-seen'
const seen = () => { try { return localStorage.getItem(SEEN) || '' } catch { return '' } }
const markSeen = () => { try { localStorage.setItem(SEEN, NEWS[0].id) } catch { /* private window */ } }

// B of the sample https://claude.ai/artifact/AU8jUvGrMNKYDnFRb4ijGD (Alex, 22 Nov): a quiet timeline, each change a dot on a
// fine line, its first words in bold (what comes before ": " when it is short), and All / Phone / Computer to filter
const WHERE = { 'On a phone': 'phone', 'On a computer': 'computer' }
const itemsOf = (n) => (n.sections || [{ title: '', items: n.items || [] }]).flatMap((g) => g.items.map((t) => ({ t, w: WHERE[g.title] || 'all' })))
function Line({ t, w, showTag }) {
  const i = t.indexOf(': ')
  const head = i > 0 && i < 42 ? t.slice(0, i) : ''
  return (
    <li className="wn-i">
      {head ? <><b>{head}.</b> <span className="wn-d">{t.slice(i + 2, i + 3).toUpperCase() + t.slice(i + 3)}</span></> : <span className="wn-d">{t}</span>}
      {showTag && w !== 'all' && <span className="wn-tag">{w === 'phone' ? 'Phone' : 'Computer'}</span>}
    </li>
  )
}
function Entry({ n, where = 'all' }) {
  const d = new Date(`${n.id}T12:00:00`)
  const all = itemsOf(n)
  const list = where === 'all' ? all : all.filter((x) => x.w === where)
  if (!list.length) return null
  return (
    <section className="wn-entry">
      <div className="wn-date"><b>{d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</b><span>{d.getFullYear()}</span></div>
      <ul className="wn-tl">{list.map((x) => <Line key={x.t} t={x.t} w={x.w} showTag={where === 'all'} />)}</ul>
    </section>
  )
}
function WhereSeg({ where, setWhere }) {
  return (
    <div className="wn-seg" role="tablist">
      {[['all', 'All'], ['phone', 'Phone'], ['computer', 'Computer']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={where === k} className={where === k ? 'on' : ''} onClick={() => setWhere(k)}>{l}</button>)}
    </div>
  )
}

// the window, once after an update
export function WhatsNewHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (seen() === NEWS[0].id) return undefined
    // after the app has settled, in sight, with no other window or the lock over it; tried again until it can show
    let t = 0
    const tryOpen = () => {
      if (seen() === NEWS[0].id) return
      if (document.hidden || document.querySelector('.modal-back, .lock, .prs2')) { t = setTimeout(tryOpen, 1500); return }
      setOpen(true)
    }
    t = setTimeout(tryOpen, 1500)
    const vis = () => { if (!document.hidden) { clearTimeout(t); t = setTimeout(tryOpen, 800) } }
    document.addEventListener('visibilitychange', vis)
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const [where, setWhere] = useState('all')
  if (!open) return null
  const close = () => { markSeen(); setOpen(false) }
  const kinds = new Set(itemsOf(NEWS[0]).map((x) => x.w))
  return (
    <Modal title="What's New" onClose={close} foot={<button type="button" className="btn btn-main wn-ok" onClick={close}>Got It</button>}>
      <div className="wn">
        {kinds.size > 1 && <WhereSeg where={where} setWhere={setWhere} />}
        <Entry n={NEWS[0]} where={where} />
      </div>
    </Modal>
  )
}

// Settings > What's New: every update
export function WhatsNewPage() {
  const [where, setWhere] = useState('all')
  useEffect(() => { markSeen() }, [])
  const shown = NEWS.filter((n) => where === 'all' || itemsOf(n).some((x) => x.w === where))
  return (
    <div className="wn wn-page">
      <WhereSeg where={where} setWhere={setWhere} />
      {shown.length ? shown.map((n) => <div key={n.id} className="set-box wn-box"><Entry n={n} where={where} /></div>) : <p className="wn-none">Nothing just for this one yet.</p>}
    </div>
  )
}
