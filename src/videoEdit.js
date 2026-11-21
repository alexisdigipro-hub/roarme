/* A video made again with its edits (Alex, 21 Nov: the photo editor on videos, with Trim): it plays once, unseen and
   unheard, from the trim's start to its end, each frame drawn through the edit steps (photoKit.js applySteps, colours on
   the GPU by videoGL.js) into a canvas that MediaRecorder records with the clip's own sound, as videoCompress.js does,
   so it takes as long as the trimmed part lasts. Standard: at most 1280 px on the long side, about the bit rate the
   chat's own shrinking aims for (so it is not shrunk again); HD: at most 1920 px, 8 Mbit/s. The handle comes from
   prepareVideo, called inside the Send tap (Safari plays sound only from a tap). */
import { applySteps } from './photoKit.js'
import { getGL } from './videoGL.js'
import { once, even, pickType, releaseVideo } from './videoCompress.js'

export const VIDEO_EDIT_MAX = 180 // seconds a video may last to be edited
export const canEditVideo = () => typeof window !== 'undefined' && !!window.MediaRecorder && !!HTMLCanvasElement.prototype.captureStream && !!pickType()

// one frame of a video into a canvas, its long side at most max
export function grabFrame(v, max, into) {
  const w0 = v.videoWidth, h0 = v.videoHeight
  if (!w0 || !h0) return null
  const k = Math.min(1, max / Math.max(w0, h0))
  const c = into || document.createElement('canvas')
  const W = Math.max(2, Math.round(w0 * k)), H = Math.max(2, Math.round(h0 * k))
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H }
  c.getContext('2d').drawImage(v, 0, 0, W, H)
  return c
}

/* recipe: { steps, trim: [from, to] | null }. Returns the new File, or null (the original is sent then). */
export async function exportEdited(h, recipe, { hd = false, onProgress, stopped } = {}) {
  if (!h) return null
  const { file, v, dest } = h
  let rec = null
  try {
    if (v.readyState < 1) await once(v, 'loadedmetadata', 20000)
    let d = v.duration
    if (d === Infinity) {
      // clips recorded in a browser often carry no length: seeking far past the end makes it known
      v.currentTime = 1e101
      await once(v, 'seeked', 15000).catch(() => {})
      d = v.duration
    }
    if (!Number.isFinite(d) || d <= 0) return null
    const a = Math.max(0, recipe.trim?.[0] || 0), b = Math.min(d, recipe.trim?.[1] || d)
    if (b - a < 0.3) return null
    const max = hd ? 1920 : 1280
    const gl = getGL()
    const pool = {}
    const src = document.createElement('canvas')
    v.pause()
    v.currentTime = a
    await once(v, 'seeked', 10000).catch(() => {})
    const first = applySteps(grabFrame(v, max, src), recipe.steps || [], gl, pool)
    // the output's size: the edited picture's, at most max on its long side
    const k = Math.min(1, max / Math.max(first.width, first.height))
    const W = even(first.width * k), H = even(first.height * k)
    const out = document.createElement('canvas'); out.width = W; out.height = H
    const g = out.getContext('2d')
    g.drawImage(first, 0, 0, W, H)
    const perFrame = !!v.requestVideoFrameCallback && !!window.CanvasCaptureMediaStreamTrack && 'requestFrame' in window.CanvasCaptureMediaStreamTrack.prototype
    const stream = out.captureStream(perFrame ? 0 : 30)
    const vtrack = stream.getVideoTracks()[0]
    const frame = () => { if (perFrame) vtrack.requestFrame() }
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    const type = pickType()
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: hd ? 8_000_000 : 2_000_000, audioBitsPerSecond: 128_000 })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const done = new Promise((resolve, reject) => { rec.onstop = resolve; rec.onerror = (e) => reject(e.error || new Error('Recording failed')) })
    let drawing = true
    let finish
    const over = new Promise((r) => { finish = r })
    const schedule = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw))
    function draw() {
      if (!drawing) return
      if (stopped?.() || v.ended || v.currentTime >= b) { finish(); return }
      g.drawImage(applySteps(grabFrame(v, max, src), recipe.steps || [], gl, pool), 0, 0, W, H)
      frame()
      onProgress?.(Math.min(1, (v.currentTime - a) / (b - a)))
      schedule()
    }
    // the end of the trim, or of the clip
    const tick = () => { if (v.currentTime >= b || v.ended) finish() }
    v.addEventListener('timeupdate', tick)
    v.addEventListener('ended', tick)
    rec.start(1000)
    frame()
    await v.play()
    schedule()
    await Promise.race([over, new Promise((r) => setTimeout(r, (b - a) * 2000 + 30000))])
    drawing = false
    v.pause()
    v.removeEventListener('timeupdate', tick)
    v.removeEventListener('ended', tick)
    if (rec.state !== 'inactive') rec.stop()
    await done
    if (stopped?.()) return null
    const mime = type.split(';')[0]
    const blob = new Blob(chunks, { type: mime })
    if (!blob.size) return null
    const base = (file.name || 'video').replace(/\.[^.]+$/, '')
    return new File([blob], `${base}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`, { type: mime, lastModified: Date.now() })
  } catch (e) {
    console.warn('video edit', e)
    return null
  } finally {
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch { /* none */ }
    releaseVideo(h)
  }
}
