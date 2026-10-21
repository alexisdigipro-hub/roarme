import { useEffect, useRef } from 'react'
import { supabase } from './lib.js'
import { getPrefs, setPrefs } from './prefs.js'

/* Chat folders kept with the account, so every device has the same ones (Alex, 19 Oct; supabase/folders.sql):
   the custom folders and how the folder tabs are set up go up a moment after a change, and come down when RoarMe
   opens or comes back to the front. The newer side wins; a device's first sync adds its own folders to the account's.
   Since 21 Oct (Alex: a chat deleted in Safari was still there in the Home Screen app) the chat list itself goes along
   too: deleted chats and cleared histories (joined from every device, the latest time wins, so none comes back), pinned
   chats, chats marked unread, favourites and mute timers (the newer side wins, like the folders). */
const KEYS = ['folderOrder', 'folderNames', 'hiddenFolders', 'folderExtra']
const JOINED = ['roarme-hidden', 'roarme-cleared'] // { room_id: ISO time }: what one device did stays done everywhere
const LOCAL = ['roarme-pins', 'roarme-marked', 'roarme-fav', 'roarme-mute-until']
const join = (a, b) => { const o = { ...(a || {}) }; for (const [k, v] of Object.entries(b || {})) if (!o[k] || String(v) > String(o[k])) o[k] = v; return o }
const AT = 'roarme-folders-at'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const snapshot = () => {
  const p = getPrefs()
  return { folders: read('roarme-folders', []), ...Object.fromEntries(KEYS.map((k) => [k, p[k]])),
    local: Object.fromEntries([...JOINED, ...LOCAL].map((k) => [k, read(k, k === 'roarme-pins' || k === 'roarme-marked' || k === 'roarme-fav' ? [] : {})])) }
}
const stamp = (v) => (v ? Date.parse(v) || 0 : 0)

export function useFolderSync(uid) {
  const last = useRef('')
  useEffect(() => {
    if (!uid) return undefined
    let alive = true
    let timer = 0
    const push = async () => {
      if (JSON.stringify(snapshot()) === last.current) return
      // what the other devices deleted or cleared joins ours first, so a push never brings a deleted chat back
      const { data: row } = await supabase.from('roar_folder_sync').select('data').eq('user_id', uid).maybeSingle()
      const theirs = row?.data?.local || {}
      let more = false
      try {
        for (const k of JOINED) {
          const mine = read(k, {}), both = join(mine, theirs[k])
          if (JSON.stringify(both) !== JSON.stringify(mine)) { localStorage.setItem(k, JSON.stringify(both)); more = true }
        }
      } catch { /* private window */ }
      const data = snapshot()
      const json = JSON.stringify(data)
      const at = new Date().toISOString()
      const { error } = await supabase.from('roar_folder_sync').upsert({ user_id: uid, data, updated_at: at })
      if (!error) { last.current = json; try { localStorage.setItem(AT, at) } catch { /* private window */ } }
      if (more) window.dispatchEvent(new Event('roarme-local'))
    }
    const apply = (d, at) => {
      try {
        localStorage.setItem('roarme-folders', JSON.stringify(d.folders || []))
        const loc = d.local || {}
        for (const k of JOINED) if (loc[k]) localStorage.setItem(k, JSON.stringify(join(read(k, {}), loc[k])))
        for (const k of LOCAL) if (loc[k] !== undefined) localStorage.setItem(k, JSON.stringify(loc[k]))
        localStorage.setItem(AT, at)
      } catch { /* private window */ }
      window.dispatchEvent(new Event('roarme-local'))
      const p = Object.fromEntries(KEYS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]))
      if (Object.keys(p).length) setPrefs(p)
      last.current = JSON.stringify(snapshot())
    }
    const pull = async () => {
      const { data: row, error } = await supabase.from('roar_folder_sync').select('data, updated_at').eq('user_id', uid).maybeSingle()
      if (!alive || error) return
      let localAt = null
      try { localAt = localStorage.getItem(AT) } catch { /* private window */ }
      if (!row) { push(); return }
      if (!localAt) {
        // this device's first sync: its own folders join the account's
        const mine = read('roarme-folders', [])
        const theirs = row.data?.folders || []
        const merged = [...theirs, ...mine.filter((f) => !theirs.some((t) => t.id === f.id))]
        const theirLocal = row.data?.local || {}
        const local = { ...theirLocal }
        for (const k of JOINED) local[k] = join(read(k, {}), theirLocal[k])
        apply({ ...row.data, folders: merged, local }, row.updated_at)
        last.current = ''; push()
        return
      }
      if (stamp(row.updated_at) > stamp(localAt)) {
        apply(row.data || {}, row.updated_at)
        if (!row.data?.local) { last.current = ''; push() } // the account has no chat list yet: this device's goes up
      } else {
        // ours is newer: what the other devices deleted or cleared still comes down, then ours goes up
        const loc = row.data?.local || {}
        let more = false
        try {
          for (const k of JOINED) {
            const mine = read(k, {}), both = join(mine, loc[k])
            if (JSON.stringify(both) !== JSON.stringify(mine)) { localStorage.setItem(k, JSON.stringify(both)); more = true }
          }
        } catch { /* private window */ }
        if (more) window.dispatchEvent(new Event('roarme-local'))
        push()
      }
    }
    const changed = () => { clearTimeout(timer); timer = setTimeout(push, 800) }
    const back = () => { if (document.visibilityState === 'visible') pull() }
    pull()
    const tick = setInterval(() => { if (document.visibilityState === 'visible') pull() }, 120000) // two devices open at once stay in step (coming back to the app pulls at once too)
    window.addEventListener('roarme-local', changed)
    window.addEventListener('roarme-prefs', changed)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      alive = false
      clearTimeout(timer)
      clearInterval(tick)
      window.removeEventListener('roarme-local', changed)
      window.removeEventListener('roarme-prefs', changed)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [uid])
}
