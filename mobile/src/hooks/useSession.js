import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

const useMobileStore = create(
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

      // History
      sessionHistory: [],

      // Settings
      settings: {
        quality: 'auto',
        notifications: true,
        clipboardSync: true,
        vibration: true,
        keepScreenOn: true,
        serverUrl: 'http://localhost:3001',
      },

      setAuth: (token, user, deviceId) => set({ token, user, deviceId, isAuthenticated: true }),
      clearAuth: () => set({ token: null, user: null, deviceId: null, isAuthenticated: false }),
      setActiveSession: (s) => set({ activeSession: s }),
      clearSession: () => set({ activeSession: null, connectionStatus: 'idle', isHost: false }),
      setConnectionStatus: (s) => set({ connectionStatus: s }),
      setIsHost: (v) => set({ isHost: v }),

      addToHistory: (s) => set((state) => ({
        sessionHistory: [s, ...state.sessionHistory.slice(0, 49)],
      })),

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
      name: 'remotelink-mobile-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        token: state.token, deviceId: state.deviceId, user: state.user,
        isAuthenticated: state.isAuthenticated, sessionHistory: state.sessionHistory,
        settings: state.settings,
      }),
    }
  )
)

export default useMobileStore
