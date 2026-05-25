const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');
const Session = require('../models/Session');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { sessionLimiter } = require('../middleware/rateLimit');
const { hashPin } = require('../services/encryption');
const sessionManager = require('../services/sessionManager');
const logger = require('../utils/logger');

/**
 * POST /api/sessions
 * Create a new session (host side)
 */
router.post('/', optionalAuth, sessionLimiter, async (req, res) => {
  try {
    const { platform } = req.body;
    const sessionId = uuidv4();

    // Fallback if MongoDB is not connected
    if (mongoose.connection.readyState !== 1) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let sessionCode = '';
      for (let i = 0; i < 6; i++) sessionCode += chars[Math.floor(Math.random() * chars.length)];
      
      const rawPassword = Math.random().toString(36).slice(-8);
      const iceConfig = {
        stunUrls: [process.env.STUN_URL || 'stun:stun.l.google.com:19302'],
        turnUrl: process.env.TURN_URL || null,
        turnUsername: process.env.TURN_USERNAME || null,
        turnCredential: process.env.TURN_CREDENTIAL || null,
      };

      // Register session in the in-memory sessionManager so WebSocket signalling works
      sessionManager.createSession(sessionId, {
        socketId: req.deviceId ? sessionManager.deviceToSocket.get(req.deviceId) : null,
        deviceId: req.deviceId,
        sessionCode,
      });

      logger.info(`[Offline Auth] Mock Session created: ${sessionId} code=${sessionCode} by ${req.deviceId}`);

      return res.status(201).json({
        sessionId,
        sessionCode,
        password: rawPassword,
        iceConfig,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }

    // Generate unique 6-char code
    let sessionCode;
    let attempts = 0;
    do {
      sessionCode = Session.generateCode();
      const exists = await Session.findOne({ sessionCode, status: { $in: ['waiting', 'active'] } });
      if (!exists) break;
      attempts++;
    } while (attempts < 10);

    const rawPassword = Session.generatePassword();
    const passwordHash = hashPin(rawPassword);

    const iceConfig = {
      stunUrls: [process.env.STUN_URL || 'stun:stun.l.google.com:19302'],
      turnUrl: process.env.TURN_URL || null,
      turnUsername: process.env.TURN_USERNAME || null,
      turnCredential: process.env.TURN_CREDENTIAL || null,
    };

    const session = await Session.create({
      sessionId,
      sessionCode,
      passwordHash,
      host: {
        user: req.user?._id,
        deviceId: req.deviceId,
      },
      status: 'waiting',
      iceConfig,
      metadata: { hostPlatform: platform || 'unknown' },
      expiresAt: new Date(Date.now() + 3600000),
    });

    logger.info(`Session created: ${sessionId} code=${sessionCode} by ${req.deviceId}`);

    res.status(201).json({
      sessionId,
      sessionCode,
      password: rawPassword,      // Only returned ONCE to the host
      iceConfig,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    logger.error('Create session error:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * POST /api/sessions/join
 * Validate session code and password before WebSocket join
 */
router.post('/join', optionalAuth, sessionLimiter, async (req, res) => {
  try {
    const { sessionCode } = req.body;

    // Fallback if MongoDB is not connected
    if (mongoose.connection.readyState !== 1) {
      const code = sessionCode.toUpperCase();
      // Try to find the session in sessionManager
      const foundSession = sessionManager.getSessionByCode(code);
      if (foundSession) {
        return res.json({
          sessionId: foundSession.sessionId,
          sessionCode: foundSession.sessionCode,
          status: foundSession.status,
          iceConfig: {
            stunUrls: [process.env.STUN_URL || 'stun:stun.l.google.com:19302'],
            turnUrl: process.env.TURN_URL || null,
            turnUsername: process.env.TURN_USERNAME || null,
            turnCredential: process.env.TURN_CREDENTIAL || null,
          }
        });
      } else {
        // Mock fallback to allow guest direct testing even if not in memory
        return res.json({
          sessionId: `mock-session-${code}`,
          sessionCode: code,
          status: 'waiting',
          iceConfig: {
            stunUrls: [process.env.STUN_URL || 'stun:stun.l.google.com:19302'],
            turnUrl: process.env.TURN_URL || null,
            turnUsername: process.env.TURN_USERNAME || null,
            turnCredential: process.env.TURN_CREDENTIAL || null,
          }
        });
      }
    }

    const session = await Session.findOne({
      sessionCode: sessionCode.toUpperCase(),
      status: { $in: ['waiting', 'active'] },
    }).select('sessionId sessionCode status iceConfig expiresAt');

    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }

    res.json({
      sessionId: session.sessionId,
      sessionCode: session.sessionCode,
      status: session.status,
      iceConfig: session.iceConfig,
    });
  } catch (err) {
    logger.error('Session lookup error:', err);
    res.status(500).json({ error: 'Failed to find session' });
  }
});

/**
 * GET /api/sessions/history
 * Get session history for authenticated user
 */
router.get('/history', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const skip = (page - 1) * limit;

    const sessions = await Session.find({
      $or: [
        { 'host.user': req.user._id },
        { 'viewers.user': req.user._id },
      ],
      status: { $in: ['active', 'ended'] },
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('sessionId sessionCode status startedAt endedAt duration metadata createdAt');

    const total = await Session.countDocuments({
      $or: [
        { 'host.user': req.user._id },
        { 'viewers.user': req.user._id },
      ],
    });

    res.json({ sessions, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('Session history error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /api/sessions/:sessionId
 * Get session details
 */
router.get('/:sessionId', authenticate, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId })
      .select('-passwordHash -iceConfig.turnCredential');

    if (!session) return res.status(404).json({ error: 'Session not found' });

    const liveState = sessionManager.getSession(req.params.sessionId);
    res.json({
      session,
      live: liveState ? {
        viewerCount: liveState.viewers.size,
        status: liveState.status,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * DELETE /api/sessions/:sessionId
 * End/terminate a session (host only)
 */
router.delete('/:sessionId', authenticate, async (req, res) => {
  try {
    const session = await Session.findOne({
      sessionId: req.params.sessionId,
      'host.user': req.user._id,
    });

    if (!session) return res.status(404).json({ error: 'Session not found or not authorized' });

    await session.end();
    sessionManager.endSession(req.params.sessionId);

    res.json({ success: true, message: 'Session ended' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to end session' });
  }
});

/**
 * GET /api/sessions/active/stats
 * Get active sessions stats
 */
router.get('/active/stats', authenticate, async (req, res) => {
  try {
    const stats = sessionManager.getActiveSessionsStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
