import { useEffect, useRef } from 'react'
import { supabase } from './lib.js'
import { getPrefs, setPrefs } from './prefs.js'

/* Chat folders kept with the account, so every device has the same ones (Alex, 19 Oct; supabase/folders.sql):
   the custom folders and how the folder tabs are set up go up a moment after a change, and come down when RoarMe
   opens or comes back to the front. The newer side wins; a device's first sync adds its own folders to the account's. */
const KEYS = ['folderOrder', 'folderNames', 'hiddenFolders', 'folderExtra']
const AT = 'roarme-folders-at'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const snapshot = () => { const p = getPrefs(); return { folders: read('roarme-folders', []), ...Object.fromEntries(KEYS.map((k) => [k, p[k]])) } }
const stamp = (v) => (v ? Date.parse(v) || 0 : 0)

export function useFolderSync(uid) {
  const last = useRef('')
  useEffect(() => {
    if (!uid) return undefined
    let alive = true
    let timer = 0
    const push = async () => {
      const data = snapshot()
      const json = JSON.stringify(data)
      if (json === last.current) return
      const at = new Date().toISOString()
      const { error } = await supabase.from('roar_folder_sync').upsert({ user_id: uid, data, updated_at: at })
      if (!error) { last.current = json; try { localStorage.setItem(AT, at) } catch { /* private window */ } }
    }
    const apply = (d, at) => {
      try {
        localStorage.setItem('roarme-folders', JSON.stringify(d.folders || []))
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
        apply({ ...row.data, folders: merged }, row.updated_at)
        if (merged.length !== theirs.length) { last.current = ''; push() }
        return
      }
      if (stamp(row.updated_at) > stamp(localAt)) apply(row.data || {}, row.updated_at)
      else push()
    }
    const changed = () => { clearTimeout(timer); timer = setTimeout(push, 800) }
    const back = () => { if (document.visibilityState === 'visible') pull() }
    pull()
    window.addEventListener('roarme-local', changed)
    window.addEventListener('roarme-prefs', changed)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('roarme-local', changed)
      window.removeEventListener('roarme-prefs', changed)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [uid])
}
