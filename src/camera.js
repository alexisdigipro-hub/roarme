/* RoarMe's own camera inside the iPhone app (Alex, 21 Nov; mobile/ios-app/RoarCamera.swift): VIDEO, PHOTO, DUAL, the
   flash, flip, and the newest photo to go to the Gallery. openCamera({ only: 'photo' }) gives the File it made, 'gallery'
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
export async function openCamera(opts = {}) {
  if (!(await hasCamera())) return undefined
  const C = plug()
  const r = await C.nativePromise('RoarCamera', 'open', opts).catch(() => null)
  if (!r || r.cancelled || r.error) return null
  if (r.gallery) return 'gallery'
  const src = C.convertFileSrc ? C.convertFileSrc(r.path) : r.path
  const blob = await (await fetch(src)).blob()
  return new File([blob], r.name || 'camera', { type: r.type || blob.type, lastModified: Date.now() })
}
