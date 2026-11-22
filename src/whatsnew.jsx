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
        'Projects: a gold PROJECTS folder. Turn a group into a project from its long-press menu.',
        'A project has its own workspace: media, files, Location Scout, calls, links, tasks, and Admin for budget and fees.',
        'The project\u2019s Overview gives a taste of everything: small thumbnails, then the latest documents, locations, links and tasks.',
        'The project\u2019s banner is calmer: its name on your own photo or the theme\u2019s colour, the shoot day under it.',
        'Songs show their real waveform, finer, read from the sound itself.',
        'Project tasks are one list: each task has its own status, due date, priority, people and subtasks; Completed folds away.',
        'Type @ in a new task to give it to someone in the group.',
        'A project\u2019s Files has a menu of the kinds there are: PDF, Documents, Music and the rest.',
        'Link a project to your TML Hub: every place in Location Scout goes into the hub\u2019s Locations by itself, with its photos.',
        'Project settings are a page now. Project Info holds the details, brief, stage and the Shoot Day.',
        'Your address book: contacts with phones, emails, addresses and groups, import and export as .vcf.',
        'Archived is a drawer icon, always at the right end of the folder bar.',
        'Five new colours in Appearance.',
        'This page, with what each update brought.',
      ] },
      { title: 'On a phone', items: [
        'In a project\u2019s chat the head shows the project\u2019s title and Project side by side; Project opens the workspace.',
        'The workspace pages fit the screen, with a slide between tabs.',
        'The number of unread messages on RoarMe\u2019s icon.',
      ] },
      { title: 'On a computer', items: [
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

function Entry({ n }) {
  return (
    <section className="wn-entry">
      <small className="wn-date">{n.date}</small>
      {(n.sections || [{ title: '', items: n.items || [] }]).map((g) => (
        <div key={g.title || 'all'} className="wn-sec">
          {g.title && <small className="wn-sec-t">{g.title}</small>}
          <ul className="wn-list">{g.items.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      ))}
    </section>
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
  if (!open) return null
  const close = () => { markSeen(); setOpen(false) }
  return (
    <Modal title="What's New" onClose={close} foot={<button type="button" className="btn btn-main wn-ok" onClick={close}>Got It</button>}>
      <div className="wn"><Entry n={NEWS[0]} /></div>
    </Modal>
  )
}

// Settings > What's New: every update
export function WhatsNewPage() {
  useEffect(() => { markSeen() }, [])
  return <div className="wn wn-page">{NEWS.map((n) => <div key={n.id} className="set-box wn-box"><Entry n={n} /></div>)}</div>
}
