const C = require('./config.js');

function guessMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return 'image/bmp';
  return null;
}

function validateImage(buf) {
  const result = {
    valid: false, mime: null, size: 0, width: 0, height: 0,
    issues: [], warnings: [],
  };

  if (!buf || !Buffer.isBuffer(buf)) {
    result.issues.push('No image data');
    return result;
  }

  result.size = buf.length;
  if (buf.length < C.MIN_IMAGE_SIZE) result.issues.push('Image too small (' + buf.length + ' bytes)');
  if (buf.length > C.MAX_IMAGE_SIZE) result.issues.push('Image exceeds maximum size (' + buf.length + ' bytes)');

  const mime = guessMime(buf);
  result.mime = mime;
  if (!mime) result.issues.push('Unrecognized image format');
  else if (!C.ALLOWED_MIME_TYPES.includes(mime)) result.warnings.push('Non-standard format: ' + mime);

  result.valid = result.issues.length === 0;
  return result;
}

async function validateImageUrl(url) {
  const result = { valid: false, width: 0, height: 0, issues: [], warnings: [] };
  if (!url || typeof url !== 'string') {
    result.issues.push('No URL provided');
    return result;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('data:')) {
    result.issues.push('Invalid URL scheme');
    return result;
  }
  result.valid = true;
  return result;
}

module.exports = { validateImage, validateImageUrl, guessMime };
