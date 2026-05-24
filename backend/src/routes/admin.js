const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Device = require('../models/Device');
const Session = require('../models/Session');
const Transfer = require('../models/Transfer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const sessionManager = require('../services/sessionManager');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

/**
 * GET /api/admin/stats
 * Overall platform statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const [userCount, deviceCount, sessionCount, transferCount] = await Promise.all([
      User.countDocuments(),
      Device.countDocuments(),
      Session.countDocuments(),
      Transfer.countDocuments(),
    ]);

    const [activeSessions, todaySessions, totalDataTransferred] = await Promise.all([
      Session.countDocuments({ status: 'active' }),
      Session.countDocuments({
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      }),
      Session.aggregate([
        { $group: { _id: null, total: { $sum: '$metadata.bytesTransferred' } } }
      ]),
    ]);

    const liveStats = sessionManager.getActiveSessionsStats();

    res.json({
      users: { total: userCount },
      devices: { total: deviceCount },
      sessions: {
        total: sessionCount,
        active: activeSessions,
        today: todaySessions,
        live: liveStats,
      },
      transfers: { total: transferCount },
      dataTransferred: totalDataTransferred[0]?.total || 0,
    });
  } catch (err) {
    logger.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/admin/sessions
 * List all sessions with filters
 */
router.get('/sessions', async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) filter.sessionCode = { $regex: search, $options: 'i' };

    const sessions = await Session.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * Math.min(limit, 100))
      .limit(Math.min(limit, 100))
      .populate('host.user', 'displayName email deviceId')
      .select('-passwordHash -chatMessages -iceConfig.turnCredential');

    const total = await Session.countDocuments(filter);
    res.json({ sessions, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

/**
 * DELETE /api/admin/sessions/:sessionId
 * Force-terminate a session
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    await Session.findOneAndUpdate(
      { sessionId: req.params.sessionId },
      { status: 'ended', endedAt: new Date() }
    );
    sessionManager.endSession(req.params.sessionId);
    logger.info(`Admin terminated session: ${req.params.sessionId}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to terminate session' });
  }
});

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { displayName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { deviceId: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .select('-__v');

    const total = await User.countDocuments(filter);
    res.json({ users, total });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * PATCH /api/admin/users/:userId
 * Update user role or status
 */
router.patch('/users/:userId', async (req, res) => {
  try {
    const { role, isActive } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { ...(role && { role }), ...(isActive !== undefined && { isActive }) },
      { new: true }
    ).select('-__v');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * GET /api/admin/logs
 * Read server logs
 */
router.get('/logs', async (req, res) => {
  try {
    const logFile = path.join(__dirname, '../../logs/combined.log');
    const lines = parseInt(req.query.lines) || 100;
    if (!fs.existsSync(logFile)) return res.json({ logs: [] });

    const content = fs.readFileSync(logFile, 'utf8');
    const allLines = content.trim().split('\n').filter(Boolean);
    const recent = allLines.slice(-lines).map(line => {
      try { return JSON.parse(line); } catch { return { message: line }; }
    });

    res.json({ logs: recent.reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

/**
 * GET /api/admin/analytics
 * Sessions over time analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - days * 86400000);

    const sessionsOverTime = await Session.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          avgDuration: { $avg: '$duration' },
          totalData: { $sum: '$metadata.bytesTransferred' },
        }
      },
      { $sort: { _id: 1 } },
    ]);

    const platformBreakdown = await Session.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: '$metadata.hostPlatform', count: { $sum: 1 } } },
    ]);

    res.json({ sessionsOverTime, platformBreakdown });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
