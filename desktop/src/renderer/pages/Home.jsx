import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Monitor, Users, History, Settings, Zap, ChevronRight,
  Wifi, WifiOff, Plus, Clock, Shield, Minus, X, Square
} from 'lucide-react'
import useAppStore from '../store/appStore'
import { sessionApi } from '../lib/api'
import { connectSignaling, emitWithAck, getSocket } from '../hooks/useSignaling'
import toast from 'react-hot-toast'

function TitleBar() {
  const { isElectron, settings } = useAppStore()
  if (!isElectron) return null

  const minimize = () => window.electronAPI?.minimize()
  const maximize = () => window.electronAPI?.maximize()
  const close = () => window.electronAPI?.close()

  return (
    <div className="titlebar">
      {/* macOS style */}
      {navigator.userAgent.includes('Mac') ? (
        <div className="titlebar-buttons">
          <button className="titlebar-btn close" onClick={close} title="Close" />
          <button className="titlebar-btn minimize" onClick={minimize} title="Minimize" />
          <button className="titlebar-btn maximize" onClick={maximize} title="Maximize" />
        </div>
      ) : null}
      <div className="flex items-center gap-2 mx-auto">
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          background: 'linear-gradient(135deg,#6366f1,#a855f7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Monitor size={10} color="white" />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>RemoteLink</span>
      </div>
      {/* Windows style */}
      {!navigator.userAgent.includes('Mac') ? (
        <div style={{ display: 'flex', marginLeft: 'auto', height: '100%' }}>
          <button className="win-titlebar-btn" onClick={minimize}><Minus size={12} /></button>
          <button className="win-titlebar-btn" onClick={maximize}><Square size={11} /></button>
          <button className="win-titlebar-btn close" onClick={close}><X size={12} /></button>
        </div>
      ) : null}
    </div>
  )
}

function Sidebar({ current }) {
  const navigate = useNavigate()
  const navItems = [
    { id: 'home', icon: Monitor, label: 'Remote Access', path: '/' },
    { id: 'history', icon: History, label: 'History', path: '/history' },
    { id: 'settings', icon: Settings, label: 'Settings', path: '/settings' },
  ]

  return (
    <div className="sidebar">
      <div style={{ padding: '16px 12px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg,#6366f1,#a855f7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <Monitor size={16} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'white' }}>RemoteLink</div>
            <div style={{ fontSize: 10, color: '#64748b' }}>Desktop v1.0</div>
          </div>
        </div>
      </div>
      <nav style={{ padding: '8px 0', flex: 1 }}>
        {navItems.map(({ id, icon: Icon, label, path }) => (
          <div
            key={id}
            className={`nav-item ${current === id ? 'active' : ''}`}
            onClick={() => navigate(path)}
          >
            <Icon size={16} />
            <span>{label}</span>
          </div>
        ))}
      </nav>
      <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={12} className="text-emerald-500" />
          End-to-end encrypted
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { activeSession, sessionHistory, addToHistory, setActiveSession, setIsHost, isAuthenticated } = useAppStore()

  const [joinCode, setJoinCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [wsStatus, setWsStatus] = useState('idle')

  useEffect(() => {
    if (!isAuthenticated) return
    const socket = connectSignaling()
    socket.on('connect', () => setWsStatus('connected'))
    socket.on('disconnect', () => setWsStatus('disconnected'))
    socket.on('connect_error', () => setWsStatus('error'))
    if (socket.connected) setWsStatus('connected')
  }, [isAuthenticated])

  const handleStartSession = async () => {
    setIsStarting(true)
    try {
      const res = await sessionApi.create({ platform: 'desktop' })
      const { sessionId, sessionCode, password, iceConfig } = res

      await emitWithAck('session:create', { sessionId, sessionCode, passwordHash: password })

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
    if (!joinCode || !joinPassword) return toast.error('Enter code and password')
    setIsJoining(true)
    try {
      const res = await sessionApi.join({ sessionCode: joinCode.trim().toUpperCase() })
      setActiveSession({ ...res, isHost: false, password: joinPassword })
      setIsHost(false)
      addToHistory({ sessionId: res.sessionId, sessionCode: joinCode.toUpperCase(), startedAt: new Date().toISOString(), role: 'viewer' })
      navigate(`/session/${res.sessionId}?host=false&code=${joinCode.toUpperCase()}&pass=${joinPassword}`)
    } catch (err) {
      toast.error(err.error || err.message || 'Session not found')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d14' }}>
      <TitleBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar current="home" />
        <div className="content animate-fade-in">
          <div style={{ maxWidth: 600, margin: '0 auto' }}>

            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700 }}>Remote Access</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
                color: wsStatus === 'connected' ? '#34d399' : wsStatus === 'error' ? '#f87171' : '#64748b' }}>
                {wsStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
                {wsStatus === 'connected' ? 'Connected to server' : wsStatus === 'error' ? 'Server unreachable' : 'Connecting...'}
              </div>
            </div>

            {/* Start Session Card */}
            <div className="card" style={{ marginBottom: 16, position: 'relative', overflow: 'hidden' }}>
              <div style={{
                position: 'absolute', top: -40, right: -40, width: 120, height: 120, borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
                pointerEvents: 'none'
              }} />
              <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)'
                  }}>
                    <Monitor size={18} style={{ color: '#818cf8' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>Share My Screen</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>Let others view and control this PC</div>
                  </div>
                </div>
                <button
                  id="btn-start-session"
                  onClick={handleStartSession}
                  disabled={isStarting || wsStatus !== 'connected'}
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '11px 0' }}
                >
                  {isStarting ? <><span className="spinner" /> Starting...</> : <><Zap size={15} /> Start Session</>}
                </button>
                <p style={{ fontSize: 11, color: '#475569', marginTop: 10, textAlign: 'center' }}>
                  You'll choose which screen to share
                </p>
              </div>
            </div>

            {/* Join Session Card */}
            <div className="card" style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)'
                }}>
                  <Users size={18} style={{ color: '#34d399' }} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Join a Session</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Enter code and password from the host</div>
                </div>
              </div>
              <form onSubmit={handleJoinSession} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  id="input-session-code"
                  type="text"
                  className="input"
                  placeholder="Session Code (e.g. ABC123)"
                  maxLength={6}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  style={{ textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 18, letterSpacing: '0.2em' }}
                />
                <input
                  id="input-session-password"
                  type="password"
                  className="input"
                  placeholder="Session Password"
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                />
                <button
                  id="btn-join-session"
                  type="submit"
                  disabled={isJoining || !joinCode || !joinPassword || wsStatus !== 'connected'}
                  className="btn"
                  style={{
                    background: '#10b981', color: 'white', padding: '11px 0',
                    boxShadow: '0 4px 20px rgba(16,185,129,0.3)',
                  }}
                >
                  {isJoining ? <><span className="spinner" /> Joining...</> : <>Join Session <ChevronRight size={15} /></>}
                </button>
              </form>
            </div>

            {/* Recent Sessions */}
            {sessionHistory.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Clock size={14} style={{ color: '#64748b' }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recent</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sessionHistory.slice(0, 4).map((s) => (
                    <div key={s.sessionId} className="card card-hover" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700,
                          background: s.role === 'host' ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.1)',
                          color: s.role === 'host' ? '#818cf8' : '#34d399',
                        }}>
                          {s.role === 'host' ? 'H' : 'V'}
                        </div>
                        <div>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700 }}>{s.sessionCode}</div>
                          <div style={{ fontSize: 11, color: '#475569' }}>
                            {s.role === 'host' ? 'Hosted' : 'Joined'} · {new Date(s.startedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <ChevronRight size={15} style={{ color: '#334155' }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
