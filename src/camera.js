/* RoarMe's own camera inside the iPhone app (Alex, 21 Nov; mobile/ios-app/RoarCamera.swift): VIDEO, PHOTO, DUAL, the
   flash, flip, and the newest photo to go to the Gallery. openCamera({ only: 'photo' }) gives { files, raw } (several from rapid fire; raw for a DNG), 'gallery'
   when the Gallery was asked for, null when closed, or undefined where there is no such camera (the web, a build before
   it), so the caller falls back to the system's own camera through a file input. */
const plug = () => {
  const C = typeof window !== 'undefined' && window.Capacitor
  return C?.isNativePlatform?.() && C.nativePromise ? C : null
}
let ok = null
export async function hasCamera() {
  const C = plug()
  if (!C) return false
  if (ok === null) ok = await C.nativePromise('RoarCamera', 'available', {}).then((r) => !!r?.ok).catch(() => false)
  return ok
}
// the app's look for the camera (Alex, 21 Nov: "by the theme we have"): the accent pair and its ink as #hex, Day or
// Night, Frost
const hexOf = (css) => {
  try {
    const d = document.createElement('i')
    d.style.cssText = `position:absolute;opacity:0;pointer-events:none;color:${css}`
    document.body.appendChild(d)
    const m = getComputedStyle(d).color.match(/[\d.]+/g)
    d.remove()
    if (!m || m.length < 3) return ''
    return '#' + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('')
  } catch { return '' }
}
const look = () => {
  const r = document.documentElement
  const theme = { light: r.dataset.mode === 'light', frost: r.dataset.frost === '1' }
  const top = hexOf('var(--halo-mine-top, var(--halo))'), main = hexOf('var(--halo-mine, var(--halo))'), ink = hexOf('var(--halo-ink, #fff)')
  if (main) theme.accent = main
  if (top) theme.accentTop = top
  if (ink) theme.ink = ink
  return theme
}
export async function openCamera(opts = {}) {
  if (!(await hasCamera())) return undefined
  const C = plug()
  const r = await C.nativePromise('RoarCamera', 'open', { ...look(), ...opts }).catch(() => null)
  if (!r || r.cancelled || r.error) return null
  if (r.gallery) return 'gallery'
  if (r.tab) return { tab: r.tab }
  // one file, or several from rapid fire; RAW (DNG) goes as a file, untouched
  const read = async (path, i) => {
    const src = C.convertFileSrc ? C.convertFileSrc(path) : path
    const blob = await (await fetch(src)).blob()
    const name = (i === undefined && r.name) || String(path).split('/').pop() || 'camera'
    return new File([blob], name, { type: r.type || blob.type, lastModified: Date.now() })
  }
  const files = r.paths ? await Promise.all(r.paths.map((p, i) => read(p, i))) : [await read(r.path)]
  return { files, raw: !!r.raw }
}
