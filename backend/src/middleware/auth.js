const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * JWT Authentication middleware
 * Supports both Bearer token and device-only guest access
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const deviceId = req.headers['x-device-id'];

    // Database offline check
    if (mongoose.connection.readyState !== 1) {
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
          req.user = {
            _id: decoded.userId,
            deviceId: decoded.deviceId || deviceId || 'mock-device',
            role: decoded.role || 'user',
            isActive: true,
            displayName: `User-${(decoded.deviceId || deviceId || 'mock').slice(-6)}`,
            toSafeObject() {
              return { id: this._id, deviceId: this.deviceId, displayName: this.displayName };
            }
          };
          req.deviceId = decoded.deviceId || deviceId;
          return next();
        } catch {}
      }
      if (deviceId) {
        req.user = {
          _id: `mock-user-${deviceId.slice(-6)}`,
          deviceId,
          role: 'user',
          isActive: true,
          displayName: `Guest-${deviceId.slice(-6)}`,
          toSafeObject() {
            return { id: this._id, deviceId: this.deviceId, displayName: this.displayName };
          }
        };
        req.deviceId = deviceId;
        req.isGuest = true;
        return next();
      }
      return res.status(401).json({ error: 'Authentication required (offline)' });
    }

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-__v');
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      req.user = user;
      req.deviceId = decoded.deviceId || deviceId;
      return next();
    }

    // Guest mode: device ID only
    if (deviceId) {
      const user = await User.findOrCreateGuest(deviceId);
      req.user = user;
      req.deviceId = deviceId;
      req.isGuest = true;
      return next();
    }

    return res.status(401).json({ error: 'Authentication required' });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logger.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

/**
 * Admin-only access middleware
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

/**
 * Optional auth: proceeds without auth but populates req.user if token present
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const deviceId = req.headers['x-device-id'];

    if (mongoose.connection.readyState !== 1) {
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const token = authHeader.slice(7);
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
          req.user = {
            _id: decoded.userId,
            deviceId: decoded.deviceId || deviceId,
            role: decoded.role || 'user',
            isActive: true,
            displayName: `User-${(decoded.deviceId || deviceId || 'mock').slice(-6)}`,
            toSafeObject() {
              return { id: this._id, deviceId: this.deviceId, displayName: this.displayName };
            }
          };
          req.deviceId = decoded.deviceId || deviceId;
        } catch {}
      } else if (deviceId) {
        req.user = {
          _id: `mock-user-${deviceId.slice(-6)}`,
          deviceId,
          role: 'user',
          isActive: true,
          displayName: `Guest-${deviceId.slice(-6)}`,
          toSafeObject() {
            return { id: this._id, deviceId: this.deviceId, displayName: this.displayName };
          }
        };
        req.deviceId = deviceId;
        req.isGuest = true;
      }
      return next();
    }

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId);
      req.deviceId = decoded.deviceId || deviceId;
    } else if (deviceId) {
      req.user = await User.findOrCreateGuest(deviceId);
      req.deviceId = deviceId;
      req.isGuest = true;
    }
  } catch {
    // Ignore auth errors in optional mode
  }
  next();
};

module.exports = { authenticate, requireAdmin, optionalAuth };

