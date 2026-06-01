import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Monitor, Shield, X, ArrowRight, Loader2 } from 'lucide-react'
import useSessionStore from '../store/sessionStore'
import { connectSignaling, getSocket } from '../lib/signaling'
import { canShareScreen } from '../lib/webrtc'
import toast from 'react-hot-toast'

/**
 * /share/:code/:pass? page — opened by the recipient of a "Request Access" invite.
 *
 * Flow:
 *   1. Show "Someone is requesting access to your screen — accept?"
 *   2. On Accept: validate session over REST → become host (session:create over WS)
 *     → navigate to /session/:id?host=true&... and start screen sharing.
 *   3. On Decline: go home.
 */
export default function ShareLink() {
  const { code: codeParam, pass: passParam } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setActiveSession, setIsHost, addToHistory } = useSessionStore()
  const code = (codeParam || '').toUpperCase()
  const password = passParam || searchParams.get('p') || ''

  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) setError('Invalid link — missing session code')
    try { connectSignaling() } catch {}
  }, [code])

  const handleAccept = async () => {
    if (!canShareScreen()) {
      toast.error('Screen sharing needs a desktop browser. Open this link on a computer.')
      return
    }
    setAccepting(true)
    try {
      // Look up the session (offline-tolerant)
      let sessionId = `remote-${Date.now().toString(36)}`
      let iceConfig = null
      try {
        const { sessionApi } = await import('../lib/api')
        const lookup = await sessionApi.join({ sessionCode: code })
        sessionId = lookup.sessionId
        iceConfig = lookup.iceConfig
      } catch {
        // proceed with code-only join (will create a fresh session)
      }

      // Become the host over the signaling channel.
      const socket = getSocket()
      if (socket?.connected) {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Timed out claiming host role')), 30000)
          socket.emit('session:create', {
            sessionId,
            sessionCode: code,
            passwordHash: password,
          }, (r) => {
            clearTimeout(t)
            r?.error ? reject(new Error(r.error)) : resolve(r)
          })
        })
      }

      const session = { sessionId, sessionCode: code, password, iceConfig, isHost: true }
      setActiveSession(session)
      setIsHost(true)
      addToHistory({ sessionId, sessionCode: code, startedAt: new Date().toISOString(), role: 'host' })
      navigate(`/session/${sessionId}?host=true&code=${code}&pass=${encodeURIComponent(password)}`, { replace: true })
    } catch (err) {
      setError(err.message || 'Could not start screen share')
      toast.error(err.message || 'Could not start screen share')
      setAccepting(false)
    }
  }

  return (
    <div className="min-h-screen bg-mesh flex items-center justify-center px-6 py-12">
      <div className="glass rounded-3xl p-8 max-w-md w-full">
        {error ? (
          <>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-4">
              <X size={26} className="text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-center mb-2">Can't accept this invite</h2>
            <p className="text-sm text-slate-400 text-center mb-5">{error}</p>
            <button onClick={() => navigate('/')} className="btn-primary w-full py-2.5 text-sm">
              Back to home
            </button>
          </>
        ) : accepting ? (
          <>
            <Loader2 size={32} className="animate-spin text-brand-400 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-center mb-2">Starting screen share…</h2>
            <p className="text-sm text-slate-400 text-center">
              When prompted, choose <b>Entire Screen</b> and click Share.
            </p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
              <Monitor size={26} className="text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-center mb-2">Screen share request</h2>
            <p className="text-sm text-slate-400 text-center mb-6 leading-relaxed">
              Someone has asked to view and control your screen using RemoteLink. Accept only if you know the person who sent this link.
            </p>

            <div className="rounded-xl bg-white/5 border border-white/10 p-4 mb-6 text-xs text-slate-400 space-y-2">
              <div className="flex items-center gap-2"><Shield size={12} className="text-emerald-400 flex-shrink-0" /> Connection is end-to-end encrypted (WebRTC)</div>
              <div className="flex items-center gap-2"><Shield size={12} className="text-emerald-400 flex-shrink-0" /> They can only see what's on screen while you share</div>
              <div className="flex items-center gap-2"><Shield size={12} className="text-emerald-400 flex-shrink-0" /> You can stop the share at any time by closing the tab</div>
            </div>

            <p className="text-xs text-slate-500 text-center mb-4">
              Session code <span className="font-mono text-brand-300">{code}</span>
            </p>

            <button onClick={handleAccept} className="btn-primary w-full py-3 text-sm mb-2">
              <Monitor size={16} /> Accept & share my screen <ArrowRight size={14} />
            </button>
            <button onClick={() => navigate('/')} className="btn-ghost w-full py-2 text-xs text-slate-500">
              Decline
            </button>
          </>
        )}
      </div>
    </div>
  )
}
