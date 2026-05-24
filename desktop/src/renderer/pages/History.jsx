import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Clock, Monitor, Eye, ChevronRight } from 'lucide-react'
import useAppStore from '../store/appStore'

export default function History() {
  const navigate = useNavigate()
  const { sessionHistory } = useAppStore()

  const formatDuration = (start, end) => {
    if (!start || !end) return '—'
    const ms = new Date(end) - new Date(start)
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d14' }}>
      <div style={{ height: 32, background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.05)',
        WebkitAppRegion: 'drag', display: 'flex', alignItems: 'center', padding: '0 12px', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Session History</span>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 200, background: 'rgba(0,0,0,0.2)', borderRight: '1px solid rgba(255,255,255,0.05)', padding: 12 }}>
          <div className="nav-item" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <ChevronLeft size={14} />
            <span style={{ fontSize: 13 }}>Back</span>
          </div>
        </div>
        <div className="content animate-fade-in">
          <div style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
              <Clock size={18} style={{ color: '#818cf8' }} />
              <h1 style={{ fontSize: 20, fontWeight: 700 }}>Session History</h1>
              <span style={{ fontSize: 12, color: '#475569', marginLeft: 4 }}>({sessionHistory.length} sessions)</span>
            </div>

            {sessionHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#334155' }}>
                <Clock size={40} style={{ marginBottom: 14, opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>No sessions yet</p>
                <p style={{ fontSize: 12, marginTop: 4, color: '#1e293b' }}>
                  Sessions you host or join will appear here
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessionHistory.map((s) => (
                  <div key={s.sessionId} className="card card-hover" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: s.role === 'host' ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.1)',
                      border: `1px solid ${s.role === 'host' ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)'}`,
                    }}>
                      {s.role === 'host'
                        ? <Monitor size={16} style={{ color: '#818cf8' }} />
                        : <Eye size={16} style={{ color: '#34d399' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700 }}>{s.sessionCode}</span>
                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10,
                          background: s.role === 'host' ? 'rgba(99,102,241,0.1)' : 'rgba(16,185,129,0.1)',
                          color: s.role === 'host' ? '#818cf8' : '#34d399',
                          border: `1px solid ${s.role === 'host' ? 'rgba(99,102,241,0.2)' : 'rgba(16,185,129,0.2)'}`,
                        }}>
                          {s.role === 'host' ? 'Hosted' : 'Joined'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#475569' }}>
                        {new Date(s.startedAt).toLocaleString()}
                        {s.endedAt && ` · ${formatDuration(s.startedAt, s.endedAt)}`}
                      </div>
                    </div>
                    <ChevronRight size={15} style={{ color: '#1e293b', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
