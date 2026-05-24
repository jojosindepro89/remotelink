const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Device = require('../models/Device');
const { authLimiter } = require('../middleware/rateLimit');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * POST /api/auth/device
 * Register or authenticate with a device ID (guest or persistent)
 */
router.post('/device', authLimiter, async (req, res) => {
  try {
    const { deviceId, platform, deviceName, osVersion, appVersion } = req.body;

    if (!deviceId || !platform) {
      return res.status(400).json({ error: 'deviceId and platform are required' });
    }

    // Upsert user
    let user = await User.findOneAndUpdate(
      { deviceId },
      { lastSeen: new Date() },
      { new: true, upsert: false }
    );

    if (!user) {
      user = await User.create({
        deviceId,
        isGuest: true,
        displayName: `User-${deviceId.slice(-6)}`,
      });
    }

    // Upsert device
    let device = await Device.findOneAndUpdate(
      { deviceId },
      {
        name: deviceName || `${platform} Device`,
        platform,
        osVersion,
        appVersion,
        lastSeen: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (!user.devices.includes(device._id)) {
      user.devices.push(device._id);
      await user.save();
    }

    const token = jwt.sign(
      { userId: user._id, deviceId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    logger.info(`Device authenticated: ${deviceId} (${platform})`);

    res.json({
      token,
      user: user.toSafeObject(),
      device,
    });
  } catch (err) {
    logger.error('Device auth error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * POST /api/auth/guest
 * Create a one-time guest session token (no account needed)
 */
router.post('/guest', authLimiter, async (req, res) => {
  try {
    const guestDeviceId = `guest-${uuidv4()}`;

    const user = await User.create({
      deviceId: guestDeviceId,
      isGuest: true,
      displayName: `Guest-${guestDeviceId.slice(-6)}`,
    });

    const token = jwt.sign(
      { userId: user._id, deviceId: guestDeviceId, role: 'user', isGuest: true },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, deviceId: guestDeviceId, displayName: user.displayName });
  } catch (err) {
    logger.error('Guest auth error:', err);
    res.status(500).json({ error: 'Failed to create guest session' });
  }
});

/**
 * GET /api/auth/google
 * Initiate Google OAuth flow
 */
router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: process.env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'profile email',
    access_type: 'offline',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

/**
 * POST /api/auth/refresh
 * Refresh an expiring JWT token
 */
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const token = jwt.sign(
      { userId: req.user._id, deviceId: req.deviceId, role: req.user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('devices').select('-__v');
    res.json({ user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * PATCH /api/auth/me
 * Update user preferences/display name
 */
router.patch('/me', authenticate, async (req, res) => {
  try {
    const { displayName, preferences } = req.body;
    const updates = {};
    if (displayName) updates.displayName = displayName;
    if (preferences) updates.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json({ user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

module.exports = router;
