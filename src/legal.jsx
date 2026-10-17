import { useEffect } from 'react'
import { locale } from './i18n.js'
import { Wordmark } from './ui.jsx'

/* Privacy Policy and Terms of Service (17 Oct 2026). Written to match what RoarMe really does: it keeps only what the
   chat needs, has no ads, no trackers and no analytics, and sells nothing. Greek when the app is in Greek.
   Shown in Settings > Privacy and Security, and as public pages: ?legal=privacy and ?legal=terms. */

const UPDATED = { en: '17 October 2026', el: '17 Οκτωβρίου 2026' }
const CONTACT = 'info@themadlions.com'

const DOCS = {
  privacy: {
    en: {
      title: 'Privacy Policy',
      lead: 'RoarMe is a chat by THE MAD LIONS, Athens, Greece. In short: we do not sell your data, we show no ads, we use no trackers or analytics, and we do not read or profile your messages. We keep only what the app needs to deliver your chats, and you can delete it.',
      sections: [
        ['What we keep, and why', [
          'Your account: email address, a password (stored only as a secure hash by our database provider), your @username and display name, and, if you add them, a profile photo and an "about" line. We need these so you can sign in and people can find you.',
          'What you send: messages, photos, videos, voice messages and files, with reactions, pins and the time each chat was last read. We keep them so they reach the people in the chat and stay in your history.',
          'Your "last seen" time, if your privacy settings allow it to be shown.',
          'Your settings (theme, chat colours, folders and similar) stay on your own device, not on our servers.',
        ]],
        ['What we do not collect', [
          'No advertising IDs, no ads, no tracking cookies, no analytics or crash-reporting tools.',
          'We do not upload your phone contacts. Your location is read only when you open Location and ask for it, and it is sent only if you send it to a chat, as a message like any other.',
          'We do not sell, rent or share your data with anyone for marketing, and we do not use your messages to build a profile of you.',
        ]],
        ['RoarTransfer', [
          'Large files sent with RoarTransfer are kept for 3 days and then deleted automatically, with their download links.',
          'A download link works for anyone who has it until it expires. Share it only with people you want to have the file.',
        ]],
        ['Calls', [
          'Voice and video calls go directly between the devices in the call (WebRTC). We do not record or store them. To connect the call, the devices contact connection servers run by Google and Cloudflare, which see the devices\' IP addresses.',
        ]],
        ['Where your data is', [
          'Accounts, messages and files are stored with Supabase, our database and storage provider, in London, United Kingdom. The app itself is served from GitHub Pages. These providers act on our behalf and keep short technical logs (such as IP address and device type) for security and to keep the service running.',
          'Data is encrypted in transit (HTTPS) and at rest by our provider. Messages are not end-to-end encrypted, so do not use RoarMe for information that needs that level of protection.',
          'The Translate button opens Google Translate with the text you chose, only when you tap it.',
          'The map in Location is drawn from OpenStreetMap data with tiles from CARTO, and place names and search come from OpenStreetMap\'s Nominatim service. They receive the area of the map being shown (and what you search for) with your IP address, never your name or account.',
        ]],
        ['How long we keep it, and how to delete it', [
          'Messages stay until they are deleted. In any chat you can turn on Auto-Delete, and messages older than the time you pick are removed.',
          'Settings > Privacy and Security > Delete My Account removes your account, your profile and your one-to-one chats. Messages you sent in groups stay for the other members, shown without your name.',
          'Devices that stay unused for a long time are signed out automatically.',
        ]],
        ['Your rights', [
          'Under the GDPR you can ask to see, correct, export or delete your data, and you can object to its use. Write to ' + CONTACT + ' and we will answer within one month. You can also complain to the Hellenic Data Protection Authority (www.dpa.gr).',
        ]],
        ['Age', [
          'RoarMe is for people aged 15 and over.',
        ]],
        ['Changes', [
          'If we change this policy we will update the date above and, for important changes, tell you in the app.',
        ]],
        ['Contact', [
          'THE MAD LIONS, Athens, Greece · ' + CONTACT,
        ]],
      ],
    },
    el: {
      title: 'Πολιτική Απορρήτου',
      lead: 'Το RoarMe είναι μια εφαρμογή συνομιλίας της THE MAD LIONS, Αθήνα. Με λίγα λόγια: δεν πουλάμε τα δεδομένα σου, δεν δείχνουμε διαφημίσεις, δεν χρησιμοποιούμε trackers ή analytics και δεν διαβάζουμε ούτε αναλύουμε τα μηνύματά σου. Κρατάμε μόνο ό,τι χρειάζεται για να λειτουργούν οι συζητήσεις σου, και μπορείς να το σβήσεις.',
      sections: [
        ['Τι κρατάμε και γιατί', [
          'Τον λογαριασμό σου: email, κωδικό (αποθηκεύεται μόνο κρυπτογραφημένος από τον πάροχο της βάσης), το @username και το όνομά σου και, αν τα προσθέσεις, φωτογραφία προφίλ και ένα «σχετικά». Τα χρειαζόμαστε για να συνδέεσαι και να σε βρίσκουν.',
          'Ό,τι στέλνεις: μηνύματα, φωτογραφίες, βίντεο, φωνητικά και αρχεία, μαζί με αντιδράσεις, καρφιτσώματα και πότε διαβάστηκε κάθε συζήτηση. Τα κρατάμε για να φτάνουν σε όσους είναι στη συζήτηση και να μένουν στο ιστορικό σου.',
          'Πότε ήσουν τελευταία φορά συνδεδεμένος, αν το επιτρέπουν οι ρυθμίσεις απορρήτου σου.',
          'Οι ρυθμίσεις σου (θέμα, χρώματα, φάκελοι κ.λπ.) μένουν στη δική σου συσκευή, όχι στους διακομιστές μας.',
        ]],
        ['Τι δεν συλλέγουμε', [
          'Κανένα αναγνωριστικό διαφήμισης, καμία διαφήμιση, κανένα cookie παρακολούθησης, κανένα εργαλείο analytics ή αναφοράς σφαλμάτων.',
          'Δεν ανεβάζουμε τις επαφές του κινητού σου. Η τοποθεσία σου διαβάζεται μόνο όταν ανοίξεις την Τοποθεσία και τη ζητήσεις, και στέλνεται μόνο αν τη στείλεις εσύ σε μια συζήτηση, ως μήνυμα όπως κάθε άλλο.',
          'Δεν πουλάμε, δεν νοικιάζουμε και δεν δίνουμε τα δεδομένα σου σε κανέναν για μάρκετινγκ, και δεν χρησιμοποιούμε τα μηνύματά σου για να φτιάξουμε προφίλ σου.',
        ]],
        ['RoarTransfer', [
          'Τα μεγάλα αρχεία που στέλνονται με RoarTransfer μένουν 3 μέρες και μετά σβήνονται αυτόματα, μαζί με τα link λήψης τους.',
          'Ένα link λήψης λειτουργεί για όποιον το έχει μέχρι να λήξει. Δώσ\' το μόνο σε όσους θέλεις να έχουν το αρχείο.',
        ]],
        ['Κλήσεις', [
          'Οι φωνητικές κλήσεις και οι βιντεοκλήσεις γίνονται απευθείας ανάμεσα στις συσκευές (WebRTC). Δεν τις ηχογραφούμε ούτε τις αποθηκεύουμε. Για να συνδεθεί η κλήση, οι συσκευές επικοινωνούν με διακομιστές σύνδεσης της Google και της Cloudflare, που βλέπουν τις διευθύνσεις IP τους.',
        ]],
        ['Πού βρίσκονται τα δεδομένα σου', [
          'Οι λογαριασμοί, τα μηνύματα και τα αρχεία φυλάσσονται στη Supabase, τον πάροχο βάσης δεδομένων και αποθήκευσης, στο Λονδίνο, Ηνωμένο Βασίλειο. Η ίδια η εφαρμογή σερβίρεται από το GitHub Pages. Οι πάροχοι αυτοί λειτουργούν για λογαριασμό μας και κρατούν σύντομα τεχνικά αρχεία (όπως διεύθυνση IP και τύπο συσκευής) για ασφάλεια και για τη λειτουργία της υπηρεσίας.',
          'Τα δεδομένα κρυπτογραφούνται κατά τη μεταφορά (HTTPS) και κατά την αποθήκευση από τον πάροχο. Τα μηνύματα δεν έχουν κρυπτογράφηση από άκρο σε άκρο, οπότε μη χρησιμοποιείς το RoarMe για πληροφορίες που χρειάζονται τέτοιο επίπεδο προστασίας.',
          'Το κουμπί Μετάφραση ανοίγει το Google Translate με το κείμενο που διάλεξες, μόνο όταν το πατήσεις.',
          'Ο χάρτης στην Τοποθεσία σχεδιάζεται με δεδομένα του OpenStreetMap και πλακίδια της CARTO, και τα ονόματα και η αναζήτηση τόπων έρχονται από την υπηρεσία Nominatim του OpenStreetMap. Λαμβάνουν την περιοχή του χάρτη που βλέπεις (και ό,τι ψάχνεις) μαζί με τη διεύθυνση IP σου, ποτέ το όνομα ή τον λογαριασμό σου.',
        ]],
        ['Πόσο τα κρατάμε και πώς τα σβήνεις', [
          'Τα μηνύματα μένουν μέχρι να σβηστούν. Σε κάθε συζήτηση μπορείς να ενεργοποιήσεις την Αυτόματη διαγραφή μηνυμάτων, και τα μηνύματα που είναι παλιότερα από τον χρόνο που διάλεξες σβήνονται.',
          'Ρυθμίσεις > Απόρρητο και ασφάλεια > Διαγραφή του λογαριασμού μου: σβήνει τον λογαριασμό, το προφίλ και τις ιδιωτικές σου συζητήσεις. Τα μηνύματα που έστειλες σε ομάδες μένουν για τα άλλα μέλη, χωρίς το όνομά σου.',
          'Συσκευές που μένουν πολύ καιρό αχρησιμοποίητες αποσυνδέονται αυτόματα.',
        ]],
        ['Τα δικαιώματά σου', [
          'Σύμφωνα με τον GDPR μπορείς να ζητήσεις να δεις, να διορθώσεις, να εξαγάγεις ή να σβήσεις τα δεδομένα σου, και να αντιταχθείς στη χρήση τους. Γράψε στο ' + CONTACT + ' και θα απαντήσουμε μέσα σε έναν μήνα. Μπορείς επίσης να απευθυνθείς στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (www.dpa.gr).',
        ]],
        ['Ηλικία', [
          'Το RoarMe είναι για άτομα 15 ετών και άνω.',
        ]],
        ['Αλλαγές', [
          'Αν αλλάξουμε αυτή την πολιτική θα ενημερώσουμε την ημερομηνία πιο πάνω και, για σημαντικές αλλαγές, θα σε ενημερώσουμε μέσα στην εφαρμογή.',
        ]],
        ['Επικοινωνία', [
          'THE MAD LIONS, Αθήνα · ' + CONTACT,
        ]],
      ],
    },
  },
  terms: {
    en: {
      title: 'Terms of Service',
      lead: 'These terms are the agreement between you and THE MAD LIONS, Athens, Greece, for using RoarMe. By creating an account you accept them.',
      sections: [
        ['Your account', [
          'You must be 15 or older. Give a real email address, keep your password and devices safe, and tell us if you think someone else is using your account.',
        ]],
        ['Your content', [
          'What you send stays yours. You allow us only to store it and deliver it to the people you send it to, so the app can work. We do not use it for anything else.',
          'You are responsible for what you send and for who you share RoarTransfer links with.',
        ]],
        ['What is not allowed', [
          'Anything illegal; harassment, threats or hate; spam; malware or attempts to break into accounts or the service; content you have no right to share; and any content that sexualises minors, which we report to the authorities.',
          'We may remove content or close accounts that break these rules.',
        ]],
        ['The service', [
          'RoarMe is provided "as is". We work to keep it running and safe, but we cannot promise it will never be interrupted or that nothing will ever be lost. Keep your own copies of anything important.',
          'We may change, add or remove features, and we may stop the service, telling you in advance where we can.',
        ]],
        ['Liability', [
          'As far as the law allows, THE MAD LIONS is not liable for indirect losses or for loss of data or content. Nothing here limits rights you have as a consumer under Greek and EU law.',
        ]],
        ['Ending', [
          'You can stop using RoarMe and delete your account at any time in Settings > Privacy and Security.',
        ]],
        ['Law', [
          'These terms are governed by Greek law; the courts of Athens have jurisdiction, without affecting your rights as a consumer.',
        ]],
        ['Changes and contact', [
          'If we change these terms we will update the date above and tell you in the app for important changes. Questions: ' + CONTACT + '.',
        ]],
      ],
    },
    el: {
      title: 'Όροι Χρήσης',
      lead: 'Οι όροι αυτοί είναι η συμφωνία ανάμεσα σε εσένα και τη THE MAD LIONS, Αθήνα, για τη χρήση του RoarMe. Με τη δημιουργία λογαριασμού τους αποδέχεσαι.',
      sections: [
        ['Ο λογαριασμός σου', [
          'Πρέπει να είσαι 15 ετών και άνω. Δώσε πραγματικό email, φύλαγε τον κωδικό και τις συσκευές σου, και πες μας αν πιστεύεις ότι κάποιος άλλος χρησιμοποιεί τον λογαριασμό σου.',
        ]],
        ['Το περιεχόμενό σου', [
          'Ό,τι στέλνεις μένει δικό σου. Μας επιτρέπεις μόνο να το αποθηκεύουμε και να το παραδίδουμε σε όσους το στέλνεις, για να λειτουργεί η εφαρμογή. Δεν το χρησιμοποιούμε για τίποτε άλλο.',
          'Είσαι υπεύθυνος για ό,τι στέλνεις και για το σε ποιους δίνεις links του RoarTransfer.',
        ]],
        ['Τι δεν επιτρέπεται', [
          'Οτιδήποτε παράνομο· παρενόχληση, απειλές ή μίσος· spam· κακόβουλο λογισμικό ή απόπειρες παραβίασης λογαριασμών ή της υπηρεσίας· περιεχόμενο που δεν έχεις δικαίωμα να μοιραστείς· και κάθε περιεχόμενο που σεξουαλικοποιεί ανηλίκους, το οποίο αναφέρουμε στις αρχές.',
          'Μπορούμε να αφαιρέσουμε περιεχόμενο ή να κλείσουμε λογαριασμούς που παραβιάζουν αυτούς τους κανόνες.',
        ]],
        ['Η υπηρεσία', [
          'Το RoarMe παρέχεται «ως έχει». Φροντίζουμε να λειτουργεί σωστά και με ασφάλεια, αλλά δεν μπορούμε να εγγυηθούμε ότι δεν θα διακοπεί ποτέ ή ότι δεν θα χαθεί ποτέ τίποτα. Κράτα δικά σου αντίγραφα ό,τι είναι σημαντικό.',
          'Μπορούμε να αλλάξουμε, να προσθέσουμε ή να αφαιρέσουμε λειτουργίες, και να σταματήσουμε την υπηρεσία, ενημερώνοντάς σε από πριν όπου είναι δυνατό.',
        ]],
        ['Ευθύνη', [
          'Στον βαθμό που το επιτρέπει ο νόμος, η THE MAD LIONS δεν ευθύνεται για έμμεσες ζημίες ή για απώλεια δεδομένων ή περιεχομένου. Τίποτα εδώ δεν περιορίζει τα δικαιώματα που έχεις ως καταναλωτής σύμφωνα με το ελληνικό και το ευρωπαϊκό δίκαιο.',
        ]],
        ['Τερματισμός', [
          'Μπορείς να σταματήσεις να χρησιμοποιείς το RoarMe και να σβήσεις τον λογαριασμό σου όποτε θέλεις, από Ρυθμίσεις > Απόρρητο και ασφάλεια.',
        ]],
        ['Δίκαιο', [
          'Οι όροι διέπονται από το ελληνικό δίκαιο· αρμόδια είναι τα δικαστήρια της Αθήνας, με την επιφύλαξη των δικαιωμάτων σου ως καταναλωτή.',
        ]],
        ['Αλλαγές και επικοινωνία', [
          'Αν αλλάξουμε τους όρους θα ενημερώσουμε την ημερομηνία πιο πάνω και θα σε ενημερώσουμε μέσα στην εφαρμογή για σημαντικές αλλαγές. Ερωτήσεις: ' + CONTACT + '.',
        ]],
      ],
    },
  },
}

const lang = () => (locale() === 'el-GR' ? 'el' : 'en')
export const legalTitle = (doc) => DOCS[doc][lang()].title
export const legalUrl = (doc) => `${window.location.origin}${window.location.pathname}?legal=${doc}`

/* the text itself; data-raw keeps the app's word-by-word translation away from it */
export function LegalDoc({ doc }) {
  const l = lang()
  const d = DOCS[doc][l]
  return (
    <article className="legal" data-raw="1" lang={l}>
      <p className="legal-date">{l === 'el' ? 'Τελευταία ενημέρωση' : 'Last updated'}: {UPDATED[l]}</p>
      <p className="legal-lead">{d.lead}</p>
      {d.sections.map(([h, ps]) => (
        <section key={h}>
          <h3>{h}</h3>
          {ps.map((p) => <p key={p.slice(0, 40)}>{p}</p>)}
        </section>
      ))}
    </article>
  )
}

/* the public page (?legal=privacy or ?legal=terms), no account needed */
export function LegalPage({ doc }) {
  const d = Object.prototype.hasOwnProperty.call(DOCS, doc) ? doc : 'privacy'
  useEffect(() => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'glass'
    document.title = `${legalTitle(d)} · RoarMe`
  }, [d])
  const other = d === 'privacy' ? 'terms' : 'privacy'
  return (
    <div className="legal-page">
      <div className="legal-card">
        <a className="legal-brand" href={`${window.location.origin}${window.location.pathname}`}><Wordmark by /></a>
        <h1>{legalTitle(d)}</h1>
        <LegalDoc doc={d} />
        <a className="legal-other" href={legalUrl(other)}>{legalTitle(other)} →</a>
      </div>
    </div>
  )
}
