import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import Home from './pages/Home'
import Session from './pages/Session'
import Admin from './pages/Admin'
import VideoCall from './pages/VideoCall'
import useSessionStore from './store/sessionStore'
import { authApi } from './lib/api'
import { v4 as uuidv4 } from 'uuid'

function App() {
  const { isAuthenticated, setAuth, deviceId } = useSessionStore()

  // Auto-authenticate as guest on first visit
  useEffect(() => {
    const init = async () => {
      if (!isAuthenticated) {
        try {
          const storedDeviceId = localStorage.getItem('rl_device_id') || `web-${uuidv4()}`
          localStorage.setItem('rl_device_id', storedDeviceId)

          const res = await authApi.loginWithDevice({
            deviceId: storedDeviceId,
            platform: 'web',
            deviceName: `Web Browser (${navigator.platform})`,
          })
          setAuth(res.token, res.user, storedDeviceId)
        } catch (err) {
          console.warn('Auto-auth failed, proceeding as guest:', err)
        }
      }
    }
    init()
  }, [isAuthenticated])

  return (
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1a1a2e',
            color: '#f1f5f9',
            border: '1px solid rgba(255,255,255,0.1)',
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
        <Route path="/call/:roomCode" element={<VideoCall />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
