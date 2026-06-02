import { io } from 'socket.io-client'
import useSessionStore from '../store/sessionStore'

let socket = null

export function getSocket() { return socket }

function getOrCreateDeviceId() {
  // Always ensure we have a stable device ID, even as a guest
  let id = localStorage.getItem('rl_device_id')
  if (!id) {
    id = `web-guest-${Math.random().toString(36).slice(2, 10)}`
    localStorage.setItem('rl_device_id', id)
  }
  return id
}

export function connectSignaling() {
  if (socket?.connected) return socket

  // If socket exists but disconnected, destroy it so we reconnect fresh
  if (socket && !socket.connected) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }

  const store   = useSessionStore.getState()
  const WS_URL  = store.customServerUrl || import.meta.env.VITE_WS_URL || 'http://localhost:3001'
  const deviceId = store.deviceId || getOrCreateDeviceId()

  try {
    socket = io(WS_URL, {
      auth: {
        token:       store.token || undefined,
        deviceId,
        displayName: store.user?.displayName || `Web-${deviceId.slice(-6)}`,
      },
      // Polling-first: socket.io 4 needs polling for the initial handshake,
      // then upgrades to WebSocket. Many networks (corporate Wi-Fi, ISP
      // proxies, mobile carriers) block raw WS but allow HTTPS polling.
      // With ['websocket'] only, every blocked network = silent failure.
      transports:          ['polling', 'websocket'],
      upgrade:              true,
      reconnectionAttempts: Infinity,
      reconnectionDelay:    1000,
      reconnectionDelayMax: 15000,
      timeout:              30000,
    })
  } catch (err) {
    console.warn('[Signaling] Could not create socket:', err.message)
    // Return a dummy socket-like object so callers don't crash
    return { connected: false, on: () => {}, off: () => {}, emit: () => {}, once: () => {}, removeAllListeners: () => {} }
  }

  socket.on('connect', () => {
    console.log('[Signaling] Connected:', socket.id)
    useSessionStore.getState().setConnectionStatus('connected')
  })

  socket.on('disconnect', (reason) => {
    console.warn('[Signaling] Disconnected:', reason)
    if (reason !== 'io client disconnect') {
      useSessionStore.getState().setConnectionStatus('disconnected')
    }
  })

  socket.on('connect_error', (err) => {
    console.warn('[Signaling] Connection error (backend may be offline):', err.message)
    useSessionStore.getState().setConnectionStatus('error')
  })

  return socket
}

export function disconnectSignaling() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function emitWithAck(event, data, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      return reject(new Error('Not connected to signaling server'))
    }
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout)
    socket.emit(event, data, (response) => {
      clearTimeout(timer)
      if (response?.error) reject(new Error(response.error))
      else resolve(response)
    })
  })
}
