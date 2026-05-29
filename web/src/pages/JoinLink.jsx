import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Loader2, AlertCircle } from 'lucide-react'
import useSessionStore from '../store/sessionStore'
import { connectSignaling, getSocket } from '../lib/signaling'
import toast from 'react-hot-toast'

export default function JoinLink() {
  const { code: codeParam, pass: passParam } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setActiveSession, setIsHost, addToHistory } = useSessionStore()
  const [error, setError] = useState(null)

  useEffect(() => {
    const code = (codeParam || '').toUpperCase()
    const password = passParam || searchParams.get('p') || ''

    if (!code) {
      setError('Invalid invite link — missing session code')
      return
    }

    // Android visitors get the APK download flow first
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '')
    if (isAndroid && !searchParams.get('web')) {
      const url = `/download?code=${code}${password ? `&pass=${encodeURIComponent(password)}` : ''}`
      navigate(url, { replace: true })
      return
    }

    let cancelled = false
    const run = async () => {
      try {
        try { connectSignaling() } catch {}

        let sessionId = `remote-${Date.now().toString(36)}`
        try {
          const { sessionApi } = await import('../lib/api')
          const res = await sessionApi.join({ sessionCode: code })
          sessionId = res.sessionId
        } catch {
          // continue with fallback id — Session page will still try to connect
        }

        if (cancelled) return

        setActiveSession({ sessionId, sessionCode: code, isHost: false })
        setIsHost(false)
        addToHistory({ sessionId, sessionCode: code, startedAt: new Date().toISOString(), role: 'viewer', password })
        navigate(`/session/${sessionId}?host=false&code=${code}&pass=${encodeURIComponent(password)}`, { replace: true })
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not join session')
          toast.error('Could not join session')
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [codeParam, passParam])

  return (
    <div className="min-h-screen flex items-center justify-center bg-mesh px-6">
      <div className="glass rounded-2xl p-8 max-w-sm w-full text-center">
        {error ? (
          <>
            <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={22} className="text-red-400" />
            </div>
            <h2 className="text-lg font-bold mb-2">Can't open invite</h2>
            <p className="text-sm text-slate-400 mb-5">{error}</p>
            <button onClick={() => navigate('/')} className="btn-primary w-full py-2.5 text-sm">
              Back to home
            </button>
          </>
        ) : (
          <>
            <Loader2 size={28} className="animate-spin text-brand-400 mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-1">Joining session…</h2>
            <p className="text-sm text-slate-400">Connecting to <span className="font-mono text-brand-300">{(codeParam || '').toUpperCase()}</span></p>
          </>
        )}
      </div>
    </div>
  )
}
