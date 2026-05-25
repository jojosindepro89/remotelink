import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Monitor, MousePointer, Keyboard, Clipboard,
  PhoneOff, MessageSquare, FolderUp, Maximize2, Minimize2,
  Copy, Check, Wifi, WifiOff, X, Video, VideoOff,
  RefreshCw, Volume2, VolumeX, ChevronDown, Link2
} from 'lucide-react'
import useSessionStore from '../store/sessionStore'
import { getSocket, connectSignaling } from '../lib/signaling'
import {
  createPeerConnection, captureScreen, captureMicrophone,
  createOffer, handleOffer, handleAnswer, addIceCandidate,
  addStreamToPeer, sendControlEvent, setStreamQuality, closePeerConnection,
  getLocalStream
} from '../lib/webrtc'
import { getIceConfig } from '../lib/api'
import Chat from '../components/Chat'
import FileTransfer from '../components/FileTransfer'
import toast from 'react-hot-toast'
import RemoteControlExecutor from '../lib/remoteControl'

export default function Session() {
  const { sessionId }    = useParams()
  const [searchParams]   = useSearchParams()
  const navigate         = useNavigate()
  const isHost           = searchParams.get('host') === 'true'
  const sessionCode      = searchParams.get('code')
  const sessionPassword  = searchParams.get('pass')
  const { activeSession } = useSessionStore()

  // Refs
  const videoRef         = useRef(null)
  const containerRef     = useRef(null)
  const pcRef            = useRef(null)
  const socketRef        = useRef(null)
  const hostSocketIdRef  = useRef(null)
  const viewerSocketIdRef = useRef(null)
  const remoteResRef     = useRef({ w: 1920, h: 1080 })  // remote screen resolution

  // State
  const [connectionState, setConnectionState] = useState('connecting')
  const [isFullscreen,    setIsFullscreen]    = useState(false)
  const [showChat,        setShowChat]        = useState(false)
  const [showFiles,       setShowFiles]       = useState(false)
  const [controlEnabled,  setControlEnabled]  = useState(false)
  const [micEnabled,      setMicEnabled]      = useState(false)
  const [quality,         setQuality]         = useState('auto')
  const [chatMessages,    setChatMessages]    = useState([])
  const [copied,          setCopied]          = useState(false)
  const [linkCopied,      setLinkCopied]      = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [remotePointer,   setRemotePointer]   = useState(null)  // { x, y } 0-1
  const [showQuality,     setShowQuality]     = useState(false)

  // ── Control event executor (host side) ──────────────────────
  // Uses Electron IPC on desktop, or injects into page on web
  const executor = useRef(new RemoteControlExecutor())

  // ── Host IPC target element size ────────────────────────────
  const getVideoRect = () => videoRef.current?.getBoundingClientRect() || { width: 1920, height: 1080, left: 0, top: 0 }

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true
    let micStream = null

    const init = async () => {
      try {
        // Connect socket first
        const socket = connectSignaling()
        socketRef.current = socket

        if (!socket.connected) {
          await new Promise((res, rej) => {
            socket.once('connect', res)
            socket.once('connect_error', rej)
            setTimeout(() => rej(new Error('Socket timeout')), 8000)
          })
        }

        // Fetch ICE config (fails gracefully if MongoDB down)
        let iceConfig = null
        try { iceConfig = await getIceConfig() } catch {}

        // Create peer connection
        const pc = createPeerConnection(iceConfig, {
          onIceCandidate: (candidate) => {
            const target = isHost ? viewerSocketIdRef.current : hostSocketIdRef.current
            if (target) socket.emit('webrtc:ice', { targetSocketId: target, candidate, sessionId })
          },
          onRemoteStream: (stream) => {
            if (!mounted) return
            setConnectionState('connected')
            if (videoRef.current) {
              videoRef.current.srcObject = stream
              videoRef.current.play().catch(() => {})
            }
            // Read remote resolution from video metadata
            videoRef.current?.addEventListener('loadedmetadata', () => {
              remoteResRef.current = {
                w: videoRef.current.videoWidth  || 1920,
                h: videoRef.current.videoHeight || 1080,
              }
            }, { once: true })
          },
          onStateChange: (state) => {
            if (!mounted) return
            setConnectionState(state)
            if (state === 'connected')    toast.success('Connected!', { icon: '🟢' })
            if (state === 'failed')       toast.error('Connection failed — retrying…')
            if (state === 'disconnected') toast.error('Connection lost')
          },
          onControlEvent: (event) => {
            // HOST receives control events from viewer and executes them
            if (isHost) executor.current.execute(event, getVideoRect())
            // Show remote pointer on viewer side if host broadcasts cursor
            if (!isHost && event.type === 'cursor') {
              setRemotePointer({ x: event.x, y: event.y })
            }
          },
          onDataChannelOpen: () => {
            if (!mounted) return
            toast.success('Remote control channel ready', { icon: '🎮' })
          },
        })
        pcRef.current = pc

        // ── HOST FLOW ────────────────────────────────────────
        if (isHost) {
          // Start screen capture immediately
          let stream
          try {
            stream = await captureScreen({
              includeAudio: false,
              onScreenShareStop: () => {
                if (mounted) {
                  setIsScreenSharing(false)
                  toast.error('Screen sharing stopped')
                }
              },
            })
            addStreamToPeer(stream)
            setIsScreenSharing(true)
          } catch (err) {
            toast.error(err.message)
            setConnectionState('error')
            return
          }

          // Wait for viewer to join, then create offer
          socket.on('viewer:joined', async ({ viewerSocketId: vsId }) => {
            if (!mounted) return
            viewerSocketIdRef.current = vsId
            toast('Viewer connected — establishing WebRTC…', { icon: '🔗' })
            try {
              await createOffer(vsId, sessionId)
            } catch (err) {
              toast.error('Failed to create offer: ' + err.message)
            }
          })

          socket.on('webrtc:answer', async ({ answer }) => {
            try { await handleAnswer(answer) } catch (e) { console.error(e) }
          })

          // Broadcast cursor position to viewer every 50ms
          let cursorInterval = null
          if (typeof window.__electron !== 'undefined') {
            // Electron: cursor is tracked by main process
          } else {
            // Web host: track mouse over the screen share preview (not useful for viewer)
            // The viewer's control events include pointer position
          }

        } else {
          // ── VIEWER FLOW ──────────────────────────────────────
          // Join the session
          let joinRes
          try {
            joinRes = await new Promise((res, rej) => {
              const t = setTimeout(() => rej(new Error('Join timeout')), 8000)
              socket.emit('session:join', { sessionCode, sessionPassword }, (r) => {
                clearTimeout(t)
                r?.error ? rej(new Error(r.error)) : res(r)
              })
            })
          } catch (err) {
            toast.error(err.message)
            setConnectionState('error')
            return
          }

          hostSocketIdRef.current = joinRes.hostSocketId
          toast('Waiting for host to share screen…', { icon: '🖥️' })

          // Receive screen stream via WebRTC offer
          socket.on('webrtc:offer', async ({ fromSocketId, offer }) => {
            if (!mounted) return
            hostSocketIdRef.current = fromSocketId
            try {
              await handleOffer(offer, fromSocketId, sessionId)
            } catch (err) { console.error('handleOffer error:', err) }
          })
        }

        // ── Shared Handlers ──────────────────────────────────
        socket.on('webrtc:ice', async ({ candidate }) => {
          await addIceCandidate(candidate)
        })

        socket.on('session:ended', ({ reason }) => {
          if (!mounted) return
          toast.error('Session ended: ' + reason.replace(/_/g, ' '))
          setTimeout(() => navigate('/'), 2000)
        })

        socket.on('session:host_disconnected', () => {
          if (mounted) setConnectionState('disconnected')
          toast.error('Host disconnected — waiting to reconnect…')
        })

        socket.on('chat:message', (msg) => {
          if (mounted) setChatMessages(prev => [...prev, msg])
        })

        socket.on('clipboard:sync', ({ content }) => {
          navigator.clipboard.writeText(content).catch(() => {})
          toast.success('Clipboard synced', { icon: '📋' })
        })

        // Viewer also told when another viewer joins (multi-viewer future)
        socket.on('control:event', (data) => {
          // Host side: execute control
          if (isHost) executor.current.execute(data, getVideoRect())
        })

      } catch (err) {
        console.error('[Session] Init error:', err)
        if (mounted) {
          toast.error(err.message || 'Connection failed')
          setConnectionState('error')
        }
      }
    }

    init()

    return () => {
      mounted = false
      closePeerConnection()
      const s = getSocket()
      if (s) {
        s.off('viewer:joined')
        s.off('webrtc:offer')
        s.off('webrtc:answer')
        s.off('webrtc:ice')
        s.off('session:ended')
        s.off('session:host_disconnected')
        s.off('chat:message')
        s.off('clipboard:sync')
        s.off('control:event')
      }
    }
  }, [sessionId, isHost])

  // ── Fullscreen ───────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.()
    } else {
      document.exitFullscreen?.()
    }
  }

  // ── Control Events (Viewer → Host) ──────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!controlEnabled || isHost) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    sendControlEvent({ type: 'mousemove', x, y })
    setRemotePointer({ x, y })
  }, [controlEnabled, isHost])

  const handleMouseDown = useCallback((e) => {
    if (!controlEnabled || isHost) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({
      type: 'mousedown',
      button: e.button,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }, [controlEnabled, isHost])

  const handleMouseUp = useCallback((e) => {
    if (!controlEnabled || isHost) return
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({
      type: 'mouseup',
      button: e.button,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }, [controlEnabled, isHost])

  const handleClick = useCallback((e) => {
    if (!controlEnabled || isHost) return
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({
      type: 'click',
      button: e.button,
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    })
  }, [controlEnabled, isHost])

  const handleDblClick = useCallback((e) => {
    if (!controlEnabled || isHost) return
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({ type: 'dblclick', x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
  }, [controlEnabled, isHost])

  const handleWheel = useCallback((e) => {
    if (!controlEnabled || isHost) return
    e.preventDefault()
    sendControlEvent({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY })
  }, [controlEnabled, isHost])

  const handleKeyDown = useCallback((e) => {
    if (!controlEnabled || isHost) return
    e.preventDefault()
    sendControlEvent({
      type:  'keydown',
      key:   e.key,
      code:  e.code,
      ctrl:  e.ctrlKey,
      alt:   e.altKey,
      shift: e.shiftKey,
      meta:  e.metaKey,
    })
  }, [controlEnabled, isHost])

  const handleKeyUp = useCallback((e) => {
    if (!controlEnabled || isHost) return
    sendControlEvent({ type: 'keyup', key: e.key, code: e.code })
  }, [controlEnabled, isHost])

  // Right-click context menu passthrough
  const handleContextMenu = useCallback((e) => {
    if (!controlEnabled || isHost) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({ type: 'rightclick', x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
  }, [controlEnabled, isHost])

  // ── UI Actions ───────────────────────────────────────────────
  const handleLeave = () => {
    if (isHost) socketRef.current?.emit('session:end', { sessionId })
    closePeerConnection()
    navigate('/')
  }

  const handleQualityChange = async (q) => {
    setQuality(q)
    setShowQuality(false)
    await setStreamQuality(q)
    socketRef.current?.emit('stream:quality', { quality: q, sessionId })
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(activeSession?.sessionCode || sessionCode || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyInviteLink = async () => {
    const code = activeSession?.sessionCode || sessionCode || ''
    const pass = activeSession?.password || sessionPassword || ''
    if (!code) return
    const link = `${window.location.origin}/j/${code}${pass ? `/${encodeURIComponent(pass)}` : ''}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      toast.success('Invite link copied!', { icon: '🔗' })
      setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      toast.error('Could not copy link')
    }
  }

  const handleClipboardSync = async () => {
    try {
      const text = await navigator.clipboard.readText()
      socketRef.current?.emit('clipboard:sync', { content: text, sessionId })
      toast.success('Clipboard sent', { icon: '📋' })
    } catch { toast.error('Clipboard access denied') }
  }

  const handleSendChat = (message) => {
    socketRef.current?.emit('chat:message', { message, sessionId })
    setChatMessages(prev => [...prev, { sender: 'You', message, timestamp: new Date().toISOString(), isSelf: true }])
  }

  const handleToggleMic = async () => {
    try {
      if (!micEnabled) {
        const stream = await captureMicrophone()
        addStreamToPeer(stream)
        setMicEnabled(true)
        toast.success('Microphone on')
      } else {
        getLocalStream()?.getAudioTracks().forEach(t => t.stop())
        setMicEnabled(false)
        toast('Microphone off')
      }
    } catch { toast.error('Mic access denied') }
  }

  const stateColor = {
    connecting: '#fbbf24', connected: '#10b981',
    disconnected: '#ef4444', failed: '#ef4444', error: '#ef4444',
  }

  const statusColor = stateColor[connectionState] || '#94a3b8'

  return (
    <div
      className="fixed inset-0 bg-black flex flex-col"
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      tabIndex={0}
      style={{ outline: 'none' }}
    >
      {/* ── Top Bar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px', background:'rgba(10,10,20,0.95)', borderBottom:'1px solid rgba(255,255,255,0.06)', zIndex:50, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          {/* Logo */}
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#7c3aed)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Monitor size={13} color="white" />
            </div>
            <span style={{ fontSize:13, fontWeight:700, color:'white' }}>RemoteLink</span>
          </div>

          {/* Status */}
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:500, color: statusColor }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background: statusColor, display:'inline-block', boxShadow: connectionState === 'connected' ? `0 0 6px ${statusColor}` : 'none' }} />
            {connectionState}
          </div>

          {/* Session code */}
          {isHost && activeSession?.sessionCode && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:'5px 12px' }}>
              <span style={{ fontSize:11, color:'#94a3b8' }}>Code</span>
              <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:800, color:'#a5b4fc', letterSpacing:2 }}>{activeSession.sessionCode}</span>
              <button onClick={handleCopyCode} style={{ background:'none', border:'none', cursor:'pointer', color: copied ? '#10b981' : '#64748b', padding:2 }}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          )}
          {isHost && activeSession?.password && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:'5px 12px' }}>
              <span style={{ fontSize:11, color:'#94a3b8' }}>Pass</span>
              <span style={{ fontFamily:'monospace', fontSize:14, fontWeight:800, color:'#6ee7b7' }}>{activeSession.password}</span>
            </div>
          )}
          {isHost && (activeSession?.sessionCode || sessionCode) && (
            <button
              onClick={handleCopyInviteLink}
              style={{ display:'flex', alignItems:'center', gap:6, background: linkCopied ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)', border:`1px solid ${linkCopied ? 'rgba(16,185,129,0.35)' : 'rgba(99,102,241,0.35)'}`, borderRadius:10, padding:'5px 12px', color: linkCopied ? '#6ee7b7' : '#a5b4fc', fontSize:12, fontWeight:600, cursor:'pointer' }}
              title="Copy invite link — anyone with this link joins automatically"
            >
              {linkCopied ? <Check size={12} /> : <Link2 size={12} />}
              {linkCopied ? 'Copied!' : 'Invite link'}
            </button>
          )}

          {/* Screen share indicator */}
          {isHost && isScreenSharing && (
            <div style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:'4px 12px' }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#ef4444', display:'inline-block', animation:'pulse 1s ease-in-out infinite' }} />
              <span style={{ fontSize:11, color:'#f87171', fontWeight:600 }}>Sharing screen</span>
            </div>
          )}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Quality selector */}
          <div style={{ position:'relative' }}>
            <button
              id="btn-quality"
              onClick={() => setShowQuality(p => !p)}
              style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:'6px 12px', color:'#94a3b8', fontSize:12, cursor:'pointer' }}
            >
              {quality === 'auto' ? 'Auto' : quality.charAt(0).toUpperCase() + quality.slice(1)} Quality
              <ChevronDown size={12} />
            </button>
            {showQuality && (
              <div style={{ position:'absolute', top:'calc(100% + 6px)', right:0, background:'rgba(15,15,25,0.97)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:12, overflow:'hidden', zIndex:100, minWidth:160, boxShadow:'0 8px 32px rgba(0,0,0,0.5)' }}>
                {[['auto','Auto (adaptive)'],['high','High (4 Mbps)'],['medium','Medium (1.5 Mbps)'],['low','Low (400 Kbps)']].map(([v,l]) => (
                  <button key={v} onClick={() => handleQualityChange(v)}
                    style={{ display:'block', width:'100%', textAlign:'left', padding:'10px 16px', fontSize:12, color: quality === v ? '#a5b4fc' : '#94a3b8', background: quality === v ? 'rgba(99,102,241,0.15)' : 'none', border:'none', cursor:'pointer' }}>
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* End session */}
          <button id="btn-end-session" onClick={handleLeave}
            style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:'6px 14px', color:'#f87171', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            <PhoneOff size={13} />
            {isHost ? 'End Session' : 'Leave'}
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* Screen view + control area */}
        <div
          ref={containerRef}
          style={{ flex:1, position:'relative', background:'#000', overflow:'hidden', cursor: controlEnabled && !isHost ? 'none' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onWheel={handleWheel}
          onContextMenu={handleContextMenu}
        >
          {/* Remote screen video */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isHost}
            style={{ width:'100%', height:'100%', objectFit:'contain', imageRendering:'crisp-edges', display:'block' }}
          />

          {/* Custom remote cursor overlay (viewer sees where they're pointing) */}
          {controlEnabled && !isHost && remotePointer && (
            <div style={{
              position:'absolute',
              left: `${remotePointer.x * 100}%`,
              top:  `${remotePointer.y * 100}%`,
              width:20, height:20,
              transform: 'translate(-2px, -2px)',
              pointerEvents:'none',
              zIndex:50,
            }}>
              {/* SVG cursor */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M2 2L8 18L10.5 12L17 10L2 2Z" fill="white" stroke="#1a1a2e" strokeWidth="1.5"/>
              </svg>
            </div>
          )}

          {/* Connection overlay */}
          {connectionState !== 'connected' && (
            <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.85)' }}>
              {connectionState === 'error' ? (
                <>
                  <p style={{ fontSize:40, marginBottom:12 }}>⚠️</p>
                  <p style={{ color:'#f87171', fontSize:14, fontWeight:600, marginBottom:8 }}>Connection failed</p>
                  <button onClick={() => window.location.reload()} style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:10, padding:'8px 20px', color:'white', fontSize:12, cursor:'pointer', marginTop:12 }}>
                    <RefreshCw size={13} style={{ display:'inline', marginRight:6 }} />Retry
                  </button>
                </>
              ) : (
                <>
                  <div className="spinner" style={{ width:40, height:40, borderWidth:3, marginBottom:16 }} />
                  <p style={{ color:'#94a3b8', fontSize:14 }}>{connectionState}…</p>
                  <p style={{ color:'#475569', fontSize:12, marginTop:6 }}>
                    {isHost ? 'Waiting for viewer to connect' : 'Waiting for host screen…'}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Control enabled overlay hint */}
          {controlEnabled && !isHost && connectionState === 'connected' && (
            <div style={{ position:'absolute', top:12, left:'50%', transform:'translateX(-50%)', background:'rgba(99,102,241,0.2)', backdropFilter:'blur(8px)', border:'1px solid rgba(99,102,241,0.4)', borderRadius:20, padding:'5px 16px', fontSize:11, color:'#a5b4fc', fontWeight:600, pointerEvents:'none' }}>
              🎮 Remote control active — your mouse controls the host
            </div>
          )}

          {/* Fullscreen button */}
          <button
            id="btn-fullscreen"
            onClick={toggleFullscreen}
            style={{ position:'absolute', top:12, right:12, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(8px)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:'6px 10px', color:'#94a3b8', cursor:'pointer', zIndex:40 }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>

        {/* Chat panel */}
        {showChat && (
          <div style={{ width:300, flexShrink:0, display:'flex', flexDirection:'column', borderLeft:'1px solid rgba(255,255,255,0.07)', background:'rgba(10,10,20,0.95)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize:13, fontWeight:600, color:'white' }}>💬 Chat</span>
              <button onClick={() => setShowChat(false)} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer' }}><X size={14} /></button>
            </div>
            <Chat messages={chatMessages} onSend={handleSendChat} />
          </div>
        )}

        {/* File transfer panel */}
        {showFiles && (
          <div style={{ width:300, flexShrink:0, display:'flex', flexDirection:'column', borderLeft:'1px solid rgba(255,255,255,0.07)', background:'rgba(10,10,20,0.95)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              <span style={{ fontSize:13, fontWeight:600, color:'white' }}>📁 File Transfer</span>
              <button onClick={() => setShowFiles(false)} style={{ background:'none', border:'none', color:'#64748b', cursor:'pointer' }}><X size={14} /></button>
            </div>
            <FileTransfer sessionId={sessionId} />
          </div>
        )}
      </div>

      {/* ── Bottom Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'10px 20px', background:'rgba(8,8,15,0.97)', borderTop:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>

        {/* Remote control toggle (viewer only) */}
        {!isHost && (
          <ToolbarBtn
            id="btn-toggle-control"
            icon={<MousePointer size={14} />}
            label={controlEnabled ? 'Control ON' : 'Control OFF'}
            active={controlEnabled}
            onClick={() => {
              const next = !controlEnabled
              setControlEnabled(next)
              if (next) toast('Remote control enabled — your mouse/keyboard now controls the host', { icon: '🎮', duration: 3000 })
              else toast('Remote control disabled')
            }}
          />
        )}

        {/* Clipboard sync */}
        <ToolbarBtn id="btn-clipboard" icon={<Clipboard size={14} />} label="Clipboard" onClick={handleClipboardSync} />

        {/* Mic */}
        <ToolbarBtn
          id="btn-mic"
          icon={micEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          label={micEnabled ? 'Mic On' : 'Mic Off'}
          active={micEnabled}
          onClick={handleToggleMic}
        />

        {/* Chat */}
        <ToolbarBtn
          id="btn-chat"
          icon={<MessageSquare size={14} />}
          label="Chat"
          active={showChat}
          badge={chatMessages.filter(m => !m.isSelf).length}
          onClick={() => { setShowChat(p => !p); setShowFiles(false) }}
        />

        {/* Files */}
        <ToolbarBtn
          id="btn-files"
          icon={<FolderUp size={14} />}
          label="Files"
          active={showFiles}
          onClick={() => { setShowFiles(p => !p); setShowChat(false) }}
        />

        <div style={{ width:1, height:24, background:'rgba(255,255,255,0.1)' }} />

        {/* End */}
        <button id="btn-end-toolbar" onClick={handleLeave}
          style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(239,68,68,0.15)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:'7px 16px', color:'#f87171', fontSize:12, fontWeight:600, cursor:'pointer' }}>
          <PhoneOff size={14} />
          {isHost ? 'End Session' : 'Leave'}
        </button>
      </div>
    </div>
  )
}

function ToolbarBtn({ id, icon, label, onClick, active = false, badge = 0 }) {
  return (
    <div style={{ position:'relative' }}>
      <button id={id} onClick={onClick} style={{
        display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:10,
        fontSize:12, fontWeight:500, cursor:'pointer', border:'1px solid',
        background: active ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)',
        borderColor: active ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)',
        color: active ? '#a5b4fc' : '#94a3b8',
        transition: 'all 0.15s',
      }}>
        {icon} <span style={{ display:'none' }} className="sm:inline">{label}</span>
      </button>
      {badge > 0 && (
        <span style={{ position:'absolute', top:-5, right:-5, background:'#ef4444', color:'white', borderRadius:'50%', width:16, height:16, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700 }}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </div>
  )
}
