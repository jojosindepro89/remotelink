import axios from 'axios'
import useSessionStore from '../store/sessionStore'

const PROD_API = 'https://remotelink-backend.onrender.com/api'
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || PROD_API,
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  const store = useSessionStore.getState()
  const headers = store.getAuthHeaders()
  Object.assign(config.headers, headers)

  // Dynamically rewrite baseURL if custom server URL is set
  if (store.customServerUrl) {
    const base = store.customServerUrl.replace(/\/$/, '')
    config.baseURL = base.endsWith('/api') ? base : `${base}/api`
  }

  return config
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      useSessionStore.getState().clearAuth()
    }
    return Promise.reject(error.response?.data || error)
  }
)

export const authApi = {
  loginAsGuest: () => api.post('/auth/guest'),
  loginWithDevice: (data) => api.post('/auth/device', data),
  getMe: () => api.get('/auth/me'),
  updateMe: (data) => api.patch('/auth/me', data),
}

export const sessionApi = {
  create: (data) => api.post('/sessions', data),
  join: (data) => api.post('/sessions/join', data),
  getHistory: (params) => api.get('/sessions/history', { params }),
  getById: (id) => api.get(`/sessions/${id}`),
  end: (id) => api.delete(`/sessions/${id}`),
  getStats: () => api.get('/sessions/active/stats'),
}

export const deviceApi = {
  list: () => api.get('/devices'),
  register: (data) => api.post('/devices/register', data),
  update: (id, data) => api.patch(`/devices/${id}`, data),
  remove: (id) => api.delete(`/devices/${id}`),
}

export const fileApi = {
  upload: (sessionId, file, onProgress) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post(`/files/${sessionId}/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => onProgress?.(Math.round((e.loaded * 100) / e.total)),
    })
  },
  getTransfers: (sessionId) => api.get(`/files/${sessionId}/transfers`),
}

export const adminApi = {
  getStats: () => api.get('/admin/stats'),
  getSessions: (params) => api.get('/admin/sessions', { params }),
  terminateSession: (id) => api.delete(`/admin/sessions/${id}`),
  getUsers: (params) => api.get('/admin/users', { params }),
  updateUser: (id, data) => api.patch(`/admin/users/${id}`, data),
  getLogs: (params) => api.get('/admin/logs', { params }),
  getAnalytics: (params) => api.get('/admin/analytics', { params }),
}

export const getIceConfig = () => api.get('/ice-config')

export default api
