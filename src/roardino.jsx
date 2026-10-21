import { useEffect, useRef } from 'react'
import { I, Modal } from './ui.jsx'
import { locale } from './i18n.js'
import { supabase } from './lib.js'

/* Roardino inside RoarMe (Alex, 18 Oct): the clip's Ordino tile opens themadlions.com/roardino in a frame, signed
   in as the same person (RoarMe hands it the short-lived access token, never the refresh token), and an ordino
   sent from there arrives in the chat as a card. Roardino keeps its own tables (roardino_*), never roar_*. */
export const ROARDINO = 'https://themadlions.com/roardino/'
const ORIGIN = new URL(ROARDINO).origin

export function RoardinoSheet({ onClose, onSend }) {
  const frame = useRef(null)
  const sendRef = useRef(onSend)
  sendRef.current = onSend
  useEffect(() => {
    const post = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token) frame.current?.contentWindow?.postMessage({ type: 'roardino:session', access_token: token }, ORIGIN)
    }
    const onMessage = (e) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return
      const d = e.data || {}
      if (d.type === 'roardino:ready') post()
      if (d.type === 'roardino:send' && typeof d.ordino?.url === 'string' && d.ordino.url.startsWith(ROARDINO)) sendRef.current(cleanOrdino(d.ordino))
    }
    window.addEventListener('message', onMessage)
    const { data: sub } = supabase.auth.onAuthStateChange((event) => { if (event === 'TOKEN_REFRESHED') post() })
    return () => { window.removeEventListener('message', onMessage); sub.subscription.unsubscribe() }
  }, [])
  return (
    <Modal title="Ordino" onClose={onClose} wide>
      <iframe ref={frame} className="rdino-frame" src={`${ROARDINO}?embed=1`} title="Roardino" allow="clipboard-write" />
    </Modal>
  )
}

// only the fields the card shows, as short text
const cleanOrdino = (o) => {
  const t = (v, n = 160) => String(v ?? '').slice(0, n)
  return { v: 1, url: t(o.url, 300), title: t(o.title), artist: t(o.artist), label: t(o.label, 60), date: t(o.date, 10), call: t(o.call, 5), place: t(o.place), accent: /^#[0-9a-f]{3,8}$/i.test(o.accent || '') ? o.accent : '#d40000' }
}

const dayOf = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return ''
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

// the message's text: what older versions and the chat list show
export const ordinoBody = (o) => [`${o.label || 'Ordino'} · ${o.title || 'Ordino'}`, [dayOf(o.date), o.call && `Call ${o.call}`].filter(Boolean).join(' · '), o.url].filter(Boolean).join('\n')

/* the ordino in the chat: its mark, the title, day and call, where, Open */
export function OrdinoCard({ o }) {
  // only a real Roardino page opens: a card someone made by hand cannot send people anywhere else
  const open = () => { if (typeof o.url === 'string' && o.url.startsWith(ROARDINO)) window.open(o.url, '_blank', 'noopener') }
  const when = [dayOf(o.date), o.call && `Call ${o.call}`].filter(Boolean).join(' · ')
  return (
    <span className="trx artc ordc" role="button" tabIndex={0} style={{ '--oc': o.accent || '#d40000' }}
      onClick={(e) => { e.stopPropagation(); open() }} onKeyDown={(e) => { if (e.key === 'Enter') open() }}>
      <span className="trx-head"><span className="rt-mark"><i>{I.ordino}</i><b><span>Ordino</span></b></span></span>
      <span className="artc-hero ordc-hero">
        {o.label && <small>{o.label}</small>}
        <b>{o.title || 'Ordino'}</b>
        {o.artist && <span>{o.artist}</span>}
        {when && <em>{when}</em>}
        {o.place && <span>{o.place}</span>}
      </span>
      <span className="trx-acts"><span className="trx-get">{I.ordino}<span>Open ordino</span></span></span>
    </span>
  )
}
