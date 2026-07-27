const crypto = require('crypto');
const { Jimp } = require('jimp');
const C = require('./config');
const log = require('./logger').AUTH;

function getImageDimensions(buffer) {
  if (!buffer || buffer.length < 24) return { width: 0, height: 0 };
  try {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length - 1) {
        if (buffer[offset] === 0xFF) {
          const marker = buffer[offset + 1];
          if (marker >= 0xC0 && marker <= 0xC3) {
            return { width: (buffer[offset + 7] << 8) + buffer[offset + 8], height: (buffer[offset + 5] << 8) + buffer[offset + 6] };
          }
          if (marker === 0xD9 || marker === 0xDA) break;
          if (marker >= 0xD0 && marker <= 0xD8) { offset += 2; }
          else { const segLen = (buffer[offset + 2] << 8) + buffer[offset + 3]; offset += 2 + segLen; }
        } else { offset++; }
      }
    } else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      return { width: (buffer[16] << 24) + (buffer[17] << 16) + (buffer[18] << 8) + buffer[19], height: (buffer[20] << 24) + (buffer[21] << 16) + (buffer[22] << 8) + buffer[23] };
    }
  } catch (_) {}
  return { width: 0, height: 0 };
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function run(buffer) {
  const t0 = Date.now();
  const result = {
    passed: true,
    imageHash: computeSha256(buffer),
    dimensions: getImageDimensions(buffer),
    isScreenshot: false,
    isCameraPhoto: false,
    isEdited: false,
    isCropped: false,
    isOverlay: false,
    tamperScore: 0,
    issues: [],
    checks: [],
  };

  if (buffer.length < C.MIN_IMAGE_SIZE) {
    result.passed = false;
    result.issues.push('Screenshot too small (' + buffer.length + ' bytes)');
    result.duration = Date.now() - t0;
    return result;
  }
  if (buffer.length > C.MAX_IMAGE_SIZE) {
    result.passed = false;
    result.issues.push('Screenshot too large (' + (buffer.length / 1024 / 1024).toFixed(1) + 'MB)');
    result.duration = Date.now() - t0;
    return result;
  }

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (e) {
    result.passed = false;
    result.issues.push('Cannot decode image: ' + e.message);
    result.duration = Date.now() - t0;
    return result;
  }

  const { width, height } = image.bitmap;
  if (width < C.MIN_IMAGE_WIDTH || height < C.MIN_IMAGE_HEIGHT) {
    result.passed = false;
    result.issues.push('Resolution too low: ' + width + 'x' + height);
    result.duration = Date.now() - t0;
    return result;
  }
  if (width > C.MAX_IMAGE_WIDTH || height > C.MAX_IMAGE_HEIGHT) {
    result.passed = false;
    result.issues.push('Resolution too high: ' + width + 'x' + height);
    result.duration = Date.now() - t0;
    return result;
  }

  const ar = width / (height || 1);
  result.isScreenshot = (ar >= 0.4 && ar <= 0.65) || (ar >= 1.4 && ar <= 1.8);
  result.checks.push({ name: 'dimensions', passed: true, w: width, h: height });

  const gray = image.clone().greyscale();
  const data = gray.bitmap.data;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 60));
  let totalBright = 0;
  let samples = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      totalBright += data[(y * width + x) * 4];
      samples++;
    }
  }
  const avgBrightness = samples > 0 ? totalBright / samples : 127;

  let edgeCount = 0;
  const edgeStep = Math.max(1, Math.floor(Math.min(width, height) / 40));
  for (let y = edgeStep; y < height - edgeStep; y += edgeStep) {
    for (let x = edgeStep; x < width - edgeStep; x += edgeStep) {
      const idx = (y * width + x) * 4;
      const gx = Math.abs(data[idx + 1] - data[idx - 1]);
      const gy = Math.abs(data[(y + 1) * width + x] - data[(y - 1) * width + x]);
      if (gx + gy > 80) edgeCount++;
    }
  }
  const edgeDensity = edgeCount / Math.max(1, samples);

  if (edgeDensity > 0.3 && avgBrightness > 80) {
    result.tamperScore += 10;
    result.issues.push('High edge density (possible camera photo or edited content)');
  }

  result.checks.push({ name: 'brightness', passed: true, avgBrightness: Math.round(avgBrightness) });
  result.checks.push({ name: 'edge_density', passed: true, density: Math.round(edgeDensity * 100) });

  result.tamperScore = Math.min(Math.round(result.tamperScore), 100);
  result.isCameraPhoto = false;
  result.isEdited = false;
  result.isOverlay = false;
  result.isCropped = false;

  result.duration = Date.now() - t0;
  log.info('', 'Auth: tamper=' + result.tamperScore + ' dims=' + width + 'x' + height + ' (' + result.duration + 'ms)');
  return result;
}

module.exports = { run, computeSha256, getImageDimensions };
