import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Smartphone, Globe, Shield, Zap, Users,
  ChevronRight, Wifi, WifiOff, Video, Lock, Clock, ArrowRight
} from 'lucide-react'
import useSessionStore from '../store/sessionStore'
import { connectSignaling, getSocket } from '../lib/signaling'
import { canShareScreen } from '../lib/webrtc'
import toast from 'react-hot-toast'

// ── Local session creation (works without backend) ─────────────
function makeLocalSession() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  const pwChars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let pass = ''
  for (let i = 0; i < 8; i++) pass += pwChars[Math.floor(Math.random() * pwChars.length)]
  const id = `local-${Date.now().toString(36)}`
  return { sessionId: id, sessionCode: code, password: pass }
}

function makeLocalRoomCode() {
  const seg = () => Math.random().toString(36).slice(2, 5).toUpperCase()
  return `${seg()}-${seg()}-${seg()}`
}

export default function Home() {
  const navigate = useNavigate()
  const { sessionHistory, addToHistory, setActiveSession, setIsHost, customServerUrl, setCustomServerUrl } = useSessionStore()

  const [joinCode,       setJoinCode]       = useState('')
  const [joinPassword,   setJoinPassword]   = useState('')
  const [customUrlInput, setCustomUrlInput] = useState(customServerUrl || '')

  const handleSaveCustomUrl = () => {
    const cleanUrl = customUrlInput.trim()
    if (!cleanUrl) {
      setCustomServerUrl(null)
      toast.success('Using default server URL')
      window.location.reload()
      return
    }
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      toast.error('URL must start with http:// or https://')
      return
    }
    setCustomServerUrl(cleanUrl)
    toast.success('Custom server URL saved! Reloading...')
    setTimeout(() => window.location.reload(), 1000)
  }

  const handleResetCustomUrl = () => {
    setCustomServerUrl(null)
    setCustomUrlInput('')
    toast.success('Reset to default server URL! Reloading...')
    setTimeout(() => window.location.reload(), 1000)
  }
  const [isStarting,     setIsStarting]     = useState(false)
  const [isJoining,      setIsJoining]      = useState(false)
  const [isStartingCall, setIsStartingCall] = useState(false)
  const [wsStatus,       setWsStatus]       = useState('idle')
  const [backendOnline,  setBackendOnline]  = useState(false)

  useEffect(() => {
    // Attempt signaling connection — non-blocking, never crashes
    try {
      const socket = connectSignaling()
      const setConnected    = () => { setWsStatus('connected'); setBackendOnline(true) }
      const setDisconnected = () => setWsStatus('disconnected')
      const setError        = () => setWsStatus('error')
      socket.on('connect',       setConnected)
      socket.on('disconnect',    setDisconnected)
      socket.on('connect_error', setError)
      if (socket.connected) { setWsStatus('connected'); setBackendOnline(true) }
    } catch {}
  }, [])

  // ── Start Session ─────────────────────────────────────────────
  const handleStartSession = async () => {
    setIsStarting(true)
    try {
      let sessionId, sessionCode, password, iceConfig

      if (backendOnline) {
        // Try backend first
        try {
          const { sessionApi } = await import('../lib/api')
          const res = await sessionApi.create({ platform: 'web' })
          ;({ sessionId, sessionCode, password, iceConfig } = res)

          const socket = getSocket()
          if (socket?.connected) {
            await new Promise((res, rej) => {
              const t = setTimeout(() => rej(new Error('timeout')), 120000)
              socket.emit('session:create', { sessionId, sessionCode, passwordHash: password }, (r) => {
                clearTimeout(t)
                r?.error ? rej(new Error(r.error)) : res(r)
              })
            })
          }
        } catch {
          // Fallback to local session
          ;({ sessionId, sessionCode, password } = makeLocalSession())
          iceConfig = null
        }
      } else {
        // Offline-first: local session, WebRTC signaling peer-to-peer via URL
        ;({ sessionId, sessionCode, password } = makeLocalSession())
        iceConfig = null
      }

      const session = { sessionId, sessionCode, password, iceConfig, isHost: true }
      setActiveSession(session)
      setIsHost(true)
      addToHistory({ sessionId, sessionCode, startedAt: new Date().toISOString(), role: 'host' })
      navigate(`/session/${sessionId}?host=true&code=${sessionCode}&pass=${password}`)
    } catch (err) {
      toast.error(err.message || 'Failed to start session')
    } finally {
      setIsStarting(false)
    }
  }

  // ── Join Session ──────────────────────────────────────────────
  const handleJoinSession = async (e) => {
    e.preventDefault()
    if (!joinCode.trim() || !joinPassword.trim()) return toast.error('Enter code and password')
    setIsJoining(true)
    try {
      const code = joinCode.trim().toUpperCase()
      let sessionId = `remote-${Date.now().toString(36)}`

      if (backendOnline) {
        try {
          const { sessionApi } = await import('../lib/api')
          const res = await sessionApi.join({ sessionCode: code })
          sessionId = res.sessionId
        } catch {
          // proceed with code-only join (P2P via URL params)
        }
      }

      setActiveSession({ sessionId, sessionCode: code, isHost: false })
      setIsHost(false)
      addToHistory({ sessionId, sessionCode: code, startedAt: new Date().toISOString(), role: 'viewer', password: joinPassword })
      navigate(`/session/${sessionId}?host=false&code=${code}&pass=${joinPassword}`)
    } catch (err) {
      toast.error(err.message || 'Failed to join session')
    } finally {
      setIsJoining(false)
    }
  }

  // ── Video Call ────────────────────────────────────────────────
  const handleStartVideoCall = async () => {
    setIsStartingCall(true)
    try {
      let roomCode

      if (backendOnline) {
        try {
          const { createCallRoom } = await import('../lib/useVideoCall')
          const { getAuthHeaders } = useSessionStore.getState()
          const res = await createCallRoom(getAuthHeaders())
          roomCode = res.roomCode
        } catch {
          roomCode = makeLocalRoomCode()
        }
      } else {
        roomCode = makeLocalRoomCode()
      }

      toast.success('Call room created!')
      navigate(`/call/${roomCode}`)
    } catch (err) {
      toast.error('Failed to create call room')
    } finally {
      setIsStartingCall(false)
    }
  }

  const features = [
    { icon: Shield, label: 'End-to-End Encrypted',  color: 'text-emerald-400' },
    { icon: Zap,    label: 'Ultra-Low Latency',      color: 'text-yellow-400' },
    { icon: Lock,   label: 'Session Code + Password', color: 'text-brand-400' },
    { icon: Globe,  label: 'Works Everywhere',       color: 'text-blue-400' },
  ]

  const platforms = [
    { icon: Monitor,    label: 'Windows Desktop', color: 'from-blue-500 to-cyan-500' },
    { icon: Smartphone, label: 'Android & iOS',   color: 'from-brand-500 to-purple-500' },
    { icon: Globe,      label: 'Web Browser',     color: 'from-emerald-500 to-teal-500' },
  ]

  return (
    <div className="min-h-screen bg-mesh">

      {/* ── Header ── */}
      <header className="fixed top-0 inset-x-0 z-40 glass border-b border-white/6">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.svg" alt="RemoteLink" className="w-9 h-9 rounded-lg" />
            <span className="font-bold text-lg tracking-tight">RemoteLink</span>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 text-xs font-medium ${
              wsStatus === 'connected' ? 'text-emerald-400' : wsStatus === 'error' ? 'text-red-400' : 'text-slate-500'
            }`}>
              {wsStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
              {wsStatus === 'connected' ? 'Online' : wsStatus === 'error' ? 'Offline' : 'Connecting…'}
            </div>
            <a
              href="https://github.com/jojosindepro89/remotelink/releases/download/v1.0.7-android/RemoteLink.apk"
              className="hidden sm:flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors font-semibold"
              title="Download the Android app (APK)"
            >
              <Smartphone size={14} /> Android APK
            </a>
            <button
              onClick={() => navigate('/admin')}
              className="btn-ghost text-sm px-3 py-1.5"
            >
              Admin
            </button>
          </div>
        </div>
      </header>

      <main className="pt-24 pb-20 px-6">
        <div className="max-w-7xl mx-auto">

          {/* ── Hero ── */}
          <div className="text-center mb-16 animate-fade-in">
            <div className="inline-flex items-center gap-2 glass rounded-full px-4 py-1.5 text-sm text-brand-300 mb-6 border border-brand-500/20">
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#818cf8', display:'inline-block', animation:'pulse 1.5s ease-in-out infinite' }} />
              Secure P2P Remote Access
            </div>
            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="bg-gradient-to-r from-white via-brand-200 to-brand-400 bg-clip-text text-transparent">
                Connect to any
              </span>
              <br />
              <span className="bg-gradient-to-r from-brand-400 to-purple-400 bg-clip-text text-transparent">
                device, anywhere
              </span>
            </h1>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
              Remote desktop and screen sharing that works across Windows, Android, iOS, and the web.
              No account required — just share a code.
            </p>
          </div>

          {/* ── Main Cards ── */}
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto mb-16 animate-slide-up">

            {/* Start Session */}
            <div className="glass rounded-2xl p-8 relative overflow-hidden group hover:border-brand-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center mb-5">
                  <Monitor size={22} className="text-brand-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">Start a Session</h2>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                  Share your screen or allow remote control. A secure code will be generated automatically.
                </p>
                <button
                  id="btn-start-session"
                  onClick={handleStartSession}
                  disabled={isStarting || !canShareScreen()}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isStarting ? (
                    <><span className="spinner" style={{ width: 16, height: 16 }} /> Starting…</>
                  ) : !canShareScreen() ? (
                    <><Smartphone size={16} /> Desktop Only</>
                  ) : (
                    <><Zap size={16} /> Start Session</>
                  )}
                </button>
                <p className="text-xs text-slate-500 mt-3 text-center">
                  {canShareScreen()
                    ? "Your screen won't share until you approve"
                    : "Screen sharing requires a desktop browser or the desktop app"}
                </p>
              </div>
            </div>

            {/* Join Session */}
            <div className="glass rounded-2xl p-8 relative overflow-hidden group hover:border-emerald-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mb-5">
                  <Users size={22} className="text-emerald-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">Join a Session</h2>
                <p className="text-slate-400 text-sm mb-5 leading-relaxed">
                  Enter the session code and password shared by the host to connect.
                </p>
                <form onSubmit={handleJoinSession} className="space-y-3">
                  <input
                    id="input-session-code"
                    type="text"
                    className="input text-center font-mono text-xl tracking-[0.3em] uppercase"
                    placeholder="ABC123"
                    maxLength={6}
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  />
                  <input
                    id="input-session-password"
                    type="password"
                    className="input"
                    placeholder="Password"
                    value={joinPassword}
                    onChange={(e) => setJoinPassword(e.target.value)}
                  />
                  <button
                    id="btn-join-session"
                    type="submit"
                    disabled={isJoining || !joinCode || !joinPassword}
                    className="btn w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#10b981', color: 'white', boxShadow: '0 4px 24px rgba(16,185,129,0.35)' }}
                  >
                    {isJoining ? (
                      <><span className="spinner" style={{ width: 16, height: 16 }} /> Joining…</>
                    ) : (
                      <>Join Session <ChevronRight size={16} /></>
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Video Call */}
            <div className="glass rounded-2xl p-8 relative overflow-hidden group hover:border-purple-500/30 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/15 border border-purple-500/25 flex items-center justify-center mb-5">
                  <Video size={22} className="text-purple-400" />
                </div>
                <h2 className="text-xl font-bold mb-2">Video Call</h2>
                <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                  Start an instant video call. Share the link — anyone who clicks it joins immediately.
                </p>
                <button
                  id="btn-start-video-call"
                  onClick={handleStartVideoCall}
                  disabled={isStartingCall}
                  className="btn w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#9333ea', color: 'white', boxShadow: '0 4px 24px rgba(147,51,234,0.35)' }}
                >
                  {isStartingCall ? (
                    <><span className="spinner" style={{ width: 16, height: 16 }} /> Creating…</>
                  ) : (
                    <><Video size={16} /> Start Video Call</>
                  )}
                </button>
                <p className="text-xs text-slate-500 mt-3 text-center">No account needed · Share link to invite</p>
              </div>
            </div>

          </div>

          {/* ── Features ── */}
          <div className="flex flex-wrap justify-center gap-4 mb-16">
            {features.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex items-center gap-2 glass rounded-xl px-4 py-2 text-sm">
                <Icon size={15} className={color} />
                <span className="text-slate-300 font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* ── How it Works ── */}
          <div className="max-w-3xl mx-auto mb-16 text-center">
            <h2 className="text-2xl font-bold mb-8 text-white">How it works</h2>
            <div className="grid grid-cols-3 gap-6">
              {[
                { step: '1', title: 'Start a session', desc: 'Click "Start Session" to get a 6-character code and password.' },
                { step: '2', title: 'Share credentials', desc: 'Send the code and password to whoever needs to connect.' },
                { step: '3', title: 'Remote access begins', desc: 'They join instantly — view screen, control mouse & keyboard.' },
              ].map(({ step, title, desc }) => (
                <div key={step} className="glass rounded-2xl p-6 text-center">
                  <div className="w-10 h-10 rounded-full bg-brand-500/20 border border-brand-500/30 flex items-center justify-center mx-auto mb-4 text-brand-400 font-bold">
                    {step}
                  </div>
                  <h3 className="font-semibold text-white mb-2 text-sm">{title}</h3>
                  <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Recent Sessions ── */}
          {sessionHistory.length > 0 && (
            <div className="max-w-3xl mx-auto mb-12">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Clock size={14} /> Recent Sessions
              </h3>
              <div className="space-y-2">
                {sessionHistory.slice(0, 5).map((s) => (
                  <div key={s.sessionId} className="card-hover flex items-center justify-between cursor-pointer"
                    onClick={() => toast('This session has ended — start a new one')}>
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold
                        ${s.role === 'host' ? 'bg-brand-500/15 text-brand-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                        {s.role === 'host' ? 'H' : 'V'}
                      </div>
                      <div>
                        <p className="font-mono text-sm font-semibold text-white">{s.sessionCode}</p>
                        <p className="text-xs text-slate-500">
                          {s.role === 'host' ? 'Hosted' : 'Joined'} · {new Date(s.startedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-600" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Custom Server Settings ── */}
          <div className="max-w-md mx-auto mb-16 p-6 glass rounded-2xl border border-white/6 text-center">
            <h3 className="text-sm font-semibold text-slate-300 mb-2">Connection Settings</h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              If the default tunnel server is down, you can paste the active tunnel URL (e.g. from localtunnel or ngrok) below:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="https://your-tunnel.loca.lt"
                className="input text-xs flex-1"
                style={{ padding: '8px 12px', height: '36px' }}
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
              />
              <button
                onClick={handleSaveCustomUrl}
                className="btn-primary text-xs px-4"
                style={{ height: '36px', background: '#6366f1', color: 'white', borderRadius: '12px' }}
              >
                Save
              </button>
              {customServerUrl && (
                <button
                  onClick={handleResetCustomUrl}
                  className="btn-ghost text-xs px-3 text-red-400 hover:text-red-300"
                  style={{ height: '36px' }}
                >
                  Reset
                </button>
              )}
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              Currently using: <code className="text-indigo-400">{customServerUrl || import.meta.env.VITE_WS_URL || 'http://localhost:3001'}</code>
            </p>
          </div>

          {/* ── Platforms ── */}
          <div className="text-center">
            <p className="text-sm text-slate-500 mb-5 uppercase tracking-wider font-medium">Available on all platforms</p>
            <div className="flex justify-center gap-4 flex-wrap">
              {platforms.map(({ icon: Icon, label, color }) => (
                <div key={label} className="flex items-center gap-2.5 glass rounded-xl px-5 py-3">
                  <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center`}>
                    <Icon size={14} className="text-white" />
                  </div>
                  <span className="text-sm font-medium text-slate-300">{label}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}
