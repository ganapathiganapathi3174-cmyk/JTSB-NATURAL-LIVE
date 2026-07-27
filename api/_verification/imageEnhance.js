const { Jimp } = require('jimp');
const C = require('./config');
const log = require('./logger').ENHANCE;

function laplacianVariance(image) {
  const gray = image.clone().greyscale();
  const w = gray.bitmap.width, h = gray.bitmap.height, data = gray.bitmap.data;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const lap = -4 * data[(y * w + x) * 4] + data[((y - 1) * w + x) * 4] + data[((y + 1) * w + x) * 4] + data[(y * w + x - 1) * 4] + data[(y * w + x + 1) * 4];
      sum += Math.abs(lap); sumSq += lap * lap; count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function analyzeImageQuality(image) {
  const { width: w, height: h } = image.bitmap;
  const blur = laplacianVariance(image);
  const blurScore = Math.min(100, Math.max(0, Math.round((1 - blur / 500) * 100)));
  const lowRes = w < C.MIN_IMAGE_WIDTH || h < C.MIN_IMAGE_HEIGHT;
  const data = image.bitmap.data;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 50));
  let totalBright = 0, samples = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      totalBright += (data[(y * w + x) * 4] + data[(y * w + x) * 4 + 1] + data[(y * w + x) * 4 + 2]) / 3;
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

async function enhanceSingle(buffer) {
  let image;
  try { image = await Jimp.read(buffer); } catch (_) { return buffer; }
  try {
    image.greyscale();
    image.contrast(0.3);
    if (image.bitmap.width < 800) image.resize(1200, Jimp.AUTO);
    else if (image.bitmap.width > 1800) image.resize(1800, Jimp.AUTO);
    return await image.getBuffer('image/jpeg');
  } catch (_) { return buffer; }
}

async function run(buffer) {
  const t0 = Date.now();
  let image;
  try { image = await Jimp.read(buffer); } catch (e) { return { buffer, quality: { passed: false, issues: ['Cannot parse image'] }, duration: Date.now() - t0 }; }

  const quality = analyzeImageQuality(image);

  const strategies = [
    { name: 'original', buf: buffer },
  ];

  try {
    const enhanced = await enhanceSingle(buffer);
    strategies.push({ name: 'enhanced', buf: enhanced });
  } catch (_) {}

  log.info('', strategies.length + ' strategies, quality=' + quality.passed + ' blur=' + quality.blurScore + ' (' + (Date.now() - t0) + 'ms)');
  return { strategies, quality, duration: Date.now() - t0 };
}

module.exports = { run, analyzeImageQuality };
