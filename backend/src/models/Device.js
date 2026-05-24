const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
    default: 'Unknown Device',
  },
  platform: {
    type: String,
    enum: ['windows', 'macos', 'linux', 'android', 'ios', 'web'],
    required: true,
  },
  osVersion: String,
  appVersion: String,
  hostname: String,
  ipAddress: String,
  isOnline: {
    type: Boolean,
    default: false,
  },
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  socketId: String,
  capabilities: {
    canHost: { type: Boolean, default: true },
    canView: { type: Boolean, default: true },
    hasCamera: { type: Boolean, default: false },
    hasMicrophone: { type: Boolean, default: false },
    supportsFileTransfer: { type: Boolean, default: true },
  },
  sessions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
  }],
}, {
  timestamps: true,
});

deviceSchema.methods.markOnline = function (socketId) {
  this.isOnline = true;
  this.socketId = socketId;
  this.lastSeen = new Date();
  return this.save();
};

deviceSchema.methods.markOffline = function () {
  this.isOnline = false;
  this.socketId = null;
  this.lastSeen = new Date();
  return this.save();
};

module.exports = mongoose.model('Device', deviceSchema);
