import { useCallback, useRef } from 'react'
import { getSocket } from './useSignaling'
import useAppStore from '../store/appStore'

let peerConnection = null
let localStream = null
let dataChannel = null

export function getPeerConnection() { return peerConnection }
export function getDataChannel() { return dataChannel }

const ICE_DEFAULTS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export function createPeerConnection(iceConfig, handlers = {}) {
  const iceServers = iceConfig?.iceServers || ICE_DEFAULTS

  peerConnection = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 })

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) handlers.onIceCandidate?.(candidate)
  }

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState
    useAppStore.getState().setPeerState(state)
    handlers.onStateChange?.(state)
    if (state === 'failed') peerConnection.restartIce()
  }

  peerConnection.ontrack = (event) => {
    handlers.onRemoteStream?.(event.streams[0])
  }

  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel
    setupDataChannel(dataChannel, handlers)
  }

  return peerConnection
}

/**
 * Electron desktop capture using desktopCapturer IPC bridge
 */
export async function captureDesktop(sourceId) {
  const isElectron = !!window.electronAPI

  if (isElectron) {
    // Get sources via IPC, then use getUserMedia with chromeMediaSource
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minWidth: 1280,
          maxWidth: 3840,
          minHeight: 720,
          maxHeight: 2160,
          minFrameRate: 15,
          maxFrameRate: 30,
        },
      },
    })
    localStream = stream
    return stream
  } else {
    // Web fallback
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: { ideal: 30 } },
      audio: false,
    })
    localStream = stream
    return stream
  }
}

export async function captureMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
}

export async function createOffer(targetSocketId, sessionId) {
  const socket = getSocket()
  dataChannel = peerConnection.createDataChannel('control', { ordered: true })
  setupDataChannel(dataChannel, {})

  const offer = await peerConnection.createOffer()
  await peerConnection.setLocalDescription(offer)
  socket.emit('webrtc:offer', { targetSocketId, offer, sessionId })
}

export async function handleOffer(offer, fromSocketId, sessionId) {
  const socket = getSocket()
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

export async function setStreamQuality(quality) {
  const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video')
  if (!sender) return
  const params = sender.getParameters()
  if (!params.encodings?.[0]) return
  const presets = {
    high:   { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
    medium: { maxBitrate: 1_500_000, scaleResolutionDownBy: 1.5 },
    low:    { maxBitrate:   500_000, scaleResolutionDownBy: 2.5 },
    auto:   { maxBitrate: 4_000_000, scaleResolutionDownBy: 1 },
  }
  params.encodings[0] = { ...params.encodings[0], ...presets[quality] }
  await sender.setParameters(params)
}

function setupDataChannel(channel, handlers = {}) {
  channel.onopen = () => { console.log('[DC] Open'); handlers.onDataChannelOpen?.() }
  channel.onclose = () => console.log('[DC] Closed')
  channel.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      handlers.onControlEvent?.(data)
    } catch {}
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
