import { kvOwner } from './cache.js'

/* Nothing of one account reaches another on the same device (Alex, 26 Nov: "nothing from one account goes to another,
   nothing"). Every roarme-… key in localStorage belongs to the account using the device now: its folders, pins, drafts,
   appearance and settings, the mail it reads, the chats it keeps. bindLocal(uid), called before Chat draws, moves the
   last owner's keys aside under roarme-acct-<id>:<key> and brings the new account's back; the kept chats and mail in
   IndexedDB have a database of their own per account (cache.js kvOwner). Only the device itself stays shared: the
   sign-ins (roarme-auth-2, roarme-accounts), the passcode lock and what the device has been shown (What's New). */
const OWNER = 'roarme-local-owner'
const DEVICE = new Set(['roarme-auth-2', 'roarme-accounts', OWNER, 'roarme-lock', 'roarme-news-seen', 'roarme-olddb-gone'])
const mine = (k) => k.startsWith('roarme-') && !k.startsWith('roarme-acct-') && !DEVICE.has(k)

export function bindLocal(uid) {
  if (!uid) return
  kvOwner(uid)
  try {
    // the database every account shared before 26 Nov goes once
    if (!localStorage.getItem('roarme-olddb-gone')) { try { indexedDB.deleteDatabase('roarme-data') } catch { /* none */ } localStorage.setItem('roarme-olddb-gone', '1') }
    const owner = localStorage.getItem(OWNER)
    if (owner === uid) return
    const keys = Object.keys(localStorage)
    if (owner) {
      for (const k of keys.filter(mine)) { localStorage.setItem(`roarme-acct-${owner}:${k}`, localStorage.getItem(k)); localStorage.removeItem(k) }
      const pre = `roarme-acct-${uid}:`
      for (const k of keys.filter((x) => x.startsWith(pre))) { localStorage.setItem(k.slice(pre.length), localStorage.getItem(k)); localStorage.removeItem(k) }
      // the first form of this (26 Nov, folders only): one blob per account
      const old = localStorage.getItem(`roarme-acct-${uid}`)
      if (old) {
        try { const o = JSON.parse(old); for (const [k, v] of Object.entries(o.keys || {})) if (v != null && localStorage.getItem(k) == null) localStorage.setItem(k, v) } catch { /* bad blob */ }
        localStorage.removeItem(`roarme-acct-${uid}`)
      }
    }
    // no owner yet (the first start with this): what is here is taken as this account's
    localStorage.setItem(OWNER, uid)
  } catch { /* private window */ }
}
