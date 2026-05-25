const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Device = require('../models/Device');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/devices
 * Get all devices for the authenticated user
 */
router.get('/', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ devices: [] });
    }
    const devices = await Device.find({ owner: req.user._id }).sort({ lastSeen: -1 });
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * POST /api/devices/register
 * Register or update a device
 */
router.post('/register', authenticate, async (req, res) => {
  try {
    const { deviceId, name, platform, osVersion, appVersion, hostname } = req.body;

    if (!deviceId || !platform) {
      return res.status(400).json({ error: 'deviceId and platform required' });
    }

    if (mongoose.connection.readyState !== 1) {
      return res.json({
        device: {
          deviceId,
          name: name || `${platform} Device`,
          platform,
          osVersion,
          appVersion,
          hostname,
          lastSeen: new Date(),
        }
      });
    }

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        owner: req.user._id,
        name: name || `${platform} Device`,
        platform,
        osVersion,
        appVersion,
        hostname,
        lastSeen: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Add to user's device list
    if (!req.user.devices.includes(device._id)) {
      req.user.devices.push(device._id);
      await req.user.save();
    }

    res.json({ device });
  } catch (err) {
    logger.error('Device register error:', err);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

/**
 * PATCH /api/devices/:deviceId
 * Rename or update device properties
 */
router.patch('/:deviceId', authenticate, async (req, res) => {
  try {
    const { name, capabilities } = req.body;
    if (mongoose.connection.readyState !== 1) {
      return res.json({
        device: {
          deviceId: req.params.deviceId,
          name,
          capabilities,
        }
      });
    }
    const device = await Device.findOneAndUpdate(
      { deviceId: req.params.deviceId, owner: req.user._id },
      { ...(name && { name }), ...(capabilities && { capabilities }) },
      { new: true }
    );
    if (!device) return res.status(404).json({ error: 'Device not found' });
    res.json({ device });
  } catch (err) {
    res.status(500).json({ error: 'Update failed' });
  }
});

/**
 * DELETE /api/devices/:deviceId
 * Remove a device from user's account
 */
router.delete('/:deviceId', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.json({ success: true });
    }
    const device = await Device.findOneAndDelete({
      deviceId: req.params.deviceId,
      owner: req.user._id,
    });
    if (!device) return res.status(404).json({ error: 'Device not found' });

    req.user.devices = req.user.devices.filter(d => !d.equals(device._id));
    await req.user.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;

