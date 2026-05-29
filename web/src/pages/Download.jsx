import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Download as DownloadIcon, Smartphone, Monitor, ArrowRight, Check, Apple } from 'lucide-react'
import toast from 'react-hot-toast'

const APK_URL = 'https://github.com/jojosindepro89/remotelink/releases/download/v1.0.2-android/RemoteLink.apk'

function detectPlatform() {
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua))                 return 'android'
  if (/iPhone|iPad|iPod/i.test(ua))        return 'ios'
  return 'desktop'
}

export default function Download() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [platform, setPlatform] = useState('desktop')
  const code = (searchParams.get('code') || '').toUpperCase()
  const pass = searchParams.get('pass') || ''

  useEffect(() => {
    setPlatform(detectPlatform())
  }, [])

  const handleAndroidDownload = () => {
    toast.success('Downloading RemoteLink APK…', { icon: '📥' })
    // Persist invite so it can auto-fill after install
    if (code) {
      localStorage.setItem('rl_pending_invite', JSON.stringify({ code, pass, ts: Date.now() }))
    }
    window.location.href = APK_URL
  }

  const handleWebJoin = () => {
    const target = code ? (pass ? `/j/${code}/${encodeURIComponent(pass)}` : `/j/${code}`) : '/'
    navigate(target)
  }

  return (
    <div className="min-h-screen bg-mesh flex flex-col">
      <header className="px-6 py-4 flex items-center gap-3 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center">
          <Monitor size={16} className="text-white" />
        </div>
        <span className="font-bold text-lg">RemoteLink</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          {code && (
            <div className="mb-8 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/30 text-xs text-brand-300 font-semibold mb-3">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Invite waiting
              </div>
              <h1 className="text-2xl font-bold mb-1">You've been invited to share your screen</h1>
              <p className="text-sm text-slate-400">
                Session code <span className="font-mono text-brand-300 font-bold">{code}</span>
              </p>
            </div>
          )}

          {/* ANDROID — primary path: install APK */}
          {platform === 'android' && (
            <div className="glass rounded-3xl p-8 mb-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-4">
                <Smartphone size={26} className="text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-center mb-2">Install RemoteLink for Android</h2>
              <p className="text-sm text-slate-400 text-center mb-6 leading-relaxed">
                The Android app lets you share your phone screen and accept remote help.
                The web version can't capture your phone's screen.
              </p>

              <button onClick={handleAndroidDownload} className="btn-primary w-full py-3.5 text-sm mb-3">
                <DownloadIcon size={16} /> Download APK
              </button>
              <button onClick={handleWebJoin} className="btn-ghost w-full py-2 text-xs text-slate-500">
                Continue in browser (view-only)
              </button>

              <details className="mt-5 text-xs text-slate-500">
                <summary className="cursor-pointer hover:text-slate-300">After download, how do I install?</summary>
                <ol className="list-decimal list-inside mt-3 space-y-1.5 leading-relaxed">
                  <li>Open the downloaded <code className="text-emerald-300">RemoteLink.apk</code> from your notifications or Files app</li>
                  <li>Android may warn you about "unknown sources" — tap <b>Settings</b> → enable for this once</li>
                  <li>Tap <b>Install</b></li>
                  <li>Open RemoteLink and enter the code: <span className="font-mono font-bold text-brand-300">{code || 'ABC123'}</span></li>
                </ol>
              </details>
            </div>
          )}

          {/* iOS — no native app */}
          {platform === 'ios' && (
            <div className="glass rounded-3xl p-8 mb-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-700/40 border border-slate-600/30 flex items-center justify-center mb-4">
                <Apple size={26} className="text-slate-300" />
              </div>
              <h2 className="text-xl font-bold text-center mb-2">iOS not yet supported</h2>
              <p className="text-sm text-slate-400 text-center mb-6 leading-relaxed">
                Apple doesn't allow apps to share the iPhone screen with third parties.
                You can still view someone else's screen in your browser.
              </p>
              <button onClick={handleWebJoin} className="btn-primary w-full py-3 text-sm">
                Continue in browser (view-only) <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* DESKTOP — browser flow + visible APK download */}
          {platform === 'desktop' && (
            <div className="glass rounded-3xl p-8 mb-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center mb-4">
                <Monitor size={26} className="text-brand-400" />
              </div>
              <h2 className="text-xl font-bold text-center mb-2">Continue in your browser</h2>
              <p className="text-sm text-slate-400 text-center mb-6 leading-relaxed">
                On desktop, RemoteLink runs directly in your browser — no install needed.
              </p>
              <button onClick={handleWebJoin} className="btn-primary w-full py-3 text-sm mb-3">
                Join session <ArrowRight size={16} />
              </button>
              <a
                href={APK_URL}
                download
                className="block w-full py-3 text-sm rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-colors font-semibold text-center"
              >
                <span className="inline-flex items-center gap-2">
                  <DownloadIcon size={16} /> Download Android APK
                </span>
              </a>
              <p className="text-xs text-slate-500 text-center mt-3">
                Transfer the file to your Android phone to install the mobile app.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-slate-600 mt-6">
            RemoteLink uses end-to-end WebRTC encryption — no data passes through our servers.
          </p>
        </div>
      </main>
    </div>
  )
}
