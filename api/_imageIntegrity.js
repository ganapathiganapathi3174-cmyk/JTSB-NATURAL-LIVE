const crypto = require('crypto');

function log(msg) {
  console.log(`[IMAGE-INTEGRITY] ${msg}`);
}

async function analyzeImageIntegrity(imageBuffer, imageUrl) {
  const tStart = Date.now();
  log(`Analyzing image integrity: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

  const result = {
    imageScore: 0,
    isEdited: false,
    qualityScore: 0,
    resolution: { width: 0, height: 0 },
    blurScore: 0,
    noiseScore: 0,
    brightness: 0,
    contrast: 0,
    isBlurred: false,
    isCropped: false,
    aspectRatio: 0,
    compressionScore: 0,
    forgeryProbability: 0,
    elaScore: 0,
    perceptualHash: '',
    issues: [],
    checks: {},
  };

  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(imageBuffer);

    result.resolution = { width: img.bitmap.width, height: img.bitmap.height };
    result.aspectRatio = img.bitmap.height > 0
      ? Math.round((img.bitmap.width / img.bitmap.height) * 100) / 100
      : 0;

    const { width, height } = result.resolution;
    if (width < 200 || height < 200) {
      result.issues.push(`Low resolution: ${width}x${height}`);
    }
    if (width > 4000 || height > 4000) {
      result.issues.push(`Very high resolution: ${width}x${height}`);
    }
    if (result.aspectRatio < 0.3 || result.aspectRatio > 2.5) {
      result.issues.push(`Unusual aspect ratio: ${result.aspectRatio}`);
    }

    const grayData = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = img.getPixelIndex(x, y);
        const r = img.bitmap.data[idx];
        const g = img.bitmap.data[idx + 1];
        const b = img.bitmap.data[idx + 2];
        grayData.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
      }
    }

    const mean = grayData.reduce((s, v) => s + v, 0) / grayData.length;
    result.brightness = Math.round(mean);
    const variance = grayData.reduce((s, v) => s + (v - mean) ** 2, 0) / grayData.length;
    result.contrast = Math.round(Math.sqrt(variance));

    if (mean < 20) result.issues.push(`Too dark: brightness=${Math.round(mean)}`);
    if (mean > 240) result.issues.push(`Too bright: brightness=${Math.round(mean)}`);
    if (variance < 100) result.issues.push(`Low contrast: ${Math.round(Math.sqrt(variance))}`);

    let lapSum = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian = Math.abs(
          4 * grayData[idx]
          - grayData[idx - 1] - grayData[idx + 1]
          - grayData[idx - width] - grayData[idx + width]
        );
        lapSum += laplacian;
      }
    }
    result.blurScore = Math.round(lapSum / ((width - 2) * (height - 2)) * 100) / 100;
    result.isBlurred = result.blurScore < 5;
    if (result.isBlurred) result.issues.push(`Blurry: score=${result.blurScore}`);

    let noiseSum = 0;
    let noiseCount = 0;
    for (let y = 0; y < height - 2; y += 2) {
      for (let x = 0; x < width - 2; x += 2) {
        const idx = y * width + x;
        noiseSum += Math.abs(grayData[idx] - grayData[idx + 1]);
        noiseCount++;
      }
    }
    result.noiseScore = noiseCount > 0 ? Math.round((noiseSum / noiseCount) * 100) / 100 : 0;

    let edgeSum = 0;
    let edgeCount = 0;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 100));
    for (let y = 0; y < height - 1; y += step) {
      for (let x = 0; x < width - 1; x += step) {
        const idx = y * width + x;
        const dx = Math.abs(grayData[idx] - grayData[idx + 1]);
        const dy = Math.abs(grayData[idx] - grayData[idx + width]);
        edgeSum += Math.sqrt(dx * dx + dy * dy);
        edgeCount++;
      }
    }
    const avgEdge = edgeCount > 0 ? edgeSum / edgeCount : 0;
    result.compressionScore = Math.min(100, Math.round((1 - avgEdge / 255) * 100));

    result.perceptualHash = crypto.createHash('sha256')
      .update(imageBuffer)
      .digest('hex')
      .substring(0, 16);

    const elaScore = await computeELAScore(img, width, height);
    result.elaScore = elaScore;
    if (elaScore > 40) {
      result.issues.push(`Potential tampering via ELA: ${elaScore}`);
    }

    const qualityFactors = [];
    if (!result.isBlurred) qualityFactors.push(25);
    else qualityFactors.push(5);
    if (result.brightness > 20 && result.brightness < 240) qualityFactors.push(25);
    else qualityFactors.push(10);
    if (result.contrast > 30) qualityFactors.push(25);
    else qualityFactors.push(10);
    if (result.noiseScore < 10) qualityFactors.push(15);
    else qualityFactors.push(5);
    if (result.elaScore < 30) qualityFactors.push(10);
    else qualityFactors.push(2);

    result.qualityScore = qualityFactors.reduce((s, v) => s + v, 0);

    const forgeryFactors = [];
    if (result.isBlurred) forgeryFactors.push(20);
    if (result.elaScore > 30) forgeryFactors.push(25);
    if (result.compressionScore > 70) forgeryFactors.push(15);
    if (result.noiseScore > 15) forgeryFactors.push(10);

    const totalForgery = forgeryFactors.reduce((s, v) => s + v, 0);
    result.forgeryProbability = Math.min(100, totalForgery);
    result.isEdited = result.forgeryProbability > 50;

    const rawScore = result.qualityScore;
    result.imageScore = Math.min(100, Math.max(0, rawScore));

    result.checks = {
      resolutionOk: width >= 200 && height >= 200,
      aspectRatioOk: result.aspectRatio >= 0.3 && result.aspectRatio <= 2.5,
      notBlurred: !result.isBlurred,
      notCropped: !result.isCropped,
      goodBrightness: result.brightness > 20 && result.brightness < 240,
      goodContrast: result.contrast > 30,
      lowNoise: result.noiseScore < 15,
      lowElaScore: result.elaScore < 30,
    };

    log(`Image score: ${result.imageScore}, edited: ${result.isEdited}, quality: ${result.qualityScore}`);
  } catch (err) {
    log(`Error: ${err.message}`);
    result.issues.push(`Analysis error: ${err.message}`);
  }

  result.processingTime = Date.now() - tStart;
  return result;
}

async function computeELAScore(img, width, height) {
  try {
    const quality = 85;
    const buf = await img.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    const recompressed = await Jimp.read(buf);

    let diffSum = 0;
    let count = 0;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 80));

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const idx1 = img.getPixelIndex(x, y);
        const idx2 = recompressed.getPixelIndex(x, y);
        const dr = Math.abs(img.bitmap.data[idx1] - recompressed.bitmap.data[idx2]);
        const dg = Math.abs(img.bitmap.data[idx1 + 1] - recompressed.bitmap.data[idx2 + 1]);
        const db = Math.abs(img.bitmap.data[idx1 + 2] - recompressed.bitmap.data[idx2 + 2]);
        diffSum += (dr + dg + db) / 3;
        count++;
      }
    }

    const avgDiff = count > 0 ? diffSum / count : 0;
    return Math.min(100, Math.round(avgDiff * 2));
  } catch {
    return 0;
  }
}

module.exports = { analyzeImageIntegrity };
