const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const logger = require('../utils/logger')

// In-memory call rooms (also mirrored in sessionManager for signaling)
const callRooms = new Map()

/**
 * Generate a random 9-character room code, e.g. "RLC-4F8-Z1K"
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const rand = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  return `${rand()}-${rand()}-${rand()}`
}

/**
 * POST /api/calls
 * Create a new video call room. Returns roomCode + join link.
 */
router.post('/', async (req, res) => {
  try {
    const roomCode = generateRoomCode()
    const roomId   = crypto.randomUUID()
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'

    const room = {
      roomId,
      roomCode,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hour TTL
      participants: [],
      status: 'waiting',
      hostDeviceId: req.body.deviceId || req.headers['x-device-id'] || null,
    }

    callRooms.set(roomId, room)
    callRooms.set(roomCode, room) // Index by code too

    // Auto-cleanup after 4 hours
    setTimeout(() => {
      callRooms.delete(roomId)
      callRooms.delete(roomCode)
    }, 4 * 60 * 60 * 1000)

    logger.info(`Video call room created: ${roomCode} (${roomId})`)

    res.json({
      roomId,
      roomCode,
      joinLink: `${clientUrl}/call/${roomCode}`,
      expiresAt: room.expiresAt,
    })
  } catch (err) {
    logger.error('Create call room error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/calls/:roomCode
 * Look up a room by code — used by joiners to verify it exists.
 */
router.get('/:roomCode', (req, res) => {
  const room = callRooms.get(req.params.roomCode.toUpperCase())
  if (!room) {
    return res.status(404).json({ error: 'Call room not found or expired' })
  }
  if (new Date() > room.expiresAt) {
    callRooms.delete(room.roomId)
    callRooms.delete(room.roomCode)
    return res.status(410).json({ error: 'Call room has expired' })
  }

  res.json({
    roomId: room.roomId,
    roomCode: room.roomCode,
    participantCount: room.participants.length,
    status: room.status,
    expiresAt: room.expiresAt,
  })
})

/**
 * DELETE /api/calls/:roomCode
 * End a call room.
 */
router.delete('/:roomCode', (req, res) => {
  const code = req.params.roomCode.toUpperCase()
  const room = callRooms.get(code)
  if (!room) return res.status(404).json({ error: 'Room not found' })
  callRooms.delete(room.roomId)
  callRooms.delete(code)
  res.json({ success: true })
})

// Export rooms map so signaling.js can update participant counts
module.exports = { router, callRooms }
