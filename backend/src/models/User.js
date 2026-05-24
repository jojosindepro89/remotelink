const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    sparse: true,
    lowercase: true,
    trim: true,
  },
  displayName: {
    type: String,
    trim: true,
    maxlength: 100,
  },
  avatar: String,
  googleId: {
    type: String,
    sparse: true,
  },
  deviceId: {
    type: String,
    unique: true,
    required: true,
    index: true,
  },
  isGuest: {
    type: Boolean,
    default: false,
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user',
  },
  sessions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Session',
  }],
  devices: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
  }],
  lastSeen: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  preferences: {
    theme: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },
    quality: { type: String, enum: ['auto', 'high', 'medium', 'low'], default: 'auto' },
    notifications: { type: Boolean, default: true },
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

userSchema.virtual('sessionCount').get(function () {
  return this.sessions ? this.sessions.length : 0;
});

userSchema.pre('save', function (next) {
  this.lastSeen = new Date();
  next();
});

userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

userSchema.statics.findOrCreateGuest = async function (deviceId) {
  let user = await this.findOne({ deviceId });
  if (!user) {
    user = await this.create({
      deviceId,
      isGuest: true,
      displayName: `Guest-${deviceId.slice(-6)}`,
    });
  }
  return user;
};

module.exports = mongoose.model('User', userSchema);
