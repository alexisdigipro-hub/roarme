import { EL } from './i18n-el.js'
import { getPrefs } from './prefs.js'

/* RoarMe in English or Greek (Alex, 16 Oct: "only English and Greek, the whole app in Greek").
   The app is written in English; in Greek every interface text on the page is swapped for its
   translation as it appears (exact texts from i18n-el.js, the changing ones from PATTERNS below).
   Messages, names and bios are never touched. Changing the language reloads RoarMe. */

export const LANGS = [['en', 'English', 'English'], ['el', 'Greek', 'Ελληνικά']]
export const lang = () => (getPrefs().lang === 'el' ? 'el' : 'en')
export const locale = () => (lang() === 'el' ? 'el-GR' : 'en-GB')

const plural = (n, one, many) => (Number(n) === 1 ? one : many)
const dur = (n, unit) => {
  const u = { hour: ['ώρα', 'ώρες'], day: ['ημέρα', 'ημέρες'], week: ['εβδομάδα', 'εβδομάδες'], month: ['μήνα', 'μήνες'] }[unit.replace(/s$/, '')]
  return `${n} ${plural(n, u[0], u[1])}`
}
const ago = (s) => s.replace(/^now$/, 'τώρα').replace(/^(\d+) min ago$/, 'πριν από $1 λεπ.').replace(/^(\d+) h ago$/, 'πριν από $1 ώρ.')

// texts with names and numbers in them
const PATTERNS = [
  [/^(\d+) members$/, (_, n) => `${n} μέλη`],
  [/^(\d+) selected$/, (_, n) => `${n} επιλεγμένα`],
  [/^(\d+) chats?$/, (_, n) => `${n} ${plural(n, 'συνομιλία', 'συνομιλίες')}`],
  [/^(\d+) of (\d+)$/, (_, a, b) => `${a} από ${b}`],
  [/^(\d+)% · (.+) of (.+)$/, (_, p, a, b) => `${p}% · ${a} από ${b}`],
  [/^(\d+) min ago$/, (_, n) => `πριν από ${n} λεπ.`],
  [/^active (.+)$/, (_, s) => `ενεργή ${ago(s)}`],
  [/^last seen yesterday$/, () => 'τελευταία φορά χθες'],
  [/^last seen (.+)$/, (_, s) => `τελευταία φορά ${s}`],
  [/^Muted for (\d+) (hours?|days?)$/, (_, n, u) => `Σίγαση για ${dur(n, u)}`],
  [/^Messages go after 1 (day|week|month)$/, (_, u) => `Τα μηνύματα σβήνουν μετά από ${dur(1, u)}`],
  [/^(\d+) messages forwarded$/, (_, n) => `Προωθήθηκαν ${n} μηνύματα`],
  [/^Call ended · (.+)$/, (_, t) => `Η κλήση τελείωσε · ${t}`],
  [/^Missed call from (.+)$/, (_, w) => `Αναπάντητη κλήση από ${w}`],
  [/^(.+) did not answer$/, (_, w) => `Δεν απάντησε: ${w}`],
  [/^(.+) declined$/, (_, w) => `Απέρριψε την κλήση: ${w}`],
  [/^(.+) is on another call$/, (_, w) => `Σε άλλη κλήση: ${w}`],
  [/^(.+) does not take calls from you\.$/, (_, w) => `${w}: δεν δέχεται κλήσεις από σένα.`],
  [/^(.+) is over 50 MB\.$/, (_, f) => `${f}: πάνω από 50 MB.`],
  [/^Making it smaller · (\d+)%$/, (_, n) => `Γίνεται μικρότερο · ${n}%`],
  [/^(.+) is over 50 MB even made smaller\. Send a shorter clip\.$/, (_, f) => `${f}: πάνω από 50 MB ακόμα και μικρότερο. Στείλε πιο σύντομο απόσπασμα.`],
  [/^(.+) is over 3 GB, the most RoarTransfer takes\.$/, (_, f) => `${f}: πάνω από 3 GB, το όριο του RoarTransfer.`],
  [/^RoarTransfer · (\d+)% · (.+) of (.+)$/, (_, n, a, b) => `RoarTransfer · ${n}% · ${a} από ${b}`],
  [/^(\d+) files over 50 MB go by RoarTransfer, kept 3 days\.$/, (_, n) => `${n} αρχεία πάνω από 50 MB πάνε με RoarTransfer και μένουν 3 μέρες.`],
  [/^(Bold|Italic|Underline|Strikethrough|Code|Spoiler) \((.+)\)$/, (_, w, k) => `${{ Bold: 'Έντονα', Italic: 'Πλάγια', Underline: 'Υπογράμμιση', Strikethrough: 'Διαγραφή', Code: 'Κώδικας', Spoiler: 'Spoiler' }[w]} (${k})`],
  [/^(\d+) files sent!$/, (_, n) => `Στάλθηκαν ${n} αρχεία!`],
  [/^(\d+) files · (.+) of 3 GB$/, (_, n, s) => `${n} αρχεία · ${s} από 3 GB`],
  [/^1 file · (.+) of 3 GB$/, (_, s) => `1 αρχείο · ${s} από 3 GB`],
  [/^(.+) of (.+) · (\d+) of (\d+) sent$/, (_, a, b, x, y) => `${a} από ${b} · ${x} από ${y} στάλθηκαν`],
  [/^In (.+), and anyone with the link can download until (.+)\.$/, (_, w, d) => `Στο ${w}, και όποιος έχει το link μπορεί να το κατεβάσει ως ${d}.`],
  [/^Pinned messages · (\d+)$/, (_, n) => `Καρφιτσωμένα · ${n}`],
  [/^(\d+) pinned messages$/, (_, n) => `${n} καρφιτσωμένα μηνύματα`],
  [/^(\d+) days left$/, (_, n) => `μένουν ${n} μέρες`],
  [/^(\d+) h left$/, (_, n) => `μένουν ${n} ώρες`],
  [/^([A-Z0-9]{1,5}) · (Video|Image|Audio|Document|File)$/, (_, e, k) => `${e} · ${{ Video: 'Βίντεο', Image: 'Εικόνα', Audio: 'Ήχος', Document: 'Έγγραφο', File: 'Αρχείο' }[k]}`],
  [/^until (.+)$/, (_, d) => `ως ${d}`],
  [/^of 3 GB · (\d+) files$/, (_, n) => `από 3 GB · ${n} αρχεία`],
  [/^of 3 GB · 1 file$/, () => 'από 3 GB · 1 αρχείο'],
  [/^(\d+) Photos?, (\d+) Videos?$/, (_, p, v) => `${p} φωτογραφίες, ${v} βίντεο`],
  [/^New RoarMe app: (.+)$/, (_, v) => `Νέα εφαρμογή RoarMe: ${v}`],
  [/^You have (.+)\. Download it and install it over the old one\.$/, (_, v) => `Έχεις την ${v}. Κατέβασέ τη και βάλ’ τη πάνω από την παλιά.`],
  [/^RoarMe (\d+\.\d+\.\d+) is out$/, (_, v) => `Βγήκε το RoarMe ${v}`],
  [/^Version (.+)$/, (_, v) => `Έκδοση ${v}`],
  [/^Delete all (\d+) calls from your list\? The other person keeps theirs\.$/, (_, n) => `Διαγραφή και των ${n} κλήσεων από τη λίστα σου; Ο άλλος κρατά τις δικές του.`],
  [/^Joined (.+)$/, (_, d) => `Γράφτηκε ${d}`],
  [/^Seen (.+)$/, (_, d) => `Εμφανίστηκε ${d}`],
  [/^(\d+) messages$/, (_, n) => `${n} μηνύματα`],
  [/^(\d+) chats$/, (_, n) => `${n} συζητήσεις`],
  [/^(\d+) files · (.+)$/, (_, n, b) => `${n} αρχεία · ${b}`],
  [/^(\d+) new messages$/, (_, n) => `${n} νέα μηνύματα`],
  [/^in (\d+) chats$/, (_, n) => `σε ${n} συνομιλίες`],
  [/^and (\d+) more$/, (_, n) => `και ${n} ακόμα`],
  [/^(\d+) min read$/, (_, n) => `${n} λεπτά ανάγνωσης`],
  [/^(\d+) min$/, (_, n) => `${n} λεπτά`],
  [/^In (\d+) min$/, (_, n) => `Σε ${n} λεπτά`],
  [/^Join from (.+)$/, (_, t) => `Μπες από τις ${t}`],
  [/^In (\d+) h (\d+) min$/, (_, h, n) => `Σε ${h} ώρ. ${n} λεπ.`],
  [/^In (\d+) days$/, (_, n) => `Σε ${n} μέρες`],
  [/^Starting now: (.+)$/, (_, t) => `Ξεκινά τώρα: ${t}`],
  [/^Call with (.+)$/, (_, w) => `Κλήση με ${w}`],
  [/^Expires in (\d+) days$/, (_, n) => `Λήγει σε ${n} μέρες`],
  [/^Expires in (\d+) h$/, (_, n) => `Λήγει σε ${n} ώρες`],
  [/^Expires (.+)$/, (_, d) => `Λήγει ${d}`],
  [/^(.+) added$/, (_, w) => `Προστέθηκε: ${w}`],
  [/^(.+) removed$/, (_, w) => `Αφαιρέθηκε: ${w}`],
  [/^(.+) blocked$/, (_, w) => `Αποκλείστηκε: ${w}`],
  [/^(.+) unblocked$/, (_, w) => `Άρση αποκλεισμού: ${w}`],
  [/^Block (.+)\? They will not be able to message or call you, or add you to groups\.$/, (_, w) => `Αποκλεισμός: ${w}; Δεν θα μπορεί να σου στέλνει μηνύματα, να σε καλεί ή να σε βάζει σε ομάδες.`],
  [/^Chats in (.+)$/, (_, f) => `Συνομιλίες στο ${f}`],
  [/^Clear the history of (.+)\? It goes for you only, on this computer\.$/, (_, w) => `Εκκαθάριση ιστορικού με ${w}; Σβήνει μόνο για σένα, σε αυτόν τον υπολογιστή.`],
  [/^Delete (.+) and leave the group\?$/, (_, g) => `Διαγραφή της ομάδας ${g} και αποχώρηση;`],
  [/^Delete (.+) for everyone, with all its messages\?$/, (_, g) => `Διαγραφή της ομάδας ${g} για όλους, μαζί με όλα τα μηνύματα;`],
  [/^Delete the chat with (.+) from your list\? A new message brings it back\.$/, (_, w) => `Διαγραφή της συνομιλίας με ${w} από τη λίστα σου; Ένα νέο μήνυμα τη φέρνει πίσω.`],
  [/^Delete this chat from your list\? A new message brings it back\.$/, () => 'Διαγραφή αυτής της συνομιλίας από τη λίστα σου; Ένα νέο μήνυμα τη φέρνει πίσω.'],
  [/^Delete (\d+) chats from your list\? A new message brings it back\.$/, (_, n) => `Διαγραφή ${n} συνομιλιών από τη λίστα σου; Ένα νέο μήνυμα τις φέρνει πίσω.`],
  [/^Delete the folder (.+)\? The chats in it stay\.$/, (_, f) => `Διαγραφή του φακέλου ${f}; Οι συνομιλίες του μένουν.`],
  [/^Leave (.+)\?$/, (_, g) => `Αποχώρηση από ${g};`],
  [/^No messages with (.+) yet\. Say hi\.$/, (_, w) => `Δεν υπάρχουν ακόμα μηνύματα με ${w}. Πες ένα γεια.`],
  [/^Remove (.+) from (.+)\?$/, (_, w, g) => `Αφαίρεση ${w} από ${g};`],
  [/^Reply to yourself$/, () => 'Απάντηση στον εαυτό σου'],
  [/^Reply to (.+)$/, (_, w) => `Απάντηση σε ${w}`],
  [/^Seen by (.+)$/, (_, w) => `Το είδαν: ${w}`],
  [/^Sign out (.+)\?$/, (_, d) => `Αποσύνδεση: ${d};`],
  [/^Theme updated: (.+)$/, (_, t) => `Το θέμα άλλαξε: ${t}`],
  [/^Upload failed \((.+)\)$/, (_, c) => `Το ανέβασμα απέτυχε (${c})`],
  [/^Your photo for (.+)$/, (_, w) => `Η φωτογραφία σου για ${w}`],
  [/^Photo · (.+)$/, (_, s) => `Φωτογραφία · ${s}`],
  [/^Video · (.+)$/, (_, s) => `Βίντεο · ${s}`],
  [/^GIF · (.+)$/, (_, s) => `GIF · ${s}`],
  [/^Open RoarMe \((\d+) unread\)$/, (_, n) => `Άνοιγμα RoarMe (${n} αδιάβαστα)`],
  [/^(\d+) px$/, (_, n) => `${n} px`],
]

/* one text in Greek, keeping the spaces around it; anything unknown stays as it is */
export function tr(s) {
  if (lang() !== 'el' || typeof s !== 'string') return s
  const t = s.trim()
  if (!t || !/[A-Za-z]/.test(t)) return s
  let out = EL[t]
  if (out == null) {
    for (const [re, f] of PATTERNS) {
      const m = t.match(re)
      if (m) { out = f(...m); break }
    }
  }
  return out == null ? s : s.replace(t, out)
}

// what is never translated: messages, names, bios, file names, previews of themes and wallpapers
const SKIP = '.bubble .text, .quote span, .peek-msg span, .pf-field span, .compose-ref-text span, .fmt-pre, .fmt-code, .room-top strong, .head-text strong, .person-text b, .pf-name, .set-me-text, .call-who b, .file-text b, .music-top b, .wall-b, .set-preview, .mfa-secret, kbd, [data-raw]'
const ATTRS = ['placeholder', 'title', 'aria-label']

function fixText(node) {
  const el = node.parentElement
  if (!el || el.closest(SKIP) || el.closest('script, style')) return
  const v = node.nodeValue
  const n = tr(v)
  if (n !== v) node.nodeValue = n
}
function fixAttrs(el) {
  if (el.closest(SKIP)) return
  ATTRS.forEach((a) => {
    const v = el.getAttribute(a)
    if (v) { const n = tr(v); if (n !== v) el.setAttribute(a, n) }
  })
}
function walk(root) {
  if (root.nodeType === 3) { fixText(root); return }
  if (root.nodeType !== 1) return
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) fixText(n)
  fixAttrs(root)
  root.querySelectorAll('[placeholder], [title], [aria-label]').forEach(fixAttrs)
}

export function startI18n() {
  document.documentElement.lang = lang()
  if (lang() !== 'el') return
  // the browser's own windows (confirm, prompt) in Greek too
  const oc = window.confirm.bind(window)
  const op = window.prompt.bind(window)
  window.confirm = (m) => oc(tr(m))
  window.prompt = (m, d) => op(tr(m), d)
  const obs = new MutationObserver((list) => {
    list.forEach((m) => {
      if (m.type === 'characterData') fixText(m.target)
      else if (m.type === 'attributes') fixAttrs(m.target)
      else m.addedNodes.forEach(walk)
    })
  })
  const go = () => {
    walk(document.body)
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
  }
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go)
}
