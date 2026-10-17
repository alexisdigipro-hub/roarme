import { useMemo, useState } from 'react'
import { qrPath } from './qr.js'
import { Avatar, I, Modal, Paw } from './ui.jsx'
import { nameOf } from './lib.js'

/* Invite people (Alex, 17 Oct): everyone has a personal link (…/roarme/?u=username) and its QR code. Whoever opens it
   signs up if they have no account yet, and a chat with the person who invited them opens by itself. The QR is drawn
   in the app (qr.js), so the link never goes to an outside service. */

const KEY = 'roarme-invite'
const NAME = /^[a-z0-9_]{3,24}$/

export const inviteLink = (username) => `${window.location.origin}${window.location.pathname}?u=${username}`

/* on load: a ?u=username in the address is kept until the person is signed in, then taken out of the address */
export function takeInvite() {
  try {
    const u = new window.URLSearchParams(window.location.search).get('u')
    if (u && NAME.test(u)) {
      localStorage.setItem(KEY, u)
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    }
  } catch { /* private window */ }
}
export const pendingInvite = () => { try { const u = localStorage.getItem(KEY); return u && NAME.test(u) ? u : '' } catch { return '' } }
export const clearInvite = () => { try { localStorage.removeItem(KEY) } catch { /* private window */ } }

export function InviteModal({ me, onClose, toast }) {
  const link = inviteLink(me.username)
  const qr = useMemo(() => qrPath(link), [link])
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { toast?.('Copy did not work here') }
  }
  const canShare = typeof navigator !== 'undefined' && !!navigator.share
  const share = () => navigator.share({ title: 'RoarMe', text: `Talk to me on RoarMe: @${me.username}`, url: link }).catch(() => {})
  return (
    <Modal title="Invite people" onClose={onClose}>
      <div className="inv">
        <div className="inv-card">
          <span className="inv-who"><Avatar src={me.avatar_url} name={nameOf(me)} size={44} /><span><b>{nameOf(me)}</b><small>@{me.username}</small></span></span>
          <span className="inv-qr">
            <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={`QR code for ${link}`} shapeRendering="crispEdges">
              <rect width={qr.size} height={qr.size} fill="#fff" />
              <path d={qr.d} fill="#111" />
            </svg>
            <i className="inv-paw"><Paw size={16} /></i>
          </span>
          <small className="inv-hint">Scan with the phone's camera</small>
        </div>
        <button type="button" className="inv-link" onClick={copy} title="Copy">
          <span>{link.replace(/^https?:\/\//, '')}</span>
          <i>{copied ? I.check : I.copy}</i>
        </button>
        <div className="inv-acts">
          <button type="button" className="btn btn-main" onClick={copy}>{copied ? I.check : I.link}<span>{copied ? 'Link copied' : 'Copy link'}</span></button>
          {canShare && <button type="button" className="btn" onClick={share}>{I.forward}<span>Share</span></button>}
        </div>
        <p className="inv-note">Whoever opens your link signs up (if they have no account yet) and a chat with you opens by itself.</p>
      </div>
    </Modal>
  )
}
