const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema({
  session: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
    required: true,
    index: true,
  },
  sender: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deviceId: String,
    displayName: String,
  },
  recipient: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deviceId: String,
    displayName: String,
  },
  fileName: { type: String, required: true },
  fileSize: { type: Number, required: true }, // bytes
  mimeType: String,
  storagePath: String,
  downloadUrl: String,
  status: {
    type: String,
    enum: ['pending', 'transferring', 'completed', 'failed', 'cancelled'],
    default: 'pending',
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  bytesTransferred: { type: Number, default: 0 },
  checksumSha256: String,
  transferDuration: Number, // ms
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 86400000), // 24 hrs
    index: { expireAfterSeconds: 0 },
  },
}, {
  timestamps: true,
});

transferSchema.virtual('speedBytesPerSec').get(function () {
  if (!this.transferDuration || this.transferDuration === 0) return 0;
  return Math.round((this.bytesTransferred / this.transferDuration) * 1000);
});

module.exports = mongoose.model('Transfer', transferSchema);
