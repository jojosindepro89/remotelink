const mongoose = require('mongoose');
const crypto = require('crypto');

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  sessionCode: {
    type: String,
    required: true,
    index: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  host: {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    socketId: String,
    deviceId: String,
  },
  viewers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
    socketId: String,
    deviceId: String,
    joinedAt: { type: Date, default: Date.now },
    permissions: {
      canControl: { type: Boolean, default: false },
      canChat: { type: Boolean, default: true },
      canTransferFiles: { type: Boolean, default: false },
      canViewScreen: { type: Boolean, default: true },
      canUseAudio: { type: Boolean, default: false },
    },
  }],
  status: {
    type: String,
    enum: ['waiting', 'active', 'ended', 'timeout', 'error'],
    default: 'waiting',
    index: true,
  },
  startedAt: Date,
  endedAt: Date,
  duration: Number, // seconds
  maxViewers: { type: Number, default: 5 },
  isRecording: { type: Boolean, default: false },
  recordingPath: String,
  chatMessages: [{
    sender: String,
    message: String,
    timestamp: { type: Date, default: Date.now },
    type: { type: String, enum: ['text', 'system', 'file'], default: 'text' },
  }],
  fileTransfers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transfer',
  }],
  iceConfig: {
    stunUrls: [String],
    turnUrl: String,
    turnUsername: String,
    turnCredential: String,
  },
  metadata: {
    hostPlatform: String,
    viewerPlatforms: [String],
    avgLatencyMs: Number,
    bytesTransferred: { type: Number, default: 0 },
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 3600000), // 1 hour
    index: { expireAfterSeconds: 0 },
  },
}, {
  timestamps: true,
});

sessionSchema.statics.generateCode = function () {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
};

sessionSchema.statics.generatePassword = function () {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

sessionSchema.methods.addChatMessage = function (sender, message, type = 'text') {
  this.chatMessages.push({ sender, message, type });
  return this.save();
};

sessionSchema.methods.end = async function () {
  this.status = 'ended';
  this.endedAt = new Date();
  if (this.startedAt) {
    this.duration = Math.floor((this.endedAt - this.startedAt) / 1000);
  }
  return this.save();
};

module.exports = mongoose.model('Session', sessionSchema);
