const C = require('./config.js');

const PNG_HEAD = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_HEAD = Buffer.from([255, 216, 255]);
const WEBP_HEAD = Buffer.from([82, 73, 70, 70]);

function detectFormat(buf) {
  if (buf.length < 4) return null;
  if (PNG_HEAD.compare(buf, 0, PNG_HEAD.length) === 0) return 'png';
  if (JPEG_HEAD.compare(buf, 0, JPEG_HEAD.length) === 0) return 'jpeg';
  if (WEBP_HEAD.compare(buf, 0, 4) === 0) return 'webp';
  return null;
}

async function validate(image) {
  const issues = [];
  if (!image || !image.buffer) return { valid: false, issues: ['No image data'] };
  const format = detectFormat(image.buffer);
  if (!format) issues.push('Unrecognized image format');
  if (image.size < C.MIN_IMAGE_BYTES) issues.push('Image too small');
  if (image.size > C.MAX_IMAGE_BYTES) issues.push('Image exceeds size limit');
  return { valid: issues.length === 0, format, size: image.size, issues };
}

module.exports = { validate, detectFormat };
