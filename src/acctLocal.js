import { getPrefs, setPrefs } from './prefs.js'

/* Each account keeps its own chat-list things on this device (Alex, 26 Nov: the folders of one account showed in the
   other). Folders, their order and names, pins, marked, favourites, hidden and cleared chats, mute timers and drafts
   lived in plain localStorage keys shared by every account on the device, so a switch carried them over and
   folderSync.js then sent them up to the other account. bindLocal(uid), called before Chat draws, puts the last
   owner's set away under roarme-acct-<id> and brings the new account's back (or nothing, the first time). */
const KEYS = ['roarme-folders', 'roarme-folders-at', 'roarme-hidden', 'roarme-cleared', 'roarme-pins', 'roarme-marked', 'roarme-fav', 'roarme-mute-until', 'roarme-drafts', 'roarme-bday-seen']
const PREF_KEYS = { folderOrder: [], folderNames: {}, hiddenFolders: [], folderExtra: {} }
const OWNER = 'roarme-local-owner'

export function bindLocal(uid) {
  if (!uid) return
  try {
    const owner = localStorage.getItem(OWNER)
    if (owner === uid) return
    if (owner) {
      const p = getPrefs()
      const keep = { keys: Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(k)])), prefs: Object.fromEntries(Object.keys(PREF_KEYS).map((k) => [k, p[k]])) }
      localStorage.setItem(`roarme-acct-${owner}`, JSON.stringify(keep))
      let back = null
      try { back = JSON.parse(localStorage.getItem(`roarme-acct-${uid}`) || 'null') } catch { back = null }
      for (const k of KEYS) {
        const v = back?.keys?.[k]
        if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v)
      }
      setPrefs({ ...PREF_KEYS, ...(back?.prefs || {}) })
    }
    // no owner yet (the first start with this): what is here is taken as this account's
    localStorage.setItem(OWNER, uid)
  } catch { /* private window */ }
}
