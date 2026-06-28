const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Jimp } = require('jimp');

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
  console.log('[OCR] Tesseract.js loaded — version: ' + (Tesseract.version || 'available'));
} catch (_) {
  console.log('[OCR] Tesseract.js not available — using PaddleOCR only');
}

const { analyzeWithPipeline, mapToVerificationFormat } = require('./_pipeline_bridge.js');

console.log('[OCR] Pipeline bridge loaded');

function fetchBufferFromURL(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
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
      const size = buffer.readUInt32LE(2);
      return { width: buffer.readUInt32LE(18), height: buffer.readUInt32LE(22) };
    }
  } catch (_) {}
  return { width: 0, height: 0 };
}

function findContentBounds(image) {
  const { width, height } = image.bitmap;
  const data = image.bitmap.data;
  let top = 0, bottom = height - 1, left = 0, right = width - 1;
  const threshold = 30;
  for (let y = 0; y < height; y++) {
    let hasContent = false;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = data[idx];
      if (gray < 255 - threshold) { hasContent = true; break; }
    }
    if (hasContent) { top = y; break; }
  }
  for (let y = height - 1; y >= 0; y--) {
    let hasContent = false;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = data[idx];
      if (gray < 255 - threshold) { hasContent = true; break; }
    }
    if (hasContent) { bottom = y; break; }
  }
  for (let x = 0; x < width; x++) {
    let hasContent = false;
    for (let y = top; y <= bottom; y++) {
      const idx = (y * width + x) * 4;
      const gray = data[idx];
      if (gray < 255 - threshold) { hasContent = true; break; }
    }
    if (hasContent) { left = x; break; }
  }
  for (let x = width - 1; x >= 0; x--) {
    let hasContent = false;
    for (let y = top; y <= bottom; y++) {
      const idx = (y * width + x) * 4;
      const gray = data[idx];
      if (gray < 255 - threshold) { hasContent = true; break; }
    }
    if (hasContent) { right = x; break; }
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
  const blockSize = Math.max(3, Math.floor(Math.min(w, h) / 30));
  if (blockSize % 2 === 0) blockSize + 1;
  const halfBlock = Math.floor(blockSize / 2);

  const integral = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const gray = data[idx];
      rowSum += gray;
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }

  const output = image.clone();
  const outData = output.bitmap.data;
  const threshold = 10;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const y1 = Math.max(0, y - halfBlock);
      const y2 = Math.min(h, y + halfBlock);
      const x1 = Math.max(0, x - halfBlock);
      const x2 = Math.min(w, x + halfBlock);
      const count = (y2 - y1) * (x2 - x1);
      const sum = integral[y2 * (w + 1) + x2] - integral[y1 * (w + 1) + x2] - integral[y2 * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
      const mean = sum / count;
      const idx = (y * w + x) * 4;
      const val = data[idx];
      const outIdx = (y * w + x) * 4;
      if (val > mean - threshold) {
        outData[outIdx] = 255;
        outData[outIdx + 1] = 255;
        outData[outIdx + 2] = 255;
      } else {
        outData[outIdx] = 0;
        outData[outIdx + 1] = 0;
        outData[outIdx + 2] = 0;
      }
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
      let r = 0, g = 0, b = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          r += data[idx] * kernel[ki];
          g += data[idx + 1] * kernel[ki];
          b += data[idx + 2] * kernel[ki];
          ki++;
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

async function preprocessForOCR(buffer) {
  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (e) {
    console.log('[OCR] Could not parse image: ' + e.message);
    return buffer;
  }
  try {
    image.greyscale();
    image.contrast(0.3);
    const bounds = findContentBounds(image);
    if (bounds.w > 20 && bounds.h > 20 && (bounds.x > 0 || bounds.y > 0 || bounds.w < image.bitmap.width || bounds.h < image.bitmap.height)) {
      image.crop(bounds.x, bounds.y, bounds.w, bounds.h);
    }
    const targetWidth = 2000;
    if (image.bitmap.width > targetWidth * 1.1) {
      image.resize(targetWidth, Jimp.AUTO);
    } else if (image.bitmap.width < 600) {
      image.resize(1200, Jimp.AUTO);
    }
    const sharpened = sharpenImage(image);
    const binarized = adaptiveBinarize(sharpened);
    return await binarized.getBuffer('image/png');
  } catch (e) {
    console.log('[OCR] Preprocessing failed: ' + e.message + ' — using raw image');
    return buffer;
  }
}

async function preprocessSimple(buffer) {
  let image;
  try {
    image = await Jimp.read(buffer);
  } catch (e) {
    return buffer;
  }
  try {
    image.greyscale();
    image.contrast(0.25);
    const bounds = findContentBounds(image);
    if (bounds.w > 20 && bounds.h > 20 && (bounds.x > 0 || bounds.y > 0 || bounds.w < image.bitmap.width || bounds.h < image.bitmap.height)) {
      image.crop(bounds.x, bounds.y, bounds.w, bounds.h);
    }
    if (image.bitmap.width > 1800) {
      image.resize(1800, Jimp.AUTO);
    }
    return await image.getBuffer('image/jpeg');
  } catch (e) {
    return buffer;
  }
}

async function runTesseractOCR(imageBuffer) {
  let worker = null;
  try {
    worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && m.progress) {
          if (Math.round(m.progress * 10) % 2 === 0) {
            console.log('[OCR] Recognition progress: ' + Math.round(m.progress * 100) + '%');
          }
        }
      }
    });
    const { data } = await worker.recognize(imageBuffer);
    return data;
  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) {}
    }
  }
}

async function analyzeScreenshot(imageUrl) {
  const result = {
    ocrAvailable: false,
    ocrText: '',
    confidence: 0,
    imageHash: '',
    rawImageHash: '',
    imageQuality: null,
    wordData: [],
    dimensions: { width: 0, height: 0 },
    simpleOcrText: '',
    simpleConfidence: 0,
    error: null,
  };

  // Try full pipeline first (primary engine — CV validation + PaddleOCR + EasyOCR fallback)
  try {
    console.log('[OCR] Trying pipeline for: ' + (imageUrl ? imageUrl.substring(0, 60) + '...' : 'null'));
    const pipeResult = await analyzeWithPipeline(imageUrl);
    if (pipeResult && !pipeResult.error && pipeResult.ocr && pipeResult.ocr.blocks && pipeResult.ocr.blocks.length > 0) {
      const mapped = mapToVerificationFormat(pipeResult);
      if (mapped.ocrResult && mapped.ocrResult.ocrAvailable) {
        result.ocrAvailable = true;
        result.ocrText = mapped.ocrResult.ocrText;
        result.confidence = mapped.ocrResult.confidence;
        result.imageHash = mapped.ocrResult.imageHash;
        result.wordData = mapped.ocrResult.wordData;
        const res = (pipeResult.imageValidation || {}).resolution || {};
        result.dimensions = { width: res.width || 0, height: res.height || 0 };
        result.imageQuality = { engine: 'pipeline', blocks: pipeResult.ocr.blocks.length, confidence: mapped.ocrResult.confidence, grade: (pipeResult.imageValidation || {}).grade };
        console.log('[OCR] Pipeline succeeded: ' + mapped.ocrResult.ocrText.length + ' chars @ ' + mapped.ocrResult.confidence + '%');
        return result;
      }
    }
    console.log('[OCR] Pipeline returned no usable result, falling back to Tesseract');
  } catch (e) {
    console.log('[OCR] Pipeline failed: ' + e.message + ', falling back to Tesseract');
  }

  // Fallback: Tesseract.js
  if (!Tesseract) {
    result.error = 'No OCR engine available (PaddleOCR failed, Tesseract not loaded)';
    console.log('[OCR] Error: ' + result.error);
    return result;
  }

  try {
    console.log('[OCR] Fallback Tesseract for: ' + (imageUrl ? imageUrl.substring(0, 60) + '...' : 'null'));
    const rawBuf = await fetchBufferFromURL(imageUrl);
    result.rawImageHash = crypto.createHash('sha256').update(rawBuf).digest('hex');
    const dims = getImageDimensions(rawBuf);
    result.dimensions = dims;
    console.log('[OCR] Fetched: ' + rawBuf.length + ' bytes, ' + dims.width + 'x' + dims.height);

    const processedBuf = await preprocessForOCR(rawBuf);
    console.log('[OCR] Running Tesseract OCR...');
    const data = await runTesseractOCR(processedBuf);
    const ocrText = data.text || '';
    const wordConfidences = (data.words || []).map(w => w.confidence || 0);
    const avgConfidence = wordConfidences.length > 0
      ? wordConfidences.reduce((s, c) => s + c, 0) / wordConfidences.length
      : 0;

    let simpleText = '';
    let simpleConf = 0;
    if (avgConfidence < 40 && ocrText.length < 20) {
      const simpleBuf = await preprocessSimple(rawBuf);
      const simpleData = await runTesseractOCR(simpleBuf);
      simpleText = simpleData.text || '';
      const simpleConfs = (simpleData.words || []).map(w => w.confidence || 0);
      simpleConf = simpleConfs.length > 0
        ? simpleConfs.reduce((s, c) => s + c, 0) / simpleConfs.length
        : 0;
    }

    const bestText = simpleText.length > ocrText.length ? simpleText : ocrText;
    const bestConf = simpleText.length > ocrText.length ? simpleConf : avgConfidence;

    result.ocrAvailable = true;
    result.ocrText = bestText;
    result.confidence = Math.round(bestConf * 100) / 100;
    result.imageHash = crypto.createHash('sha256').update(bestText).digest('hex');
    result.wordData = (data.words || []).map(w => ({
      text: w.text,
      confidence: w.confidence || 0,
      bbox: w.bbox || null,
    }));

    console.log('[OCR] Tesseract complete: ' + bestText.length + ' chars @ ' + result.confidence + '%');
    return result;

  } catch (e) {
    result.error = 'All OCR engines failed: ' + e.message;
    console.log('[OCR] Error: ' + result.error);
    return result;
  }
}

module.exports = { analyzeScreenshot, getImageDimensions, fetchBufferFromURL, preprocessForOCR, preprocessSimple };
