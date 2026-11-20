import { supabase } from './lib.js'

/* Share Battery (Alex, 20 Nov): while it is on (privacy.battery is everybody or contacts) and RoarMe is open, this device
   writes its battery level and whether it charges to roar_profiles (battery_level, battery_charging, battery_at), at most
   every 5 minutes or when it changes by 5 points; roar_people shows it only to whom it is allowed
   (supabase/birthdays-battery.sql). A computer's browser and the Mac app use navigator.getBattery; inside the iPhone app
   Capacitor's Device plugin (getBatteryInfo, over the native bridge). Safari on its own has no way to read it. */
const ON = (me) => ['everybody', 'contacts'].includes(me?.privacy?.battery)

async function readBattery() {
  const C = typeof window !== 'undefined' && window.Capacitor
  if (C?.isNativePlatform?.()) {
    try {
      const D = C.Plugins?.Device
      const b = D?.getBatteryInfo ? await D.getBatteryInfo() : await C.nativePromise?.('Device', 'getBatteryInfo', {})
      if (b && typeof b.batteryLevel === 'number' && b.batteryLevel >= 0) return { level: Math.round(b.batteryLevel * 100), charging: !!b.isCharging }
    } catch { /* no Device plugin in this build */ }
    return null
  }
  if (!navigator.getBattery) return null
  try { const b = await navigator.getBattery(); return { level: Math.round(b.level * 100), charging: !!b.charging, b } } catch { return null }
}

let last = { level: -1, at: 0 }
let timer = null
let watched = null
export function startBattery(me) {
  stopBattery()
  if (!ON(me)) return
  const send = async () => {
    const r = await readBattery()
    if (!r) return
    const now = Date.now()
    if (Math.abs(r.level - last.level) < 5 && now - last.at < 5 * 60e3 && r.charging === last.charging) return
    last = { level: r.level, charging: r.charging, at: now }
    await supabase.from('roar_profiles').update({ battery_level: r.level, battery_charging: r.charging, battery_at: new Date(now).toISOString() }).eq('id', me.id)
    if (r.b && !watched) { watched = r.b; ['levelchange', 'chargingchange'].forEach((e) => r.b.addEventListener(e, send)) }
  }
  send()
  timer = setInterval(send, 60e3)
  const vis = () => { if (!document.hidden) send() }
  document.addEventListener('visibilitychange', vis)
  stopBattery.vis = vis
  stopBattery.send = send
}
export function stopBattery() {
  clearInterval(timer); timer = null
  if (stopBattery.vis) document.removeEventListener('visibilitychange', stopBattery.vis)
  if (watched && stopBattery.send) ['levelchange', 'chargingchange'].forEach((e) => watched.removeEventListener(e, stopBattery.send))
  watched = null
  last = { level: -1, at: 0 }
}

/* what the profile shows: "🔋 64%" or "⚡ 64%", only when written in the last hour */
export function batteryText(p) {
  if (p?.battery_level == null || !p.battery_at || Date.now() - new Date(p.battery_at).getTime() > 3600e3) return ''
  return `${p.battery_charging ? '⚡' : '🔋'} ${p.battery_level}%`
}
