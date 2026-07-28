const C = require('./config.js');

const MAGIC = {
  png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  jpeg: [0xFF, 0xD8, 0xFF],
  webp: [0x52, 0x49, 0x46, 0x46],
};

function detectFormat(buf) {
  if (!buf || buf.length < 4) return null;
  for (const [fmt, sig] of Object.entries(MAGIC)) {
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (buf[i] !== sig[i]) { match = false; break; }
    }
    if (match) return fmt;
  }
  return null;
}

async function validate(imageBuffer) {
  const issues = [];
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    return { valid: false, format: null, size: 0, issues: ['No image data'] };
  }
  const format = detectFormat(imageBuffer);
  if (!format) issues.push('Unsupported image format (PNG/JPEG/WEBP required)');
  if (imageBuffer.length < C.MIN_IMAGE_BYTES) issues.push('Image too small');
  if (imageBuffer.length > C.MAX_IMAGE_BYTES) issues.push('Image exceeds size limit');
  return { valid: issues.length === 0, format, size: imageBuffer.length, issues };
}

module.exports = { validate, detectFormat };
