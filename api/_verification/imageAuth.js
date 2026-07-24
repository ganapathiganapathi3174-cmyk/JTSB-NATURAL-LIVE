const crypto = require('crypto');
const { Jimp } = require('jimp');
const C = require('./config');
const log = require('./logger').AUTH;

function fetchBufferFromURL(url) {
  const https = require('https');
  const http = require('http');
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching screenshot')); });
  });
}

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
    } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
      const header = buffer.toString('ascii', 0, 6);
      if (header === 'GIF87a' || header === 'GIF89a') {
        return { width: buffer[6] + (buffer[7] << 8), height: buffer[8] + (buffer[9] << 8) };
      }
    } else if (buffer[0] === 0x52 && buffer[1] === 0x49) {
      return { width: buffer.readUInt32LE(18), height: buffer.readUInt32LE(22) };
    }
  } catch (_) {}
  return { width: 0, height: 0 };
}

function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function detectCameraPhoto(image) {
  const gray = image.clone().greyscale();
  const { width: w, height: h } = gray.bitmap;
  const data = gray.bitmap.data;
  let score = 0;
  const issues = [];

  const kernelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const kernelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const angles = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 80));
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      let gx = 0, gy = 0, ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          gx += data[idx] * kernelX[ki];
          gy += data[idx] * kernelY[ki];
          ki++;
        }
      }
      if (Math.sqrt(gx * gx + gy * gy) > 30) {
        angles.push(Math.abs(Math.atan2(gy, gx) * 180 / Math.PI % 90));
      }
    }
  }
  if (angles.length > 50) {
    const std = Math.sqrt(angles.reduce((s, a) => {
      const m = angles.reduce((a2, b) => a2 + b, 0) / angles.length;
      return s + (a - m) ** 2;
    }, 0) / angles.length);
    if (std > 15) {
      score += Math.min(std * 3, 40);
      issues.push('Non-uniform edge angles (perspective distortion)');
    }
  }

  const lumSamples = [];
  const sampleStep = Math.max(1, Math.floor(Math.min(w, h) / 50));
  for (let y = 0; y < h; y += sampleStep) {
    for (let x = 0; x < w; x += sampleStep) {
      lumSamples.push(data[(y * w + x) * 4]);
    }
  }
  if (lumSamples.length > 100) {
    const mean = lumSamples.reduce((a, b) => a + b, 0) / lumSamples.length;
    const centerSamples = lumSamples.slice(Math.floor(lumSamples.length * 0.3), Math.floor(lumSamples.length * 0.7));
    const cornerSamples = [...lumSamples.slice(0, Math.floor(lumSamples.length * 0.05)), ...lumSamples.slice(Math.floor(lumSamples.length * 0.95))];
    const centerMean = centerSamples.reduce((a, b) => a + b, 0) / centerSamples.length;
    const cornerMean = cornerSamples.reduce((a, b) => a + b, 0) / cornerSamples.length;
    if (cornerMean > 0 && centerMean / cornerMean > 1.15) {
      const vignetteScore = Math.min((centerMean / cornerMean - 1) * 100, 20);
      score += vignetteScore;
      issues.push('Vignetting pattern detected (camera lens)');
    }
  }

  const centerX = Math.floor(w / 2);
  const centerY = Math.floor(h / 2);
  const regionSize = Math.min(w, h) / 4;
  const centerPixels = [];
  const edgePixels = [];
  for (let y = centerY - regionSize; y < centerY + regionSize; y += sampleStep) {
    for (let x = centerX - regionSize; x < centerX + regionSize; x += sampleStep) {
      if (y >= 0 && y < h && x >= 0 && x < w) centerPixels.push(data[(y * w + x) * 4]);
    }
  }
  for (let y = 0; y < Math.floor(regionSize); y += sampleStep) {
    for (let x = 0; x < w; x += sampleStep) {
      edgePixels.push(data[(y * w + x) * 4]);
    }
    for (let x = 0; x < w; x += sampleStep) {
      edgePixels.push(data[((h - 1 - y) * w + x) * 4]);
    }
  }
  if (centerPixels.length > 50 && edgePixels.length > 50) {
    const centerVar = variance(centerPixels);
    const edgeVar = variance(edgePixels);
    if (edgeVar > centerVar * 3) {
      score += 15;
      issues.push('High noise variance at edges (lens aberration)');
    }
  }

  return { score: Math.min(score, 100), isCameraPhoto: score > 60, issues };
}

function variance(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

async function detectEditing(image) {
  let score = 0;
  const issues = [];

  try {
    const { Jimp: J } = require('jimp');
    const pilImg = image.clone();
    const buf = await pilImg.getBuffer('image/jpeg', { quality: 75 });
    const resaved = await J.read(buf);
    const w = pilImg.bitmap.width;
    const h = pilImg.bitmap.height;
    const origData = pilImg.bitmap.data;
    const resavedData = resaved.bitmap.data;
    let anomalousCount = 0;
    let totalPixels = 0;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
    const diffs = [];
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const idx = (y * w + x) * 4;
        const diff = Math.abs(origData[idx] - resavedData[idx]) +
                     Math.abs(origData[idx + 1] - resavedData[idx + 1]) +
                     Math.abs(origData[idx + 2] - resavedData[idx + 2]);
        diffs.push(diff / 3);
        totalPixels++;
      }
    }
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const stdDiff = Math.sqrt(diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / diffs.length);
    const threshold = meanDiff + 2 * stdDiff;
    anomalousCount = diffs.filter(d => d > threshold).length;
    const anomalyPct = (anomalousCount / totalPixels) * 100;
    score = Math.min(anomalyPct * 3, 100);
    if (score > 30) issues.push('ELA analysis detected ' + anomalyPct.toFixed(1) + '% anomalous regions');
    if (score > 60) issues.push('High tamper probability');
  } catch (_) {}

  return { score, isEdited: score > 30, issues };
}

async function detectCrop(image) {
  const { width: w, height: h } = image.bitmap;
  const gray = image.clone().greyscale();
  const data = gray.bitmap.data;
  let score = 0;
  const issues = [];

  const thresholds = [240, 230, 220];
  for (const thresh of thresholds) {
    let topContent = 0, bottomContent = 0;
    for (let x = 0; x < w; x += 3) {
      if (data[x] < thresh) topContent++;
      if (data[((h - 1) * w + x) * 4] < thresh) bottomContent++;
    }
    if (topContent > w * 0.8) { score += 10; break; }
    if (bottomContent > w * 0.8) { score += 10; break; }
  }

  for (let x = 0; x < w; x += 3) {
    let leftContent = 0;
    for (let y = 0; y < h; y += 3) {
      if (data[(y * w + x) * 4] < 240) leftContent++;
    }
    if (leftContent > h * 0.8) { score += 10; break; }
  }

  for (let x = w - 1; x >= Math.max(0, w - 15); x--) {
    let rightContent = 0;
    for (let y = 0; y < h; y += 3) {
      if (data[(y * w + x) * 4] < 240) rightContent++;
    }
    if (rightContent > h * 0.8) { score += 10; break; }
  }

  return { score: Math.min(score, 100), isCropped: score > 40, issues };
}

async function detectOverlay(image) {
  const { width: w, height: h } = image.bitmap;
  const data = image.bitmap.data;
  let score = 0;
  const issues = [];

  const gray = image.clone().greyscale();
  const gData = gray.bitmap.data;
  const edges = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 100));
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const idx = (y * w + x) * 4;
      const gx = Math.abs(gData[idx + 1] - gData[idx - 1]);
      const gy = Math.abs(gData[(y + 1) * w + x] - gData[(y - 1) * w + x]);
      edges.push({ x, y, mag: gx + gy });
    }
  }
  const strongEdges = edges.filter(e => e.mag > 100);
  if (strongEdges.length > 20) {
    const yPositions = strongEdges.map(e => e.y).sort((a, b) => a - b);
    let transitions = 0;
    for (let i = 1; i < yPositions.length; i++) {
      if (yPositions[i] - yPositions[i - 1] > h * 0.05) transitions++;
    }
    if (transitions > 8) {
      score += Math.min(transitions * 3, 30);
      issues.push('Abnormal edge transitions (possible overlay)');
    }
  }

  let whiteCount = 0;
  let blackCount = 0;
  const sampleStep = Math.max(1, Math.floor(Math.min(w, h) / 100));
  let totalSamples = 0;
  for (let y = 0; y < h; y += sampleStep) {
    for (let x = 0; x < w; x += sampleStep) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r > 250 && g > 250 && b > 250) whiteCount++;
      if (r < 5 && g < 5 && b < 5) blackCount++;
      totalSamples++;
    }
  }
  const whitePct = totalSamples > 0 ? whiteCount / totalSamples : 0;
  const blackPct = totalSamples > 0 ? blackCount / totalSamples : 0;
  if (whitePct > 0.6) {
    score += 15;
    issues.push('Large white region detected (possible overlay mask)');
  }
  if (blackPct > 0.4) {
    score += 15;
    issues.push('Large black region detected (possible overlay mask)');
  }

  return { score: Math.min(score, 100), isOverlay: score > 40, issues };
}

function detectScreenshotType(image) {
  const { width: w, height: h } = image.bitmap;
  const ar = w / (h || 1);
  const isPortraitPhone = ar >= 0.4 && ar <= 0.65;
  const isLandscapePhone = ar >= 1.4 && ar <= 1.8;
  return { isPortraitPhone, isLandscapePhone, aspectRatio: ar, isScreenshotLike: isPortraitPhone || isLandscapePhone };
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
    return result;
  }
  if (buffer.length > C.MAX_IMAGE_SIZE) {
    result.passed = false;
    result.issues.push('Screenshot too large (' + (buffer.length / 1024 / 1024).toFixed(1) + 'MB)');
    return result;
  }

  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (e) {
    result.passed = false;
    result.issues.push('Cannot decode image: ' + e.message);
    return result;
  }

  const { width, height } = image.bitmap;
  if (width < C.MIN_IMAGE_WIDTH || height < C.MIN_IMAGE_HEIGHT) {
    result.passed = false;
    result.issues.push('Resolution too low: ' + width + 'x' + height);
    return result;
  }
  if (width > C.MAX_IMAGE_WIDTH || height > C.MAX_IMAGE_HEIGHT) {
    result.passed = false;
    result.issues.push('Resolution too high: ' + width + 'x' + height);
    return result;
  }

  const typeInfo = detectScreenshotType(image);
  result.isScreenshot = typeInfo.isScreenshotLike;
  result.checks.push({ name: 'screenshot_type', passed: true, aspectRatio: typeInfo.aspectRatio, portrait: typeInfo.isPortraitPhone });

  const camera = await detectCameraPhoto(image);
  result.isCameraPhoto = camera.isCameraPhoto;
  result.tamperScore += camera.score * 0.3;
  result.issues.push(...camera.issues);
  result.checks.push({ name: 'camera_photo', passed: !camera.isCameraPhoto, score: camera.score });

  const editing = await detectEditing(image);
  result.isEdited = editing.isEdited;
  result.tamperScore += editing.score * 0.3;
  result.issues.push(...editing.issues);
  result.checks.push({ name: 'editing', passed: !editing.isEdited, score: editing.score });

  const crop = await detectCrop(image);
  result.isCropped = crop.isCropped;
  result.tamperScore += crop.score * 0.2;
  result.issues.push(...crop.issues);
  result.checks.push({ name: 'crop', passed: !crop.isCropped, score: crop.score });

  const overlay = await detectOverlay(image);
  result.isOverlay = overlay.isOverlay;
  result.tamperScore += overlay.score * 0.2;
  result.issues.push(...overlay.issues);
  result.checks.push({ name: 'overlay', passed: !overlay.isOverlay, score: overlay.score });

  result.tamperScore = Math.min(Math.round(result.tamperScore), 100);

  if (result.isCameraPhoto || result.isEdited || result.isOverlay) {
    result.passed = false;
  }

  result.duration = Date.now() - t0;
  log.info('', 'Authenticity: tamper=' + result.tamperScore + ' camera=' + result.isCameraPhoto + ' edited=' + result.isEdited + ' overlay=' + result.isOverlay + ' (' + result.duration + 'ms)');
  return result;
}

module.exports = { run, fetchBufferFromURL, computeSha256, getImageDimensions };
