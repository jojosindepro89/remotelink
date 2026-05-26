import { getSocket, emitWithAck } from './signaling'
import useSessionStore from '../store/sessionStore'

// Module-level state
let peerConnection  = null
let localStream     = null
let dataChannel     = null
let pendingCandidates = []
let controlHandlers = {}

const ICE_SERVERS_DEFAULT = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // Free public TURN — relays when STUN can't punch through NAT
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

export function getPeerConnection()  { return peerConnection }
export function getLocalStream()     { return localStream }
export function getDataChannel()     { return dataChannel }

// ── Peer Connection ────────────────────────────────────────────

export function createPeerConnection(iceConfig, handlers = {}) {
  controlHandlers = handlers

  const iceServers = iceConfig?.iceServers || ICE_SERVERS_DEFAULT
  peerConnection = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 })

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) handlers.onIceCandidate?.(candidate)
  }

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState
    useSessionStore.getState().setPeerState?.(state)
    handlers.onStateChange?.(state)
    if (state === 'failed') {
      console.warn('[WebRTC] ICE failed, restarting…')
      peerConnection.restartIce()
    }
  }

  peerConnection.onconnectionstatechange = () => {
    handlers.onStateChange?.(peerConnection.connectionState)
  }

  peerConnection.ontrack = (event) => {
    handlers.onRemoteStream?.(event.streams[0])
  }

  // Viewer receives data channel from host
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel
    setupDataChannel(dataChannel, handlers)
  }

  return peerConnection
}

// ── Screen / Display Capture ───────────────────────────────────

/**
 * Capture screen using getDisplayMedia (browser).
 * Returns the MediaStream. Caller should call addStreamToPeer() after.
 */
export function canShareScreen() {
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') return false
  const ua = navigator.userAgent || ''
  if (/Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(ua)) return false
  return true
}

export async function captureScreen(options = {}) {
  try {
    const constraints = {
      video: {
        width:     { ideal: 1920 },
        height:    { ideal: 1080 },
        frameRate: { ideal: 30, max: 60 },
        cursor:    'always',
      },
      audio: options.includeAudio
        ? { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 }
        : false,
      selfBrowserSurface: 'exclude',
    }

    // Electron: use desktopCapturer source ID if provided
    if (options.sourceId) {
      constraints.video = {
        mandatory: {
          chromeMediaSource:   'desktop',
          chromeMediaSourceId: options.sourceId,
          maxWidth:  1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStream = stream
      return stream
    }

    if (!canShareScreen()) {
      throw new Error('Screen sharing is not supported on this device. Use a desktop browser or the desktop app to host a session.')
    }

    const stream = await navigator.mediaDevices.getDisplayMedia(constraints)
    localStream = stream

    // Auto-stop when user hits browser's "Stop sharing" button
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      options.onScreenShareStop?.()
    })

    return stream
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Screen share denied — please allow screen capture')
    }
    throw err
  }
}

/**
 * Capture microphone for voice chat
 */
export async function captureMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  })
}

// ── Stream Management ──────────────────────────────────────────

/**
 * Add stream tracks to peer connection (call after createPeerConnection)
 */
export function addStreamToPeer(stream) {
  if (!peerConnection) throw new Error('No peer connection')
  stream.getTracks().forEach(track => {
    peerConnection.addTrack(track, stream)
  })
}

/**
 * Replace the video track on the existing sender (e.g. switch source)
 */
export async function replaceVideoTrack(newStream) {
  const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video')
  if (!sender) return
  const newTrack = newStream.getVideoTracks()[0]
  if (newTrack) await sender.replaceTrack(newTrack)
}

// ── Signaling ──────────────────────────────────────────────────

/**
 * Host: open data channel, create offer, send to viewer
 */
export async function createOffer(targetSocketId, sessionId) {
  const socket = getSocket()
  if (!peerConnection) throw new Error('No peer connection')

  // Open reliable data channel for control events (host side creates it)
  dataChannel = peerConnection.createDataChannel('control', { ordered: true, maxRetransmits: 3 })
  setupDataChannel(dataChannel, controlHandlers)

  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  })
  await peerConnection.setLocalDescription(offer)
  socket.emit('webrtc:offer', { targetSocketId, offer, sessionId })
}

/**
 * Viewer: handle incoming offer, send answer
 */
export async function handleOffer(offer, fromSocketId, sessionId) {
  const socket = getSocket()
  if (!peerConnection) throw new Error('No peer connection')

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))

  // Flush any buffered ICE candidates
  for (const c of pendingCandidates) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }
  pendingCandidates = []

  const answer = await peerConnection.createAnswer()
  await peerConnection.setLocalDescription(answer)
  socket.emit('webrtc:answer', { targetSocketId: fromSocketId, answer, sessionId })
}

/**
 * Host: handle viewer's answer
 */
export async function handleAnswer(answer) {
  if (!peerConnection) return
  if (peerConnection.signalingState !== 'have-local-offer') return
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))

  // Flush pending ICE
  for (const c of pendingCandidates) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
  }
  pendingCandidates = []
}

/**
 * Add ICE candidate — buffer if remote description not yet set
 */
export async function addIceCandidate(candidate) {
  try {
    if (peerConnection?.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } else {
      pendingCandidates.push(candidate)
    }
  } catch (err) {
    console.warn('[WebRTC] ICE error (ignored):', err.message)
  }
}

// ── Quality Control ────────────────────────────────────────────

export async function setStreamQuality(quality) {
  const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video')
  if (!sender) return

  const params = sender.getParameters()
  if (!params.encodings?.length) return

  const presets = {
    high:   { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
    medium: { maxBitrate: 1_500_000, scaleResolutionDownBy: 1.5 },
    low:    { maxBitrate:   400_000, scaleResolutionDownBy: 2.5 },
    auto:   { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
  }
  const p = presets[quality] || presets.auto
  params.encodings[0] = { ...params.encodings[0], ...p }
  await sender.setParameters(params)
}

// ── Control Event Sending (Viewer → Host via data channel) ─────

/**
 * Send a control event to the host.
 * Events: mousemove, mousedown, mouseup, mouseclick, wheel, keydown, keyup
 */
export function sendControlEvent(event) {
  if (dataChannel?.readyState === 'open') {
    dataChannel.send(JSON.stringify({ ...event, ts: Date.now() }))
  }
}

// ── Data Channel Setup ─────────────────────────────────────────

function setupDataChannel(channel, handlers = {}) {
  channel.onopen = () => {
    console.log('[DataChannel] Opened ✓')
    handlers.onDataChannelOpen?.()
  }
  channel.onclose  = () => console.log('[DataChannel] Closed')
  channel.onerror  = (e) => console.warn('[DataChannel] Error:', e)
  channel.onmessage = ({ data }) => {
    try {
      const event = JSON.parse(data)
      handlers.onControlEvent?.(event)
    } catch {}
  }
}

// ── Cleanup ────────────────────────────────────────────────────

export function closePeerConnection() {
  localStream?.getTracks().forEach(t => t.stop())
  localStream = null
  dataChannel?.close()
  dataChannel = null
  peerConnection?.close()
  peerConnection = null
  pendingCandidates = []
  controlHandlers = {}
}
