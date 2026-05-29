import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, StatusBar,
  KeyboardAvoidingView, Platform
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { io } from 'socket.io-client'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import useMobileStore from '../hooks/useSession'
import { colors, spacing, radius, typography } from '../theme/colors'

let socket = null

export default function HomeScreen({ navigation }) {
  const { isAuthenticated, setAuth, settings, token, deviceId, user,
    sessionHistory, addToHistory, setActiveSession, setIsHost } = useMobileStore()

  const [joinCode, setJoinCode] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [serverStatus, setServerStatus] = useState('checking')

  // Auto-auth on mount
  useEffect(() => {
    const init = async () => {
      if (!isAuthenticated) {
        try {
          const dId = `mobile-${Platform.OS}-${uuidv4().slice(0, 12)}`
          const res = await axios.post(`${settings.serverUrl}/api/auth/device`, {
            deviceId: dId,
            platform: Platform.OS,
            deviceName: `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} Device`,
          }, { timeout: 120000 })
          setAuth(res.data.token, res.data.user, dId)
        } catch (err) {
          console.warn('Auth failed:', err.message)
        }
      }

      // Connect signaling
      const store = useMobileStore.getState()
      socket = io(store.settings.serverUrl, {
        auth: { token: store.token, deviceId: store.deviceId, displayName: `Mobile-${store.deviceId?.slice(-6)}` },
        transports: ['websocket', 'polling'],   // fall back to polling if WS upgrade fails
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 10000,
        timeout: 120000,                         // 2 min handshake timeout (Render cold starts)
      })
      socket.on('connect', () => setServerStatus('connected'))
      socket.on('disconnect', () => setServerStatus('disconnected'))
      socket.on('connect_error', () => setServerStatus('error'))
    }
    init()
  }, [])

  const handleStartSession = async () => {
    setIsStarting(true)
    try {
      const store = useMobileStore.getState()
      const res = await axios.post(`${settings.serverUrl}/api/sessions`, { platform: Platform.OS }, {
        headers: store.getAuthHeaders(),
      })
      const { sessionId, sessionCode, password, iceConfig } = res.data

      await new Promise((resolve, reject) => {
        socket.emit('session:create', { sessionId, sessionCode, passwordHash: password }, (r) => {
          if (r?.error) reject(new Error(r.error)); else resolve(r)
        })
        setTimeout(() => reject(new Error('Timeout — backend may be cold-starting')), 120000)
      })

      const session = { sessionId, sessionCode, password, iceConfig, isHost: true }
      setActiveSession(session)
      setIsHost(true)
      addToHistory({ sessionId, sessionCode, startedAt: new Date().toISOString(), role: 'host' })
      navigation.navigate('Session', { sessionId, isHost: true, socket, session })
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to start session')
    } finally {
      setIsStarting(false)
    }
  }

  const handleJoinSession = async () => {
    if (!joinCode.trim() || !joinPassword.trim()) {
      return Alert.alert('Missing Info', 'Please enter both session code and password')
    }
    setIsJoining(true)
    try {
      const store = useMobileStore.getState()
      const res = await axios.post(`${settings.serverUrl}/api/sessions/join`, {
        sessionCode: joinCode.trim().toUpperCase()
      }, { headers: store.getAuthHeaders() })
      const { sessionId, iceConfig } = res.data

      const session = { sessionId, sessionCode: joinCode.toUpperCase(), iceConfig, isHost: false, password: joinPassword }
      setActiveSession(session)
      setIsHost(false)
      addToHistory({ sessionId, sessionCode: joinCode.toUpperCase(), startedAt: new Date().toISOString(), role: 'viewer' })
      navigation.navigate('Session', { sessionId, isHost: false, socket, session })
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.error || err.message || 'Session not found')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logo}>
              <Text style={styles.logoIcon}>⊞</Text>
            </View>
            <View>
              <Text style={styles.appName}>RemoteLink</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, {
                  backgroundColor: serverStatus === 'connected' ? colors.success : serverStatus === 'error' ? colors.error : colors.warning
                }]} />
                <Text style={styles.statusText}>
                  {serverStatus === 'connected' ? 'Connected' : serverStatus === 'error' ? 'Server error' : 'Connecting...'}
                </Text>
              </View>
            </View>
          </View>

          {/* Start Session */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(99,102,241,0.15)' }]}>
                <Text style={{ fontSize: 20 }}>🖥</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Share My Screen</Text>
                <Text style={styles.cardSubtitle}>Start a session and share your screen or camera</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.btnPrimary, (isStarting || serverStatus !== 'connected') && styles.btnDisabled]}
              onPress={handleStartSession}
              disabled={isStarting || serverStatus !== 'connected'}
              activeOpacity={0.8}
            >
              {isStarting ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>⚡ Start Session</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Join Session */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <Text style={{ fontSize: 20 }}>📱</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Join a Session</Text>
                <Text style={styles.cardSubtitle}>Enter the code from the host device</Text>
              </View>
            </View>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="Session Code (ABC123)"
              placeholderTextColor={colors.textMuted}
              value={joinCode}
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={6}
              returnKeyType="next"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={joinPassword}
              onChangeText={setJoinPassword}
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleJoinSession}
            />
            <TouchableOpacity
              style={[styles.btnSuccess, (isJoining || !joinCode || !joinPassword || serverStatus !== 'connected') && styles.btnDisabled]}
              onPress={handleJoinSession}
              disabled={isJoining || !joinCode || !joinPassword || serverStatus !== 'connected'}
              activeOpacity={0.8}
            >
              {isJoining ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <Text style={styles.btnPrimaryText}>Join Session →</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Recent Sessions */}
          {sessionHistory.length > 0 && (
            <View>
              <Text style={styles.sectionTitle}>⏱ Recent</Text>
              {sessionHistory.slice(0, 3).map((s) => (
                <View key={s.sessionId} style={[styles.historyItem]}>
                  <View style={[styles.historyIcon, {
                    backgroundColor: s.role === 'host' ? 'rgba(99,102,241,0.12)' : 'rgba(16,185,129,0.1)'
                  }]}>
                    <Text style={{ fontSize: 14 }}>{s.role === 'host' ? '🖥' : '👁'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyCode}>{s.sessionCode}</Text>
                    <Text style={styles.historyMeta}>
                      {s.role === 'host' ? 'Hosted' : 'Joined'} · {new Date(s.startedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textMuted }}>›</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginBottom: spacing.lg, marginTop: spacing.sm,
  },
  logo: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  logoIcon: { fontSize: 22, color: 'white' },
  appName: { fontSize: 20, fontWeight: '800', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radius.xl, padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: spacing.md },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },

  btnPrimary: {
    backgroundColor: colors.brand, borderRadius: radius.lg,
    padding: 14, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.brand, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12,
    elevation: 6,
  },
  btnSuccess: {
    backgroundColor: colors.success, borderRadius: radius.lg,
    padding: 14, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.success, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12,
    elevation: 6,
  },
  btnPrimaryText: { color: 'white', fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.45 },

  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.lg, padding: 13,
    color: colors.textPrimary, fontSize: 14,
    marginBottom: 10,
  },
  codeInput: {
    textAlign: 'center', fontSize: 20, fontWeight: '700',
    letterSpacing: 8, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },

  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  historyItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder,
    borderRadius: radius.lg, padding: spacing.sm + 4, marginBottom: 8,
  },
  historyIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  historyCode: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  historyMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
})
