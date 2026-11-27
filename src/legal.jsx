import { useEffect } from 'react'
import { locale } from './i18n.js'
import { Wordmark } from './ui.jsx'
import { appUrl } from './lib.js'

/* Privacy Policy and Terms of Service (17 Oct 2026; 23 Nov: PROjects, the Production Hub and the $; brought up to date 15 Nov for the App Store: phone number and SMS,
   contacts as hashes, location and live location, camera / microphone / photos, Apple push, group calls, reports,
   deletion inside the app; before that 25 Oct: emails, notifications, LiveKit calls,
   RoarTransfer on Cloudflare R2, folders synced, the other apps on the same account). Written to match what RoarMe really does: it keeps only what the
   chat needs, has no ads, no trackers and no analytics, and sells nothing. Greek when the app is in Greek.
   Shown in Settings > Privacy and Security, and as public pages: ?legal=privacy and ?legal=terms. */

const UPDATED = { en: '27 November 2026', el: '27 Νοεμβρίου 2026' }
const CONTACT = 'info@themadlions.com'

const DOCS = {
  privacy: {
    en: {
      title: 'Privacy Policy',
      lead: 'RoarMe is a chat app by THE MAD LIONS, Athens, Greece, on the web and on iPhone. In short: we do not sell your data, we show no ads, we use no trackers or analytics, we do not track you across other apps or websites, and we do not read or profile your messages. We keep only what the app needs to deliver your chats, and you can delete it at any time from inside the app.',
      sections: [
        ['What we keep, and why', [
          'Your account: email address, a password (stored only as a secure hash by our database provider), your @username and display name and, if you add them, a profile photo, an "about" line and a name colour. We need these so you can sign in and people can find you.',
          'Your phone number, only if you choose to add it. It is checked with a one-time code sent by SMS and is used so that friends who have your number can find you. You can remove it, and turn off Let People Find Me, in Settings > Privacy and Security.',
          'What you send: messages, photos, videos, voice and video messages and files, and what you share in a chat (a place, a live location, a contact card, an event, a call), with reactions, pins, reminders, scheduled messages and the time each chat was last read. We keep them so they reach the people in the chat and stay in your history.',
          'Your "last seen" time, if your privacy settings allow it to be shown, and the list of people you have blocked.',
          'Your chat folders and the names you give your contacts, so they are the same on every device you use. Your other settings (theme, chat colours, wallpaper and similar) stay on your own device.',
          'Your address book, if you use it: the contacts you add or import yourself (names, phone numbers, emails, addresses, birthdays, websites, notes, groups and a photo). Only you can see it; it is kept so you have it on every device, and you can export it as a .vcf file or delete any contact at any time. Contacts read from your iPhone are added only when you choose Import, and nothing is sent to the people in it.',
          'Projects, if a group is made one: its stage, dates, brief and details (such as artist, title, category and budget), tasks, location scouting (places, addresses, contact names and numbers you enter, notes and photos), ordinos linked to it and a cover picture. Every member of the group can see and change these. The project\'s admin side (budget, expenses, who worked on it and their fees) is seen only by the group\'s admins and the members they choose, and so is how often each member opened the project and for how long. All of it is deleted when the group stops being a project or is deleted.',
          'PROjects (optional, off until you turn it on): a project group has three chats (Pre Production, Production, Post Production); the group\'s admins choose who sees which, and only those in Pre Production and the admins can change the project; everyone in the group can see its Overview (song, ordino, open tasks and the team). A background picture a member uploads for the project is seen by everyone who sees it. Notices about tasks (put on a task, a task done, a task due) are shown only to the person they concern. Someone who linked a Production Hub can mark contacts as Hub Members with a category; these people are added to that person\'s new project groups in that category.',
          'Production Hub: if a project is tied to a Production Hub (The Mad Lions\' production tool, a separate service you link with a key), its title, stage, shoot day, category, tasks and locations are kept the same on both sides, and the hub\'s cover, songs, location photos and published ordinos are shown in RoarMe. When you use the $ in a project\'s chat, what you enter (a payment: description, role, amount, status, notes; or an expense: amount, VAT, what for, category, shop, date, who paid, notes and the photo or PDF of the receipt) is sent to that hub, where you are found by your RoarMe email; it is kept there under the hub\'s own terms.',
          'Reports: if you report a message or a person, we keep the report, your note and a copy of the reported message so we can review it. Reports are seen only by RoarMe\'s administrator.',
          'Errors and backups: when RoarMe breaks on your device it sends us what went wrong (the error, the screen, the kind of device and system), never your messages or files. To keep RoarMe safe we copy its database once a day (the newest ten copies are kept, seen only by RoarMe\'s administrator) and look over it for spam, fake accounts and attacks.',
        ]],
        ['What we do not collect', [
          'No advertising identifiers, no ads, no tracking cookies, no analytics or crash-reporting tools, and no tracking across other companies\' apps or websites.',
          'We do not sell, rent or share your data with anyone for marketing, and we do not use your messages to build a profile of you or to train any AI.',
        ]],
        ['Your contacts (iPhone app)', [
          'Find Friends From Your Contacts works only if you start it and allow access to your contacts. The email addresses and phone numbers in your address book never leave your phone: the app turns each one into a one-way code (a SHA-256 hash) on the phone and sends only those codes, to see which ones belong to RoarMe users who allow being found. We do not keep the codes you send, and we never store your address book. If you invite someone, the invitation goes by your phone\'s own Messages app.',
        ]],
        ['Your location', [
          'Your location is read only when you open Location in a chat and allow it. Send Location sends one place, as a message like any other.',
          'A Locked Message keeps its words on our servers until it opens: at the time you chose, or when a person in the chat is within the place you chose. To check the place, their phone sends its position once, when they press I’m Here; it is compared and not kept.',
          'Your birthday (day and month, and the year if you add it) is kept only if you add it in your profile; your contacts see the day and month unless you choose Nobody, and the year is shown to nobody. Share Battery is off until you turn it on; then, while RoarMe is open, your battery level and whether it is charging are kept and shown on your profile to the people you chose.',
          'Live Location sends your position again and again for the time you choose (15 minutes, 1 hour, 8 hours or until you stop it), and only while RoarMe is open on your phone. The people in that chat see it move. It stops when the time ends or when you press Stop Sharing; the last position stays with the message until the message is deleted.',
        ]],
        ['Camera, microphone and photos', [
          'RoarMe uses the camera and the microphone only when you take a photo or video, record a voice or video message, or are on a call, and your photo library only when you choose photos or files to send. Nothing is recorded or uploaded without your action.',
          'Photos you send from the Gallery are made smaller on your device before they are sent; files sent from File are sent exactly as they are.',
        ]],
        ['Emails, SMS and notifications', [
          'We email you to confirm your account and reset your password and, if you leave it on, to remind you of unread messages. These emails are sent through Resend and never contain what the messages say. Every reminder has a link that turns them off.',
          'If you add a phone number, the verification code is sent by SMS through Twilio, which receives your number for that purpose only.',
          'If you turn on notifications, your device gives us an address for it (a push token). In a browser, each notification is encrypted for your device before it leaves our server. In the iPhone app, notifications are delivered by the Apple Push Notification service. A notification shows who wrote and, if you allow previews, the start of the message; you can turn previews off in Settings > Notifications and Sounds.',
        ]],
        ['Calls', [
          'Voice and video calls, group video chats and call links connect through LiveKit, our call service, or directly between the devices (WebRTC), helped by connection servers of Google and Cloudflare. They are encrypted in transit and we never record or store them. These services see the devices\' IP addresses for the length of the call. We keep the call log (who called whom, when, and how long).',
        ]],
        ['RoarTransfer', [
          'Large files you send with RoarTransfer are stored with Cloudflare R2. You choose how long their link lasts (1, 3 or 7 days); when it ends the file is deleted within the hour. Each file can be downloaded a limited number of times.',
          'A download link works for anyone who has it until it ends. Share it only with people you want to have the file. RoarTransfer has its own Privacy Policy at roartransfer.com/privacy.',
        ]],
        ['When you use other services', [
          'The map in Location is OpenStreetMap\'s, and place names and search come from OpenStreetMap\'s Nominatim service. It receives the area of the map being shown (and what you search for) with your IP address, never your name or account.',
          'A video link (YouTube, Vimeo) plays in that service\'s own player, which then receives your IP address under its own policy.',
        ]],
        ['Where your data is, and who sees it', [
          'Accounts, messages and files are stored with Supabase, our database and storage provider, in London, United Kingdom; RoarTransfer files with Cloudflare R2. The website is served from GitHub Pages. These providers, and Resend, Twilio, LiveKit and Apple for the parts named above, act on our behalf and keep short technical logs (such as IP address and device type) for security and to keep the service running.',
          'To run RoarMe and keep it safe, its administrator at The Mad Lions can see the list of accounts (name, @username, email, when they joined and were last seen), the details of files sent (name, size, type, when, by whom, how often downloaded) and the reports people send. Never what other messages or files say.',
          'Data is encrypted in transit (HTTPS) and at rest by our providers. Messages are not end-to-end encrypted, except text written while Encrypted Chat is on in a chat: that is encrypted on the device and only the devices of the people in that chat can read it, not RoarMe. Photos, files and voice messages are never end-to-end encrypted.',
          'Your RoarMe account also signs you in to RoarWriter, Roardino and RoarTransfer. Each of them has its own policy for what it keeps.',
          'Mail (ROARMAIL): only if you add a mail account in RoarMe, or press Send to RoarMe in RoarMail on your computer, that mail account\'s password (or its Microsoft sign-in) is checked once against its mail server and kept encrypted in Supabase Vault, so RoarMe can read that account\'s mail from its mail server for you and send the mail you write there through it. Nobody can read the password back, not even you; the mail itself is fetched each time you look and is not stored by us; the newest mails and the ones you opened are kept on your phone so they open at once, until you clear them or sign out. Block Sender adds the sender to your block list (the one RoarMail keeps in your Roar Account, or one of its own in RoarMe if you do not use RoarMail). Removing the account in Settings > ROARMAIL, or Remove from RoarMe in RoarMail, deletes the password at once. With Notifications on (Settings > ROARMAIL), our mail server keeps your Inbox connected and, when a mail arrives, sends your devices a notification with its sender, subject and first line; only the number of the newest mail told about is kept.',
        ]],
        ['How long we keep it, and how to delete it', [
          'Messages stay until they are deleted. You can delete your own messages for everyone, clear a chat, and turn on Auto-Delete in any chat so that messages older than the time you pick are removed.',
          'Settings > Privacy and Security > Delete My Account deletes your account at once, inside the app: your profile, phone number, contacts, folders, push tokens and your one-to-one chats. Messages you sent in groups stay for the other members, shown without your name.',
          'Devices that stay unused for a long time are signed out automatically. Server logs are kept by our providers for a short time only.',
        ]],
        ['Your rights', [
          'Under the GDPR you can ask to see, correct, export or delete your data, and you can object to its use. Write to ' + CONTACT + ' and we will answer within one month. You can also complain to the Hellenic Data Protection Authority (www.dpa.gr).',
          'We process your data to provide the service you asked for (your account and chats), on your consent where the app asks for it (contacts, location, camera, microphone, notifications, which you can withdraw in your device\'s settings), and for our legitimate interest in keeping RoarMe safe (reports and security logs).',
        ]],
        ['Age', [
          'RoarMe is for people aged 15 and over, and is not directed at children.',
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
      lead: 'Το RoarMe είναι μια εφαρμογή συνομιλίας της THE MAD LIONS, Αθήνα, στο web και στο iPhone. Με λίγα λόγια: δεν πουλάμε τα δεδομένα σου, δεν δείχνουμε διαφημίσεις, δεν χρησιμοποιούμε trackers ή analytics, δεν σε παρακολουθούμε σε άλλες εφαρμογές ή ιστοσελίδες και δεν διαβάζουμε ούτε αναλύουμε τα μηνύματά σου. Κρατάμε μόνο ό,τι χρειάζεται για να λειτουργούν οι συζητήσεις σου, και μπορείς να το σβήσεις όποτε θέλεις μέσα από την εφαρμογή.',
      sections: [
        ['Τι κρατάμε και γιατί', [
          'Τον λογαριασμό σου: email, κωδικό (αποθηκεύεται μόνο κρυπτογραφημένος από τον πάροχο της βάσης), το @username και το όνομά σου και, αν τα προσθέσεις, φωτογραφία προφίλ, ένα «σχετικά» και ένα χρώμα ονόματος. Τα χρειαζόμαστε για να συνδέεσαι και να σε βρίσκουν.',
          'Τον αριθμό του κινητού σου, μόνο αν διαλέξεις να τον προσθέσεις. Επιβεβαιώνεται με κωδικό μιας χρήσης μέσω SMS και χρησιμοποιείται για να σε βρίσκουν φίλοι που έχουν τον αριθμό σου. Μπορείς να τον αφαιρέσεις, και να κλείσεις το «Να με βρίσκουν», από Ρυθμίσεις > Απόρρητο και ασφάλεια.',
          'Ό,τι στέλνεις: μηνύματα, φωτογραφίες, βίντεο, φωνητικά και βιντεομηνύματα και αρχεία, και ό,τι μοιράζεσαι σε μια συζήτηση (μια τοποθεσία, μια ζωντανή τοποθεσία, μια επαφή, ένα γεγονός, μια κλήση), μαζί με αντιδράσεις, καρφιτσώματα, υπενθυμίσεις, προγραμματισμένα μηνύματα και πότε διαβάστηκε κάθε συζήτηση. Τα κρατάμε για να φτάνουν σε όσους είναι στη συζήτηση και να μένουν στο ιστορικό σου.',
          'Πότε ήσουν τελευταία φορά συνδεδεμένος, αν το επιτρέπουν οι ρυθμίσεις απορρήτου σου, και τη λίστα με όσους έχεις μπλοκάρει.',
          'Τους φακέλους των συζητήσεών σου και τα ονόματα που δίνεις στις επαφές σου, για να είναι ίδια σε κάθε συσκευή σου. Οι υπόλοιπες ρυθμίσεις σου (θέμα, χρώματα, ταπετσαρία κ.λπ.) μένουν στη δική σου συσκευή.',
          'Το βιβλίο επαφών σου, αν το χρησιμοποιείς: οι επαφές που προσθέτεις ή εισάγεις εσύ (ονόματα, τηλέφωνα, email, διευθύνσεις, γενέθλια, ιστοσελίδες, σημειώσεις, ομάδες και μια φωτογραφία). Το βλέπεις μόνο εσύ· κρατιέται για να το έχεις σε κάθε συσκευή σου, και μπορείς να το εξαγάγεις ως αρχείο .vcf ή να σβήσεις όποια επαφή θέλεις, όποτε θέλεις. Επαφές από το iPhone σου μπαίνουν μόνο όταν επιλέξεις Εισαγωγή, και δεν στέλνεται τίποτα στους ανθρώπους που περιέχει.',
          'Τα projects, αν μια ομάδα γίνει project: η φάση, οι ημερομηνίες, η περιγραφή και τα στοιχεία του (όπως καλλιτέχνης, τίτλος, κατηγορία και budget), εργασίες, location scouting (χώροι, διευθύνσεις, ονόματα και τηλέφωνα επαφών που γράφεις, σημειώσεις και φωτογραφίες), ordinos που συνδέονται με αυτό και μια εικόνα εξωφύλλου. Τα βλέπουν και τα αλλάζουν όλα τα μέλη της ομάδας. Το διαχειριστικό κομμάτι (budget, έξοδα, ποιοι δούλεψαν και οι αμοιβές τους) το βλέπουν μόνο οι διαχειριστές της ομάδας και τα μέλη που επιλέγουν, όπως και πόσες φορές και για πόση ώρα άνοιξε το project κάθε μέλος. Όλα σβήνονται όταν η ομάδα πάψει να είναι project ή διαγραφεί.',
          'PROjects (προαιρετικό, κλειστό μέχρι να το ανοίξεις): μια ομάδα project έχει τρία chat (Pre Production, Production, Post Production)· οι διαχειριστές της ομάδας επιλέγουν ποιος βλέπει ποιο, και μόνο όσοι είναι στο Pre Production και οι διαχειριστές μπορούν να αλλάξουν το project· όλοι στην ομάδα βλέπουν το Overview του (τραγούδι, ordino, ανοιχτές εργασίες και την ομάδα). Μια εικόνα φόντου που ανεβάζει ένα μέλος για το project τη βλέπουν όλοι όσοι το βλέπουν. Οι ειδοποιήσεις για εργασίες (σε έβαλαν σε μια εργασία, μια εργασία έγινε, μια εργασία λήγει) εμφανίζονται μόνο σε αυτόν που αφορούν. Όποιος έχει συνδέσει ένα Production Hub μπορεί να ορίσει επαφές ως Hub Members με μια κατηγορία· αυτοί μπαίνουν στις νέες ομάδες project του σε αυτή την κατηγορία.',
          'Production Hub: αν ένα project είναι συνδεδεμένο με ένα Production Hub (το εργαλείο παραγωγής της The Mad Lions, ξεχωριστή υπηρεσία που συνδέεις με ένα κλειδί), ο τίτλος, η φάση, η μέρα γυρίσματος, η κατηγορία, οι εργασίες και οι τοποθεσίες μένουν ίδια και στις δύο πλευρές, και το εξώφυλλο, τα τραγούδια, οι φωτογραφίες τοποθεσιών και τα δημοσιευμένα ordinos του hub φαίνονται στο RoarMe. Όταν χρησιμοποιείς το $ στο chat ενός project, ό,τι γράφεις (μια πληρωμή: περιγραφή, ρόλος, ποσό, κατάσταση, σημειώσεις· ή ένα έξοδο: ποσό, ΦΠΑ, για τι, κατηγορία, κατάστημα, ημερομηνία, ποιος πλήρωσε, σημειώσεις και η φωτογραφία ή το PDF της απόδειξης) στέλνεται σε αυτό το hub, όπου σε βρίσκει από το email του RoarMe· φυλάσσεται εκεί με τους όρους του hub.',
          'Αναφορές: αν αναφέρεις ένα μήνυμα ή ένα άτομο, κρατάμε την αναφορά, το σημείωμά σου και ένα αντίγραφο του μηνύματος για να την εξετάσουμε. Τις αναφορές τις βλέπει μόνο ο διαχειριστής του RoarMe.',
          'Σφάλματα και αντίγραφα ασφαλείας: όταν το RoarMe χαλάσει στη συσκευή σου, μας στέλνει τι πήγε στραβά (το σφάλμα, την οθόνη, το είδος της συσκευής και του συστήματος), ποτέ τα μηνύματα ή τα αρχεία σου. Για να μένει ασφαλές, αντιγράφουμε τη βάση του μία φορά τη μέρα (κρατάμε τα δέκα πιο πρόσφατα αντίγραφα, που τα βλέπει μόνο ο διαχειριστής του RoarMe) και την ελέγχουμε για spam, ψεύτικους λογαριασμούς και επιθέσεις.',
        ]],
        ['Τι δεν συλλέγουμε', [
          'Κανένα αναγνωριστικό διαφήμισης, καμία διαφήμιση, κανένα cookie παρακολούθησης, κανένα εργαλείο analytics ή αναφοράς σφαλμάτων, και καμία παρακολούθηση σε εφαρμογές ή ιστοσελίδες άλλων εταιρειών.',
          'Δεν πουλάμε, δεν νοικιάζουμε και δεν δίνουμε τα δεδομένα σου σε κανέναν για μάρκετινγκ, και δεν χρησιμοποιούμε τα μηνύματά σου για να φτιάξουμε προφίλ σου ή για να εκπαιδεύσουμε κανένα AI.',
        ]],
        ['Οι επαφές σου (εφαρμογή iPhone)', [
          'Η Εύρεση φίλων από τις επαφές λειτουργεί μόνο αν την ξεκινήσεις εσύ και επιτρέψεις την πρόσβαση στις επαφές. Τα emails και τα τηλέφωνα της ατζέντας σου δεν φεύγουν ποτέ από το κινητό: η εφαρμογή μετατρέπει το καθένα σε κωδικό μίας κατεύθυνσης (SHA-256 hash) πάνω στο κινητό και στέλνει μόνο αυτούς τους κωδικούς, για να δει ποιοι ανήκουν σε χρήστες του RoarMe που επιτρέπουν να τους βρίσκουν. Δεν κρατάμε τους κωδικούς που στέλνεις και δεν αποθηκεύουμε ποτέ την ατζέντα σου. Αν προσκαλέσεις κάποιον, η πρόσκληση φεύγει από την εφαρμογή Μηνύματα του κινητού σου.',
        ]],
        ['Η τοποθεσία σου', [
          'Η τοποθεσία σου διαβάζεται μόνο όταν ανοίξεις την Τοποθεσία σε μια συζήτηση και το επιτρέψεις. Το Send Location στέλνει ένα σημείο, ως μήνυμα όπως κάθε άλλο.',
          'Το Κλειδωμένο Μήνυμα (Locked Message) κρατά τα λόγια του στους διακομιστές μας μέχρι να ανοίξει: την ώρα που διάλεξες, ή όταν κάποιος από τη συζήτηση βρεθεί μέσα στο μέρος που διάλεξες. Για τον έλεγχο του μέρους, το κινητό του στέλνει τη θέση του μία φορά, όταν πατήσει I’m Here· συγκρίνεται και δεν κρατιέται.',
          'Τα γενέθλιά σου (μέρα και μήνας, και η χρονιά αν τη βάλεις) κρατιούνται μόνο αν τα προσθέσεις στο προφίλ σου· οι επαφές σου βλέπουν μέρα και μήνα εκτός αν διαλέξεις Nobody, και τη χρονιά δεν τη βλέπει κανείς. Το Share Battery είναι κλειστό μέχρι να το ανοίξεις· τότε, όσο το RoarMe είναι ανοιχτό, η στάθμη της μπαταρίας σου και αν φορτίζει κρατιούνται και φαίνονται στο προφίλ σου σε όσους διάλεξες.',
          'Η Ζωντανή τοποθεσία (Live Location) στέλνει τη θέση σου ξανά και ξανά για όσο διαλέξεις (15 λεπτά, 1 ώρα, 8 ώρες ή μέχρι να τη σταματήσεις), και μόνο όσο το RoarMe είναι ανοιχτό στο κινητό σου. Όσοι είναι στη συζήτηση τη βλέπουν να κινείται. Σταματά όταν λήξει ο χρόνος ή όταν πατήσεις Stop Sharing· η τελευταία θέση μένει με το μήνυμα μέχρι να σβηστεί το μήνυμα.',
        ]],
        ['Κάμερα, μικρόφωνο και φωτογραφίες', [
          'Το RoarMe χρησιμοποιεί την κάμερα και το μικρόφωνο μόνο όταν τραβάς φωτογραφία ή βίντεο, ηχογραφείς φωνητικό ή βιντεομήνυμα ή είσαι σε κλήση, και τη βιβλιοθήκη φωτογραφιών μόνο όταν διαλέγεις φωτογραφίες ή αρχεία για να στείλεις. Τίποτα δεν ηχογραφείται ή ανεβαίνει χωρίς δική σου ενέργεια.',
          'Οι φωτογραφίες που στέλνεις από το Gallery μικραίνουν στη συσκευή σου πριν σταλούν· τα αρχεία από το File στέλνονται ακριβώς όπως είναι.',
        ]],
        ['Emails, SMS και ειδοποιήσεις', [
          'Σου στέλνουμε email για να επιβεβαιώσεις τον λογαριασμό σου και να αλλάξεις κωδικό και, αν το αφήσεις ανοιχτό, για να σου θυμίσουμε αδιάβαστα μηνύματα. Τα emails αυτά στέλνονται μέσω της Resend και δεν περιέχουν ποτέ τι λένε τα μηνύματα. Κάθε υπενθύμιση έχει ένα link που τις σταματά.',
          'Αν προσθέσεις αριθμό κινητού, ο κωδικός επιβεβαίωσης στέλνεται με SMS μέσω της Twilio, που λαμβάνει τον αριθμό σου μόνο γι\' αυτόν τον σκοπό.',
          'Αν ανοίξεις τις ειδοποιήσεις, η συσκευή σου μάς δίνει μια διεύθυνση γι\' αυτό (push token). Σε browser, κάθε ειδοποίηση κρυπτογραφείται για τη συσκευή σου πριν φύγει από τον διακομιστή μας. Στην εφαρμογή iPhone, οι ειδοποιήσεις παραδίδονται από την υπηρεσία Apple Push Notification. Μια ειδοποίηση δείχνει ποιος έγραψε και, αν επιτρέπεις την προεπισκόπηση, την αρχή του μηνύματος· μπορείς να κλείσεις την προεπισκόπηση από Ρυθμίσεις > Ειδοποιήσεις και ήχοι.',
        ]],
        ['Κλήσεις', [
          'Οι φωνητικές κλήσεις, οι βιντεοκλήσεις, οι ομαδικές βιντεοσυνομιλίες και τα links κλήσεων συνδέονται μέσω της LiveKit, της υπηρεσίας κλήσεων που χρησιμοποιούμε, ή απευθείας ανάμεσα στις συσκευές (WebRTC), με τη βοήθεια διακομιστών σύνδεσης της Google και της Cloudflare. Κρυπτογραφούνται κατά τη μεταφορά και δεν τις ηχογραφούμε ούτε τις αποθηκεύουμε ποτέ. Οι υπηρεσίες αυτές βλέπουν τις διευθύνσεις IP των συσκευών όσο κρατάει η κλήση. Κρατάμε το ιστορικό κλήσεων (ποιος κάλεσε ποιον, πότε και για πόσο).',
        ]],
        ['RoarTransfer', [
          'Τα μεγάλα αρχεία που στέλνεις με RoarTransfer φυλάσσονται στο Cloudflare R2. Διαλέγεις πόσο κρατάει το link τους (1, 3 ή 7 μέρες)· όταν λήξει, το αρχείο σβήνεται μέσα στην ώρα. Κάθε αρχείο κατεβαίνει περιορισμένο αριθμό φορών.',
          'Ένα link λήψης λειτουργεί για όποιον το έχει μέχρι να λήξει. Δώσ\' το μόνο σε όσους θέλεις να έχουν το αρχείο. Το RoarTransfer έχει δική του Πολιτική Απορρήτου στο roartransfer.com/privacy.',
        ]],
        ['Όταν χρησιμοποιείς άλλες υπηρεσίες', [
          'Ο χάρτης στην Τοποθεσία είναι του OpenStreetMap, και τα ονόματα και η αναζήτηση τόπων έρχονται από την υπηρεσία Nominatim του OpenStreetMap. Λαμβάνει την περιοχή του χάρτη που βλέπεις (και ό,τι ψάχνεις) μαζί με τη διεύθυνση IP σου, ποτέ το όνομα ή τον λογαριασμό σου.',
          'Ένα link βίντεο (YouTube, Vimeo) παίζει στο δικό τους player, που τότε λαμβάνει τη διεύθυνση IP σου σύμφωνα με τη δική του πολιτική.',
        ]],
        ['Πού βρίσκονται τα δεδομένα σου και ποιος τα βλέπει', [
          'Οι λογαριασμοί, τα μηνύματα και τα αρχεία φυλάσσονται στη Supabase, τον πάροχο βάσης δεδομένων και αποθήκευσης, στο Λονδίνο, Ηνωμένο Βασίλειο· τα αρχεία του RoarTransfer στο Cloudflare R2. Η ιστοσελίδα σερβίρεται από το GitHub Pages. Οι πάροχοι αυτοί, και οι Resend, Twilio, LiveKit και Apple για όσα αναφέρονται πιο πάνω, λειτουργούν για λογαριασμό μας και κρατούν σύντομα τεχνικά αρχεία (όπως διεύθυνση IP και τύπο συσκευής) για ασφάλεια και για τη λειτουργία της υπηρεσίας.',
          'Για να λειτουργεί το RoarMe και να μένει ασφαλές, ο διαχειριστής του στη The Mad Lions βλέπει τη λίστα των λογαριασμών (όνομα, @username, email, πότε γράφτηκαν και πότε εμφανίστηκαν τελευταία), τα στοιχεία των αρχείων που στέλνονται (όνομα, μέγεθος, τύπος, πότε, από ποιον, πόσες φορές κατέβηκαν) και τις αναφορές που στέλνονται. Ποτέ τι λένε τα άλλα μηνύματα ή τα αρχεία.',
          'Τα δεδομένα κρυπτογραφούνται κατά τη μεταφορά (HTTPS) και κατά την αποθήκευση από τους παρόχους. Τα μηνύματα δεν έχουν κρυπτογράφηση από άκρο σε άκρο, εκτός από το κείμενο που γράφεται όσο είναι ανοιχτή η Κρυπτογραφημένη συνομιλία: αυτό κρυπτογραφείται στη συσκευή και μόνο οι συσκευές όσων είναι στη συζήτηση μπορούν να το διαβάσουν, όχι το RoarMe. Οι φωτογραφίες, τα αρχεία και τα φωνητικά δεν έχουν ποτέ κρυπτογράφηση από άκρο σε άκρο.',
          'Ο λογαριασμός σου στο RoarMe σε συνδέει και στα RoarWriter, Roardino και RoarTransfer. Το καθένα έχει τη δική του πολιτική για το τι κρατάει.',
          'Mail (ROARMAIL): μόνο αν προσθέσεις λογαριασμό email στο RoarMe, ή πατήσεις Send to RoarMe στο RoarMail του υπολογιστή σου, ο κωδικός εκείνου του λογαριασμού (ή η σύνδεσή του με τη Microsoft) ελέγχεται μία φορά στον mail server του και φυλάσσεται κρυπτογραφημένος στο Supabase Vault, ώστε το RoarMe να διαβάζει για σένα τα mail του από τον mail server του και να στέλνει από εκεί όσα γράφεις. Τον κωδικό δεν μπορεί να τον διαβάσει κανείς, ούτε εσύ· τα ίδια τα mail φέρνονται κάθε φορά που τα βλέπεις και δεν τα κρατάμε· τα πιο πρόσφατα και όσα άνοιξες φυλάσσονται στο κινητό σου για να ανοίγουν αμέσως, ώσπου να τα σβήσεις ή να αποσυνδεθείς. Το Block Sender βάζει τον αποστολέα στη λίστα αποκλεισμών σου (αυτή που κρατά το RoarMail στον Roar Account σου, ή μια δική του στο RoarMe αν δεν χρησιμοποιείς το RoarMail). Η αφαίρεση του λογαριασμού στο Settings > ROARMAIL, ή το Remove from RoarMe στο RoarMail, σβήνει αμέσως τον κωδικό. Με τις ειδοποιήσεις ανοιχτές (Settings > ROARMAIL), ο mail server μας κρατά το Inbox σου συνδεδεμένο και, όταν έρθει mail, στέλνει στις συσκευές σου ειδοποίηση με τον αποστολέα, το θέμα και την πρώτη γραμμή του· κρατάμε μόνο τον αριθμό του τελευταίου mail που ειπώθηκε.',
        ]],
        ['Πόσο τα κρατάμε και πώς τα σβήνεις', [
          'Τα μηνύματα μένουν μέχρι να σβηστούν. Μπορείς να σβήσεις τα δικά σου μηνύματα για όλους, να καθαρίσεις μια συζήτηση και να ενεργοποιήσεις την Αυτόματη διαγραφή σε κάθε συζήτηση, ώστε να σβήνονται τα μηνύματα που είναι παλιότερα από τον χρόνο που διάλεξες.',
          'Ρυθμίσεις > Απόρρητο και ασφάλεια > Διαγραφή του λογαριασμού μου: σβήνει αμέσως, μέσα από την εφαρμογή, τον λογαριασμό, το προφίλ, τον αριθμό, τις επαφές, τους φακέλους, τα push tokens και τις ιδιωτικές σου συζητήσεις. Τα μηνύματα που έστειλες σε ομάδες μένουν για τα άλλα μέλη, χωρίς το όνομά σου.',
          'Συσκευές που μένουν πολύ καιρό αχρησιμοποίητες αποσυνδέονται αυτόματα. Τα τεχνικά αρχεία των παρόχων κρατιούνται για λίγο μόνο.',
        ]],
        ['Τα δικαιώματά σου', [
          'Σύμφωνα με τον GDPR μπορείς να ζητήσεις να δεις, να διορθώσεις, να εξαγάγεις ή να σβήσεις τα δεδομένα σου, και να αντιταχθείς στη χρήση τους. Γράψε στο ' + CONTACT + ' και θα απαντήσουμε μέσα σε έναν μήνα. Μπορείς επίσης να απευθυνθείς στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (www.dpa.gr).',
          'Επεξεργαζόμαστε τα δεδομένα σου για να σου δώσουμε την υπηρεσία που ζήτησες (λογαριασμός και συζητήσεις), με τη συγκατάθεσή σου όπου η εφαρμογή τη ζητά (επαφές, τοποθεσία, κάμερα, μικρόφωνο, ειδοποιήσεις, που μπορείς να ανακαλέσεις από τις ρυθμίσεις της συσκευής σου), και για το έννομο συμφέρον μας να κρατάμε το RoarMe ασφαλές (αναφορές και αρχεία ασφαλείας).',
        ]],
        ['Ηλικία', [
          'Το RoarMe είναι για άτομα 15 ετών και άνω και δεν απευθύνεται σε παιδιά.',
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
        ['PROjects and the Production Hub', [
          'PROjects is a tool for working together on a project in a group. A payment or expense you send to a Production Hub with the $ is a record for the production, not a payment: RoarMe does not move money. You are responsible for what you enter being correct; the hub\'s owner decides what to do with it under their own terms.',
        ]],
        ['Free and paid', [
          'RoarMe is free. Some features may later be offered in a paid plan (Pro); if so, the price and what you get are shown before you pay, and nothing is ever charged without your clear order.',
        ]],
        ['What is not allowed', [
          'Anything illegal; harassment, threats or hate; spam; malware or attempts to break into accounts or the service; content you have no right to share; and any content that sexualises minors, which we report to the authorities.',
          'We may remove content or close accounts that break these rules.',
          'There is no tolerance for objectionable content or abusive people. Anyone can report a message or a person (hold a message > Report, or a contact > Report) and block a person. We look at every report within 24 hours, remove what breaks these rules and close the account of whoever sent it.',
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
        ['PROjects και Production Hub', [
          'Τα PROjects είναι ένα εργαλείο για να δουλεύει μια ομάδα μαζί σε ένα project. Μια πληρωμή ή ένα έξοδο που στέλνεις σε ένα Production Hub με το $ είναι καταγραφή για την παραγωγή, όχι πληρωμή: το RoarMe δεν μεταφέρει χρήματα. Είσαι υπεύθυνος να είναι σωστά όσα γράφεις· ο κάτοχος του hub αποφασίζει τι θα κάνει με αυτά με τους δικούς του όρους.',
        ]],
        ['Δωρεάν και επί πληρωμή', [
          'Το RoarMe είναι δωρεάν. Ορισμένες λειτουργίες μπορεί αργότερα να προσφέρονται σε πληρωμένο πλάνο (Pro)· τότε η τιμή και τι περιλαμβάνει εμφανίζονται πριν πληρώσεις, και τίποτα δεν χρεώνεται ποτέ χωρίς τη ρητή εντολή σου.',
        ]],
        ['Τι δεν επιτρέπεται', [
          'Οτιδήποτε παράνομο· παρενόχληση, απειλές ή μίσος· spam· κακόβουλο λογισμικό ή απόπειρες παραβίασης λογαριασμών ή της υπηρεσίας· περιεχόμενο που δεν έχεις δικαίωμα να μοιραστείς· και κάθε περιεχόμενο που σεξουαλικοποιεί ανηλίκους, το οποίο αναφέρουμε στις αρχές.',
          'Μπορούμε να αφαιρέσουμε περιεχόμενο ή να κλείσουμε λογαριασμούς που παραβιάζουν αυτούς τους κανόνες.',
          'Δεν υπάρχει καμία ανοχή σε απαράδεκτο περιεχόμενο ή σε καταχρηστική συμπεριφορά. Όποιος θέλει μπορεί να αναφέρει ένα μήνυμα ή ένα άτομο (κράτα πατημένο ένα μήνυμα > Report, ή σε μια επαφή > Report) και να μπλοκάρει ένα άτομο. Εξετάζουμε κάθε αναφορά μέσα σε 24 ώρες, αφαιρούμε ό,τι παραβιάζει τους κανόνες και κλείνουμε τον λογαριασμό όποιου το έστειλε.',
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
export const legalUrl = (doc) => `${appUrl()}?legal=${doc}` // inside the iPhone app, the website's address

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
