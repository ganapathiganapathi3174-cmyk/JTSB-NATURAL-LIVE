const crypto = require('crypto');
const C = require('./config');
const log = require('./logger').IMAGE;

function computeHash(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return '';
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function validateSize(buf) {
  if (!buf || !Buffer.isBuffer(buf)) return { passed: false, issues: ['No image data'] };
  if (buf.length < C.MIN_IMAGE_SIZE_BYTES) return { passed: false, issues: ['Image too small: ' + buf.length + ' bytes'] };
  if (buf.length > C.MAX_IMAGE_SIZE_BYTES) return { passed: false, issues: ['Image exceeds max size'] };
  return { passed: true, issues: [] };
}

function validateFormat(buf) {
  if (!buf || buf.length < 8) return { passed: false, format: 'unknown', issues: ['Unreadable image'] };
  const header = buf.slice(0, 8).toString('hex').toUpperCase();
  if (header.startsWith('89504E47')) return { passed: true, format: 'PNG', issues: [] };
  if (header.startsWith('FFD8FF')) return { passed: true, format: 'JPEG', issues: [] };
  if (header.startsWith('474946')) return { passed: true, format: 'GIF', issues: [] };
  if (header.startsWith('424D')) return { passed: true, format: 'BMP', issues: [] };
  if (header.startsWith('524946')) return { passed: true, format: 'WEBP', issues: [] };
  return { passed: false, format: 'unknown', issues: ['Unsupported image format'] };
}

function detectTampering(buf) {
  const issues = [];
  let tamperScore = 0;
  const str = buf.slice(0, Math.min(buf.length, 4096)).toString('utf8').toLowerCase();
  if (/\bphotoshop\b/i.test(str)) { issues.push('Photoshop metadata detected'); tamperScore += 30; }
  if (/\bgnome-screenshot/i.test(str)) { tamperScore += 5; }
  if (buf.length > 100 && buf.length < 5000) { issues.push('Suspiciously small image'); tamperScore += 15; }
  return { tamperScore: Math.min(tamperScore, 100), issues };
}

function analyzeLayout(buf) {
  const issues = [];
  if (buf.length < 1000) return { passed: true, issues: [], edgeDensity: 0 };
  try {
    let edgeCount = 0;
    const sample = 400;
    const step = Math.max(1, Math.floor(buf.length / sample));
    for (let i = 0; i < buf.length - 1; i += step) {
      const diff = Math.abs(buf[i + 1] - buf[i]);
      if (diff > 30) edgeCount++;
    }
    const edgeDensity = edgeCount / (buf.length / step);
    if (edgeDensity < C.EDGE_DENSITY_MIN) {
      issues.push('Image appears uniform or blank');
    }
    return { passed: edgeDensity >= C.EDGE_DENSITY_MIN, issues, edgeDensity };
  } catch (e) {
    return { passed: true, issues: [], edgeDensity: 0 };
  }
}

function parseDimensions(buf) {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  const header = buf.slice(0, 8).toString('hex').toUpperCase();
  if (header.startsWith('89504E47')) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (header.startsWith('FFD8FF')) {
    let offset = 2;
    while (offset < buf.length - 1) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
      }
      const segLen = buf.readUInt16BE(offset + 2);
      offset += 2 + segLen;
      if (offset >= buf.length) break;
    }
  }
  return { width: 0, height: 0 };
}

function run(buf) {
  const t0 = Date.now();
  const allIssues = [];
  let passed = true;

  const formatCheck = validateFormat(buf);
  if (!formatCheck.passed) { allIssues.push(...formatCheck.issues); passed = false; }

  const sizeCheck = validateSize(buf);
  if (!sizeCheck.passed) { allIssues.push(...sizeCheck.issues); passed = false; }

  const dims = parseDimensions(buf);
  if (dims.width > 0 && dims.width < C.MIN_IMAGE_DIMENSION) { allIssues.push('Image too narrow: ' + dims.width + 'px'); passed = false; }
  if (dims.height > 0 && dims.height < C.MIN_IMAGE_DIMENSION) { allIssues.push('Image too short: ' + dims.height + 'px'); passed = false; }
  if (dims.width > C.MAX_IMAGE_WIDTH) { allIssues.push('Image too wide'); passed = false; }
  if (dims.height > C.MAX_IMAGE_HEIGHT) { allIssues.push('Image too tall'); passed = false; }

  const tamperCheck = detectTampering(buf);
  if (tamperCheck.tamperScore > C.TAMPER_SCORE_MAX) {
    allIssues.push(...tamperCheck.issues); passed = false;
  }

  const layoutCheck = analyzeLayout(buf);
  if (!layoutCheck.passed) { allIssues.push(...layoutCheck.issues); passed = false; }

  const imageHash = computeHash(buf);

  log.info('Image: format=' + formatCheck.format + ' dims=' + dims.width + 'x' + dims.height + ' bytes=' + buf.length + ' tamper=' + tamperCheck.tamperScore + ' edges=' + (layoutCheck.edgeDensity || 0).toFixed(4) + ' hash=' + (imageHash ? imageHash.substring(0, 12) : 'none') + ' (' + (Date.now() - t0) + 'ms)');
  return {
    passed,
    format: formatCheck.format,
    width: dims.width,
    height: dims.height,
    sizeBytes: buf.length,
    imageHash,
    tamperScore: tamperCheck.tamperScore,
    tamperIssues: tamperCheck.issues,
    edgeDensity: layoutCheck.edgeDensity || 0,
    issues: allIssues,
    duration: Date.now() - t0,
  };
}

module.exports = { run, computeHash, validateSize, validateFormat, detectTampering, parseDimensions, analyzeLayout };