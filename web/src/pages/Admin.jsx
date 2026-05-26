import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, Users, Monitor, Layers, TrendingUp, LogOut,
  RefreshCw, Trash2, Search, ChevronLeft, BarChart2, FileText, Settings
} from 'lucide-react'
import { adminApi } from '../lib/api'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import toast from 'react-hot-toast'

const COLORS = ['#6366f1', '#a855f7', '#10b981', '#f59e0b', '#3b82f6']

export default function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [sessions, setSessions] = useState([])
  const [users, setUsers] = useState([])
  const [logs, setLogs] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [analyticsRange, setAnalyticsRange] = useState(7)

  useEffect(() => { loadStats() }, [])
  useEffect(() => { if (tab === 'analytics') loadAnalytics() }, [tab, analyticsRange])
  useEffect(() => { if (tab === 'sessions') loadSessions() }, [tab])
  useEffect(() => { if (tab === 'users') loadUsers() }, [tab])
  useEffect(() => { if (tab === 'logs') loadLogs() }, [tab])

  // ── Auto-refresh active tab every 5 seconds for real-time data ─
  useEffect(() => {
    const refreshers = {
      overview:  loadStats,
      sessions:  loadSessions,
      users:     loadUsers,
      logs:      loadLogs,
      analytics: loadAnalytics,
    }
    const fn = refreshers[tab]
    if (!fn) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fn()
    }, 5000)
    return () => clearInterval(interval)
  }, [tab, analyticsRange])

  const loadStats = async () => {
    try {
      const data = await adminApi.getStats()
      setStats(data)
    } catch (err) {
      toast.error('Failed to load stats — check admin credentials')
    } finally {
      setLoading(false)
    }
  }

  const loadSessions = async () => {
    try {
      const data = await adminApi.getSessions({ limit: 50 })
      setSessions(data.sessions || [])
    } catch {}
  }

  const loadUsers = async () => {
    try {
      const data = await adminApi.getUsers({ limit: 50 })
      setUsers(data.users || [])
    } catch {}
  }

  const loadLogs = async () => {
    try {
      const data = await adminApi.getLogs({ lines: 200 })
      setLogs(data.logs || [])
    } catch {}
  }

  const loadAnalytics = async () => {
    try {
      const data = await adminApi.getAnalytics({ days: analyticsRange })
      setAnalytics(data)
    } catch {}
  }

  const terminateSession = async (id) => {
    if (!confirm('Terminate this session?')) return
    try {
      await adminApi.terminateSession(id)
      toast.success('Session terminated')
      loadSessions()
    } catch { toast.error('Failed') }
  }

  const TABS = [
    { id: 'overview', icon: Activity, label: 'Overview' },
    { id: 'sessions', icon: Monitor, label: 'Sessions' },
    { id: 'users', icon: Users, label: 'Users' },
    { id: 'analytics', icon: BarChart2, label: 'Analytics' },
    { id: 'logs', icon: FileText, label: 'Logs' },
  ]

  const StatCard = ({ label, value, sub, color = 'brand' }) => (
    <div className="card">
      <p className="text-slate-400 text-xs font-medium mb-1">{label}</p>
      <p className={`text-3xl font-bold text-${color}-400`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )

  return (
    <div className="min-h-screen bg-mesh">
      {/* ── Header ── */}
      <header className="fixed top-0 inset-x-0 z-40 glass border-b border-white/6">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="btn-ghost p-2">
              <ChevronLeft size={18} />
            </button>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
              <Settings size={15} className="text-white" />
            </div>
            <span className="font-bold text-lg">Admin Panel</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-emerald-400" title="Auto-refreshing every 5 seconds">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </div>
            <button onClick={loadStats} className="btn-ghost text-sm px-3 py-1.5">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="pt-20 pb-10 px-6 max-w-7xl mx-auto">
        {/* ── Tab Nav ── */}
        <nav className="flex gap-1 glass rounded-2xl p-1 mb-8">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              id={`admin-tab-${id}`}
              onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-sm font-medium transition-all duration-200 ${
                tab === id ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon size={15} />
              <span className="hidden sm:block">{label}</span>
            </button>
          ))}
        </nav>

        {/* ── Overview Tab ── */}
        {tab === 'overview' && (
          <div className="animate-fade-in space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Users" value={stats?.users?.total} color="brand" />
              <StatCard label="Total Devices" value={stats?.devices?.total} color="purple" />
              <StatCard label="Total Sessions" value={stats?.sessions?.total}
                sub={`${stats?.sessions?.today || 0} today`} color="emerald" />
              <StatCard label="Active Now" value={stats?.sessions?.live?.active}
                sub={`${stats?.sessions?.live?.viewers || 0} viewers`} color="yellow" />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="card">
                <h3 className="text-sm font-semibold mb-4">Live Session Stats</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Active Sessions', value: stats?.sessions?.live?.active || 0 },
                    { label: 'Waiting Sessions', value: stats?.sessions?.live?.waiting || 0 },
                    { label: 'Connected Viewers', value: stats?.sessions?.live?.viewers || 0 },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">{label}</span>
                      <span className="text-sm font-semibold text-white">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h3 className="text-sm font-semibold mb-4">Data Transferred</h3>
                <p className="text-3xl font-bold text-brand-300">
                  {stats?.dataTransferred
                    ? `${(stats.dataTransferred / 1073741824).toFixed(2)} GB`
                    : '0 GB'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Total across all sessions</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Sessions Tab ── */}
        {tab === 'sessions' && (
          <div className="animate-fade-in">
            <div className="flex gap-3 mb-4">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by session code..."
                  className="input pl-9 text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              {sessions
                .filter(s => !search || s.sessionCode?.includes(search.toUpperCase()))
                .map((s) => (
                  <div key={s._id} className="card flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className={`badge-${s.status === 'active' ? 'active' : s.status === 'waiting' ? 'waiting' : 'ended'}`}>
                        <span className="dot-pulse" />
                        {s.status}
                      </span>
                      <div>
                        <p className="font-mono text-sm font-bold">{s.sessionCode}</p>
                        <p className="text-xs text-slate-500">
                          {s.metadata?.hostPlatform} · {new Date(s.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    {s.status === 'active' && (
                      <button onClick={() => terminateSession(s.sessionId)} className="btn-danger text-xs px-3 py-1.5">
                        <Trash2 size={13} /> Terminate
                      </button>
                    )}
                  </div>
                ))}
              {sessions.length === 0 && (
                <div className="text-center py-12 text-slate-500">No sessions found</div>
              )}
            </div>
          </div>
        )}

        {/* ── Users Tab ── */}
        {tab === 'users' && (
          <div className="animate-fade-in space-y-2">
            {users.map((u) => (
              <div key={u._id} className="card flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-xl bg-brand-500/15 flex items-center justify-center text-brand-400 font-bold text-sm">
                    {(u.displayName || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{u.displayName}</p>
                    <p className="text-xs text-slate-500">{u.deviceId?.slice(0, 16)}… · {u.role}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {u.isGuest && <span className="badge-waiting">Guest</span>}
                  <span className={u.isActive ? 'badge-online' : 'badge-offline'}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <div className="text-center py-12 text-slate-500">No users found</div>
            )}
          </div>
        )}

        {/* ── Analytics Tab ── */}
        {tab === 'analytics' && (
          <div className="animate-fade-in space-y-6">
            <div className="flex gap-2">
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setAnalyticsRange(d)}
                  className={`btn text-xs px-4 py-2 ${analyticsRange === d ? 'btn-primary' : 'btn-ghost'}`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {analytics && (
              <>
                <div className="card">
                  <h3 className="text-sm font-semibold mb-4">Sessions Over Time</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={analytics.sessionsOverTime}>
                      <XAxis dataKey="_id" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                        labelStyle={{ color: '#94a3b8' }}
                      />
                      <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="card">
                    <h3 className="text-sm font-semibold mb-4">Platform Breakdown</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={analytics.platformBreakdown.map(p => ({ name: p._id, value: p.count }))}
                          cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value">
                          {analytics.platformBreakdown.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap gap-2 mt-2 justify-center">
                      {analytics.platformBreakdown.map((p, i) => (
                        <div key={p._id} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-xs text-slate-400 capitalize">{p._id || 'unknown'}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="card">
                    <h3 className="text-sm font-semibold mb-4">Avg Session Duration</h3>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={analytics.sessionsOverTime}>
                        <XAxis dataKey="_id" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                        <Tooltip
                          formatter={(v) => [`${Math.round(v / 60)}m`, 'Avg duration']}
                          contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }}
                        />
                        <Bar dataKey="avgDuration" fill="#a855f7" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Logs Tab ── */}
        {tab === 'logs' && (
          <div className="animate-fade-in">
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/6 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Server Logs (last 200 entries)</h3>
                <button onClick={loadLogs} className="btn-ghost text-xs px-3 py-1.5">
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              <div className="h-[600px] overflow-y-auto p-4 font-mono text-xs space-y-1">
                {logs.map((log, i) => (
                  <div key={i} className={`flex gap-3 ${
                    log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn'  ? 'text-yellow-400' : 'text-slate-400'
                  }`}>
                    <span className="text-slate-600 whitespace-nowrap shrink-0">
                      {log.timestamp || ''}
                    </span>
                    <span className={`uppercase font-bold w-8 shrink-0 ${
                      log.level === 'error' ? 'text-red-500' :
                      log.level === 'warn' ? 'text-yellow-500' : 'text-emerald-500'
                    }`}>{log.level?.slice(0, 4)}</span>
                    <span className="text-slate-300 break-all">{log.message}</span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="text-center text-slate-500 py-8">No logs available</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
