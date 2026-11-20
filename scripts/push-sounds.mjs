// The message sounds of Settings > Notifications and Sounds as files for the iPhone app's notifications (Alex, 14 Nov:
// "the notification sounds strange, neither ours nor the iPhone's"). Apple plays a notification's sound only from a
// file inside the app, so each of prefs.js SOUNDS is drawn here with the same notes, wave and envelope chime() uses,
// and written to mobile/sounds/<kind>.wav (16-bit mono, 44.1 kHz). Run again after a change to SOUNDS:
//   node scripts/push-sounds.mjs
import { writeFileSync, readFileSync } from 'node:fs'

const src = readFileSync(new URL('../src/prefs.js', import.meta.url), 'utf8')
const SOUNDS = eval(src.match(/export const SOUNDS = (\[[\s\S]*?\n\])/)[1]) // eslint-disable-line no-eval
const RATE = 44100
const wave = (type, ph) => {
  const x = ph % 1
  if (type === 'sine') return Math.sin(2 * Math.PI * x)
  if (type === 'triangle') return 1 - 4 * Math.abs(x - 0.5)
  return 2 * x - 1 // sawtooth
}
// WebAudio's exponential ramps: 0.0001 at the start, up to peak in `up` seconds, down to 0.0001 by `len`
const env = (t, peak, up, len) => {
  if (t < 0 || t > len) return 0
  if (t < up) return 0.0001 * Math.pow(peak / 0.0001, t / up)
  return peak * Math.pow(0.0001 / peak, (t - up) / (len - up))
}
for (const [kind, , type, notes, mallet] of SOUNDS) {
  if (kind === 'iphone') continue // Apple's own 'default' sound, no file of ours
  const voices = mallet
    ? notes.flatMap(([f, d]) => [[f, d, 'sine', 0.16, 0.003, 0.42], [f * 4, d, 'sine', 0.035, 0.003, 0.09]])
    : notes.map(([f, d]) => [f, d, type, type === 'sawtooth' ? 0.05 : 0.12, 0.02, type === 'sawtooth' ? 0.45 : 0.28])
  const end = Math.max(...voices.map(([, d, , , , len]) => d + len)) + 0.05
  const n = Math.ceil(end * RATE)
  const pcm = new Float32Array(n)
  for (const [f, d, w, peak, up, len] of voices) {
    for (let i = Math.floor(d * RATE); i < n; i++) {
      const t = i / RATE - d
      if (t > len) break
      pcm[i] += wave(w, f * t) * env(t, peak, up, len)
    }
  }
  // as loud as the phone's own alerts: the loudest point at about 0.9
  const top = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (pcm[i] / top) * 0.9)) * 32767), 44 + i * 2)
  writeFileSync(new URL(`../mobile/sounds/${kind}.wav`, import.meta.url), buf)
  console.log(kind, (end).toFixed(2) + ' s')
}
