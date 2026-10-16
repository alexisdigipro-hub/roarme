/*
  Videos sent in the chat shrink in the browser before they go up, the way WhatsApp does it (Alex,
  8 Oct): at most 1280 px on the long side (720p), about 1.8 Mbit/s, the sound kept. No library:
  the clip plays once, unseen and unheard, while a canvas copy of it is recorded with MediaRecorder,
  so compressing takes about as long as the clip lasts. MP4 where the browser can record it
  (Safari, recent Chrome), WebM otherwise.

  The frame rate is the clip's own (Alex, 11 Oct: 24 and 25 fps were turned into 30, which judders
  on pans): the canvas is drawn once for every frame the clip shows (requestVideoFrameCallback) and
  each drawing is handed to the recording as one frame (requestFrame), so 24 stays 24, 25 stays 25
  and 60 stays 60. A browser without those two falls back to a steady 30.

  Anything that does not work out (a format the browser cannot play, a browser that blocks the
  hidden playback, a result that is not smaller) returns null and the original is sent instead.

  Safari only lets a video play with sound from inside a tap, so prepareVideo() is called
  synchronously in the Send click: it plays each clip for an instant (into a silent audio graph)
  to unlock it, and compressVideo() then uses that same element later.
*/

const MAX_SIDE = 1280
const VIDEO_BPS = 1_800_000
const AUDIO_BPS = 96_000

export const isVideoFile = (f) => (f?.type || '').startsWith('video/')

function pickType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return ''
  const types = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || ''
}

export function canCompressVideo() {
  return typeof document !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream && !!(window.AudioContext || window.webkitAudioContext) && !!pickType()
}

let actx = null
function audioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  if (!actx || actx.state === 'closed') actx = new Ctx()
  actx.resume?.().catch(() => {})
  return actx
}

const once = (el, ev, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { el.removeEventListener(ev, h); reject(new Error(`${ev} timed out`)) }, ms)
  const h = () => { clearTimeout(t); resolve() }
  el.addEventListener(ev, h, { once: true })
})
const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/* Call inside the click, before any await. Returns a handle for compressVideo, or null. */
export function prepareVideo(file) {
  if (!isVideoFile(file) || !canCompressVideo()) return null
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.playsInline = true
  v.setAttribute('playsinline', '')
  v.preload = 'auto'
  v.src = url
  let dest = null
  try {
    const ac = audioCtx()
    const source = ac.createMediaElementSource(v)
    dest = ac.createMediaStreamDestination()
    source.connect(dest) // never to the speakers: nobody hears it
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
  const p = v.play()
  if (p) p.then(() => v.pause()).catch(() => {})
  return { file, url, v, dest, done: false }
}

export function releaseVideo(h) {
  if (!h || h.done) return
  h.done = true
  try { h.v.pause(); h.v.removeAttribute('src'); h.v.load() } catch {}
  URL.revokeObjectURL(h.url)
}

/* { file, w, h, duration } with the smaller file, or null to send the original. */
export async function compressVideo(h, onProgress) {
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
    const w0 = v.videoWidth
    const h0 = v.videoHeight
    if (!w0 || !h0 || !Number.isFinite(d) || d <= 0) return null
    const k = Math.min(1, MAX_SIDE / Math.max(w0, h0))
    // already small enough: a short clip at 720p or under with a modest bit rate
    if (k === 1 && (file.size * 8) / d <= (VIDEO_BPS + AUDIO_BPS) * 1.3) return null
    const w = even(w0 * k)
    const ht = even(h0 * k)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = ht
    const g = canvas.getContext('2d')
    // one recorded frame per frame of the clip where the browser allows it, else a steady 30 fps
    const perFrame = !!v.requestVideoFrameCallback && typeof CanvasCaptureMediaStreamTrack !== 'undefined' && 'requestFrame' in CanvasCaptureMediaStreamTrack.prototype
    const stream = canvas.captureStream(perFrame ? 0 : 30)
    const vtrack = stream.getVideoTracks()[0]
    const frame = () => { if (perFrame) vtrack.requestFrame() }
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t))
    const type = pickType()
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise((resolve, reject) => {
      rec.onstop = resolve
      rec.onerror = (e) => reject(e.error || new Error('Recording failed'))
    })

    v.pause()
    if (v.currentTime > 0) { v.currentTime = 0; await once(v, 'seeked', 8000).catch(() => {}) }
    g.drawImage(v, 0, 0, w, ht)
    let drawing = true
    const schedule = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw))
    function draw() {
      if (!drawing) return
      g.drawImage(v, 0, 0, w, ht)
      frame()
      onProgress?.(Math.min(1, v.currentTime / d))
      schedule()
    }
    const ended = once(v, 'ended', d * 2000 + 30000)
    rec.start(1000)
    frame() // the first picture, drawn above
    await v.play()
    schedule()
    await ended
    drawing = false
    if (rec.state !== 'inactive') rec.stop()
    await stopped
    const mime = type.split(';')[0]
    const blob = new Blob(chunks, { type: mime })
    if (!blob.size || blob.size >= file.size * 0.9) return null
    const base = (file.name || 'video').replace(/\.[^.]+$/, '')
    return { file: new File([blob], `${base}.${mime === 'video/mp4' ? 'mp4' : 'webm'}`, { type: mime }), w, h: ht, duration: d }
  } catch {
    return null
  } finally {
    try { if (rec && rec.state !== 'inactive') rec.stop() } catch {}
    releaseVideo(h)
  }
}

/* Width, height (and length) of a photo or video as it is, for one sent in original quality. */
export function mediaSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const done = (v) => { clearTimeout(t); URL.revokeObjectURL(url); resolve(v) }
    const t = setTimeout(() => done(null), 10000)
    if ((file.type || '').startsWith('image/')) {
      const img = new Image()
      img.onload = () => done(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null)
      img.onerror = () => done(null)
      img.src = url
    } else {
      const v = document.createElement('video')
      v.preload = 'metadata'
      v.muted = true
      v.onloadedmetadata = () => done(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight, duration: v.duration } : null)
      v.onerror = () => done(null)
      v.src = url
    }
  })
}
