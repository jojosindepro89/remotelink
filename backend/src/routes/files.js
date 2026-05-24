const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Transfer = require('../models/Transfer');
const Session = require('../models/Session');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const logger = require('../utils/logger');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionDir = path.join(uploadDir, req.params.sessionId || 'temp');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB) || 500) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Block dangerous executables in certain modes
    const blocked = ['.exe', '.bat', '.sh', '.ps1', '.cmd'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (blocked.includes(ext) && process.env.BLOCK_EXECUTABLES === 'true') {
      return cb(new Error('Executable files are blocked'));
    }
    cb(null, true);
  },
});

/**
 * POST /api/files/:sessionId/upload
 */
router.post('/:sessionId/upload', optionalAuth, uploadLimiter, upload.single('file'), async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await Session.findOne({ sessionId, status: 'active' });
    if (!session) return res.status(404).json({ error: 'Active session not found' });

    const transfer = await Transfer.create({
      session: session._id,
      sender: {
        user: req.user?._id,
        deviceId: req.deviceId,
        displayName: req.user?.displayName || 'Unknown',
      },
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      storagePath: req.file.path,
      downloadUrl: `/api/files/download/${path.basename(req.file.path)}`,
      status: 'completed',
      progress: 100,
      bytesTransferred: req.file.size,
    });

    // Update session
    await Session.findByIdAndUpdate(session._id, {
      $push: { fileTransfers: transfer._id },
      $inc: { 'metadata.bytesTransferred': req.file.size },
    });

    logger.info(`File uploaded: ${req.file.originalname} (${req.file.size}B) for session ${sessionId}`);
    res.status(201).json({ transfer, downloadUrl: transfer.downloadUrl });
  } catch (err) {
    logger.error('File upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/**
 * GET /api/files/download/:filename
 */
router.get('/download/:filename', optionalAuth, async (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitize filename to prevent directory traversal
    const safeName = path.basename(filename);
    const transfer = await Transfer.findOne({ storagePath: { $regex: safeName } });

    if (!transfer) return res.status(404).json({ error: 'File not found' });
    if (!fs.existsSync(transfer.storagePath)) {
      return res.status(404).json({ error: 'File no longer available' });
    }

    res.download(transfer.storagePath, transfer.fileName);
  } catch (err) {
    logger.error('File download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * GET /api/files/:sessionId/transfers
 */
router.get('/:sessionId/transfers', authenticate, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId });
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const transfers = await Transfer.find({ session: session._id })
      .sort({ createdAt: -1 });

    res.json({ transfers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

module.exports = router;
