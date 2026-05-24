const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derives a 32-byte key from an arbitrary string secret
 */
function deriveKey(secret) {
  return crypto.scryptSync(secret, 'remotelink-salt-v1', KEY_LENGTH);
}

/**
 * Encrypts plaintext using AES-256-GCM
 * Returns: base64(iv + authTag + ciphertext)
 */
function encrypt(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts base64 payload from encrypt()
 */
function decrypt(payload, secret) {
  const key = deriveKey(secret);
  const combined = Buffer.from(payload, 'base64');
  const iv = combined.slice(0, IV_LENGTH);
  const authTag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

/**
 * Generates a cryptographically secure session token
 */
function generateSessionToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hashes a password/pin for storage (using bcrypt-like approach with crypto)
 */
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a pin against its hash
 */
function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(pin, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

/**
 * Generates TURN credentials (time-limited)
 */
function generateTurnCredentials(username, secret, ttl = 86400) {
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const tempUser = `${timestamp}:${username}`;
  const credential = crypto.createHmac('sha1', secret).update(tempUser).digest('base64');
  return { username: tempUser, credential };
}

module.exports = {
  encrypt,
  decrypt,
  generateSessionToken,
  hashPin,
  verifyPin,
  generateTurnCredentials,
};
