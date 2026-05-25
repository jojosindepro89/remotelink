import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const API_URL = import.meta.env.VITE_API_URL || ''

const useSessionStore = create(
  persist(
    (set, get) => ({
      // Auth state
      token: null,
      deviceId: null,
      user: null,
      isAuthenticated: false,

      // Session state
      activeSession: null,
      sessionHistory: [],
      devices: [],

      // UI state
      isConnecting: false,
      connectionStatus: 'idle', // idle | connecting | connected | disconnected | error
      peerConnectionState: 'new',
      isHost: false,

      // Settings
      settings: {
        quality: 'auto',
        theme: 'dark',
        notifications: true,
        clipboardSync: true,
        soundEnabled: true,
      },
      customServerUrl: null,

      setAuth: (token, user, deviceId) => set({ token, user, deviceId, isAuthenticated: true }),
      clearAuth: () => set({ token: null, user: null, deviceId: null, isAuthenticated: false }),
      setCustomServerUrl: (url) => set({ customServerUrl: url }),

      setActiveSession: (session) => set({ activeSession: session }),
      clearSession: () => set({ activeSession: null, connectionStatus: 'idle', isHost: false }),

      setConnectionStatus: (status) => set({ connectionStatus: status }),
      setPeerState: (state) => set({ peerConnectionState: state }),
      setIsHost: (val) => set({ isHost: val }),
      setConnecting: (val) => set({ isConnecting: val }),

      addToHistory: (session) => set((state) => ({
        sessionHistory: [session, ...state.sessionHistory.slice(0, 19)],
      })),

      setDevices: (devices) => set({ devices }),

      updateSettings: (updates) => set((state) => ({
        settings: { ...state.settings, ...updates },
      })),

      getAuthHeaders: () => {
        const { token, deviceId } = get()
        return {
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(deviceId && { 'X-Device-ID': deviceId }),
        }
      },
    }),
    {
      name: 'remotelink-store',
      partialize: (state) => ({
        token: state.token,
        deviceId: state.deviceId,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        sessionHistory: state.sessionHistory,
        settings: state.settings,
        customServerUrl: state.customServerUrl,
      }),
    }
  )
)

export default useSessionStore
