const { Jimp } = require('jimp');
const C = require('./config');
const log = require('./logger').ENHANCE;

function findContentBounds(image) {
  const { width, height } = image.bitmap;
  const data = image.bitmap.data;
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const threshold = 30;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < 255 - threshold) { top = y; y = height; break; }
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < 255 - threshold) { bottom = y; y = -1; break; }
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y++) {
      if (data[(y * width + x) * 4] < 255 - threshold) { left = x; x = width; break; }
    }
  }
  for (let x = width - 1; x >= 0; x--) {
    for (let y = top; y <= bottom; y++) {
      if (data[(y * width + x) * 4] < 255 - threshold) { right = x; x = -1; break; }
    }
  }
  const marginX = Math.max(5, Math.floor((right - left) * 0.02));
  const marginY = Math.max(5, Math.floor((bottom - top) * 0.02));
  return {
    x: Math.max(0, left - marginX),
    y: Math.max(0, top - marginY),
    w: Math.min(width - Math.max(0, left - marginX), right - left + 2 * marginX),
    h: Math.min(height - Math.max(0, top - marginY), bottom - top + 2 * marginY),
  };
}

function adaptiveBinarize(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  const blockSize = Math.max(3, Math.floor(Math.min(w, h) / 30)) | 1;
  const halfBlock = Math.floor(blockSize / 2);
  const integral = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[(y * w + x) * 4];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const output = image.clone();
  const outData = output.bitmap.data;
  const thr = 10;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const y1 = Math.max(0, y - halfBlock), y2 = Math.min(h, y + halfBlock);
      const x1 = Math.max(0, x - halfBlock), x2 = Math.min(w, x + halfBlock);
      const count = (y2 - y1) * (x2 - x1);
      const sum = integral[y2 * (w + 1) + x2] - integral[y1 * (w + 1) + x2] - integral[y2 * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
      const mean = sum / count;
      const val = data[(y * w + x) * 4];
      const outIdx = (y * w + x) * 4;
      const v = val > mean - thr ? 255 : 0;
      outData[outIdx] = v; outData[outIdx + 1] = v; outData[outIdx + 2] = v;
    }
  }
  return output;
}

function sharpenImage(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const output = image.clone();
  const outData = output.bitmap.data;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0, g = 0, b = 0, ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          r += data[idx] * kernel[ki]; g += data[idx + 1] * kernel[ki]; b += data[idx + 2] * kernel[ki]; ki++;
        }
      }
      const outIdx = (y * w + x) * 4;
      outData[outIdx] = Math.max(0, Math.min(255, r));
      outData[outIdx + 1] = Math.max(0, Math.min(255, g));
      outData[outIdx + 2] = Math.max(0, Math.min(255, b));
    }
  }
  return output;
}

async function enhanceForOCR(buffer) {
  let image;
  try { image = await Jimp.read(buffer); } catch (_) { return buffer; }
  try {
    image.greyscale();
    image.contrast(0.3);
    const bounds = findContentBounds(image);
    if (bounds.w > 20 && bounds.h > 20 && (bounds.x > 0 || bounds.y > 0 || bounds.w < image.bitmap.width || bounds.h < image.bitmap.height)) {
      image.crop(bounds.x, bounds.y, bounds.w, bounds.h);
    }
    if (image.bitmap.width > C.ENHANCEMENT_MAX_WIDTH * 1.1) image.resize(C.ENHANCEMENT_MAX_WIDTH, Jimp.AUTO);
    else if (image.bitmap.width < 600) image.resize(1200, Jimp.AUTO);
    const sharpened = sharpenImage(image);
    const binarized = adaptiveBinarize(sharpened);
    return await binarized.getBuffer('image/png');
  } catch (_) { return buffer; }
}

async function enhanceSimple(buffer) {
  let image;
  try { image = await Jimp.read(buffer); } catch (_) { return buffer; }
  try {
    image.greyscale();
    image.contrast(0.25);
    const bounds = findContentBounds(image);
    if (bounds.w > 20 && bounds.h > 20 && (bounds.x > 0 || bounds.y > 0 || bounds.w < image.bitmap.width || bounds.h < image.bitmap.height)) {
      image.crop(bounds.x, bounds.y, bounds.w, bounds.h);
    }
    if (image.bitmap.width > 1800) image.resize(1800, Jimp.AUTO);
    return await image.getBuffer('image/jpeg');
  } catch (_) { return buffer; }
}

async function enhanceGrayscale(buffer) {
  let image;
  try { image = await Jimp.read(buffer); } catch (_) { return buffer; }
  try {
    image.greyscale();
    image.contrast(0.35);
    if (image.bitmap.width < 800) image.resize(1200, Jimp.AUTO);
    return await image.getBuffer('image/png');
  } catch (_) { return buffer; }
}

function laplacianVariance(image) {
  const gray = image.clone().greyscale();
  const w = gray.bitmap.width, h = gray.bitmap.height, data = gray.bitmap.data;
  let sum = 0, sumSq = 0, count = 0;
  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let lap = 0, ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          lap += data[((y + ky) * w + (x + kx)) * 4] * kernel[ki++];
        }
      }
      sum += Math.abs(lap); sumSq += lap * lap; count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function analyzeImageQuality(image, buffer) {
  const { width: w, height: h } = image.bitmap;
  const blur = laplacianVariance(image);
  const blurScore = Math.min(100, Math.max(0, Math.round((1 - blur / 500) * 100)));
  const lowRes = w < C.MIN_IMAGE_WIDTH || h < C.MIN_IMAGE_HEIGHT;
  const data = image.bitmap.data;
  let totalBright = 0, samples = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 100));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      totalBright += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      samples++;
    }
  }
  const avgBrightness = samples > 0 ? totalBright / samples : 127;
  const darkScore = avgBrightness < 15 ? 100 : avgBrightness < 30 ? 60 : avgBrightness < 50 ? 30 : 0;

  let passed = true;
  const issues = [];
  if (blurScore > 80) { passed = false; issues.push('Very blurry screenshot'); }
  else if (blurScore > 60) { issues.push('Moderate blur'); }
  if (lowRes) { passed = false; issues.push('Low resolution: ' + w + 'x' + h); }
  if (darkScore > 90) { passed = false; issues.push('Very dark image'); }
  return { passed, blurScore, lowRes, avgBrightness: Math.round(avgBrightness), darkScore, w, h, issues };
}

async function run(buffer) {
  const t0 = Date.now();
  let image;
  try { image = await Jimp.read(buffer); } catch (e) { return { buffer, quality: { passed: false, issues: ['Cannot parse image'] }, duration: Date.now() - t0 }; }
  const quality = analyzeImageQuality(image, buffer);
  const strategies = [
    { name: 'original', buf: buffer },
  ];
  try {
    const enhanced = await enhanceForOCR(buffer);
    strategies.push({ name: 'enhanced', buf: enhanced });
  } catch (_) {}
  try {
    const simple = await enhanceSimple(buffer);
    strategies.push({ name: 'simple', buf: simple });
  } catch (_) {}
  try {
    const gray = await enhanceGrayscale(buffer);
    strategies.push({ name: 'grayscale_2x', buf: gray });
  } catch (_) {}
  log.info('', 'Enhanced: ' + strategies.length + ' strategies, quality=' + quality.passed + ' blur=' + quality.blurScore + ' (' + (Date.now() - t0) + 'ms)');
  return { strategies, quality, duration: Date.now() - t0 };
}

module.exports = { run, enhanceForOCR, enhanceSimple, enhanceGrayscale, analyzeImageQuality };
