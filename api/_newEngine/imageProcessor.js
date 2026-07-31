const C = require('./config.js');

async function processImage(buf, options) {
  const result = { processed: false, buffer: buf, width: 0, height: 0, enhancements: [] };
  if (!buf || !Buffer.isBuffer(buf)) { result.processed = false; return result; }

  try {
    const Jimp = require('jimp');
    const image = await Jimp.read(buf);
    result.width = image.bitmap.width;
    result.height = image.bitmap.height;

    if (result.width < C.MIN_WIDTH || result.height < C.MIN_HEIGHT) {
      result.warnings = ['Image resolution too low: ' + result.width + 'x' + result.height];
    }

    image.autocrop();
    result.enhancements.push('autocrop');

    if (options?.contrast !== false) {
      image.contrast(0.15);
      result.enhancements.push('contrast');
    }

    if (options?.greyscale) {
      image.greyscale();
      result.enhancements.push('greyscale');
    }

    if (options?.normalize) {
      image.normalize();
      result.enhancements.push('normalize');
    }

    if (result.width > 2000 || result.height > 2000) {
      const scale = Math.min(2000 / result.width, 2000 / result.height);
      image.scale(scale);
      result.enhancements.push('resize_' + scale.toFixed(2));
    }

    result.buffer = await image.getBufferAsync(Jimp.MIME_PNG);
    result.processed = true;
  } catch (e) {
    result.error = e.message;
    result.processed = false;
  }
  return result;
}

function detectBlur(buf, width, height) {
  // Variance-of-Laplacian blur metric computed on the real pixel data.
  // Returns { blurred, score, dark } where score is the Laplacian variance.
  if (!buf || !width || !height) return Promise.resolve({ blurred: false, score: 0, dark: false, error: 'no image info' });
  try {
    const Jimp = require('jimp');
    return new Promise((resolve) => {
      Jimp.read(buf).then((img) => {
        const { data, width: w, height: h } = img.bitmap;
        const lapVals = [];
        let sum = 0;
        let totalLum = 0;
        let px = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = (y * w + x) * 4;
            const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const gUp = 0.299 * data[((y - 1) * w + x) * 4] + 0.587 * data[((y - 1) * w + x) * 4 + 1] + 0.114 * data[((y - 1) * w + x) * 4 + 2];
            const gDown = 0.299 * data[((y + 1) * w + x) * 4] + 0.587 * data[((y + 1) * w + x) * 4 + 1] + 0.114 * data[((y + 1) * w + x) * 4 + 2];
            const gLeft = 0.299 * data[(y * w + x - 1) * 4] + 0.587 * data[(y * w + x - 1) * 4 + 1] + 0.114 * data[(y * w + x - 1) * 4 + 2];
            const gRight = 0.299 * data[(y * w + x + 1) * 4] + 0.587 * data[(y * w + x + 1) * 4 + 1] + 0.114 * data[(y * w + x + 1) * 4 + 2];
            const lap = 4 * g - gUp - gDown - gLeft - gRight;
            lapVals.push(lap);
            sum += lap;
            totalLum += g;
            px++;
          }
        }
        const mean = lapVals.length ? sum / lapVals.length : 0;
        let variance = 0;
        for (const v of lapVals) variance += (v - mean) * (v - mean);
        variance = lapVals.length ? variance / lapVals.length : 0;
        const avgLum = px ? totalLum / px : 255;
        resolve({
          blurred: variance < C.BLUR_THRESHOLD,
          score: Math.round(variance * 100) / 100,
          dark: avgLum < C.DARK_THRESHOLD,
          meanLuminance: Math.round(avgLum),
        });
      }).catch((e) => resolve({ blurred: false, score: 0, dark: false, error: e.message }));
    });
  } catch (e) {
    return Promise.resolve({ blurred: false, score: 0, dark: false, error: e.message });
  }
}

module.exports = { processImage, detectBlur };
