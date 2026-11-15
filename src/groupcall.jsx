import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errText, nameOf, supabase } from './lib.js'
import { Avatar, I, svg } from './ui.jsx'
import { getPrefs } from './prefs.js'

/* Video chats in groups, as Telegram's (Alex, 15 Nov; supabase/group-calls.sql). Anyone in a group starts one (the
   profile's Call or Video, a scheduled call's Join); a card goes into the chat (so everyone is told, as with any
   message) and a bar over the chat reads "Video Chat · N joined · Join" while it is on. The sound and picture go
   through LiveKit (roar-livekit {groupCallId}); who is in it is Realtime presence on gcall-<id>, which the bar reads
   without joining. The last one out ends it; whoever started it, or an admin, can end it for all. */

const MIC_OFF = svg(<><path d="M9 9v3a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-5.7-1.3M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11.6 5.3M12 18v3M4 4l16 16" /></>, 24)
const CAM_OFF = svg(<><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H13a2.5 2.5 0 0 1 2.5 2.5v7c0 .3 0 .6-.2.9M16 10l5-3v10l-5-3M3 3l18 18" /></>, 24)
const FLIP = svg(<><path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z" /><path d="M9.5 13.5a2.5 2.5 0 0 1 4.6-1.4M14.5 13.5a2.5 2.5 0 0 1-4.6 1.4M14 10.5v1.8h-1.8M10 16.5v-1.8h1.8" /></>, 24)
const SCREEN = svg(<><rect x="3" y="4.5" width="18" height="12" rx="2.5" /><path d="M8.5 20h7M12 16.5V20M12 13V8M9.5 10.5 12 8l2.5 2.5" /></>, 24)
const LEAVE = svg(<path d="M5 15.5c3.9-3.6 10.1-3.6 14 0l-1.8 2.3-3-1.3v-2.6a8.3 8.3 0 0 0-4.4 0v2.6l-3 1.3z" />, 26)
const SMALLER = svg(<path d="M10 4v6H4M14 20v-6h6M4 10l6-6M20 14l-6 6" />, 22)

// one presence channel per video chat, shared by the bar and the call itself (two joins of one topic would clash)
const chans = new Map()
function holdPresence(id, myId) {
  let c = chans.get(id)
  if (!c) {
    const ch = supabase.channel(`gcall-${id}`, { config: { presence: { key: myId } } })
    c = { ch, n: 0, subs: new Set(), ready: false, waits: [] }
    const cc = c
    ch.on('presence', { event: 'sync' }, () => cc.subs.forEach((f) => f()))
    ch.subscribe((st) => { if (st === 'SUBSCRIBED') { cc.ready = true; cc.waits.splice(0).forEach((f) => f()) } })
    chans.set(id, c)
  }
  c.n++
  return c
}
function dropPresence(id) {
  const c = chans.get(id)
  if (!c) return
  c.n--
  if (c.n <= 0) { supabase.removeChannel(c.ch); chans.delete(id) }
}
const whenReady = (c) => new Promise((ok) => { if (c.ready) ok(); else c.waits.push(ok) })
const peopleIn = (c) => [...new Set(Object.values(c.ch.presenceState()).flat().map((p) => p.user))].filter(Boolean)

// the video chat on in a group now, and who is in it (presence, without joining)
export function useGroupCall(roomId, myId, enabled = true) {
  const [call, setCall] = useState(null)
  const [here, setHere] = useState([])
  useEffect(() => {
    if (!roomId || !enabled) { setCall(null); return }
    let alive = true
    const load = () => supabase.from('roar_group_calls').select('*').eq('room_id', roomId).is('ended_at', null).order('started_at', { ascending: false }).limit(1)
      .then(({ data }) => { if (alive) setCall(data?.[0] && Date.now() - new Date(data[0].started_at).getTime() < 12 * 3600e3 ? data[0] : null) })
    load()
    const ch = supabase.channel(`gcalls-${roomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'roar_group_calls', filter: `room_id=eq.${roomId}` }, load).subscribe()
    window.addEventListener('roarme-gcall-changed', load)
    return () => { alive = false; supabase.removeChannel(ch); window.removeEventListener('roarme-gcall-changed', load) }
  }, [roomId, enabled])
  useEffect(() => {
    if (!call?.id) { setHere([]); return }
    const c = holdPresence(call.id, myId)
    const read = () => setHere(peopleIn(c))
    c.subs.add(read)
    read()
    return () => { c.subs.delete(read); dropPresence(call.id) }
  }, [call?.id, myId])
  return { call, here }
}

// start (or join the one already on) from anywhere: window event roarme-gcall { room, video }
export const startGroupCall = (room, video = true) => window.dispatchEvent(new CustomEvent('roarme-gcall', { detail: { room, video } }))

// the bar over a group's chat while its video chat is on
export function GroupCallBar({ call, here, people, me, inIt, onJoin }) {
  if (!call) return null
  const faces = here.slice(0, 3)
  return (
    <div className="gc-bar" role="button" tabIndex={0} onClick={onJoin} onKeyDown={(e) => { if (e.key === 'Enter') onJoin() }}>
      <span className="gc-bar-faces">
        {faces.map((id) => <Avatar key={id} src={id === me.id ? me.avatar_url : people[id]?.avatar_url} name={id === me.id ? nameOf(me) : nameOf(people[id])} size={26} />)}
        {!faces.length && <i className="gc-bar-ico">{I.video}</i>}
      </span>
      <span className="gc-bar-text"><b>Video Chat</b><small>{here.length ? `${here.length} joined` : 'Starting…'}</small></span>
      <button type="button" className="gc-join" onClick={(e) => { e.stopPropagation(); onJoin() }}>{inIt ? 'Return' : 'Join'}</button>
    </div>
  )
}

// the card a started video chat leaves in the chat
export function GroupCallCard({ who, live, here, onJoin }) {
  return (
    <span className={`gc-card${live ? ' live' : ''}`} onClick={(e) => e.stopPropagation()}>
      <i className="gc-card-ico">{I.video}</i>
      <span className="gc-card-text"><b>Video Chat</b><small>{live ? (here ? `${who} started it · ${here} joined` : `${who} started it`) : 'Ended'}</small></span>
      {live && <button type="button" className="gc-join" onClick={onJoin}>Join</button>}
    </span>
  )
}

// one person's tile: their camera, or their picture while it is off; a ring while they speak
function Tile({ p, me, people }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const s = p.video ? new MediaStream([p.video]) : null
    if (el.srcObject !== s) el.srcObject = s
  }, [p.video])
  const person = p.id === me.id ? me : people[p.id]
  const name = p.id === me.id ? 'You' : p.name || nameOf(person)
  return (
    <div className={`gc-tile${p.speaking ? ' speaking' : ''}${p.video ? ' has-video' : ''}${p.screen ? ' screen' : ''}`}>
      {p.video ? <video ref={ref} autoPlay playsInline muted className={p.id === me.id && !p.screen ? 'mirror' : ''} /> : <Avatar src={person?.avatar_url} name={name} size={72} />}
      <span className="gc-name">{p.muted && <i>{MIC_OFF}</i>}{name}</span>
    </div>
  )
}

// the call itself: full screen, or a small pill while looking at the chats
function GroupCallScreen({ open, me, people, roomTitle, canEnd, onClose, toast }) {
  const [tiles, setTiles] = useState([])
  const [stage, setStage] = useState('connecting')
  const [mic, setMic] = useState(true)
  const [cam, setCam] = useState(!!open.video)
  const [sharing, setSharing] = useState(false)
  const [small, setSmall] = useState(false)
  const roomRef = useRef(null)
  const presence = useRef(null)
  const audios = useRef(null)
  const front = useRef(true)
  const leaving = useRef(false)

  useEffect(() => {
    let r = null
    let alive = true
    const rebuild = async () => {
      if (!r) return
      const { Track } = await import('livekit-client')
      const one = (pt, isMe) => {
        const camPub = pt.getTrackPublication(Track.Source.Camera)
        const scrPub = pt.getTrackPublication(Track.Source.ScreenShare)
        const micPub = pt.getTrackPublication(Track.Source.Microphone)
        const vid = scrPub?.track && !scrPub.isMuted ? scrPub.track : camPub?.track && !camPub.isMuted ? camPub.track : null
        return { id: pt.identity, name: isMe ? '' : pt.name, video: vid?.mediaStreamTrack || null, screen: !!(scrPub?.track && !scrPub.isMuted), muted: !micPub || micPub.isMuted, speaking: pt.isSpeaking }
      }
      setTiles([one(r.localParticipant, true), ...[...r.remoteParticipants.values()].map((x) => one(x, false))])
    }
    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('roar-livekit', { body: { groupCallId: open.id } })
        if (error || !data?.token) {
          let msg = error?.message || 'The video chat could not start.'
          try { msg = (await error.context.json()).error || msg } catch { /* plain */ }
          throw new Error(msg)
        }
        const { Room, RoomEvent, Track } = await import('livekit-client')
        if (!alive) return
        const { micId, camId, callLessData } = getPrefs()
        r = new Room({
          adaptiveStream: true, dynacast: true,
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, ...(micId ? { deviceId: micId } : {}) },
          videoCaptureDefaults: { resolution: callLessData ? { width: 640, height: 360, frameRate: 15 } : { width: 1280, height: 720, frameRate: 30 }, ...(camId ? { deviceId: camId } : {}) },
        })
        roomRef.current = r
        const ev = [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged]
        ev.forEach((e) => r.on(e, rebuild))
        r.on(RoomEvent.TrackSubscribed, (track) => { if (track.kind === Track.Kind.Audio && audios.current) { const el = track.attach(); el.dataset.sid = track.sid; audios.current.appendChild(el) } })
        r.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove()) })
        r.on(RoomEvent.Reconnecting, () => setStage('connecting'))
        r.on(RoomEvent.Reconnected, () => setStage('live'))
        r.on(RoomEvent.Disconnected, () => { if (!leaving.current) { toast('The connection dropped'); onClose() } })
        await r.connect(data.url, data.token)
        if (!alive) { r.disconnect(); return }
        await r.localParticipant.setMicrophoneEnabled(true).catch(() => { setMic(false) })
        if (open.video) await r.localParticipant.setCameraEnabled(true).catch(() => { setCam(false) })
        setStage('live')
        rebuild()
        const c = holdPresence(open.id, me.id)
        presence.current = c
        await whenReady(c)
        if (alive) c.ch.track({ user: me.id, at: Date.now() })
      } catch (e) {
        toast(/Permission|NotAllowed/i.test(String(e?.name || e?.message)) ? 'RoarMe needs the microphone (and camera) for the video chat' : errText(e))
        onClose()
      }
    })()
    // when it is ended for all, everyone leaves
    const watch = supabase.channel(`gcall-end-${open.id}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'roar_group_calls', filter: `id=eq.${open.id}` }, (p) => {
      if (p.new?.ended_at && !leaving.current) { toast('The video chat has ended'); leave(false) }
    }).subscribe()
    return () => {
      alive = false
      leaving.current = true
      supabase.removeChannel(watch)
      if (presence.current) { presence.current.ch.untrack().catch(() => {}); presence.current = null; dropPresence(open.id) }
      roomRef.current?.disconnect()
      roomRef.current = null
    }
  }, [open.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // leave; the last one out ends it, and End for All ends it for everyone
  const leave = async (endAll) => {
    if (leaving.current) return
    leaving.current = true
    const r = roomRef.current
    const last = r && r.remoteParticipants.size === 0
    try { await presence.current?.ch.untrack() } catch { /* gone */ }
    r?.disconnect()
    if (endAll || last) await supabase.rpc('roar_group_call_end', { c: open.id })
    window.dispatchEvent(new Event('roarme-gcall-changed'))
    onClose()
  }
  const toggleMic = async () => { const v = !mic; setMic(v); await roomRef.current?.localParticipant.setMicrophoneEnabled(v).catch(() => setMic(!v)) }
  const toggleCam = async () => { const v = !cam; setCam(v); await roomRef.current?.localParticipant.setCameraEnabled(v).catch(() => setCam(!v)) }
  const flip = async () => {
    const { Track } = await import('livekit-client')
    const t = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    if (!t) return
    front.current = !front.current
    await t.restartTrack({ facingMode: front.current ? 'user' : 'environment' }).catch(() => {})
  }
  const share = async () => { const v = !sharing; setSharing(v); await roomRef.current?.localParticipant.setScreenShareEnabled(v).catch(() => setSharing(!v)) }
  const canShare = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|Android/i.test(navigator.userAgent)
  const phone = typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent)

  const count = tiles.length
  const ui = (
    <div className={`gc-screen${small ? ' small' : ''}`} data-n={Math.min(count, 9)}>
      <div ref={audios} hidden />
      {small ? (
        <button type="button" className="gc-pill" onClick={() => setSmall(false)}><i>{I.video}</i><span><b>{roomTitle}</b><small>{count} in the video chat</small></span><span className="gc-pill-go">Return</span></button>
      ) : (
        <>
          <div className="gc-top">
            <button type="button" className="round" onClick={() => setSmall(true)} aria-label="Smaller" title="Back to the chats">{SMALLER}</button>
            <span className="gc-title"><b>{roomTitle}</b><small>{stage === 'live' ? `${count} ${count === 1 ? 'person' : 'people'} · Video Chat` : 'Connecting…'}</small></span>
            {canEnd ? <button type="button" className="gc-endall" onClick={() => leave(true)}>End for All</button> : <span className="gc-top-gap" />}
          </div>
          <div className="gc-grid">{tiles.map((p) => <Tile key={p.id} p={p} me={me} people={people} />)}</div>
          <div className="gc-acts">
            <button type="button" className={`gc-btn${!mic ? ' off' : ''}`} onClick={toggleMic} aria-label={mic ? 'Mute' : 'Unmute'}>{mic ? I.mic : MIC_OFF}<small>{mic ? 'Mute' : 'Unmute'}</small></button>
            <button type="button" className={`gc-btn${!cam ? ' off' : ''}`} onClick={toggleCam} aria-label={cam ? 'Camera off' : 'Camera on'}>{cam ? I.video : CAM_OFF}<small>{cam ? 'Camera' : 'Camera off'}</small></button>
            {phone && cam && <button type="button" className="gc-btn" onClick={flip} aria-label="Flip camera">{FLIP}<small>Flip</small></button>}
            {canShare && <button type="button" className={`gc-btn${sharing ? ' on' : ''}`} onClick={share} aria-label="Share screen">{SCREEN}<small>{sharing ? 'Stop sharing' : 'Screen'}</small></button>}
            <button type="button" className="gc-btn leave" onClick={() => leave(false)} aria-label="Leave">{LEAVE}<small>Leave</small></button>
          </div>
        </>
      )}
    </div>
  )
  return createPortal(ui, document.body)
}

// once in the app: answers roarme-gcall (start or join), shows the call
export function GroupCallHost({ me, people, rooms, toast }) {
  const [open, setOpen] = useState(null) // { id, room, video, title, canEnd }
  const openRef = useRef(null)
  openRef.current = open
  useEffect(() => {
    const f = async (e) => {
      const { room, video = true, id } = e.detail || {}
      if (!room) return
      if (openRef.current) { if (openRef.current.room === room) return; toast('You are already in a video chat'); return }
      const r = rooms.find((x) => x.room_id === room)
      let cid = id
      let startedBy = null
      if (!cid) {
        const { data, error } = await supabase.rpc('roar_group_call_start', { r: room, v: video })
        if (error) { toast(/function|does not exist/i.test(error.message) ? 'Video chats need one more step on the server (supabase/group-calls.sql).' : errText(error)); return }
        cid = data?.id
        if (data?.fresh) {
          startedBy = me.id
          // the card in the chat, which also tells everyone (a notification, as for any message)
          await supabase.from('roar_messages').insert({ room_id: room, user_id: me.id, kind: 'text', body: 'Video chat', file: { groupcall: { id: cid, video } } })
        }
      }
      if (!cid) return
      if (!startedBy) { const { data } = await supabase.from('roar_group_calls').select('started_by').eq('id', cid).maybeSingle(); startedBy = data?.started_by }
      window.dispatchEvent(new Event('roarme-gcall-changed'))
      setOpen({ id: cid, room, video, title: r?.title || 'Group', canEnd: startedBy === me.id || r?.role === 'admin' })
    }
    window.addEventListener('roarme-gcall', f)
    return () => window.removeEventListener('roarme-gcall', f)
  }, [rooms, me.id, toast])
  useEffect(() => { document.documentElement.classList.toggle('in-gcall', !!open) }, [open])
  if (!open) return null
  return <GroupCallScreen key={open.id} open={open} me={me} people={people} roomTitle={open.title} canEnd={open.canEnd} onClose={() => setOpen(null)} toast={toast} />
}
