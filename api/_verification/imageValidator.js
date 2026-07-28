const C = require('./config');

function classify(header) {
  if (header.startsWith('89504E47')) return 'PNG';
  if (header.startsWith('FFD8FF')) return 'JPEG';
  if (header.startsWith('474946')) return 'GIF';
  if (header.startsWith('424D')) return 'BMP';
  if (header.startsWith('524946')) return 'WEBP';
  return 'UNKNOWN';
}

function validate(buf) {
  const log = [];

  if (!buf || !Buffer.isBuffer(buf) || buf.length < 4) {
    return { ok: false, format: null, bytes: 0, log: ['No image data'] };
  }

  const fmt = classify(buf.slice(0, 8).toString('hex').toUpperCase());
  if (fmt === 'UNKNOWN') log.push('Unsupported format');

  if (buf.length < C.MIN_IMAGE_BYTES) log.push('Too small: ' + buf.length + ' bytes');
  if (buf.length > C.MAX_IMAGE_BYTES) log.push('Exceeds size limit');

  return { ok: log.length === 0, format: fmt, bytes: buf.length, log };
}

module.exports = { validate };