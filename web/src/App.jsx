import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect } from 'react'
import Home from './pages/Home'
import Session from './pages/Session'
import Admin from './pages/Admin'
import VideoCall from './pages/VideoCall'
import useSessionStore from './store/sessionStore'

function App() {
  const { isAuthenticated, setAuth } = useSessionStore()

  // Auto-assign a stable guest deviceId — works offline, no API call needed
  useEffect(() => {
    if (!isAuthenticated) {
      try {
        let deviceId = localStorage.getItem('rl_device_id')
        if (!deviceId) {
          deviceId = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          localStorage.setItem('rl_device_id', deviceId)
        }
        // Set guest auth state without hitting the API — the backend will
        // accept any deviceId as a guest when it's online
        setAuth(null, { displayName: `Guest-${deviceId.slice(-4)}` }, deviceId)
      } catch (err) {
        console.warn('[App] Guest init failed:', err.message)
      }
    }
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
        <Route path="/"                 element={<Home />} />
        <Route path="/session/:sessionId" element={<Session />} />
        <Route path="/call/:roomCode"   element={<VideoCall />} />
        <Route path="/admin"            element={<Admin />} />
        <Route path="*"                 element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
