import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  StatusBar, PanResponder, Dimensions, Platform
} from 'react-native'
import { RTCView } from 'react-native-webrtc'
import { GestureHandlerRootView, GestureDetector, Gesture } from 'react-native-gesture-handler'
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  createPeerConnection, getMobileScreenStream, addStreamToPeer,
  createOffer, handleOffer, handleAnswer, addIceCandidate,
  sendControlEvent, closePeerConnection
} from '../hooks/useWebRTC'
import useMobileStore from '../hooks/useSession'
import { colors } from '../theme/colors'
import * as RemoteControl from '../lib/remoteControl'

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window')

export default function SessionScreen({ navigation, route }) {
  const { sessionId, isHost, socket, session } = route.params
  const { settings } = useMobileStore()

  const videoRef = useRef(null)
  const [remoteStream, setRemoteStream] = useState(null)
  const [connectionState, setConnectionState] = useState('connecting')
  const [controlEnabled, setControlEnabled] = useState(false)
  const [showToolbar, setShowToolbar] = useState(true)
  const [chatVisible, setChatVisible] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [hostSocketId, setHostSocketId] = useState(null)
  const [viewerSocketId, setViewerSocketId] = useState(null)
  const [scale, setScale] = useState(1)

  // Pinch to zoom
  const baseScale = useSharedValue(1)
  const pinchScale = useSharedValue(1)
  const savedScale = useSharedValue(1)

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      pinchScale.value = savedScale.value * e.scale
    })
    .onEnd(() => {
      savedScale.value = Math.max(0.5, Math.min(pinchScale.value, 4))
    })

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pinchScale.value }],
  }))

  // Auto-hide toolbar
  useEffect(() => {
    const t = setTimeout(() => setShowToolbar(false), 4000)
    return () => clearTimeout(t)
  }, [showToolbar])

  // WebRTC init
  useEffect(() => {
    const init = async () => {
      try {
        const iceConfig = session.iceConfig

        createPeerConnection({ iceServers: [
          { urls: iceConfig?.stunUrls?.[0] || 'stun:stun.l.google.com:19302' },
          ...(iceConfig?.turnUrl ? [{ urls: iceConfig.turnUrl, username: iceConfig.turnUsername, credential: iceConfig.turnCredential }] : [])
        ]}, {
          onIceCandidate: (candidate) => {
            const target = isHost ? viewerSocketId : hostSocketId
            if (target) socket.emit('webrtc:ice', { targetSocketId: target, candidate, sessionId })
          },
          onRemoteStream: (stream) => {
            setRemoteStream(stream)
            setConnectionState('connected')
          },
          onStateChange: setConnectionState,
          onControlEvent: async (event) => {
            // Only the HOST executes incoming control events (the viewer
            // sent them; the host is the one whose phone gets controlled).
            if (!isHost) return
            const enabled = await RemoteControl.isEnabled()
            if (!enabled) return
            await RemoteControl.executeIncomingEvent(event, SCREEN_W, SCREEN_H)
          },
        })

        if (isHost) {
          const stream = await getMobileScreenStream()
          addStreamToPeer(stream)

          // Prompt for accessibility on first session — required for remote
          // control of this phone. Skipping is OK; the viewer just sees the
          // screen without being able to tap.
          if (Platform.OS === 'android') {
            const enabled = await RemoteControl.isEnabled()
            if (!enabled) {
              Alert.alert(
                'Allow remote control?',
                'To let the connected device tap and swipe on your phone, enable RemoteLink in Accessibility Settings. Skip to share view-only.',
                [
                  { text: 'Skip (view-only)', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => RemoteControl.openAccessibilitySettings() },
                ]
              )
            }
          }

          socket.on('viewer:joined', async ({ viewerSocketId: vsId }) => {
            setViewerSocketId(vsId)
            await createOffer(vsId, sessionId, socket)
          })
          socket.on('webrtc:answer', async ({ answer }) => await handleAnswer(answer))
        } else {
          await new Promise((resolve, reject) => {
            socket.emit('session:join', {
              sessionCode: session.sessionCode,
              sessionPassword: session.password,
            }, (res) => {
              if (res?.error) reject(new Error(res.error)); else { setHostSocketId(res.hostSocketId); resolve(res) }
            })
            setTimeout(() => reject(new Error('Timeout — backend may be cold-starting')), 180000)
          })

          socket.on('webrtc:offer', async ({ fromSocketId, offer }) => {
            setHostSocketId(fromSocketId)
            await handleOffer(offer, fromSocketId, sessionId, socket)
          })
        }

        socket.on('webrtc:ice', async ({ candidate }) => await addIceCandidate(candidate))
        socket.on('session:ended', () => {
          Alert.alert('Session Ended', 'The host ended the session')
          handleLeave()
        })
        socket.on('chat:message', (msg) => setChatMessages(p => [...p, msg]))

      } catch (err) {
        console.error('[Mobile Session]', err)
        Alert.alert('Connection Error', err.message)
        setConnectionState('error')
      }
    }

    init()

    return () => {
      closePeerConnection()
      socket?.off('viewer:joined')
      socket?.off('webrtc:offer')
      socket?.off('webrtc:answer')
      socket?.off('webrtc:ice')
      socket?.off('session:ended')
      socket?.off('chat:message')
    }
  }, [sessionId, isHost])

  // Touch → mouse control mapping
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => controlEnabled && !isHost,
    onMoveShouldSetPanResponder: () => controlEnabled && !isHost,
    onPanResponderMove: (evt, gs) => {
      const { locationX, locationY, target } = evt.nativeEvent
      sendControlEvent({
        type: 'mousemove',
        x: locationX / SCREEN_W,
        y: locationY / SCREEN_H,
      })
    },
    onPanResponderRelease: (evt) => {
      sendControlEvent({ type: 'mouseclick', button: 0 })
    },
    onPanResponderGrant: (evt) => {
      // Long press = right click
    },
  })

  const handleLeave = () => {
    if (isHost) socket?.emit('session:end', { sessionId })
    closePeerConnection()
    navigation.goBack()
  }

  const stateColor = { connected: colors.success, connecting: colors.warning, error: colors.error, disconnected: colors.error }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <StatusBar hidden />

        {/* Remote Video */}
        <TouchableOpacity
          style={styles.videoContainer}
          activeOpacity={1}
          onPress={() => setShowToolbar(true)}
        >
          <GestureDetector gesture={pinchGesture}>
            <Animated.View style={[styles.videoWrapper, animatedStyle]}>
              {remoteStream ? (
                <RTCView
                  streamURL={remoteStream.toURL()}
                  style={styles.video}
                  objectFit="contain"
                  zOrder={0}
                />
              ) : (
                <View style={styles.connectingOverlay}>
                  <Text style={styles.connectingEmoji}>📡</Text>
                  <Text style={styles.connectingText}>{connectionState}...</Text>
                </View>
              )}
            </Animated.View>
          </GestureDetector>

          {/* Touch Control Overlay */}
          {controlEnabled && !isHost && (
            <View
              style={StyleSheet.absoluteFill}
              {...panResponder.panHandlers}
            />
          )}
        </TouchableOpacity>

        {/* Toolbar (auto-hides) */}
        {showToolbar && (
          <View style={styles.toolbar}>
            {/* Status */}
            <View style={styles.toolbarStatus}>
              <View style={[styles.statusDot, { backgroundColor: stateColor[connectionState] || colors.textMuted }]} />
              <Text style={styles.statusText}>{connectionState}</Text>
            </View>

            {/* Session Code (host) */}
            {isHost && session.sessionCode && (
              <View style={styles.codeChip}>
                <Text style={styles.codeText}>{session.sessionCode}</Text>
                <Text style={styles.passText}>{session.password}</Text>
              </View>
            )}

            <View style={styles.toolbarActions}>
              {!isHost && (
                <TouchableOpacity
                  style={[styles.toolBtn, controlEnabled && styles.toolBtnActive]}
                  onPress={() => setControlEnabled(!controlEnabled)}
                >
                  <Text style={styles.toolBtnIcon}>🖱</Text>
                  <Text style={styles.toolBtnLabel}>{controlEnabled ? 'Ctrl On' : 'Control'}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.toolBtn, chatVisible && styles.toolBtnActive]}
                onPress={() => setChatVisible(!chatVisible)}
              >
                <Text style={styles.toolBtnIcon}>💬</Text>
                <Text style={styles.toolBtnLabel}>Chat</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.toolBtn, styles.toolBtnEnd]} onPress={handleLeave}>
                <Text style={styles.toolBtnIcon}>📵</Text>
                <Text style={[styles.toolBtnLabel, { color: colors.error }]}>
                  {isHost ? 'End' : 'Leave'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Host sharing indicator */}
        {isHost && connectionState === 'connected' && (
          <View style={styles.hostBadge}>
            <View style={styles.recDot} />
            <Text style={styles.hostBadgeText}>Sharing</Text>
          </View>
        )}

        {/* Pinch hint */}
        {connectionState === 'connected' && (
          <View style={styles.hint}>
            <Text style={styles.hintText}>
              {controlEnabled ? 'Tap to click · Drag to move' : 'Pinch to zoom · Tap screen for controls'}
            </Text>
          </View>
        )}
      </View>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  videoWrapper: { width: '100%', height: '100%' },
  video: { flex: 1, backgroundColor: '#000' },

  connectingOverlay: {
    flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d0d14'
  },
  connectingEmoji: { fontSize: 40, marginBottom: 14 },
  connectingText: { fontSize: 15, color: colors.textMuted, textTransform: 'capitalize' },

  toolbar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(13,13,20,0.92)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)',
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    paddingHorizontal: 16, paddingTop: 12,
  },
  toolbarStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, color: colors.textMuted, textTransform: 'capitalize', fontWeight: '600' },

  codeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10, alignSelf: 'flex-start',
  },
  codeText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 15, fontWeight: '700', color: '#a5b4fc', letterSpacing: 3 },
  passText: { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 15, fontWeight: '700', color: colors.success },

  toolbarActions: { flexDirection: 'row', gap: 10 },
  toolBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  toolBtnActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: 'rgba(99,102,241,0.4)' },
  toolBtnEnd: { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.25)' },
  toolBtnIcon: { fontSize: 20, marginBottom: 3 },
  toolBtnLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },

  hostBadge: {
    position: 'absolute', top: 16, left: '50%', transform: [{ translateX: -45 }],
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
  },
  recDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.error },
  hostBadgeText: { fontSize: 12, color: '#f87171', fontWeight: '600' },

  hint: {
    position: 'absolute', bottom: 120, left: 0, right: 0, alignItems: 'center',
  },
  hintText: { fontSize: 11, color: 'rgba(255,255,255,0.2)', fontWeight: '500' },
})
