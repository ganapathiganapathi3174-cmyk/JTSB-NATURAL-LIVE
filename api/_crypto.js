const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    console.warn('[CRYPTO] ENCRYPTION_KEY not set or too short — encryption disabled');
    return null;
  }
  return crypto.scryptSync(key, 'jsree-apex-salt', 32);
}

function encrypt(text) {
  if (!text) return text;
  const key = getKey();
  if (!key) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(encrypted) {
  if (!encrypted) return encrypted;
  const key = getKey();
  if (!key) return encrypted;
  if (!encrypted.includes(':')) return encrypted;
  const parts = encrypted.split(':');
  if (parts.length !== 3) return encrypted;
  const [ivHex, tagHex, data] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encrypted;
  }
}

function encryptField(obj, field) {
  if (!obj || !obj[field]) return obj;
  return { ...obj, [field]: encrypt(String(obj[field])) };
}

function decryptFields(obj, fields) {
  if (!obj) return obj;
  const result = { ...obj };
  for (const field of fields) {
    if (result[field]) result[field] = decrypt(result[field]);
  }
  return result;
}

module.exports = { encrypt, decrypt, encryptField, decryptFields, getKey };
