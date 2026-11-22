// What's New (Alex, 22 Nov: "after an update, a small window once that says what changed, in bullets, minimal; closed, it
// does not come back; and a history of updates somewhere low in Settings"). NEWS is newest first; the window shows the
// newest entry once per device (localStorage roarme-news-seen), Settings > What's New lists them all.
// Every change people will notice adds a line to the newest entry, or a new entry on a new day.
import { useEffect, useState } from 'react'
import { Modal } from './ui.jsx'

export const NEWS = [
  {
    id: '2026-11-22',
    date: '22 November 2026',
    items: [
      'Projects: a gold PROJECTS folder. Turn a group into a project from its long-press menu.',
      'A project has its own workspace: media, files, Location Scout, calls, links, tasks, and Admin for budget and fees.',
      'Project settings are a page now. Project Info holds the details, brief, stage and the Shoot Day.',
      'On a phone the chat head shows the project’s title and Project side by side.',
      'Import from Telegram: bring a chat’s history and files into RoarMe (on a computer, from the profile’s More).',
      'Your address book: contacts with phones, emails, addresses and groups, import and export as .vcf.',
      'Archived is a drawer icon, always at the right end of the folder bar.',
      'On a computer a project\u2019s chat keeps its full name in the head; the workspace stays beside it even in a narrow window.',
      'Anything dropped into a chat is sent straight away.',
      'The number of unread messages on RoarMe’s icon.',
      'Five new colours in Appearance.',
    ],
  },
  {
    id: '2026-11-21',
    date: '21 November 2026',
    items: [
      'RoarMe’s own camera, with photo, video and dual, and pro controls.',
      'The photo and video editor: crop, draw, adjust, looks, and trim for videos.',
      '“typing…” in the chat list and in the chat’s head.',
      'Pinch to zoom the photo library.',
      'Videos play in the chat by themselves, muted, and open full screen with a tap.',
      'Long-press menus redrawn, with the background softly blurred.',
    ],
  },
  {
    id: '2026-11-20',
    date: '20 November 2026',
    items: [
      'Your status: Online, Away, Do Not Disturb, Invisible, or a status of your own.',
      'Hold Send for Send Without Sound, Schedule Message and Locked Message.',
      'Birthdays: a small bar on the day, with Wish.',
      'Share Battery, if you want your contacts to see it.',
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
      <ul className="wn-list">{n.items.map((t) => <li key={t}>{t}</li>)}</ul>
    </section>
  )
}

// the window, once after an update
export function WhatsNewHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (seen() === NEWS[0].id) return undefined
    const t = setTimeout(() => setOpen(true), 1200) // after the app has settled
    return () => clearTimeout(t)
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
