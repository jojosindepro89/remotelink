// Shared API client for the desktop renderer
// Reads server URL from the Zustand store settings
import axios from 'axios'
import useAppStore from '../store/appStore'

const api = axios.create({ timeout: 15000 })

api.interceptors.request.use((config) => {
  const store = useAppStore.getState()
  const base = store.settings.serverUrl || 'http://localhost:3001'
  config.baseURL = `${base}/api`
  const headers = store.getAuthHeaders()
  Object.assign(config.headers, headers)
  return config
})

api.interceptors.response.use(
  (r) => r.data,
  (err) => {
    if (err.response?.status === 401) useAppStore.getState().clearAuth()
    return Promise.reject(err.response?.data || err)
  }
)

export const sessionApi = {
  create: (data) => api.post('/sessions', data),
  join: (data) => api.post('/sessions/join', data),
  getHistory: (p) => api.get('/sessions/history', { params: p }),
  end: (id) => api.delete(`/sessions/${id}`),
}

export const fileApi = {
  upload: (sessionId, file, onProgress) => {
    const fd = new FormData(); fd.append('file', file)
    return api.post(`/files/${sessionId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / e.total)),
    })
  },
}

export const getIceConfig = () => api.get('/ice-config')

export default api
