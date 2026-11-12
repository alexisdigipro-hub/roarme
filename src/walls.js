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

/* One's own wallpaper (Alex, 8 Nov): any colour ('color:#rrggbb') or a photo of one's own ('img:<url>|<opacity>',
   uploaded to roar-avatars/<id>/wall-…). Kept in the same places as a built-in key: prefs.background for every chat,
   the roarme-walls map for one chat. */
export const ownColor = (v) => (typeof v === 'string' && /^color:#[0-9a-f]{6}$/i.test(v) ? v.slice(6) : '')
export const ownPhoto = (v) => {
  const m = typeof v === 'string' && v.match(/^img:(https:\/\/[^|"\s]+)\|([\d.]+)$/)
  return m ? { url: m[1], opacity: Math.min(1, Math.max(0.1, Number(m[2]) || 1)) } : null
}
export const photoValue = (url, opacity) => `img:${url}|${Math.round(opacity * 100) / 100}`
// what a chat or a preview wears: the attributes and the style, for a built-in, a colour or a photo
// strength (Alex, 12 Nov: "opacity on all of them"): 10 to 100 for RoarMe's own wallpapers and a colour, kept in
// prefs.wallStrength; under 100 the page's own colour is laid over the wallpaper (data-wop, --wop). One's own photo
// carries its strength in its value.
export function wallLook(v, l, strength = 100) {
  const s = Math.min(100, Math.max(10, Number(strength) || 100))
  const veil = s < 100 && v && v !== 'soft' ? { 'data-wop': '', style: { '--wop': s / 100 } } : { style: {} }
  const c = ownColor(v)
  if (c) return { 'data-bg': 'color', 'data-wop': veil['data-wop'], style: { '--wall-color': c, ...veil.style } }
  const ph = ownPhoto(v)
  if (ph) return { 'data-bg': 'own', 'data-img': '', 'data-own': '', style: { '--wall': `url("${ph.url}")`, '--wall-op': ph.opacity } }
  const st = wallStyle(v, l)
  return { 'data-bg': v, 'data-img': st ? '' : undefined, 'data-wop': veil['data-wop'], style: { ...(st || {}), ...veil.style } }
}

export const WALL_BUCKET = BUCKET
