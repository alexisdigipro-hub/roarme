// What's New (Alex, 22 Nov: "after an update, a small window once that says what changed, in bullets, minimal; closed, it
// does not come back; and a history of updates somewhere low in Settings"). NEWS is newest first; the window shows the
// newest entry once per device (localStorage roarme-news-seen), Settings > What's New lists them all.
// Every change people will notice adds a line to the newest entry, in its section (Everywhere, On a phone, On a
// computer; Alex, 22 Nov), or a new entry on a new day.
import { useEffect, useState } from 'react'
import { Modal } from './ui.jsx'

// a section with lab: true shows only to who sees what is still being built (inThemeLab; Chat.jsx sets it with newsLab)
let LAB = false
export const newsLab = (v) => { LAB = !!v }

export const NEWS = [
  {
    id: '2026-11-26',
    date: '26 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'Each account on the same phone keeps everything of its own: folders, pins, drafts, appearance, settings and mail. Nothing shows in the other account.',
        'More than one account: Settings > Add Account, then switch with one tap, or hold Settings in the bar at the foot. Notifications come from all of them, and a tap opens the right account.',
        'Pulling down to refresh no longer asks for your passcode or Face ID again.',
        'The folders at the top share the bar evenly, each one centred in its own part.',
        'Terms of Service and Privacy Policy on the sign-up page are light blue and easy to read.',
        'Settings > General > Reset All Settings, at the foot of the page: the look, notifications and sounds, chats, data and mail settings go back to how RoarMe starts. Your folders, chats, contacts and accounts stay.',
        'The round Unread button sends out soft rings, with the number in the middle.',
        'The Calls sign in the bar at the foot has the same line weight as the signs beside it.',
        'ROARMAIL: Junk, Trash, Sent, Drafts and Archive are read ahead in the background, so they open at once.',
        'A big RoarMoji or sticker with a reaction: the reaction and the time sit side by side under it, the time never broken in two.',
        'A delivered project now stays only in PROjects > Archived Projects, out of All, Unread and every other folder. Search still finds it.',
        'Tap a reply to see the message it answers: it lights up for a moment, words, photo or anything. From the calendar the day lights up too, so you see where it starts.',
        'An empty writing box stays one line tall, also beside a project\'s Workspace.',
        'A spoiler shimmers so you know to tap it, and opens from left to right.',
        'Bold, italic, underline and strike show straight away in the box you write in, with no asterisks to see.',
        'PROjects: a new project group no longer takes your whole team by itself. Add All Team in the group\'s Members or in Project Settings brings them in with one tap, each in their own chats.',
      ] },
      { title: 'On a computer', items: [
        'Arrow keys: left and right change folder, up and down open the chat above or below. While writing, hold Option (Alt on Windows).',
        'PROjects in the Mac and Windows apps: the Workspace can open in a window of its own. It sits snapped to the right of the chat window and moves with it; drag it away to keep it apart, for example on a second screen. Back into the chat window brings it home.',
        'Unlock with Touch ID in the Mac app: Settings > Privacy and Security > Passcode lock. The lock asks for your finger as soon as RoarMe opens; the passcode still works.',
      ] },
      { title: 'On a phone', items: [
        'Mail answers faster: what you tap no longer waits behind mail being fetched in the background, and long folders scroll lighter.',
        'Mail stays in step with your other devices: new mail shows by itself every half minute, and mail deleted elsewhere goes. A slide right anywhere on an open mail takes you back.',
        'The buttons that come out when you slide a mail (Read, Star, Move, Block, Trash) work again.',
        'Mail is quicker: RoarMe now keeps your mail accounts connected, so reading, deleting and moving mail no longer waits for a fresh sign-in each time.',
        'Mail goes at once: Delete, Move, Junk and Empty Trash or Junk take the mail away the moment you tap, and the server catches up in the background.',
        'All Mail at the foot of a folder brings every mail in it, and More Results brings the rest of a search.',
        'A tap on Mail at the foot always takes you to the start of your mail.',
        'New mail notifies you the moment it arrives, with the sender, the subject and a line of it, even with RoarMe closed; a tap opens that mail. Settings > ROARMAIL > Notifications turns it off, for all or for one account. Blocked senders and Junk stay quiet.',
        'Settings > ROARMAIL has the settings of RoarMail on the computer: Mark as Read, Privacy Mode, Block Trackers, Clean Links, Undo Send, Full Slide, quotes in colours and more.',
      ] },
    ],
  },
  {
    id: '2026-11-25',
    date: '25 November 2026',
    sections: [
      { title: 'On a phone', items: [
        'RoarMail inside RoarMe: turn it on in Settings > ROARMAIL and Mail joins the bar at the foot. Add Gmail, iCloud, Outlook, Yahoo or any mail, read, reply and keep your inbox tidy.',
      ] },
      { title: 'Everywhere', items: [
        'Calendar in every chat: tap a day like November 23 to see every day with its photos, jump to one, or select days and clear them.',
        'Pull down to refresh now catches on every page, and inside Mail too.',
        'Slide right to go back works on every page, even when your finger starts on a button or a colour; from the screen\'s left edge it always goes back.',
        'Sliding a chat or a mail sideways is steadier: the whole row moves with your finger and its buttons come in whole from the edge, never over the words.',
        'Pull down to refresh on Settings, Calls, Media and the mail too; you come back to the same page.',
        'Unread shows only chats again. Tap the dots there to select several: Delete, Read, Move, Archive.',
        'RoarTransfer: a file that got stuck on its way up (100% and nothing more) now goes on another way by itself and arrives.',
        'Pull to refresh keeps you where you were: the same tab, folder, chat or Settings page.',
        "PROjects: the Production Hub's Calendar in a project's Overview, above the Team: the month with its dots, the day's events, All types, Not available and +, with everything you see in the hub.",
        'Make the Ordino: its + also lets you add an ordino by its link, so it takes no line of its own.',
        'ALL stays blue while anything is unread, whichever folder you are in.',
        'The folder bar slides sideways easily when there are many folders.',
        'PROjects Overview: Video Chat, Voice Call and Schedule in a slim row right under the tabs; the Calls tab is gone.',
        'Settings, alike everywhere: Microphone, Camera and Speakers as rows; Media with the same head as every page; What\'s New with its choices in the middle; red words and chosen choices that read by Night; the brand at the foot of Settings whole above the bar.',
        'PROjects background: one picture for all projects, and any project can still have its own (Project Settings > More > Background).',
      ] },
      { title: 'On a phone', items: [
        'The iPhone app stays upright when you turn the phone on its side.',
      ] },
      { title: 'RoarMail', lab: true, items: [
        'Conversations is a sign in the bar over the mails again, and the signs there stand evenly, in from the edges.',
        'Add Account at the foot of Mailboxes: Gmail, iCloud, Outlook, Yahoo, AOL or any mail, with the steps each one asks for, or Import from RoarMail on your computer.',
        'An open mail keeps room at its left and right edges, so the words never touch the screen.',
        'On a computer, Settings > RoarMail shows what RoarMail is, with the download for Mac and Windows.',
        'A mail wider than the screen is drawn smaller to fit whole, no longer cut at the sides.',
        'The filter bar stays at the top while you scroll the mails.',
        'Settings > RoarMail > Show: the sender and the subject, the sender only, or the subject only.',
        'Search sits at the top beside the +, on every page of the mail. Conversations moved to Settings > RoarMail, so the bar over the mails is shorter.',
        'Swipe between the tabs at the bottom in their order: Contacts, Calls, Messages, Mail, Settings.',
        'The dots at the top work for the page you are on: edit the mailboxes, move folders up or down, select several mails, or the open mail\'s menu.',
        'With one account, RoarMail opens straight on its folders.',
        'A mail\'s long-press menu stands in the middle of the screen.',
        'The + at the top right is back, and inside RoarMail it starts a new message.',
        'No more bar with the name over the mail: back is at the top left, beside the dots.',
        'RoarMail moved from the folders at the top to the bar at the bottom: Mail, right of Messages, with its unread count. The bar stays the same inside the mail; tap Mail there to go back to your accounts. Mail no longer stands in Unread.',
        'Inside RoarMail the top reads ROARMAIL.',
        'Inside RoarMail the bar at the bottom is Contacts, New Mail and Settings. Contacts lists everyone with an email; tap one to write to them.',
        'Every account shows its address under its name, and the unread counts stand in one line.',
        'Over the mails one bar, as wide as the folders: back and the filters; no Unread filter, unread mail shows anyway.',
        'RoarMail settings that work, and more: Preview Lines, Sender Pictures, Mail in Unread, Check Every, Quote in Replies, Send New Mail From, an account in All Inboxes or not, how much is kept.',
        'Junk: mail from blocked senders leaves the Inbox by itself; Blocked Senders with Unblock; hold a mail for Move to Junk, Not Junk and Block @domain.',
        'Writing a mail as Apple\'s Mail: a full, clean page, X and a round Send at the top, To with + for your contacts, Cc/Bcc and From folded in one line, Subject with the clip, then the whole page for your words.',
        'Pick several mails: hold a mail and choose Select, tap the others, then Read, Star, Move, Junk or Delete for all of them.',
        'RoarMail is a place of its own: it slides in, the folder bar steps aside for the mail\'s own bar, and RoarMe in the bar at the bottom slides you back to your chats. Mail there takes you back to all your accounts; New Mail is the + at the top right.',
        'Edit Mailboxes: the dots at the top left inside RoarMail. Tick what shows, drag to reorder, and add All Sent, All Drafts, All Trash, All Junk, All Archive, Flagged, Unread, Attachments or Today.',
        'Slide right goes back on every RoarMail page, inside an open mail too.',
        'Every head in RoarMail is the same slim bar: an account\'s folders, an open mail and Contacts.',
        'Slide a mail from the right edge of the screen: Read, Star, Move, Block and Trash come out and stay until you tap.',
        'Hold a mail: Reply, Reply All, Forward, Move To, Archive, All From This Sender, Block Sender and Delete.',
        'New Mail: the round pencil at the bottom right of every RoarMail page. Reply and Forward from an open mail; a forward carries its files.',
        'Eight filters under the folder name: Search, Unread, Starred, Attachments, Conversations, one day, oldest first, one sender.',
        'Empty Trash and Empty Junk.',
        'Senders in your contacts show with the name and photo you have for them.',
        'Faster: the newest mail and every unread one are fetched in the background, so they open at once.',
        'Unread holds your mail too, mixed with the chats by time; All, Chats or Mail at the top.',
        'Settings, RoarMail: your accounts, reading, actions, signature and the mail kept on this phone.',
      ] },
    ],
  },
  {
    id: '2026-11-24',
    date: '24 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'Group pictures: a group with no photo wears the same round as a person with no photo, with the group sign in it, always the same colour for the same group.',
        'Group names in bold or italic show their first letter properly, not a box with a question mark.',
        'Archived is a word again in the folder bar, as every other folder.',
        'Empty folders made calm: one line and one glass button, Add Chats.',
        'On the computer, the welcome screen is only ROARME with by THEMADLIONS under it.',
        "A group's page no longer slides sideways on a phone, and in a PROject the Pre, Prod and Post choices sit under each name.",
        'On a computer the two panels have no white outline any more: the glass glows softly from its edges instead.',
      ] },
      { title: 'On a phone', items: [
        'Transfer: the Transfer button no longer hides under the bar at the foot of the + sheet.',
        'Transfer: while it uploads the ring keeps moving, a piece that hangs starts again by itself, and Stop and Keep Chatting stand side by side in the middle.',
        'Transfer: a file the phone no longer lets RoarMe read says so at once (pick it again), instead of trying for a minute and a half.',
        'The + sheet: it opens at two thirds of the screen, drag it up to fill the screen and down to bring it back or close it.',
        'Media: the camera is the first square of your photos, and Recents at the top opens your albums.',
        'Files: a tab of its own, with search, kinds, sort, list or grid, and several sent files picked at once to send again.',
        'The bar at the foot of the sheet is one frosted capsule.',
        'Chat Folders: drag a folder up or down by its dots to change the order of the tabs.',
      ] },
    ],
  },
  {
    id: '2026-11-23',
    date: '23 November 2026',
    sections: [
      { title: 'Everywhere', items: [
        'Roary: our own sticker character, a plush lion cub in 20 poses that move. Tap + and choose RoarMoji, he is at the top.',
        'RoarMoji: our own 3D emoji that move, drawn wherever you send an emoji, big when a message is only emoji, and in reactions. Tap + and choose RoarMoji for all of them, with ten film cameras.',
        'Unread: when something is new the chosen folder lights up in your colour. Slide the folders to the right and a round button with the number appears under them; tap it for your unread chats.',
        'Archived is a round sign with three binders at the right of the folders.',
        'PROJECTS is written in capitals everywhere: PRO in gold and bold, JECTS thin.',
        'Earlier messages in groups: when you add people, an admin chooses whether they see the chat from before. The clock beside each member turns it on or off later.',
        'Folder colours: a round colour button beside B I U S in Edit Folder gives the folder name a colour of its own.',
        'Passcode: it opens as soon as the last digit is right, no OK. Each device keeps its own passcode.',
        'PROJECTS is now in the same lettering as the RoarMe wordmark, as tall as the other folders.',
      ] },
      { title: 'On a computer', items: [
        'Unread with a mouse: point at the folders and the round Unread button peeks out at the left; click ALL to bring it out, click again to put it back.',
      ] },
    ],
  },
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
const markSeen = () => { try { localStorage.setItem(SEEN, newest().id) } catch { /* private window */ } }

// B of the sample https://claude.ai/artifact/AU8jUvGrMNKYDnFRb4ijGD (Alex, 22 Nov): a quiet timeline, each change a dot on a
// fine line, its first words in bold (what comes before ": " when it is short), and All / Phone / Computer to filter
const WHERE = { 'On a phone': 'phone', 'On a computer': 'computer', RoarMail: 'phone' }
const itemsOf = (n) => (n.sections || [{ title: '', items: n.items || [] }]).filter((g) => !g.lab || LAB).flatMap((g) => g.items.map((t) => ({ t, w: WHERE[g.title] || 'all' })))
// the newest entry with something for this person (an entry of lab lines alone is nothing for everyone else)
const newest = () => NEWS.find((n) => itemsOf(n).length) || NEWS[0]
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
    if (seen() === newest().id || seen() > newest().id) return undefined
    // after the app has settled, in sight, with no other window or the lock over it; tried again until it can show
    let t = 0
    const tryOpen = () => {
      if (seen() === newest().id || seen() > newest().id) return
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
  const kinds = new Set(itemsOf(newest()).map((x) => x.w))
  return (
    <Modal title="What's New" onClose={close} foot={<button type="button" className="btn btn-main wn-ok" onClick={close}>Got It</button>}>
      <div className="wn">
        {kinds.size > 1 && <WhereSeg where={where} setWhere={setWhere} />}
        <Entry n={newest()} where={where} />
      </div>
    </Modal>
  )
}

// Settings > What's New: every update
export function WhatsNewPage() {
  const [where, setWhere] = useState('all')
  useEffect(() => { markSeen() }, [])
  const shown = NEWS.filter((n) => itemsOf(n).length && (where === 'all' || itemsOf(n).some((x) => x.w === where)))
  return (
    <div className="wn wn-page">
      <WhereSeg where={where} setWhere={setWhere} />
      {shown.length ? shown.map((n) => <div key={n.id} className="set-box wn-box"><Entry n={n} where={where} /></div>) : <p className="wn-none">Nothing just for this one yet.</p>}
    </div>
  )
}
