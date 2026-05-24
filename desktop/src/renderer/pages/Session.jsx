import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import {
  Monitor, MousePointer, Clipboard, Volume2, VolumeX,
  PhoneOff, MessageSquare, FolderUp, Wifi, WifiOff,
  RefreshCw, X, Copy, Check, ChevronDown, Minimize2, Maximize2
} from 'lucide-react'
import useAppStore from '../store/appStore'
import { getSocket, connectSignaling, emitWithAck } from '../hooks/useSignaling'
import {
  createPeerConnection, captureDesktop, addStreamToPeer,
  createOffer, handleOffer, handleAnswer, addIceCandidate,
  sendControlEvent, setStreamQuality, closePeerConnection
} from '../hooks/useWebRTC'
import { getIceConfig } from '../lib/api'
import toast from 'react-hot-toast'

export default function Session() {
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isHost = searchParams.get('host') === 'true'
  const sessionCode = searchParams.get('code')
  const sessionPassword = searchParams.get('pass')

  const { activeSession, isElectron, screenSources, setScreenSources } = useAppStore()

  const videoRef = useRef(null)
  const [connectionState, setConnectionState] = useState('connecting')
  const [controlEnabled, setControlEnabled] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showSourcePicker, setShowSourcePicker] = useState(false)
  const [quality, setQuality] = useState('auto')
  const [copied, setCopied] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [fileUploads, setFileUploads] = useState([])
  const [hostSocketId, setHostSocketId] = useState(null)
  const [viewerSocketId, setViewerSocketId] = useState(null)
  const [selectedSource, setSelectedSource] = useState(null)
  const fileInputRef = useRef(null)

  // ── Load screen sources (host Electron) ───────────────────
  useEffect(() => {
    if (isHost && isElectron && window.electronAPI) {
      window.electronAPI.getSources({ types: ['screen', 'window'] }).then(sources => {
        setScreenSources(sources)
        if (sources.length > 0) {
          setSelectedSource(sources[0])
          setShowSourcePicker(sources.length > 1)
        }
      })
    }
  }, [isHost, isElectron])

  // ── Initialize WebRTC ──────────────────────────────────────
  useEffect(() => {
    if (isHost && !selectedSource && isElectron) return // wait for source selection

    const init = async () => {
      try {
        const socket = connectSignaling()
        const iceConfigRes = await getIceConfig()

        createPeerConnection(iceConfigRes, {
          onIceCandidate: (candidate) => {
            const target = isHost ? viewerSocketId : hostSocketId
            if (target) socket.emit('webrtc:ice', { targetSocketId: target, candidate, sessionId })
          },
          onRemoteStream: (stream) => {
            setConnectionState('connected')
            if (videoRef.current) videoRef.current.srcObject = stream
          },
          onStateChange: setConnectionState,
          onControlEvent: handleIncomingControl,
        })

        if (isHost) {
          const stream = await captureDesktop(selectedSource?.id)
          addStreamToPeer(stream)

          socket.on('viewer:joined', async ({ viewerSocketId: vsId }) => {
            setViewerSocketId(vsId)
            await createOffer(vsId, sessionId)
            toast.success('Remote viewer connected!')
          })
          socket.on('webrtc:answer', async ({ answer }) => await handleAnswer(answer))
        } else {
          const joinRes = await emitWithAck('session:join', { sessionCode, sessionPassword })
          setHostSocketId(joinRes.hostSocketId)
          socket.on('webrtc:offer', async ({ fromSocketId, offer }) => {
            setHostSocketId(fromSocketId)
            await handleOffer(offer, fromSocketId, sessionId)
          })
        }

        socket.on('webrtc:ice', async ({ candidate }) => await addIceCandidate(candidate))
        socket.on('session:ended', () => { toast.error('Session ended by host'); setTimeout(() => navigate('/'), 2000) })
        socket.on('session:host_disconnected', () => setConnectionState('disconnected'))
        socket.on('chat:message', (msg) => setChatMessages(prev => [...prev, msg]))
        socket.on('clipboard:sync', async ({ content }) => {
          try {
            if (isElectron && window.electronAPI) {
              await window.electronAPI.clipboardWrite(content)
            } else {
              await navigator.clipboard.writeText(content)
            }
            toast.success('Clipboard synced!', { icon: '📋' })
          } catch {}
        })

      } catch (err) {
        console.error('[Session] Error:', err)
        toast.error(err.message || 'Connection failed')
        setConnectionState('error')
      }
    }

    init()

    return () => {
      closePeerConnection()
      const socket = getSocket()
      ;['viewer:joined','webrtc:offer','webrtc:answer','webrtc:ice',
        'session:ended','session:host_disconnected','chat:message','clipboard:sync'
      ].forEach(ev => socket?.off(ev))
    }
  }, [sessionId, isHost, selectedSource])

  // ── Mouse/Keyboard Control ─────────────────────────────────
  const handleMouseMove = useCallback((e) => {
    if (!controlEnabled || isHost) return
    const rect = e.currentTarget.getBoundingClientRect()
    sendControlEvent({ type: 'mousemove', x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height })
  }, [controlEnabled, isHost])

  const handleMouseClick = useCallback((e) => {
    if (!controlEnabled || isHost) return
    sendControlEvent({ type: 'mouseclick', button: e.button })
  }, [controlEnabled, isHost])

  const handleKeyDown = useCallback((e) => {
    if (!controlEnabled || isHost) return
    e.preventDefault()
    sendControlEvent({ type: 'keydown', key: e.key, code: e.code, modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey } })
  }, [controlEnabled, isHost])

  const handleWheel = useCallback((e) => {
    if (!controlEnabled || isHost) return
    sendControlEvent({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY })
  }, [controlEnabled, isHost])

  const handleIncomingControl = (data) => {
    // On desktop host: inject OS-level control events
    // In Electron production: use robotjs/nut-js via IPC
    console.log('[Control Event]', data)
  }

  const handleClipboardSync = async () => {
    try {
      let text
      if (isElectron && window.electronAPI) {
        text = await window.electronAPI.clipboardRead()
      } else {
        text = await navigator.clipboard.readText()
      }
      const socket = getSocket()
      socket?.emit('clipboard:sync', { content: text, sessionId })
      toast.success('Clipboard sent to remote', { icon: '📋' })
    } catch { toast.error('Clipboard access denied') }
  }

  const handleSendChat = () => {
    if (!chatInput.trim()) return
    const socket = getSocket()
    socket?.emit('chat:message', { message: chatInput.trim(), sessionId })
    setChatMessages(prev => [...prev, { sender: 'You', message: chatInput.trim(), timestamp: new Date().toISOString(), isSelf: true }])
    setChatInput('')
  }

  const handleCopyCode = () => {
    const code = activeSession?.sessionCode || ''
    if (isElectron && window.electronAPI) window.electronAPI.clipboardWrite(code)
    else navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleLeave = () => {
    if (isHost) getSocket()?.emit('session:end', { sessionId })
    closePeerConnection()
    navigate('/')
  }

  const stateColors = { connecting: '#f59e0b', connected: '#10b981', disconnected: '#ef4444', error: '#ef4444' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#000', outline: 'none' }}
      tabIndex={0} onKeyDown={handleKeyDown}>

      {/* ── Screen Source Picker ── */}
      {showSourcePicker && isHost && screenSources.length > 1 && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100,
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div className="card" style={{ width: 480, maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 15, fontWeight: 700 }}>Choose what to share</h3>
              <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setShowSourcePicker(false)}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, overflow: 'auto' }}>
              {screenSources.map((src) => (
                <div
                  key={src.id}
                  className="card card-hover"
                  style={{
                    padding: 10, cursor: 'pointer',
                    border: selectedSource?.id === src.id ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.07)',
                    background: selectedSource?.id === src.id ? 'rgba(99,102,241,0.1)' : undefined,
                  }}
                  onClick={() => { setSelectedSource(src); setShowSourcePicker(false) }}
                >
                  <img src={src.thumbnail} alt={src.name}
                    style={{ width: '100%', borderRadius: 6, marginBottom: 6, objectFit: 'contain', background: '#000', aspectRatio: '16/9' }} />
                  <p style={{ fontSize: 11, fontWeight: 500, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {src.name}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Top Bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', height: 42,
        background: 'rgba(13,13,20,0.95)', borderBottom: '1px solid rgba(255,255,255,0.07)',
        flexShrink: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
            color: stateColors[connectionState] || '#64748b' }}>
            {connectionState === 'connected' ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span style={{ textTransform: 'capitalize' }}>{connectionState}</span>
          </div>

          {isHost && activeSession?.sessionCode && (
            <>
              <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>Code:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>
                  {activeSession.sessionCode}
                </span>
                <button onClick={handleCopyCode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}>
                  {copied ? <Check size={12} style={{ color: '#10b981' }} /> : <Copy size={12} />}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>Pass:</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: '#34d399' }}>
                  {activeSession.password}
                </span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={quality} onChange={(e) => { setQuality(e.target.value); setStreamQuality(e.target.value) }}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8,
              color: '#94a3b8', fontSize: 11, padding: '3px 8px', outline: 'none', cursor: 'pointer' }}>
            <option value="auto">Auto</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button onClick={handleLeave} className="btn btn-danger" style={{ padding: '5px 12px', fontSize: 12 }}>
            <PhoneOff size={13} /> End
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Video */}
        <div style={{ flex: 1, position: 'relative', background: '#000' }}
          onMouseMove={handleMouseMove} onClick={handleMouseClick} onWheel={handleWheel}
          style={{ flex: 1, position: 'relative', background: '#000', cursor: controlEnabled && !isHost ? 'crosshair' : 'default' }}>
          <video ref={videoRef} autoPlay playsInline muted={isHost}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          {connectionState !== 'connected' && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)'
            }}>
              <span className="spinner" style={{ width: 36, height: 36, marginBottom: 14, borderWidth: 3 }} />
              <p style={{ color: '#64748b', fontSize: 13, textTransform: 'capitalize' }}>{connectionState}...</p>
            </div>
          )}
          {isHost && connectionState === 'connected' && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'rgba(0,0,0,0.7)', borderRadius: 20, padding: '4px 12px',
            }}>
              <span className="dot-pulse" style={{ color: '#ef4444' }} />
              <span style={{ fontSize: 11, color: '#f87171', fontWeight: 500 }}>Sharing screen</span>
            </div>
          )}
        </div>

        {/* Chat Panel */}
        {showChat && (
          <div style={{ width: 280, background: '#0d0d14', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Chat</span>
              <button onClick={() => setShowChat(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={14} /></button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.isSelf ? 'flex-end' : 'flex-start' }}>
                  {!m.isSelf && <span style={{ fontSize: 10, color: '#475569', marginBottom: 3 }}>{m.sender}</span>}
                  <div style={{
                    background: m.isSelf ? '#6366f1' : 'rgba(255,255,255,0.07)',
                    borderRadius: 12, padding: '7px 11px', fontSize: 12, maxWidth: '80%', wordBreak: 'break-word'
                  }}>{m.message}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: 10, borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8 }}>
              <input className="input" style={{ fontSize: 12 }} placeholder="Message..."
                value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()} />
              <button onClick={handleSendChat} className="btn btn-primary" style={{ padding: '7px 10px', flexShrink: 0 }}>
                →
              </button>
            </div>
          </div>
        )}

        {/* File Transfer Panel */}
        {showFiles && (
          <div style={{ width: 280, background: '#0d0d14', borderLeft: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Files</span>
              <button onClick={() => setShowFiles(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569' }}><X size={14} /></button>
            </div>
            <div style={{ flex: 1, padding: 12 }}>
              <div style={{ border: '2px dashed rgba(255,255,255,0.1)', borderRadius: 12, padding: 24, textAlign: 'center', cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}>
                <FolderUp size={22} style={{ color: '#475569', marginBottom: 8 }} />
                <p style={{ fontSize: 12, color: '#64748b' }}>Click to upload files</p>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} />
              </div>
              {fileUploads.map((f, i) => (
                <div key={i} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{f.name}</span>
                  <span style={{ color: '#10b981', fontSize: 11 }}>{f.progress}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '8px 16px', background: 'rgba(13,13,20,0.97)',
        borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0
      }}>
        {!isHost && (
          <button className={`btn ${controlEnabled ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 12 }}
            onClick={() => setControlEnabled(!controlEnabled)}>
            <MousePointer size={13} />
            {controlEnabled ? 'Control On' : 'Control Off'}
          </button>
        )}
        <button className="btn btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }} onClick={handleClipboardSync}>
          <Clipboard size={13} /> Clipboard
        </button>
        <button className={`btn ${showChat ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 12 }}
          onClick={() => { setShowChat(!showChat); setShowFiles(false) }}>
          <MessageSquare size={13} /> Chat
        </button>
        <button className={`btn ${showFiles ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 12 }}
          onClick={() => { setShowFiles(!showFiles); setShowChat(false) }}>
          <FolderUp size={13} /> Files
        </button>
        <button className={`btn ${micEnabled ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 12 }}
          onClick={() => setMicEnabled(!micEnabled)}>
          {micEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          Voice
        </button>
        {isHost && (
          <button className="btn btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}
            onClick={() => setShowSourcePicker(true)}>
            <Monitor size={13} /> Change Screen
          </button>
        )}
        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
        <button onClick={handleLeave} className="btn btn-danger" style={{ padding: '7px 14px', fontSize: 12 }}>
          <PhoneOff size={13} /> {isHost ? 'End Session' : 'Leave'}
        </button>
      </div>
    </div>
  )
}
