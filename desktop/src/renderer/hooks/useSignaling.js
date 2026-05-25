import { io } from 'socket.io-client'
import useAppStore from '../store/appStore'

let socket = null

export function getSocket() { return socket }

export function connectSignaling(serverUrl) {
  if (socket?.connected) return socket

  const store = useAppStore.getState()
  const url = serverUrl || store.settings.serverUrl || 'http://localhost:3001'

  socket = io(url, {
    auth: {
      token: store.token,
      deviceId: store.deviceId,
      displayName: store.user?.displayName || `Desktop-${store.deviceId?.slice(-6)}`,
    },
    transports: ['websocket'],
    reconnectionAttempts: 15,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  })

  socket.on('connect', () => {
    console.log('[WS] Connected:', socket.id)
    useAppStore.getState().setConnectionStatus('connected')
  })

  socket.on('disconnect', (reason) => {
    console.warn('[WS] Disconnected:', reason)
    if (reason !== 'io client disconnect') {
      useAppStore.getState().setConnectionStatus('disconnected')
    }
  })

  socket.on('connect_error', (err) => {
    console.error('[WS] Error:', err.message)
    useAppStore.getState().setConnectionStatus('error')
  })

  return socket
}

export function disconnectSignaling() {
  socket?.disconnect()
  socket = null
}

export function emitWithAck(event, data, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('Not connected to server'))
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeout)
    socket.emit(event, data, (res) => {
      clearTimeout(timer)
      if (res?.error) reject(new Error(res.error))
      else resolve(res)
    })
  })
}
