import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc'

let peerConnection = null
let localStream = null
let dataChannel = null
let controlHandlers = {}

const ICE_DEFAULTS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export function getPeerConnection() { return peerConnection }
export function getDataChannel() { return dataChannel }
export function getLocalStream() { return localStream }

export function createPeerConnection(iceConfig, handlers = {}) {
  controlHandlers = handlers
  const iceServers = iceConfig?.iceServers || ICE_DEFAULTS

  peerConnection = new RTCPeerConnection({ iceServers })

  peerConnection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) handlers.onIceCandidate?.(candidate)
  })

  peerConnection.addEventListener('iceconnectionstatechange', () => {
    const state = peerConnection.iceConnectionState
    handlers.onStateChange?.(state)
    if (state === 'failed') peerConnection.restartIce()
  })

  peerConnection.addEventListener('track', (event) => {
    handlers.onRemoteStream?.(event.streams[0])
  })

  peerConnection.addEventListener('datachannel', (event) => {
    dataChannel = event.channel
    setupDataChannel(dataChannel, handlers)
  })

  return peerConnection
}

/**
 * Get device camera/mic stream (for mobile hosting)
 */
export async function getMobileStream() {
  const stream = await mediaDevices.getUserMedia({
    audio: true,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24 },
      facingMode: 'environment',
    },
  })
  localStream = stream
  return stream
}

/**
 * Get screen capture on mobile (requires react-native-webrtc MediaProjection on Android)
 */
export async function getMobileScreenStream() {
  try {
    const stream = await mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    })
    localStream = stream
    return stream
  } catch (err) {
    // Fallback to camera
    console.warn('Screen share not available, falling back to camera')
    return getMobileStream()
  }
}

export async function createOffer(targetSocketId, sessionId, socket) {
  dataChannel = peerConnection.createDataChannel('control', { ordered: true })
  setupDataChannel(dataChannel, controlHandlers)

  const offer = await peerConnection.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false })
  await peerConnection.setLocalDescription(offer)
  socket.emit('webrtc:offer', { targetSocketId, offer, sessionId })
}

export async function handleOffer(offer, fromSocketId, sessionId, socket) {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer))
  const answer = await peerConnection.createAnswer()
  await peerConnection.setLocalDescription(answer)
  socket.emit('webrtc:answer', { targetSocketId: fromSocketId, answer, sessionId })
}

export async function handleAnswer(answer) {
  if (peerConnection.signalingState !== 'have-local-offer') return
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer))
}

export async function addIceCandidate(candidate) {
  try {
    if (peerConnection?.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    }
  } catch (err) {
    console.warn('[WebRTC] ICE error:', err.message)
  }
}

export function addStreamToPeer(stream) {
  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream))
}

export function sendControlEvent(event) {
  if (dataChannel?.readyState === 'open') {
    dataChannel.send(JSON.stringify(event))
  }
}

function setupDataChannel(channel, handlers) {
  channel.onopen = () => handlers.onDataChannelOpen?.()
  channel.onmessage = (e) => {
    try { handlers.onControlEvent?.(JSON.parse(e.data)) } catch {}
  }
}

export function closePeerConnection() {
  localStream?.getTracks().forEach(t => t.stop())
  localStream = null
  dataChannel?.close()
  dataChannel = null
  peerConnection?.close()
  peerConnection = null
}
