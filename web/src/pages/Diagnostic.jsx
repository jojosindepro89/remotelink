import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { Check, X, Loader2, AlertTriangle, Copy } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * /diagnostic — full stack health check from the user's browser.
 *
 * Runs through every layer of the remote-session pipeline and reports
 * pass/fail with the exact error string for each step. If anything is
 * broken (firewall, dead TURN, expired creds, CDN cache, etc.) it
 * shows up here with a precise reason instead of a generic "Session
 * failed" toast.
 *
 * Layers covered, in order:
 *   1. Backend REST health           — HTTP reachability
 *   2. Backend API (auth)            — JWT issuance
 *   3. Backend session create        — REST session lifecycle
 *   4. Socket.io polling handshake   — XHR transport
 *   5. Socket.io WebSocket upgrade   — full-duplex
 *   6. Backend session:create over WS — signalling registration
 *   7. Backend session:join over WS  — signalling lookup
 *   8. ICE config                    — STUN/TURN delivery
 *   9. STUN reachability             — ICE candidate gathering
 *  10. TURN reachability             — relay candidate gathering
 *  11. WebRTC peer-connection setup  — full pc.iceConnectionState='connected'
 *
 * Each test has its own status, timing, and detail. The whole report
 * is one-click copyable so users can share it back to the developer.
 */

const BACKEND = import.meta.env.VITE_API_URL?.replace(/\/api$/, '')
  || 'https://remotelink-backend.onrender.com'
const WS_URL  = import.meta.env.VITE_WS_URL || BACKEND

const TESTS = [
  { id: 'health',         label: '1. Backend REST health'         },
  { id: 'auth',           label: '2. Auth token (POST /api/auth/guest)' },
  { id: 'create',         label: '3. REST session create'         },
  { id: 'wsPolling',      label: '4. Socket.io polling handshake' },
  { id: 'wsUpgrade',      label: '5. WebSocket upgrade'           },
  { id: 'wsCreate',       label: '6. session:create over WS'      },
  { id: 'wsJoin',         label: '7. session:join over WS'        },
  { id: 'iceConfig',      label: '8. ICE config endpoint'         },
  { id: 'stun',           label: '9. STUN reachable (srflx candidate)' },
  { id: 'turn',           label: '10. TURN reachable (relay candidate)' },
  { id: 'peerConnection', label: '11. WebRTC peer-connection'     },
]

const STATUS = { idle: 'idle', running: 'running', pass: 'pass', fail: 'fail', warn: 'warn' }

export default function Diagnostic() {
  const navigate = useNavigate()
  const [results, setResults] = useState(() =>
    Object.fromEntries(TESTS.map(t => [t.id, { status: STATUS.idle, detail: '', timing: 0 }]))
  )
  const [running, setRunning] = useState(false)
  const cleanup = useRef([])

  function update(id, patch) {
    setResults(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function timed(id, fn) {
    update(id, { status: STATUS.running, detail: '', timing: 0 })
    const t0 = Date.now()
    try {
      const result = await fn()
      const timing = Date.now() - t0
      update(id, { status: result?.warn ? STATUS.warn : STATUS.pass, detail: result?.detail || '', timing })
      return result
    } catch (err) {
      const timing = Date.now() - t0
      update(id, { status: STATUS.fail, detail: err?.message || String(err), timing })
      throw err
    }
  }

  async function runAll() {
    // Reset
    setResults(Object.fromEntries(TESTS.map(t => [t.id, { status: STATUS.idle, detail: '', timing: 0 }])))
    setRunning(true)
    cleanup.current.forEach(fn => { try { fn() } catch {} })
    cleanup.current = []

    let token = null
    let deviceId = `diag-${Math.random().toString(36).slice(2, 10)}`
    let sessionId = null
    let sessionCode = null
    let password = null
    let iceServers = null
    let socket = null

    try {
      // 1. Backend health
      await timed('health', async () => {
        const r = await fetch(`${BACKEND}/health`, { method: 'GET' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        return { detail: `${data.environment} · ${data.timestamp}` }
      })

      // 2. Auth
      await timed('auth', async () => {
        const r = await fetch(`${BACKEND}/api/auth/guest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: 'Diagnostic' }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
        const data = await r.json()
        token = data.token; deviceId = data.deviceId
        if (!token) throw new Error('No token returned')
        return { detail: `deviceId=${deviceId.slice(-12)}` }
      })

      // 3. REST session create
      await timed('create', async () => {
        const r = await fetch(`${BACKEND}/api/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Device-ID': deviceId,
          },
          body: JSON.stringify({ platform: 'diagnostic' }),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
        const data = await r.json()
        sessionId = data.sessionId; sessionCode = data.sessionCode; password = data.password
        if (!sessionId || !sessionCode) throw new Error('Missing sessionId/code in response')
        return { detail: `code=${sessionCode}` }
      })

      // 4 & 5. Socket.io polling handshake + WS upgrade
      let pollingOk = false
      const tConnectStart = Date.now()
      socket = io(WS_URL, {
        auth: { token, deviceId, displayName: 'Diagnostic' },
        transports: ['polling', 'websocket'],
        upgrade: true,
        reconnection: false,
        timeout: 20000,
      })
      cleanup.current.push(() => { try { socket.disconnect() } catch {} })

      await timed('wsPolling', () => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Polling handshake timed out after 20s')), 20000)
        socket.io.engine?.once('open', () => {
          pollingOk = true
          clearTimeout(timeout)
          resolve({ detail: `transport=${socket.io.engine.transport.name}` })
        })
        socket.io.on('error', (err) => { clearTimeout(timeout); reject(err) })
        socket.on('connect_error', (err) => { clearTimeout(timeout); reject(new Error(err?.message || String(err))) })
        // Some socket.io versions emit 'connect' even on polling-only
        socket.once('connect', () => {
          pollingOk = true
          clearTimeout(timeout)
          resolve({ detail: `transport=${socket.io.engine?.transport?.name || 'polling'}` })
        })
      }))

      await timed('wsUpgrade', () => new Promise((resolve) => {
        // Give the upgrade a chance — if it doesn't happen in 5s, that's a warning, not a failure.
        const upgradeTimeout = setTimeout(() => {
          const t = socket.io.engine?.transport?.name
          if (t === 'websocket') resolve({ detail: 'upgraded to WebSocket' })
          else resolve({ warn: true, detail: `still on ${t} (network may block WS — polling will keep working but at higher latency)` })
        }, 5000)
        socket.io.engine?.on('upgrade', (transport) => {
          clearTimeout(upgradeTimeout)
          resolve({ detail: `upgraded to ${transport.name}` })
        })
      }))

      // 6. session:create over WS
      await timed('wsCreate', () => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('session:create timed out')), 15000)
        socket.emit('session:create', { sessionId, sessionCode, passwordHash: password }, (r) => {
          clearTimeout(t)
          if (r?.error) reject(new Error(r.error))
          else resolve({ detail: `sessionId returned: ${(r?.sessionId || '').slice(0, 12)}…` })
        })
      }))

      // 7. session:join over WS (need a second socket)
      await timed('wsJoin', async () => {
        const viewerAuth = await fetch(`${BACKEND}/api/auth/guest`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }).then(r => r.json())
        const viewerSock = io(WS_URL, {
          auth: { token: viewerAuth.token, deviceId: viewerAuth.deviceId, displayName: 'Viewer' },
          transports: ['polling', 'websocket'], reconnection: false, timeout: 20000,
        })
        cleanup.current.push(() => { try { viewerSock.disconnect() } catch {} })
        await new Promise((res, rej) => {
          viewerSock.once('connect', res)
          viewerSock.once('connect_error', rej)
          setTimeout(() => rej(new Error('viewer connect timeout')), 15000)
        })
        const joinRes = await new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('session:join timed out')), 15000)
          viewerSock.emit('session:join', { sessionCode, sessionPassword: password }, (r) => {
            clearTimeout(t)
            if (r?.error) rej(new Error(r.error)); else res(r)
          })
        })
        viewerSock.disconnect()
        if (!joinRes?.hostSocketId) return { warn: true, detail: 'joined but no hostSocketId returned' }
        return { detail: `hostSocketId=${joinRes.hostSocketId.slice(0, 12)}…` }
      })

      // 8. ICE config
      await timed('iceConfig', async () => {
        const r = await fetch(`${BACKEND}/api/ice-config`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        iceServers = data.iceServers
        const turnUrls = iceServers.flatMap(s => Array.isArray(s.urls) ? s.urls : [s.urls]).filter(u => u.startsWith('turn'))
        if (turnUrls.length === 0) {
          return { warn: true, detail: `STUN-only (${iceServers.length} server${iceServers.length > 1 ? 's' : ''}). Sessions across different NATs may fail. Configure TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN on the backend for TURN.` }
        }
        return { detail: `${iceServers.length} ICE servers (source=${data.source}, includes TURN)` }
      })

      // 9 & 10. STUN/TURN reachability via ICE gathering
      const candidates = await timed('stun', () => gatherCandidates(iceServers, 8000))
      const srflx = candidates.filter(c => c.includes('typ srflx'))
      const relay = candidates.filter(c => c.includes('typ relay'))
      update('stun', {
        status: srflx.length ? STATUS.pass : STATUS.fail,
        detail: srflx.length ? `${srflx.length} server-reflexive candidate(s) — STUN works` : 'No srflx candidate — STUN unreachable or blocked',
      })
      update('turn', {
        status: relay.length ? STATUS.pass : (iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn'))) ? STATUS.fail : STATUS.warn),
        detail: relay.length ? `${relay.length} relay candidate(s) — TURN works` :
          (iceServers.some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(u => u.startsWith('turn'))) ? 'No relay candidate — TURN server unreachable or credentials invalid' : 'No TURN configured (see step 8)'),
      })

      // 11. Peer connection happy path
      await timed('peerConnection', async () => {
        return await new Promise((resolve, reject) => {
          const pc = new RTCPeerConnection({ iceServers })
          const pc2 = new RTCPeerConnection({ iceServers })
          cleanup.current.push(() => { try { pc.close(); pc2.close() } catch {} })
          pc.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {})
          pc2.onicecandidate = (e) => e.candidate && pc.addIceCandidate(e.candidate).catch(() => {})
          const timeout = setTimeout(() => reject(new Error('peer connection did not reach "connected" within 15s')), 15000)
          pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
              clearTimeout(timeout)
              resolve({ detail: `state=${pc.iceConnectionState}` })
            }
            if (pc.iceConnectionState === 'failed') {
              clearTimeout(timeout)
              reject(new Error('iceConnectionState=failed (no working path between the two peer connections)'))
            }
          }
          pc.createDataChannel('test')
          pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => pc2.setRemoteDescription(pc.localDescription))
            .then(() => pc2.createAnswer()).then(a => pc2.setLocalDescription(a)).then(() => pc.setRemoteDescription(pc2.localDescription))
            .catch(reject)
        })
      })

    } catch {
      // Errors are already shown in the per-step result
    } finally {
      try { socket?.disconnect() } catch {}
      setRunning(false)
    }
  }

  function gatherCandidates(iceServers, timeoutMs) {
    return new Promise((resolve) => {
      const pc = new RTCPeerConnection({ iceServers })
      const cands = []
      pc.onicecandidate = (e) => {
        if (e.candidate) cands.push(e.candidate.candidate)
      }
      pc.createDataChannel('probe')
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {})
      setTimeout(() => { try { pc.close() } catch {}; resolve(cands) }, timeoutMs)
    })
  }

  useEffect(() => () => cleanup.current.forEach(fn => { try { fn() } catch {} }), [])

  const copyReport = () => {
    const lines = [
      `RemoteLink Diagnostic Report — ${new Date().toISOString()}`,
      `Backend: ${BACKEND}`,
      `User-Agent: ${navigator.userAgent}`,
      '',
      ...TESTS.map(t => {
        const r = results[t.id]
        const icon = r.status === STATUS.pass ? 'PASS' : r.status === STATUS.fail ? 'FAIL' : r.status === STATUS.warn ? 'WARN' : '----'
        return `[${icon}] ${t.label} (${r.timing}ms) — ${r.detail || '(no detail)'}`
      }),
    ].join('\n')
    navigator.clipboard.writeText(lines).then(
      () => toast.success('Report copied'),
      () => toast.error('Could not copy')
    )
  }

  const StatusIcon = ({ status }) => {
    if (status === STATUS.pass) return <Check size={16} className="text-emerald-400" />
    if (status === STATUS.fail) return <X size={16} className="text-red-400" />
    if (status === STATUS.warn) return <AlertTriangle size={16} className="text-amber-400" />
    if (status === STATUS.running) return <Loader2 size={16} className="text-brand-400 animate-spin" />
    return <span className="w-4 h-4 rounded-full border border-slate-600" />
  }

  return (
    <div className="min-h-screen bg-mesh px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-1">Connection Diagnostic</h1>
            <p className="text-sm text-slate-400">Tests every layer between your browser and the RemoteLink backend.</p>
          </div>
          <button onClick={() => navigate('/')} className="btn-ghost text-sm">Back</button>
        </header>

        <div className="glass rounded-2xl p-6 mb-4">
          <div className="text-xs text-slate-500 mb-1">Backend</div>
          <div className="font-mono text-sm text-brand-300 break-all">{BACKEND}</div>
        </div>

        <div className="glass rounded-2xl overflow-hidden mb-4">
          {TESTS.map((t, i) => {
            const r = results[t.id]
            return (
              <div key={t.id} className={`flex items-start gap-3 p-4 ${i < TESTS.length - 1 ? 'border-b border-white/5' : ''}`}>
                <div className="mt-0.5 flex-shrink-0">
                  <StatusIcon status={r.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-200">{t.label}</div>
                    {r.timing > 0 && <div className="text-xs text-slate-500 font-mono">{r.timing}ms</div>}
                  </div>
                  {r.detail && (
                    <div className={`text-xs mt-1 break-all ${r.status === STATUS.fail ? 'text-red-300' : r.status === STATUS.warn ? 'text-amber-300' : 'text-slate-400'}`}>
                      {r.detail}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <button onClick={runAll} disabled={running} className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50">
            {running ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <>Run diagnostic</>}
          </button>
          <button onClick={copyReport} className="btn-ghost text-sm px-4 py-2.5">
            <Copy size={14} /> Copy report
          </button>
        </div>

        <p className="text-xs text-slate-500 mt-6 leading-relaxed">
          Tests 1–8 verify reachability + signalling. Tests 9–10 probe STUN/TURN by creating a real RTCPeerConnection and gathering ICE candidates. Test 11 verifies a two-peer-in-same-tab connection completes — if this fails but 9 passes, the issue is most likely missing TURN for your network topology.
        </p>
      </div>
    </div>
  )
}
