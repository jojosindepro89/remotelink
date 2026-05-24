import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const isElectron = !!(window.electronAPI)

const useAppStore = create(
  persist(
    (set, get) => ({
      // Auth
      token: null,
      deviceId: null,
      user: null,
      isAuthenticated: false,

      // Session
      activeSession: null,
      isHost: false,
      connectionStatus: 'idle',
      peerConnectionState: 'new',

      // History
      sessionHistory: [],

      // Devices
      devices: [],

      // Settings
      settings: {
        quality: 'auto',
        theme: 'dark',
        notifications: true,
        clipboardSync: true,
        soundEnabled: true,
        startMinimized: false,
        serverUrl: 'http://localhost:3001',
      },

      // Desktop specific
      isElectron,
      platform: isElectron ? 'desktop' : 'web',
      screenSources: [],

      setAuth: (token, user, deviceId) => set({ token, user, deviceId, isAuthenticated: true }),
      clearAuth: () => set({ token: null, user: null, deviceId: null, isAuthenticated: false }),

      setActiveSession: (session) => set({ activeSession: session }),
      clearSession: () => set({ activeSession: null, connectionStatus: 'idle', isHost: false }),

      setConnectionStatus: (s) => set({ connectionStatus: s }),
      setPeerState: (s) => set({ peerConnectionState: s }),
      setIsHost: (v) => set({ isHost: v }),

      addToHistory: (s) => set((state) => ({
        sessionHistory: [s, ...state.sessionHistory.slice(0, 49)],
      })),

      setDevices: (devices) => set({ devices }),
      setScreenSources: (sources) => set({ screenSources: sources }),

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
      name: 'remotelink-desktop-store',
      partialize: (state) => ({
        token: state.token, deviceId: state.deviceId, user: state.user,
        isAuthenticated: state.isAuthenticated, sessionHistory: state.sessionHistory,
        settings: state.settings,
      }),
    }
  )
)

export default useAppStore
