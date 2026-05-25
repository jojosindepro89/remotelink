import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { connectSignaling } from './signaling'
import useSessionStore from '../store/sessionStore'
import toast from 'react-hot-toast'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// Module-level peer map — survives HMR but cleared on unmount
const peers = {}

export function useVideoCall() {
  const { roomCode }  = useParams()
  const navigate      = useNavigate()
  const { user, deviceId } = useSessionStore()

  const localVideoRef   = useRef(null)
  const localStream     = useRef(null)
  const socketRef       = useRef(null)
  const bcRef           = useRef(null)   // BroadcastChannel fallback
  const mountedRef      = useRef(true)
  const mySocketId      = useRef(`local-${Date.now().toString(36)}`)

  const [localStreamState, setLocalStreamState] = useState(null)
  const [remoteStreams, setRemoteStreams]        = useState({})
  const [callState,    setCallState]            = useState('joining')
  const [myVideo,      setMyVideo]              = useState(true)
  const [myAudio,      setMyAudio]              = useState(true)
  const [chatOpen,     setChatOpen]             = useState(false)
  const [messages,     setMessages]             = useState([])
  const [chatInput,    setChatInput]            = useState('')
  const [reactions,    setReactions]            = useState([])

  const myName = user?.displayName
    || `Guest-${(deviceId || mySocketId.current).slice(-4)}`

  // ── Helper: emit via socket or BroadcastChannel ──────────────
  const relay = useCallback((event, data) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, { ...data, roomCode })
    } else if (bcRef.current) {
      bcRef.current.postMessage({ event, data: { ...data, roomCode } })
    }
  }, [roomCode])

  // ── Create RTCPeerConnection to one remote ───────────────────
  const createPeer = useCallback((targetId, isInitiator) => {
    if (peers[targetId]) return peers[targetId]

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peers[targetId] = pc

    localStream.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current)
    })

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) relay('call:ice', { targetSocketId: targetId, candidate })
    }

    pc.ontrack = (event) => {
      if (!mountedRef.current) return
      const stream = event.streams[0]
      setRemoteStreams(prev => ({
        ...prev,
        [targetId]: { ...prev[targetId], stream },
      }))
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce()
    }

    if (isInitiator) {
      ;(async () => {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
          await pc.setLocalDescription(offer)
          relay('call:offer', { targetSocketId: targetId, offer })
        } catch (err) { console.error('[WebRTC] createOffer error:', err) }
      })()
    }

    return pc
  }, [relay])

  // ── Handle incoming signal messages (socket or BroadcastChannel)
  const handleSignal = useCallback(async (event, data) => {
    if (!mountedRef.current) return

    if (event === 'call:participant_joined') {
      const { socketId, displayName } = data
      if (socketId === mySocketId.current) return
      setRemoteStreams(prev => ({ ...prev, [socketId]: { displayName, video: true, audio: true } }))
    }

    else if (event === 'call:offer') {
      const { fromSocketId, offer } = data
      if (fromSocketId === mySocketId.current) return
      const pc = createPeer(fromSocketId, false)
      try {
        if (pc.signalingState !== 'stable') return
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        relay('call:answer', { targetSocketId: fromSocketId, answer })
      } catch (err) { console.error('[WebRTC] handleOffer error:', err) }
    }

    else if (event === 'call:answer') {
      const { fromSocketId, answer } = data
      const pc = peers[fromSocketId]
      if (pc?.signalingState === 'have-local-offer') {
        try { await pc.setRemoteDescription(new RTCSessionDescription(answer)) }
        catch (err) { console.error('[WebRTC] setAnswer error:', err) }
      }
    }

    else if (event === 'call:ice') {
      const { fromSocketId, candidate } = data
      const pc = peers[fromSocketId]
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
        catch (err) { console.warn('[WebRTC] addICE error:', err) }
      }
    }

    else if (event === 'call:participant_left') {
      const { socketId } = data
      peers[socketId]?.close()
      delete peers[socketId]
      setRemoteStreams(prev => { const n = { ...prev }; delete n[socketId]; return n })
      toast('A participant left', { icon: '👋' })
    }

    else if (event === 'call:media_toggle') {
      const { fromSocketId, video, audio } = data
      setRemoteStreams(prev => ({
        ...prev,
        [fromSocketId]: { ...prev[fromSocketId], video, audio },
      }))
    }

    else if (event === 'chat:message') {
      setMessages(prev => [...prev, data])
    }

    else if (event === 'call:reaction') {
      const { emoji, displayName } = data
      const id = Date.now() + Math.random()
      setReactions(prev => [...prev, { id, emoji, displayName }])
      setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3500)
    }
  }, [createPeer, relay])

  // ── Main init ────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    const init = async () => {
      // 1. Get camera + mic — never fail hard
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
      } catch (videoErr) {
        console.warn('[VideoCall] Camera blocked, trying audio only:', videoErr.message)
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          toast('Camera not available — joining audio only', { icon: '🎙️' })
        } catch (audioErr) {
          console.warn('[VideoCall] Audio also blocked, joining without media')
          stream = new MediaStream()
          toast('No camera/mic detected — joining to watch only', { icon: '👁️' })
        }
      }

      if (!mountedRef.current) return

      localStream.current = stream
      setLocalStreamState(stream)

      if (localVideoRef.current && stream.getTracks().length > 0) {
        localVideoRef.current.srcObject = stream
        localVideoRef.current.play().catch(() => {})
      }

      // 2. Try socket connection (non-blocking — fall back to BroadcastChannel)
      let useSocket = false
      try {
        const sock = connectSignaling()
        socketRef.current = sock

        if (!sock.connected && sock.on) {
          // Give socket 5 seconds max — don't block UI on failure
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 5000)   // resolve either way
            sock.once('connect', () => { clearTimeout(t); resolve() })
            sock.once('connect_error', () => { clearTimeout(t); resolve() })
          })
        }

        useSocket = sock.connected
      } catch {
        useSocket = false
      }

      if (!mountedRef.current) return

      // 3a. Socket path — join room via backend
      if (useSocket) {
        const sock = socketRef.current
        sock.emit('call:join', { roomCode, displayName: myName }, (res) => {
          if (!mountedRef.current) return
          if (res?.error) {
            toast.error(res.error)
            setCallState('error')
            return
          }
          setCallState('connected')
          ;(res.participants || []).forEach(p => {
            setRemoteStreams(prev => ({ ...prev, [p.socketId]: { displayName: p.displayName, video: true, audio: true } }))
            createPeer(p.socketId, true)
          })
        })

        sock.on('call:participant_joined', d => handleSignal('call:participant_joined', d))
        sock.on('call:offer',              d => handleSignal('call:offer',              { ...d, fromSocketId: d.fromSocketId }))
        sock.on('call:answer',             d => handleSignal('call:answer',             { ...d, fromSocketId: d.fromSocketId }))
        sock.on('call:ice',                d => handleSignal('call:ice',                { ...d, fromSocketId: d.fromSocketId }))
        sock.on('call:participant_left',   d => handleSignal('call:participant_left',   d))
        sock.on('call:media_toggle',       d => handleSignal('call:media_toggle',       { ...d, fromSocketId: d.fromSocketId }))
        sock.on('chat:message',            d => handleSignal('chat:message',            d))
        sock.on('call:reaction',           d => handleSignal('call:reaction',           d))

      } else {
        // 3b. BroadcastChannel fallback — same-browser tab-to-tab calls
        console.info('[VideoCall] Backend offline — using BroadcastChannel (same-browser only)')
        toast('Connecting locally (backend offline) — both tabs must be on the same browser', {
          icon: '📡', duration: 5000,
        })

        const bc = new BroadcastChannel(`remotelink:${roomCode}`)
        bcRef.current = bc

        bc.onmessage = ({ data: msg }) => {
          if (msg.data?.fromSocketId === mySocketId.current) return
          handleSignal(msg.event, msg.data)
        }

        // Announce ourselves
        bc.postMessage({
          event: 'call:participant_joined',
          data: { socketId: mySocketId.current, displayName: myName, roomCode },
        })

        setCallState('connected')
      }
    }

    init()

    return () => {
      mountedRef.current = false
      const sock = socketRef.current
      if (sock?.connected) {
        sock.emit('call:leave', { roomCode })
        ;['call:participant_joined','call:offer','call:answer','call:ice',
          'call:participant_left','call:media_toggle','chat:message','call:reaction']
          .forEach(e => sock.off(e))
      }
      bcRef.current?.postMessage({ event: 'call:participant_left', data: { socketId: mySocketId.current, roomCode } })
      bcRef.current?.close()
      Object.values(peers).forEach(pc => pc.close())
      for (const k in peers) delete peers[k]
      localStream.current?.getTracks().forEach(t => t.stop())
      localStream.current = null
    }
  }, [roomCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media controls ───────────────────────────────────────────

  const toggleVideo = useCallback(() => {
    const track = localStream.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMyVideo(track.enabled)
    relay('call:media_toggle', { fromSocketId: mySocketId.current, video: track.enabled, audio: myAudio })
  }, [myAudio, relay])

  const toggleAudio = useCallback(() => {
    const track = localStream.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMyAudio(track.enabled)
    relay('call:media_toggle', { fromSocketId: mySocketId.current, video: myVideo, audio: track.enabled })
  }, [myVideo, relay])

  const sendReaction = useCallback((emoji) => {
    relay('call:reaction', { emoji, displayName: myName })
    const id = Date.now() + Math.random()
    setReactions(prev => [...prev, { id, emoji, displayName: 'You' }])
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3500)
  }, [relay, myName])

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return
    relay('chat:message', { sender: myName, message: chatInput.trim(), timestamp: new Date().toISOString() })
    setMessages(prev => [...prev, { sender: 'You', senderId: 'me', message: chatInput.trim(), timestamp: new Date().toISOString() }])
    setChatInput('')
  }, [chatInput, myName, relay])

  const leaveCall = useCallback(() => {
    relay('call:leave', { socketId: mySocketId.current })
    Object.values(peers).forEach(pc => pc.close())
    for (const k in peers) delete peers[k]
    localStream.current?.getTracks().forEach(t => t.stop())
    navigate('/')
  }, [relay, navigate])

  const copyLink = useCallback(() => {
    const link = `${window.location.origin}/call/${roomCode}`
    navigator.clipboard.writeText(link)
      .then(() => toast.success('Join link copied! 🔗'))
      .catch(() => toast.success(`Share this link: ${link}`))
  }, [roomCode])

  return {
    localVideoRef, localStreamState, remoteStreams, callState,
    myVideo, myAudio, chatOpen, setChatOpen,
    messages, chatInput, setChatInput,
    reactions, myName, roomCode,
    toggleVideo, toggleAudio, sendReaction, sendChat, leaveCall, copyLink,
  }
}

// ── API helpers (used from Home.jsx) ─────────────────────────────

export async function createCallRoom(headers = {}) {
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
  const { default: axios } = await import('axios')
  const res = await axios.post(`${API}/calls`, {}, { headers })
  return res.data
}

export async function getCallRoom(roomCode) {
  const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
  const { default: axios } = await import('axios')
  const res = await axios.get(`${API}/calls/${roomCode}`)
  return res.data
}
