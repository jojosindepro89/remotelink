import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Smartphone, Globe, Shield, Zap, Users, ChevronRight, Wifi, WifiOff, Video } from 'lucide-react'
import useSessionStore from '../store/sessionStore'
import { sessionApi } from '../lib/api'
import { connectSignaling, emitWithAck, getSocket } from '../lib/signaling'
import { createCallRoom } from '../lib/useVideoCall'
import toast from 'react-hot-toast'
import { v4 as uuidv4 } from 'uuid'

export default function Home() {
  const navigate = useNavigate()
  const { isAuthenticated, sessionHistory, token, deviceId, addToHistory, setActiveSession, setIsHost } = useSessionStore()

  const [joinCode, setJoinCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [isStartingCall, setIsStartingCall] = useState(false)
  const [wsStatus, setWsStatus] = useState('idle')

  useEffect(() => {
    const socket = connectSignaling()
    socket.on('connect', () => setWsStatus('connected'))
    socket.on('disconnect', () => setWsStatus('disconnected'))
    socket.on('connect_error', () => setWsStatus('error'))
    if (socket.connected) setWsStatus('connected')
  }, [])

  const handleStartSession = async () => {
    setIsStarting(true)
    try {
      const res = await sessionApi.create({ platform: 'web' })
      const { sessionId, sessionCode, password, iceConfig } = res

      const socket = getSocket()
      if (!socket?.connected) throw new Error('Not connected to signaling server')

      await emitWithAck('session:create', {
        sessionId,
        sessionCode,
        passwordHash: password, // signaling server receives raw; DB already has hash
      })

      const session = { sessionId, sessionCode, password, iceConfig, isHost: true }
      setActiveSession(session)
      setIsHost(true)
      addToHistory({ sessionId, sessionCode, startedAt: new Date().toISOString(), role: 'host' })
      navigate(`/session/${sessionId}?host=true`)
    } catch (err) {
      toast.error(err.message || 'Failed to start session')
    } finally {
      setIsStarting(false)
    }
  }

  const handleJoinSession = async (e) => {
    e.preventDefault()
    if (!joinCode.trim() || !joinPassword.trim()) {
      return toast.error('Enter session code and password')
    }
    setIsJoining(true)
    try {
      const res = await sessionApi.join({ sessionCode: joinCode.trim().toUpperCase() })
      const { sessionId, iceConfig } = res

      setActiveSession({ sessionId, sessionCode: joinCode.toUpperCase(), iceConfig, isHost: false })
      setIsHost(false)
      addToHistory({ sessionId, sessionCode: joinCode.toUpperCase(), startedAt: new Date().toISOString(), role: 'viewer', password: joinPassword })
      navigate(`/session/${sessionId}?host=false&code=${joinCode.toUpperCase()}&pass=${joinPassword}`)
    } catch (err) {
      toast.error(err.error || err.message || 'Session not found')
    } finally {
      setIsJoining(false)
    }
  }

  const handleStartVideoCall = async () => {
    setIsStartingCall(true)
    try {
      const store = useSessionStore.getState()
      const res = await createCallRoom(store.getAuthHeaders())
      toast.success('Call room created!')
      navigate(`/call/${res.roomCode}`)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to create call room')
    } finally {
      setIsStartingCall(false)
    }
  }

  const features = [
    { icon: Shield, label: 'End-to-End Encrypted', color: 'text-emerald-400' },
    { icon: Zap, label: 'Ultra-Low Latency', color: 'text-yellow-400' },
    { icon: Users, label: 'Multi-Device Support', color: 'text-brand-400' },
    { icon: Globe, label: 'Works Everywhere', color: 'text-blue-400' },
  ]

  const platforms = [
    { icon: Monitor, label: 'Windows Desktop', color: 'from-blue-500 to-cyan-500' },
    { icon: Smartphone, label: 'Android & iOS', color: 'from-brand-500 to-purple-500' },
    { icon: Globe, label: 'Web Browser', color: 'from-emerald-500 to-teal-500' },
  ]

  return (
    <div className="min-h-screen bg-mesh">
      {/* ── Header ── */}
      <header className="fixed top-0 inset-x-0 z-40 glass border-b border-white/6">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
              <Monitor size={16} className="text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">RemoteLink</span>
          </div>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 text-xs font-medium ${
              wsStatus === 'connected' ? 'text-emerald-400' : wsStatus === 'error' ? 'text-red-400' : 'text-slate-500'
            }`}>
              {wsStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
              {wsStatus === 'connected' ? 'Online' : wsStatus === 'error' ? 'Error' : 'Connecting...'}
            </div>
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
              <span className="dot-pulse" style={{ color: '#818cf8' }} />
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
                  Share your screen or allow remote control. A secure code will be generated.
                </p>
                <button
                  id="btn-start-session"
                  onClick={handleStartSession}
                  disabled={isStarting || wsStatus !== 'connected'}
                  className="btn-primary w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isStarting ? (
                    <><span className="spinner" style={{ width: 16, height: 16 }} /> Starting...</>
                  ) : (
                    <><Zap size={16} /> Start Session</>
                  )}
                </button>
                <p className="text-xs text-slate-500 mt-3 text-center">Your screen won't be shared until you approve</p>
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
                  Enter the session code and password shared by the host.
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
                    disabled={isJoining || !joinCode || !joinPassword || wsStatus !== 'connected'}
                    className="btn bg-emerald-500 text-white hover:bg-emerald-400 w-full py-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ boxShadow: '0 4px 24px rgba(16,185,129,0.35)' }}
                  >
                    {isJoining ? (
                      <><span className="spinner" style={{ width: 16, height: 16 }} /> Joining...</>
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
                    <><span className="spinner" style={{ width: 16, height: 16 }} /> Creating...</>
                  ) : (
                    <><Video size={16} /> Start Video Call</>
                  )}
                </button>
                <p className="text-xs text-slate-500 mt-3 text-center">No account needed · Share link to invite</p>
              </div>
            </div>

          </div>

          {/* ── Features Row ── */}
          <div className="flex flex-wrap justify-center gap-4 mb-16">
            {features.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex items-center gap-2 glass rounded-xl px-4 py-2 text-sm">
                <Icon size={15} className={color} />
                <span className="text-slate-300 font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* ── Session History ── */}
          {sessionHistory.length > 0 && (
            <div className="max-w-3xl mx-auto mb-12">
              <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Recent Sessions</h3>
              <div className="space-y-2">
                {sessionHistory.slice(0, 5).map((s) => (
                  <div key={s.sessionId} className="card-hover flex items-center justify-between">
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
                    <ChevronRight size={16} className="text-slate-600" />
                  </div>
                ))}
              </div>
            </div>
          )}

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
