require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');

const { connectDB } = require('./config/db');
const initSignaling = require('./services/signaling');
const logger = require('./utils/logger');
const { generalLimiter } = require('./middleware/rateLimit');

const authRoutes    = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const deviceRoutes  = require('./routes/devices');
const fileRoutes    = require('./routes/files');
const adminRoutes   = require('./routes/admin');
const { router: callRoutes } = require('./routes/calls');

const app = express();
const httpServer = http.createServer(app);

// ── Security Middleware ────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

app.use(cors({
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
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-ID'],
}));


// ── Body Parsing ───────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ── Logging ────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ── Rate Limiting ──────────────────────────────────────────────
app.use('/api/', generalLimiter);

// ── Static Files (uploads) ─────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Health Check ───────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV,
  });
});

// ── API Routes ─────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/calls', callRoutes);

// ── ICE Server Config Endpoint ────────────────────────────────
//
// Configuration sources (in priority order):
//   1. TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN  → dynamic, signed STUN+TURN
//      (Twilio's NAT Traversal Service, recommended for production —
//      generous free tier ~10GB/month).
//   2. TURN_URL + TURN_USERNAME + TURN_CREDENTIAL  → static custom TURN.
//   3. Fallback: Google's public STUN servers only (P2P works when both
//      peers are on networks that allow direct UDP punch-through).
//
// Removed: openrelay.metered.ca was deprecated in late 2024 and the
//          "openrelayproject" credentials are dead / heavily rate-limited.
//          Handing them out caused silent media-plane failures on strict
//          NAT networks. Better to omit TURN entirely and surface the
//          issue than ship known-broken credentials.
app.get('/api/ice-config', async (req, res) => {
  const iceServers = [
    { urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Cloudflare's public STUN (operational + globally distributed)
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (sid && token) {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.ice_servers?.length) {
          logger.info('[ICE] Returning Twilio-issued ICE servers');
          return res.json({ iceServers: data.ice_servers, source: 'twilio' });
        }
      } else {
        logger.error(`[ICE] Twilio token API returned ${response.status}`);
      }
    } catch (err) {
      logger.error('[ICE] Failed to fetch Twilio ICE servers:', err.message);
    }
  }

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
    logger.info('[ICE] Returning STUN + custom TURN');
    return res.json({ iceServers, source: 'custom-turn' });
  }

  logger.warn('[ICE] No TURN configured. P2P will fail behind strict NATs. Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN on Render to fix.');
  return res.json({ iceServers, source: 'stun-only' });
});

// ── API Docs ──────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'RemoteLink API',
    version: '1.0.0',
    endpoints: {
      auth: { base: '/api/auth', routes: ['POST /device', 'POST /guest', 'GET /me', 'POST /refresh'] },
      sessions: { base: '/api/sessions', routes: ['POST /', 'POST /join', 'GET /history', 'GET /:id', 'DELETE /:id'] },
      devices: { base: '/api/devices', routes: ['GET /', 'POST /register', 'PATCH /:id', 'DELETE /:id'] },
      files: { base: '/api/files', routes: ['POST /:sessionId/upload', 'GET /download/:filename'] },
      admin: { base: '/api/admin', routes: ['GET /stats', 'GET /sessions', 'GET /users', 'GET /analytics', 'GET /logs'] },
    },
    websocket: { url: `ws://localhost:${process.env.PORT || 3001}`, docs: 'Connect via socket.io with auth token or deviceId' },
  });
});

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3001;

async function start() {
  // Connect to DB — non-blocking so server starts even if MongoDB is slow
  connectDB().catch(err => logger.warn(`DB not connected at startup: ${err.message}`));

  // Initialize WebSocket signaling
  initSignaling(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 RemoteLink server running on port ${PORT}`);
    logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   API: http://localhost:${PORT}/api`);
    logger.info(`   Health: http://localhost:${PORT}/health`);
  });
}


// ── Graceful Shutdown ─────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  httpServer.close(async () => {
    const { disconnectDB } = require('./config/db');
    await disconnectDB();
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

start();

module.exports = { app, httpServer };
