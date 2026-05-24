import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import Home from './pages/Home'
import Session from './pages/Session'
import Settings from './pages/Settings'
import History from './pages/History'
import useAppStore from './store/appStore'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'

function App() {
  const { isAuthenticated, setAuth, settings, isElectron } = useAppStore()

  useEffect(() => {
    const init = async () => {
      if (!isAuthenticated) {
        try {
          let deviceId
          if (isElectron && window.electronAPI) {
            deviceId = await window.electronAPI.getDeviceId()
          } else {
            deviceId = localStorage.getItem('rl_device_id') || `desktop-${uuidv4()}`
            localStorage.setItem('rl_device_id', deviceId)
          }

          const platform = isElectron
            ? (await window.electronAPI.getPlatform()) === 'win32' ? 'windows'
              : (await window.electronAPI.getPlatform()) === 'darwin' ? 'macos' : 'linux'
            : 'web'

          const res = await axios.post(`${settings.serverUrl}/api/auth/device`, {
            deviceId,
            platform,
            deviceName: `${platform} Desktop`,
            appVersion: isElectron ? await window.electronAPI.getVersion() : '1.0.0',
          })

          setAuth(res.data.token, res.data.user, deviceId)
        } catch (err) {
          console.warn('Auto-auth failed:', err.message)
        }
      }
    }
    init()
  }, [])

  // Listen for tray events
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return
    const cleanup = window.electronAPI.onTrayStartSession(() => {
      window.location.hash = '#/'
    })
    return cleanup
  }, [isElectron])

  return (
    <BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#1c1c28',
            color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            fontSize: '13px',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
          duration: 4000,
        }}
      />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/:sessionId" element={<Session />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
