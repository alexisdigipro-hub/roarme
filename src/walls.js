import { useEffect, useState } from 'react'
import { supabase } from './lib.js'
import { WALLS } from './prefs.js'

/* The chat wallpapers, run from Admin > Wallpapers (Alex, 22 Oct; supabase/wallpapers.sql). roar_wallpapers holds them
   in order: the built-in ones drawn by styles.css (no path) and the photos in the public bucket roar-walls. The list is
   kept on the device so a photo wallpaper is there at once on the next start; WALLS is the list before the first load. */

const CACHE = 'roarme-walls-list'
const BUCKET = 'roar-walls'
let list = (() => {
  try { const l = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (Array.isArray(l) && l.length) return l } catch { /* private window */ }
  return WALLS.map(([key, name], position) => ({ key, name, path: null, position, hidden: false }))
})()
const subs = new Set()
let loading = null

export const wallUrl = (path) => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : '')
export const wallImage = (key, l = list) => wallUrl(l.find((w) => w.key === key)?.path)

export function loadWalls() {
  loading = supabase.from('roar_wallpapers').select('key, name, path, position, hidden').order('position').order('updated_at').then(({ data, error }) => {
    if (error || !data?.length) return
    list = data
    try { localStorage.setItem(CACHE, JSON.stringify(list)) } catch { /* private window */ }
    subs.forEach((f) => f(list))
  })
  return loading
}

// every wallpaper (all = true, for Admin) or only the ones shown to people
export function useWalls(all = false) {
  const [l, setL] = useState(list)
  useEffect(() => {
    subs.add(setL)
    if (!loading) loadWalls()
    return () => { subs.delete(setL) }
  }, [])
  return all ? l : l.filter((w) => !w.hidden)
}

// the style a chat or a preview takes for a photo wallpaper (the built-in ones are drawn by their data-bg)
export const wallStyle = (key, l) => {
  const url = wallImage(key, l)
  return url ? { '--wall': `url("${url}")` } : null
}

export const WALL_BUCKET = BUCKET
