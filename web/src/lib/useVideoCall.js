import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { connectSignaling, getSocket } from './signaling'
import useSessionStore from '../store/sessionStore'
import toast from 'react-hot-toast'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

// Module-level peer map (cleared on unmount)
const peers = {}

export function useVideoCall() {
  const { roomCode }  = useParams()
  const navigate      = useNavigate()
  const { user, deviceId } = useSessionStore()

  const localVideoRef   = useRef(null)     // bound to local <video> via forwardRef
  const localStream     = useRef(null)
  const socketRef       = useRef(null)
  const mountedRef      = useRef(true)

  const [localStreamState, setLocalStreamState] = useState(null) // triggers re-render
  const [remoteStreams, setRemoteStreams]        = useState({})   // { socketId: { stream, displayName, video, audio } }
  const [callState,    setCallState]            = useState('joining')
  const [myVideo,      setMyVideo]              = useState(true)
  const [myAudio,      setMyAudio]              = useState(true)
  const [chatOpen,     setChatOpen]             = useState(false)
  const [messages,     setMessages]             = useState([])
  const [chatInput,    setChatInput]            = useState('')
  const [reactions,    setReactions]            = useState([])
  const myName = user?.displayName || `Guest-${(deviceId || '').slice(-4) || Math.random().toString(36).slice(2,6)}`

  // ── Create a peer connection to one remote participant ──────────
  const createPeer = useCallback((targetSocketId, isInitiator) => {
    if (peers[targetSocketId]) return peers[targetSocketId]

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    peers[targetSocketId] = pc

    // Add all local tracks
    localStream.current?.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current)
    })

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && socketRef.current?.connected) {
        socketRef.current.emit('call:ice', { targetSocketId, candidate, roomCode })
      }
    }

    pc.ontrack = (event) => {
      if (!mountedRef.current) return
      const stream = event.streams[0]
      setRemoteStreams(prev => ({
        ...prev,
        [targetSocketId]: { ...prev[targetSocketId], stream },
      }))
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn('[WebRTC] Connection failed, restarting ICE to', targetSocketId)
        pc.restartIce()
      }
    }

    if (isInitiator) {
      // Create offer immediately
      ;(async () => {
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          })
          await pc.setLocalDescription(offer)
          socketRef.current?.emit('call:offer', { targetSocketId, offer, roomCode })
        } catch (err) {
          console.error('[WebRTC] createOffer error:', err)
        }
      })()
    }

    return pc
  }, [roomCode])

  // ── Main init effect ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    const init = async () => {
      try {
        // 1. Get camera + mic
        let stream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
            audio: { echoCancellation: true, noiseSuppression: true },
          })
        } catch (mediaErr) {
          console.warn('[VideoCall] No camera/mic, using audio only:', mediaErr.message)
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true })
          } catch {
            stream = new MediaStream() // empty — still let them join
          }
        }

        localStream.current = stream
        setLocalStreamState(stream)

        // Bind to local video element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
          localVideoRef.current.play().catch(() => {})
        }

        // 2. Connect signaling socket
        const sock = connectSignaling()
        socketRef.current = sock

        // Wait for connection (max 8s)
        if (!sock.connected) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('Socket connection timeout')), 8000)
            sock.once('connect', () => { clearTimeout(t); resolve() })
            sock.once('connect_error', (err) => { clearTimeout(t); reject(err) })
          })
        }

        if (!mountedRef.current) return

        // 3. Join the call room
        sock.emit('call:join', { roomCode, displayName: myName }, (res) => {
          if (!mountedRef.current) return
          if (res?.error) {
            toast.error(res.error)
            setCallState('error')
            return
          }

          setCallState('connected')

          // Connect to all existing participants
          ;(res.participants || []).forEach(p => {
            setRemoteStreams(prev => ({
              ...prev,
              [p.socketId]: {
                displayName: p.displayName,
                video: p.video !== false,
                audio: p.audio !== false,
              },
            }))
            createPeer(p.socketId, true)   // we initiate to existing peers
          })
        })

        // ── Socket event handlers ─────────────────────────────────

        sock.on('call:participant_joined', ({ socketId, displayName }) => {
          if (!mountedRef.current) return
          setRemoteStreams(prev => ({ ...prev, [socketId]: { displayName, video: true, audio: true } }))
          // New joiner sends the offer to us; we respond (don't initiate)
        })

        sock.on('call:offer', async ({ fromSocketId, offer }) => {
          if (!mountedRef.current) return
          const pc = createPeer(fromSocketId, false)
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            sock.emit('call:answer', { targetSocketId: fromSocketId, answer, roomCode })
          } catch (err) { console.error('[WebRTC] handleOffer error:', err) }
        })

        sock.on('call:answer', async ({ fromSocketId, answer }) => {
          const pc = peers[fromSocketId]
          if (pc?.signalingState === 'have-local-offer') {
            try { await pc.setRemoteDescription(new RTCSessionDescription(answer)) }
            catch (err) { console.error('[WebRTC] setAnswer error:', err) }
          }
        })

        sock.on('call:ice', async ({ fromSocketId, candidate }) => {
          const pc = peers[fromSocketId]
          if (!pc) return
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) }
          catch (err) { console.warn('[WebRTC] addICE error:', err) }
        })

        sock.on('call:participant_left', ({ socketId }) => {
          if (!mountedRef.current) return
          peers[socketId]?.close()
          delete peers[socketId]
          setRemoteStreams(prev => {
            const next = { ...prev }
            delete next[socketId]
            return next
          })
          toast(`A participant left`, { icon: '👋' })
        })

        sock.on('call:media_toggle', ({ fromSocketId, video, audio }) => {
          if (!mountedRef.current) return
          setRemoteStreams(prev => ({
            ...prev,
            [fromSocketId]: { ...prev[fromSocketId], video, audio },
          }))
        })

        sock.on('chat:message', (msg) => {
          if (!mountedRef.current) return
          setMessages(prev => [...prev, msg])
        })

        sock.on('call:reaction', ({ emoji, displayName }) => {
          if (!mountedRef.current) return
          const id = Date.now() + Math.random()
          setReactions(prev => [...prev, { id, emoji, displayName }])
          setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3500)
        })

      } catch (err) {
        console.error('[VideoCall] init error:', err)
        if (mountedRef.current) {
          toast.error(err.message || 'Could not join call')
          setCallState('error')
        }
      }
    }

    init()

    return () => {
      mountedRef.current = false

      // Signal leave
      socketRef.current?.emit('call:leave', { roomCode })
      socketRef.current?.off('call:participant_joined')
      socketRef.current?.off('call:offer')
      socketRef.current?.off('call:answer')
      socketRef.current?.off('call:ice')
      socketRef.current?.off('call:participant_left')
      socketRef.current?.off('call:media_toggle')
      socketRef.current?.off('chat:message')
      socketRef.current?.off('call:reaction')

      // Close all peer connections
      Object.values(peers).forEach(pc => pc.close())
      for (const k in peers) delete peers[k]

      // Stop local media
      localStream.current?.getTracks().forEach(t => t.stop())
      localStream.current = null
    }
  }, [roomCode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media controls ──────────────────────────────────────────────

  const toggleVideo = useCallback(() => {
    const track = localStream.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMyVideo(track.enabled)
    socketRef.current?.emit('call:media_toggle', { roomCode, video: track.enabled, audio: myAudio })
  }, [myAudio, roomCode])

  const toggleAudio = useCallback(() => {
    const track = localStream.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMyAudio(track.enabled)
    socketRef.current?.emit('call:media_toggle', { roomCode, video: myVideo, audio: track.enabled })
  }, [myVideo, roomCode])

  const sendReaction = useCallback((emoji) => {
    socketRef.current?.emit('call:reaction', { roomCode, emoji })
    const id = Date.now() + Math.random()
    setReactions(prev => [...prev, { id, emoji, displayName: 'You' }])
    setTimeout(() => setReactions(prev => prev.filter(r => r.id !== id)), 3500)
  }, [roomCode])

  const sendChat = useCallback(() => {
    if (!chatInput.trim()) return
    socketRef.current?.emit('chat:message', { message: chatInput.trim(), roomCode })
    setMessages(prev => [...prev, {
      sender: myName, senderId: 'me',
      message: chatInput.trim(), timestamp: new Date().toISOString(),
    }])
    setChatInput('')
  }, [chatInput, myName, roomCode])

  const leaveCall = useCallback(() => {
    socketRef.current?.emit('call:leave', { roomCode })
    Object.values(peers).forEach(pc => pc.close())
    for (const k in peers) delete peers[k]
    localStream.current?.getTracks().forEach(t => t.stop())
    navigate('/')
  }, [roomCode, navigate])

  const copyLink = useCallback(() => {
    const link = `${window.location.origin}/call/${roomCode}`
    navigator.clipboard.writeText(link).then(() => toast.success('Join link copied!')).catch(() => {
      toast.success(`Link: ${link}`)
    })
  }, [roomCode])

  return {
    localVideoRef, localStreamState, remoteStreams, callState,
    myVideo, myAudio, chatOpen, setChatOpen,
    messages, chatInput, setChatInput,
    reactions, myName, roomCode,
    toggleVideo, toggleAudio, sendReaction, sendChat, leaveCall, copyLink,
  }
}

// ── API helpers ──────────────────────────────────────────────────

export async function createCallRoom(headers = {}) {
  const res = await axios.post(`${API}/calls`, {}, { headers })
  return res.data
}

export async function getCallRoom(roomCode) {
  const res = await axios.get(`${API}/calls/${roomCode}`)
  return res.data
}
