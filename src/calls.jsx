import { useCallback, useEffect, useRef, useState } from 'react'
import { SUPABASE_KEY, SUPABASE_URL, errText, nameOf, supabase } from './lib.js'
import { Avatar, I, OnTop, svg } from './ui.jsx'
import { getPrefs } from './prefs.js'

/* Voice and video calls between two people (Alex, 16 Oct), straight from one computer to the other
   (WebRTC). The ringing, the answer and the network details travel through each person's private
   inbox on Supabase Realtime ("call:<their id>"); the database decides who may ring whom (blocks and
   "Who can call me") and keeps the call log (roar_calls) for Recent Calls. */

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] }
const RING_FOR = 45000

// a signal to someone's inbox, through Realtime's broadcast API (checked against the database's rules)
async function signal(to, event, payload) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${data.session?.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `call:${to}`, event, payload, private: true }] }),
  })
  if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'You cannot call this person.' : 'The call could not get through.')
}

// a ring made with WebAudio: two notes for an incoming call, one long note while calling out
let actx = null
function ringer(kind) {
  let stop = false
  const play = () => {
    if (stop) return
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)()
      const t = actx.currentTime
      const notes = kind === 'in' ? [[784, 0], [988, 0.18], [784, 0.36], [988, 0.54]] : [[440, 0]]
      notes.forEach(([f, d]) => {
        const o = actx.createOscillator()
        const g = actx.createGain()
        o.frequency.value = f
        g.gain.setValueAtTime(0.0001, t + d)
        g.gain.exponentialRampToValueAtTime(kind === 'in' ? 0.12 : 0.06, t + d + 0.03)
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + (kind === 'in' ? 0.16 : 1.2))
        o.connect(g).connect(actx.destination)
        o.start(t + d)
        o.stop(t + d + 1.3)
      })
    } catch { /* no sound */ }
  }
  play()
  const id = setInterval(play, kind === 'in' ? 2000 : 3000)
  return () => { stop = true; clearInterval(id) }
}

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export function useCalls({ me, people, loadPeople, toast }) {
  const [call, setCall] = useState(null) // { id, peer, roomId, video, dir, stage, liveAt, muted, camOff }
  const callRef = useRef(null)
  callRef.current = call
  const pc = useRef(null)
  const local = useRef(null)
  const remote = useRef(null)
  const offer = useRef(null)
  const pending = useRef([])
  const stopRing = useRef(() => {})
  const ringTimer = useRef(0)
  const [, tick] = useState(0)

  const cleanup = useCallback(() => {
    stopRing.current(); stopRing.current = () => {}
    clearTimeout(ringTimer.current)
    try { pc.current?.close() } catch { /* closed */ }
    pc.current = null
    local.current?.getTracks().forEach((t) => t.stop())
    local.current = null
    remote.current = null
    offer.current = null
    pending.current = []
  }, [])

  const log = (id, patch) => supabase.from('roar_calls').update(patch).eq('id', id).then(() => {})

  const finish = useCallback((note) => {
    const c = callRef.current
    cleanup()
    setCall(null)
    if (note) toast(note)
    return c
  }, [cleanup, toast])

  const newPeer = (c) => {
    const p = new RTCPeerConnection(ICE)
    p.onicecandidate = (e) => { if (e.candidate) signal(c.peer.id, 'ice', { callId: c.id, from: me.id, c: e.candidate.toJSON() }).catch(() => {}) }
    p.ontrack = (e) => { remote.current = e.streams[0]; tick((n) => n + 1) }
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'connected') setCall((x) => (x ? { ...x, stage: 'live', liveAt: x.liveAt || Date.now() } : x))
      if (p.connectionState === 'failed') {
        const cur = callRef.current
        if (cur) { signal(cur.peer.id, 'hangup', { callId: cur.id, from: me.id }).catch(() => {}); log(cur.id, { ended_at: new Date().toISOString() }) }
        finish('The connection dropped')
      }
    }
    pc.current = p
    return p
  }
  const getMedia = async (video) => {
    const { micId, camId } = getPrefs() // Settings > General > Call settings
    const s = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, ...(micId ? { deviceId: { ideal: micId } } : {}) },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 }, ...(camId ? { deviceId: { ideal: camId } } : {}) } : false,
    })
    local.current = s
    return s
  }
  const addPending = async () => {
    const list = pending.current
    pending.current = []
    for (const c of list) { try { await pc.current.addIceCandidate(c) } catch { /* old */ } }
  }

  // ---------- calling out ----------
  const startCall = useCallback(async (person, roomId, video) => {
    if (callRef.current) { toast('You are already in a call'); return }
    if (!person) return
    if (!navigator.mediaDevices?.getUserMedia) { toast('This browser cannot make calls'); return }
    let c = null
    try {
      const { data: row, error } = await supabase.from('roar_calls').insert({ caller: me.id, callee: person.id, room_id: roomId, video }).select('id').single()
      if (error) throw new Error(/row-level security/i.test(error.message) ? `${nameOf(person)} does not take calls from you.` : errText(error))
      c = { id: row.id, peer: person, roomId, video, dir: 'out', stage: 'ringing', muted: false, camOff: false }
      setCall(c)
      const s = await getMedia(video)
      const p = newPeer(c)
      s.getTracks().forEach((t) => p.addTrack(t, s))
      const o = await p.createOffer()
      await p.setLocalDescription(o)
      await signal(person.id, 'invite', { callId: c.id, from: me.id, roomId, video, sdp: p.localDescription.toJSON() })
      stopRing.current = ringer('out')
      ringTimer.current = setTimeout(() => {
        const cur = callRef.current
        if (cur?.id === c.id && cur.stage === 'ringing') {
          signal(person.id, 'cancel', { callId: c.id, from: me.id }).catch(() => {})
          log(c.id, { status: 'missed', ended_at: new Date().toISOString() })
          finish(`${nameOf(person)} did not answer`)
        }
      }, RING_FOR)
    } catch (e) {
      if (c) log(c.id, { status: 'cancelled', ended_at: new Date().toISOString() })
      finish(e?.name === 'NotAllowedError' ? 'ROAR needs your microphone (and camera) to call' : errText(e))
    }
  }, [me.id, toast, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- answering ----------
  const accept = useCallback(async (withVideo) => {
    const c = callRef.current
    if (!c || c.dir !== 'in') return
    stopRing.current(); stopRing.current = () => {}
    setCall({ ...c, stage: 'connecting', video: withVideo })
    try {
      const s = await getMedia(withVideo)
      const p = newPeer(c)
      s.getTracks().forEach((t) => p.addTrack(t, s))
      await p.setRemoteDescription(offer.current)
      const a = await p.createAnswer()
      await p.setLocalDescription(a)
      await signal(c.peer.id, 'answer', { callId: c.id, from: me.id, sdp: p.localDescription.toJSON() })
      await addPending()
      log(c.id, { status: 'answered', answered_at: new Date().toISOString() })
    } catch (e) {
      signal(c.peer.id, 'hangup', { callId: c.id, from: me.id }).catch(() => {})
      finish(e?.name === 'NotAllowedError' ? 'ROAR needs your microphone (and camera) to answer' : errText(e))
    }
  }, [me.id, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  const decline = useCallback(() => {
    const c = callRef.current
    if (!c) return
    signal(c.peer.id, 'decline', { callId: c.id, from: me.id }).catch(() => {})
    log(c.id, { status: 'declined', ended_at: new Date().toISOString() })
    finish()
  }, [me.id, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  const hangup = useCallback(() => {
    const c = callRef.current
    if (!c) return
    const ringing = c.stage === 'ringing' && c.dir === 'out'
    signal(c.peer.id, ringing ? 'cancel' : 'hangup', { callId: c.id, from: me.id }).catch(() => {})
    log(c.id, ringing ? { status: 'cancelled', ended_at: new Date().toISOString() } : { ended_at: new Date().toISOString() })
    finish(c.liveAt ? `Call ended · ${mmss(Date.now() - c.liveAt)}` : null)
  }, [me.id, finish]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const t = local.current?.getAudioTracks()[0]
    if (!t) return
    t.enabled = !t.enabled
    setCall((x) => ({ ...x, muted: !t.enabled }))
  }
  const toggleCam = () => {
    const t = local.current?.getVideoTracks()[0]
    if (!t) return
    t.enabled = !t.enabled
    setCall((x) => ({ ...x, camOff: !t.enabled }))
  }

  // ---------- my inbox ----------
  useEffect(() => {
    let ch = null
    let alive = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) supabase.realtime.setAuth(data.session.access_token)
      if (!alive) return
      ch = supabase.channel(`call:${me.id}`, { config: { private: true, broadcast: { self: false } } })
      ch.on('broadcast', { event: '*' }, async ({ event, payload }) => {
        const cur = callRef.current
        if (!payload?.callId) return
        if (event === 'invite') {
          if (cur) { signal(payload.from, 'busy', { callId: payload.callId, from: me.id }).catch(() => {}); return }
          let peer = people.current[payload.from]
          if (!peer) { await loadPeople([payload.from]); peer = people.current[payload.from] || { id: payload.from, username: '', display_name: 'Someone' } }
          offer.current = payload.sdp
          pending.current = []
          setCall({ id: payload.callId, peer, roomId: payload.roomId, video: !!payload.video, dir: 'in', stage: 'ringing', muted: false, camOff: false })
          stopRing.current = ringer('in')
          if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try { new Notification(nameOf(peer), { body: payload.video ? 'Incoming video call' : 'Incoming call', icon: peer.avatar_url || './icon.svg', tag: `call-${payload.callId}` }) } catch { /* not here */ }
          }
          clearTimeout(ringTimer.current)
          ringTimer.current = setTimeout(() => { if (callRef.current?.id === payload.callId && callRef.current.stage === 'ringing') finish(`Missed call from ${nameOf(peer)}`) }, RING_FOR + 5000)
          return
        }
        if (!cur || cur.id !== payload.callId) return
        if (event === 'answer' && pc.current) {
          stopRing.current(); stopRing.current = () => {}
          clearTimeout(ringTimer.current)
          setCall((x) => ({ ...x, stage: 'connecting' }))
          await pc.current.setRemoteDescription(payload.sdp)
          await addPending()
        } else if (event === 'ice') {
          if (pc.current?.remoteDescription) { try { await pc.current.addIceCandidate(payload.c) } catch { /* old */ } } else pending.current.push(payload.c)
        } else if (event === 'decline') {
          finish(`${nameOf(cur.peer)} declined`)
        } else if (event === 'busy') {
          log(cur.id, { status: 'busy', ended_at: new Date().toISOString() })
          finish(`${nameOf(cur.peer)} is on another call`)
        } else if (event === 'cancel') {
          finish(`Missed call from ${nameOf(cur.peer)}`)
        } else if (event === 'hangup') {
          finish(cur.liveAt ? `Call ended · ${mmss(Date.now() - cur.liveAt)}` : 'Call ended')
        }
      })
      ch.subscribe()
    })()
    return () => { alive = false; if (ch) supabase.removeChannel(ch) }
  }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // the clock while talking
  useEffect(() => {
    if (call?.stage !== 'live') return undefined
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [call?.stage])
  useEffect(() => () => cleanup(), [cleanup])

  const screen = call && (
    <CallScreen call={call} local={local.current} remote={remote.current} onAccept={accept} onDecline={decline} onHangup={hangup} onMute={toggleMute} onCam={toggleCam} />
  )
  return { startCall, screen, inCall: !!call }
}

function Video({ stream, muted, className }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream || null
    const sp = getPrefs().speakerId
    if (!muted && sp && ref.current?.setSinkId) ref.current.setSinkId(sp).catch(() => {})
  }, [stream, muted])
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />
}

function CallScreen({ call, local, remote, onAccept, onDecline, onHangup, onMute, onCam }) {
  const [small, setSmall] = useState(false)
  const peer = call.peer
  const remoteVideo = !!remote?.getVideoTracks().length
  const status = call.stage === 'live' ? mmss(Date.now() - call.liveAt)
    : call.dir === 'in' && call.stage === 'ringing' ? (call.video ? 'Incoming video call' : 'Incoming call')
    : call.stage === 'ringing' ? 'Calling…' : 'Connecting…'
  return (
    <OnTop>
      <div className={`call${small ? ' call-small' : ''}${remoteVideo && call.stage !== 'ringing' ? ' has-video' : ''}`}>
        {remoteVideo && <Video stream={remote} className="call-remote" />}
        {!remoteVideo && remote && <Video stream={remote} className="call-audio" />}
        <div className="call-who">
          {!remoteVideo && <span className={`call-ring${call.stage === 'ringing' ? ' on' : ''}`}><Avatar src={peer.avatar_url} name={nameOf(peer)} size={small ? 44 : 120} /></span>}
          <b>{nameOf(peer)}</b>
          <small>{status}</small>
        </div>
        {call.video && local && call.stage !== 'ringing' && <Video stream={local} muted className={`call-local${call.camOff ? ' off' : ''}`} />}
        {call.video && local && call.dir === 'out' && call.stage === 'ringing' && <Video stream={local} muted className="call-local" />}
        <div className="call-acts">
          {call.dir === 'in' && call.stage === 'ringing' ? (
            <>
              <button type="button" className="call-btn end" onClick={onDecline} aria-label="Decline">{I.phone}<small>Decline</small></button>
              {call.video && <button type="button" className="call-btn ok" onClick={() => onAccept(true)} aria-label="Answer with video">{I.video}<small>Video</small></button>}
              <button type="button" className="call-btn ok" onClick={() => onAccept(false)} aria-label="Answer">{I.phone}<small>Answer</small></button>
            </>
          ) : (
            <>
              <button type="button" className={`call-btn${call.muted ? ' on' : ''}`} onClick={onMute} aria-label="Mute">{call.muted ? svg(<><path d="M9 9v3a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.6 5.3M12 18v3M4 4l16 16" /></>) : I.mic}<small>{call.muted ? 'Unmute' : 'Mute'}</small></button>
              {call.video && <button type="button" className={`call-btn${call.camOff ? ' on' : ''}`} onClick={onCam} aria-label="Camera">{I.video}<small>{call.camOff ? 'Camera on' : 'Camera off'}</small></button>}
              <button type="button" className="call-btn" onClick={() => setSmall((v) => !v)} aria-label="Smaller">{small ? svg(<path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6" />) : svg(<path d="M10 4v6H4M14 20v-6h6M4 10l6-6M20 14l-6 6" />)}<small>{small ? 'Bigger' : 'Smaller'}</small></button>
              <button type="button" className="call-btn end" onClick={onHangup} aria-label="End call">{I.phone}<small>End</small></button>
            </>
          )}
        </div>
      </div>
    </OnTop>
  )
}

/* Recent Calls: one row per call, missed ones (to me) in red; a click calls back the same way */
export function RecentCalls({ me, people, loadPeople, onCall, empty = null }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('roar_calls').select('id, caller, callee, video, status, started_at, answered_at, ended_at, room_id').order('started_at', { ascending: false }).limit(100)
      if (!alive) return
      const rows = data || []
      loadPeople(rows.map((r) => (r.caller === me.id ? r.callee : r.caller)))
      setList(rows)
    }
    load()
    const ch = supabase.channel(`calls-log-${me.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'roar_calls' }, load).subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (list === null) return <p className="muted rooms-none">Loading…</p>
  if (!list.length) return empty
  return (
    <div className="recent-calls">
      {list.map((r) => {
        const out = r.caller === me.id
        const other = people[out ? r.callee : r.caller] || { id: out ? r.callee : r.caller, display_name: '…' }
        const missed = !out && ['missed', 'cancelled'].includes(r.status)
        const dur = r.answered_at && r.ended_at ? mmss(new Date(r.ended_at) - new Date(r.answered_at)) : ''
        const label = missed ? 'Missed' : out ? (r.status === 'answered' ? 'Outgoing' : r.status === 'declined' ? 'Declined' : r.status === 'busy' ? 'Busy' : 'No answer') : r.status === 'declined' ? 'Declined' : 'Incoming'
        return (
          <button key={r.id} type="button" className="room call-log" onClick={() => onCall(other, r.room_id, r.video)} title={r.video ? 'Video call back' : 'Call back'}>
            <Avatar src={other.avatar_url} name={nameOf(other)} />
            <span className="room-main">
              <span className="room-top"><strong className={missed ? 'missed' : ''}>{nameOf(other)}</strong><small>{new Date(r.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: '2-digit' })}</small></span>
              <span className="room-bottom"><span className="room-prev"><i className={`call-dir${out ? ' out' : ''}`}>{r.video ? I.video : I.phone}</i>{label}{dur && ` (${dur})`}</span></span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
