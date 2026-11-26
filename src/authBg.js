/* The sign-in and sign-up page's background (Alex, 26 Nov: "in admin, change the sign in / sign up background whenever
   I want"): the photo an admin picks in Settings > Admin > Wallpapers is kept in roar_app_look ('auth_bg', a path in the
   public bucket roar-walls; supabase/app-look.sql). The page shows the one kept on this device at once and asks again
   each time it opens; '' is the built-in streaks (src/assets/auth-bg.jpg). The device key is shared by every account. */
import { useEffect, useState } from 'react'
import { supabase } from './lib.js'
import { wallUrl } from './walls.js'

export const AUTH_BG_KEY = 'roarme-auth-bg'
const read = () => { try { return localStorage.getItem(AUTH_BG_KEY) || '' } catch { return '' } }
const keep = (url) => {
  try { if (url) localStorage.setItem(AUTH_BG_KEY, url); else localStorage.removeItem(AUTH_BG_KEY) } catch { /* private window */ }
  window.dispatchEvent(new Event('roarme-auth-bg'))
}

export async function loadAuthBg() {
  const { data, error } = await supabase.from('roar_app_look').select('path').eq('key', 'auth_bg').maybeSingle()
  if (error) return read()
  const url = data?.path ? wallUrl(data.path) : ''
  if (url !== read()) keep(url)
  return url
}

// an admin sets the photo (a path already in roar-walls) or goes back to the built-in one (null)
export async function setAuthBg(path) {
  const { error } = await supabase.from('roar_app_look').upsert({ key: 'auth_bg', path: path || null, updated_at: new Date().toISOString() })
  if (error) throw error
  keep(path ? wallUrl(path) : '')
}

export function useAuthBg() {
  const [url, setUrl] = useState(read)
  useEffect(() => {
    const on = () => setUrl(read())
    window.addEventListener('roarme-auth-bg', on)
    loadAuthBg().catch(() => {})
    return () => window.removeEventListener('roarme-auth-bg', on)
  }, [])
  return url
}
