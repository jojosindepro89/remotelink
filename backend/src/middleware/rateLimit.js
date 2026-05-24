const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

const createLimiter = (options) => rateLimit({
  windowMs: options.windowMs || 15 * 60 * 1000,
  max: options.max || 100,
  message: { error: options.message || 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit hit: ${req.ip} on ${req.path}`);
    res.status(options.statusCode).json(options.message);
  },
});

const generalLimiter = createLimiter({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
});

const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts, please try again in 15 minutes.',
});

const sessionLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many session requests, please slow down.',
});

const uploadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many file upload requests.',
});

module.exports = { generalLimiter, authLimiter, sessionLimiter, uploadLimiter };
