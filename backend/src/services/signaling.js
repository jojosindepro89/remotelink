const { Server } = require('socket.io')
const logger = require('../utils/logger')
const mongoose = require('mongoose')
const sessionManager = require('./sessionManager')
const Session = require('../models/Session')
const { verifyPin } = require('./encryption')
const jwt = require('jsonwebtoken')

// Lazy-import call rooms to avoid circular deps
function getCallRooms() {
  try { return require('../routes/calls').callRooms } catch { return new Map() }
}

/**
 * WebSocket Signaling Server
 * Handles WebRTC offer/answer/ICE relay for both screen-sharing sessions
 * and video call rooms.
 */
function initSignaling(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim())
        const isVercel = origin && origin.startsWith('https://') && origin.endsWith('.vercel.app')
        const isLocalhost = origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))
        if (allowed.includes('*') || !origin || allowed.includes(origin) || isVercel || isLocalhost) {
          callback(null, true)
        } else {
          callback(new Error(`CORS blocked: ${origin}`))
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingInterval: 10000,
    pingTimeout: 5000,
  })

  // ── Auth middleware ────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token    = socket.handshake.auth?.token || socket.handshake.query?.token
      const deviceId = socket.handshake.auth?.deviceId

      if (token) {
        try {
          const decoded   = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret')
          socket.userId   = decoded.userId
          socket.deviceId = decoded.deviceId || deviceId
        } catch { socket.deviceId = deviceId }
      }

      // Always assign a deviceId — never reject guest connections
      if (!socket.deviceId) {
        socket.deviceId = deviceId || ('guest-' + socket.id)
      }

      socket.displayName = socket.handshake.auth?.displayName || ('Guest-' + socket.deviceId.slice(-6))
      next()
    } catch (err) {
      logger.warn('WS auth error, allowing anyway: ' + err.message)
      socket.deviceId    = 'anon-' + socket.id
      socket.displayName = 'Anonymous'
      next()
    }
  })

  // ── Connection ─────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (device: ${socket.deviceId})`)

    // ─────────────────────────────────────────────────────
    // SCREEN SHARING SESSION SIGNALING
    // ─────────────────────────────────────────────────────

    socket.on('session:create', async (data, callback) => {
      try {
        const { sessionCode } = data

        // First: if this device has a session in grace-period reconnect, restore it
        const reclaimed = sessionManager.reclaimHostSession(socket.deviceId, socket.id)
        if (reclaimed) {
          socket.join(`session:${reclaimed.sessionId}`)
          socket.sessionId = reclaimed.sessionId
          socket.role      = 'host'
          // Notify any waiting viewers so WebRTC can resume
          for (const [viewerSocketId, viewer] of reclaimed.viewers) {
            io.to(socket.id).emit('viewer:joined', {
              viewerSocketId, deviceId: viewer.deviceId, displayName: viewer.displayName,
            })
          }
          logger.info(`Host re-joined session ${reclaimed.sessionId} — ${reclaimed.viewers.size} viewer(s) re-attached`)
          return callback?.({ success: true, sessionId: reclaimed.sessionId, reclaimed: true })
        }

        if (mongoose.connection.readyState === 1) {
          const existing = await Session.findOne({ sessionCode, status: { $in: ['waiting', 'active'] } })
          if (existing) return callback?.({ error: 'Session code already in use' })
        }

        sessionManager.createSession(data.sessionId, {
          socketId: socket.id, deviceId: socket.deviceId, sessionCode,
        })

        socket.join(`session:${data.sessionId}`)
        socket.sessionId = data.sessionId
        socket.role      = 'host'

        logger.info(`Host created session ${data.sessionId} (${sessionCode})`)
        callback?.({ success: true, sessionId: data.sessionId })
      } catch (err) {
        logger.error('session:create error', err)
        callback?.({ error: err.message })
      }
    })

    socket.on('session:join', async (data, callback) => {
      try {
        const { sessionCode, sessionPassword } = data

        let dbSession = null
        if (mongoose.connection.readyState === 1) {
          dbSession = await Session.findOne({ sessionCode, status: { $in: ['waiting', 'active'] } })
        }

        if (!dbSession) {
          // If offline: fallback to finding the session in memory inside sessionManager
          const memorySession = sessionManager.getSessionByCode(sessionCode.toUpperCase())
          if (!memorySession) return callback?.({ error: 'Session not found or expired' })
          
          dbSession = {
            sessionId: memorySession.sessionId,
            sessionCode: memorySession.sessionCode,
            passwordHash: memorySession.passwordHash,
            iceConfig: {
              stunUrls: [process.env.STUN_URL || 'stun:stun.l.google.com:19302'],
            }
          }
        } else {
          if (!verifyPin(sessionPassword, dbSession.passwordHash)) return callback?.({ error: 'Incorrect password' })
        }

        const state = sessionManager.addViewer(dbSession.sessionId, {
          socketId: socket.id, deviceId: socket.deviceId, displayName: socket.displayName,
        })
        if (!state) return callback?.({ error: 'Session full or unavailable' })

        socket.join(`session:${dbSession.sessionId}`)
        socket.sessionId = dbSession.sessionId
        socket.role      = 'viewer'

        // Only notify host if they're currently connected
        if (state.status !== 'host_disconnected' && state.hostSocketId) {
          io.to(state.hostSocketId).emit('viewer:joined', {
            viewerSocketId: socket.id, deviceId: socket.deviceId, displayName: socket.displayName,
          })
        }

        logger.info(`Viewer joined session ${dbSession.sessionId}`)
        callback?.({
          success: true,
          sessionId: dbSession.sessionId,
          hostSocketId: state.hostSocketId,
          hostStatus: state.status,
          iceConfig: dbSession.iceConfig
        })
      } catch (err) {
        logger.error('session:join error', err)
        callback?.({ error: err.message })
      }
    })

    // WebRTC relay for sessions
    socket.on('webrtc:offer',  ({ targetSocketId, offer,      sessionId }) => { io.to(targetSocketId).emit('webrtc:offer',  { fromSocketId: socket.id, offer,      sessionId }) })
    socket.on('webrtc:answer', ({ targetSocketId, answer,     sessionId }) => { io.to(targetSocketId).emit('webrtc:answer', { fromSocketId: socket.id, answer,     sessionId }) })
    socket.on('webrtc:ice',    ({ targetSocketId, candidate,  sessionId }) => { io.to(targetSocketId).emit('webrtc:ice',    { fromSocketId: socket.id, candidate,  sessionId }) })

    socket.on('control:event', (data) => {
      const session = sessionManager.getSessionBySocket(socket.id)
      if (!session) return
      const viewer = session.viewers.get(socket.id)
      if (!viewer?.permissions?.canControl && socket.role !== 'host') return
      io.to(session.hostSocketId).emit('control:event', { ...data, fromSocketId: socket.id })
    })

    socket.on('session:permissions', ({ viewerSocketId, permissions }) => {
      const session = sessionManager.getSessionBySocket(socket.id)
      if (!session || socket.role !== 'host') return
      sessionManager.updateViewerPermissions(session.sessionId, viewerSocketId, permissions)
      io.to(viewerSocketId).emit('session:permissions', { permissions })
    })

    socket.on('chat:message', async ({ message, sessionId, roomCode }) => {
      const roomKey = roomCode ? `call:${roomCode}` : `session:${sessionId}`
      const payload = { sender: socket.displayName, senderId: socket.id, message, timestamp: new Date().toISOString(), type: 'text' }
      io.to(roomKey).emit('chat:message', payload)
      if (sessionId && mongoose.connection.readyState === 1) {
        Session.findOneAndUpdate({ sessionId }, { $push: { chatMessages: { sender: socket.displayName, message, type: 'text' } } })
          .catch(err => logger.error('Chat persist error', err))
      }
    })

    socket.on('clipboard:sync', ({ content, sessionId }) => {
      const session = sessionManager.getSession(sessionId)
      if (!session) return
      socket.to(`session:${sessionId}`).emit('clipboard:sync', { content, from: socket.id })
    })

    socket.on('stream:quality', ({ quality, sessionId }) => {
      const session = sessionManager.getSession(sessionId)
      if (!session) return
      io.to(session.hostSocketId).emit('stream:quality', { quality, requestedBy: socket.id })
    })

    socket.on('session:reconnect', async (data, callback) => {
      try {
        const session = sessionManager.getSession(data.sessionId)
        callback?.(session && session.status !== 'ended'
          ? { success: true, hostSocketId: session.hostSocketId }
          : { error: 'Session no longer available' })
      } catch (err) { callback?.({ error: err.message }) }
    })

    socket.on('session:end', async ({ sessionId }) => {
      const session = sessionManager.getSession(sessionId)
      if (!session || socket.role !== 'host') return
      io.to(`session:${sessionId}`).emit('session:ended', { reason: 'host_ended' })
      sessionManager.endSession(sessionId)
      await Session.findOneAndUpdate({ sessionId }, { status: 'ended', endedAt: new Date() })
      logger.info(`Session ended by host: ${sessionId}`)
    })

    socket.on('file:offer',  (data) => { const s = sessionManager.getSession(data.sessionId); if (s) socket.to(`session:${data.sessionId}`).emit('file:offer',  { ...data, fromSocketId: socket.id }) })
    socket.on('file:accept', (data) => { io.to(data.targetSocketId).emit('file:accept', { ...data, fromSocketId: socket.id }) })
    socket.on('file:reject', (data) => { io.to(data.targetSocketId).emit('file:reject', { ...data, fromSocketId: socket.id }) })
    socket.on('voice:toggle', ({ enabled, sessionId }) => { socket.to(`session:${sessionId}`).emit('voice:toggle', { enabled, from: socket.id }) })

    // ─────────────────────────────────────────────────────
    // VIDEO CALL ROOM SIGNALING
    // ─────────────────────────────────────────────────────

    /**
     * call:join — join a call room. Notifies all existing participants.
     */
    socket.on('call:join', ({ roomCode, displayName }, callback) => {
      if (!roomCode || typeof roomCode !== 'string' || roomCode.trim().length < 3) {
        return callback?.({ error: 'Call room not found or expired' })
      }

      const rooms = getCallRooms()
      let room = rooms.get(roomCode.toUpperCase())

      if (!room) {
        const formattedCode = roomCode.toUpperCase()
        const roomId = require('crypto').randomUUID()
        room = {
          roomId,
          roomCode: formattedCode,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hour TTL
          participants: [],
          status: 'waiting',
          hostDeviceId: socket.deviceId || null,
        }
        rooms.set(roomId, room)
        rooms.set(formattedCode, room)
        logger.info(`Video call room created on-demand: ${formattedCode} (socket: ${socket.id})`)

        // Auto-cleanup after 4 hours
        setTimeout(() => {
          rooms.delete(roomId)
          rooms.delete(formattedCode)
        }, 4 * 60 * 60 * 1000)
      }

      if (new Date() > room.expiresAt)   return callback?.({ error: 'Call room has expired' })

      // Deduplicate
      room.participants = room.participants.filter(p => p.socketId !== socket.id)
      room.participants.push({
        socketId:    socket.id,
        deviceId:    socket.deviceId,
        displayName: displayName || socket.displayName,
        joinedAt:    new Date(),
        video:       true,
        audio:       true,
      })
      room.status = 'active'

      socket.join(`call:${roomCode}`)
      socket.callRoom = roomCode
      const isInitiator = room.participants.length === 1

      // Notify all existing peers about the new joiner
      socket.to(`call:${roomCode}`).emit('call:participant_joined', {
        socketId:    socket.id,
        displayName: displayName || socket.displayName,
      })

      const others = room.participants.filter(p => p.socketId !== socket.id)
      logger.info(`${socket.displayName} joined call room ${roomCode} (${room.participants.length} total)`)
      callback?.({ success: true, roomId: room.roomId, roomCode, participants: others, isInitiator })
    })

    // WebRTC relay for call rooms (separate namespace from sessions)
    socket.on('call:offer',  ({ targetSocketId, offer,     roomCode }) => { io.to(targetSocketId).emit('call:offer',  { fromSocketId: socket.id, offer,     roomCode }) })
    socket.on('call:answer', ({ targetSocketId, answer,    roomCode }) => { io.to(targetSocketId).emit('call:answer', { fromSocketId: socket.id, answer,    roomCode }) })
    socket.on('call:ice',    ({ targetSocketId, candidate, roomCode }) => { io.to(targetSocketId).emit('call:ice',    { fromSocketId: socket.id, candidate, roomCode }) })

    /** Broadcast camera/mic toggle state to room */
    socket.on('call:media_toggle', ({ roomCode, video, audio }) => {
      socket.to(`call:${roomCode}`).emit('call:media_toggle', { fromSocketId: socket.id, video, audio })
    })

    /** Emoji reaction */
    socket.on('call:reaction', ({ roomCode, emoji }) => {
      socket.to(`call:${roomCode}`).emit('call:reaction', {
        fromSocketId: socket.id, displayName: socket.displayName, emoji,
      })
    })

    /** Explicit leave */
    socket.on('call:leave', ({ roomCode }) => {
      const rooms = getCallRooms()
      const room  = rooms.get(roomCode)
      if (room) {
        room.participants = room.participants.filter(p => p.socketId !== socket.id)
        if (room.participants.length === 0) room.status = 'ended'
      }
      socket.to(`call:${roomCode}`).emit('call:participant_left', { socketId: socket.id })
      socket.leave(`call:${roomCode}`)
      socket.callRoom = null
      logger.info(`${socket.displayName} left call room ${roomCode}`)
    })

    // ─────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`)

      // Call room cleanup
      if (socket.callRoom) {
        const rooms = getCallRooms()
        const room  = rooms.get(socket.callRoom)
        if (room) {
          room.participants = room.participants.filter(p => p.socketId !== socket.id)
          if (room.participants.length === 0) room.status = 'ended'
        }
        socket.to(`call:${socket.callRoom}`).emit('call:participant_left', { socketId: socket.id })
      }

      // Session cleanup
      const result = sessionManager.removeSocket(socket.id)
      if (!result) return

      const { session, role } = result
      if (role === 'host') {
        io.to(`session:${session.sessionId}`).emit('session:host_disconnected', { reason, reconnectWindow: 30000 })
        await Session.findOneAndUpdate({ sessionId: session.sessionId }, { status: 'ended', endedAt: new Date() })
          .catch(err => logger.error('Session end DB error', err))
      } else if (role === 'viewer') {
        io.to(session.hostSocketId).emit('viewer:left', { viewerSocketId: socket.id, reason })
      }
    })
  })

  logger.info('WebSocket signaling server initialized')
  return io
}

module.exports = initSignaling
