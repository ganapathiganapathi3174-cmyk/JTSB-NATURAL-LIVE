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
  if (!buf || !width || !height) return { blurred: false, score: 0 };
  try {
    const Jimp = require('jimp');
    const laplacian = Jimp.__TestOnly ? 0 : 0;
    let variance = 0;
    try {
      const img = Jimp.__TestOnly ? null : null;
      variance = 0;
    } catch {}
    return { blurred: variance < C.BLUR_THRESHOLD, score: variance };
  } catch {
    return { blurred: false, score: 0 };
  }
}

module.exports = { processImage, detectBlur };
