const { Jimp } = require('jimp');

function laplacianVariance(image) {
  const gray = image.clone();
  gray.greyscale();
  const w = gray.bitmap.width;
  const h = gray.bitmap.height;
  const data = gray.bitmap.data;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  const kernel = [0, 1, 0, 1, -4, 1, 0, 1, 0];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let laplacian = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          laplacian += data[idx] * kernel[ki++];
        }
      }
      laplacian = Math.abs(laplacian);
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance;
}

function sobelAngles(image) {
  const gray = image.clone();
  gray.greyscale();
  const w = gray.bitmap.width;
  const h = gray.bitmap.height;
  const data = gray.bitmap.data;

  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  const angles = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 100));

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      let gx = 0;
      let gy = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const val = data[idx];
          gx += val * sobelX[ki];
          gy += val * sobelY[ki];
          ki++;
        }
      }
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag > 30) {
        let angle = Math.atan2(gy, gx) * (180 / Math.PI);
        if (angle < 0) angle += 180;
        angles.push(angle);
      }
    }
  }

  return angles;
}

function detectRotationDegrees(angles) {
  if (angles.length < 50) return 0;

  const sorted = angles.slice().sort((a, b) => a - b);
  const modeStart = Math.floor(sorted.length * 0.4);
  const modeEnd = Math.floor(sorted.length * 0.6);
  const modeSlice = sorted.slice(modeStart, modeEnd);
  const medianAngle = modeSlice.reduce((s, a) => s + a, 0) / modeSlice.length;

  const deviation = Math.abs(medianAngle - 0);
  const deviation90 = Math.abs(medianAngle - 90);
  const deviation180 = Math.abs(medianAngle - 180);
  const minDev = Math.min(deviation, deviation90, deviation180);

  if (minDev < 5) return 0;
  if (minDev < 15) return minDev;
  return deviation;
}

function detectCropRatio(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  const edgeThreshold = 25;
  const margin = Math.max(2, Math.floor(Math.min(w, h) * 0.005));

  for (let y = 0; y < h; y++) {
    let hasContent = false;
    for (let x = 0; x < w; x += 2) {
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (brightness < 255 - edgeThreshold) { hasContent = true; break; }
    }
    if (hasContent) { top = y; break; }
  }

  for (let y = h - 1; y >= 0; y--) {
    let hasContent = false;
    for (let x = 0; x < w; x += 2) {
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (brightness < 255 - edgeThreshold) { hasContent = true; break; }
    }
    if (hasContent) { bottom = y; break; }
  }

  for (let x = 0; x < w; x++) {
    let hasContent = false;
    for (let y = top; y <= bottom; y += 2) {
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (brightness < 255 - edgeThreshold) { hasContent = true; break; }
    }
    if (hasContent) { left = x; break; }
  }

  for (let x = w - 1; x >= 0; x--) {
    let hasContent = false;
    for (let y = top; y <= bottom; y += 2) {
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (brightness < 255 - edgeThreshold) { hasContent = true; break; }
    }
    if (hasContent) { right = x; break; }
  }

  const contentW = right - left + 1;
  const contentH = bottom - top + 1;
  const expectedW = w - 2 * margin;
  const expectedH = h - 2 * margin;

  const cropRatioX = expectedW > 0 ? contentW / expectedW : 1;
  const cropRatioY = expectedH > 0 ? contentH / expectedH : 1;

  return {
    cropRatio: Math.min(cropRatioX, cropRatioY),
    contentBounds: { x: left, y: top, w: contentW, h: contentH },
    margins: { top, bottom, left, right, totalW: w, totalH: h },
  };
}

function detectScreenshotInScreenshot(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const sampleX = Math.floor(w * 0.15);
  let borderScore = 0;
  const borderSamples = 50;

  for (let i = 0; i < borderSamples; i++) {
    const y = Math.floor(h * (0.05 + 0.9 * i / borderSamples));
    const idx = (y * w + sampleX) * 4;
    const idx2 = (y * w + sampleX + 1) * 4;
    const diff = Math.abs(data[idx] - data[idx2]) + Math.abs(data[idx + 1] - data[idx2 + 1]) + Math.abs(data[idx + 2] - data[idx2 + 2]);
    if (diff > 100) borderScore++;
  }

  const cornerSize = Math.floor(Math.min(w, h) * 0.08);
  let darkPixels = 0;
  let totalPixels = 0;

  for (let y = 0; y < cornerSize; y++) {
    for (let x = 0; x < cornerSize; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] < 40 && data[idx + 1] < 40 && data[idx + 2] < 40) darkPixels++;
      totalPixels++;
    }
    for (let x = w - cornerSize; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] < 40 && data[idx + 1] < 40 && data[idx + 2] < 40) darkPixels++;
      totalPixels++;
    }
  }
  for (let y = h - cornerSize; y < h; y++) {
    for (let x = 0; x < cornerSize; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] < 40 && data[idx + 1] < 40 && data[idx + 2] < 40) darkPixels++;
      totalPixels++;
    }
    for (let x = w - cornerSize; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] < 40 && data[idx + 1] < 40 && data[idx + 2] < 40) darkPixels++;
      totalPixels++;
    }
  }

  const cornerDarkScore = totalPixels > 0 ? (darkPixels / totalPixels) * 100 : 0;

  let roundedCornerCount = 0;
  for (let y = 0; y < cornerSize; y++) {
    for (let x = 0; x < cornerSize; x++) {
      const distFromCorner = Math.sqrt(x * x + y * y);
      const cornerRadius = cornerSize * 0.4;
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      if (distFromCorner > cornerRadius && brightness > 200) {
        roundedCornerCount++;
      }
    }
  }
  const totalCornerPixels = cornerSize * cornerSize;
  const hasRoundedCorners = roundedCornerCount > totalCornerPixels * 0.1;

  const hasInnerBorder = borderScore > borderSamples * 0.6;
  const hasDarkCorners = cornerDarkScore > 50;

  let confidence = 0;
  const reasons = [];
  if (hasInnerBorder) { confidence += 30; reasons.push('Inner border detected'); }
  if (hasRoundedCorners) { confidence += 25; reasons.push('Rounded corners detected'); }
  if (hasDarkCorners) { confidence += 20; reasons.push('Dark corners detected'); }

  return { detected: confidence > 30, confidence, reasons };
}

function analyzeDarkness(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  let totalBrightness = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      totalBrightness += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      count++;
    }
  }

  const avgBrightness = count > 0 ? totalBrightness / count : 127;
  let darkScore = 0;
  if (avgBrightness < 30) darkScore = 100;
  else if (avgBrightness < 60) darkScore = 80;
  else if (avgBrightness < 90) darkScore = 50;
  else if (avgBrightness < 120) darkScore = 20;

  return { avgBrightness, darkScore };
}

function detectGlare(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 150));

  let brightSpotCount = 0;
  let totalSamples = 0;

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      let localMax = 0;
      let localAvg = 0;
      let localCount = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const idx = ((y + dy) * w + (x + dx)) * 4;
          const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          localMax = Math.max(localMax, brightness);
          localAvg += brightness;
          localCount++;
        }
      }
      localAvg /= localCount;
      const idx = (y * w + x) * 4;
      const centerBrightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      if (centerBrightness > 240 && localAvg < 180) {
        brightSpotCount++;
      }
      totalSamples++;
    }
  }

  const glareRatio = totalSamples > 0 ? brightSpotCount / totalSamples : 0;
  let glareScore = 0;
  if (glareRatio > 0.15) glareScore = Math.min(100, Math.round(glareRatio * 200));
  else if (glareRatio > 0.08) glareScore = 50;
  else if (glareRatio > 0.03) glareScore = 20;

  return { glareScore, brightSpotRatio: Math.round(glareRatio * 1000) / 1000 };
}

function detectCompressionArtifacts(image, fileSize) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const pixels = w * h;
  const bytesPerPixel = fileSize > 0 ? (fileSize / pixels) : 0;
  let compressionScore = 0;

  if (bytesPerPixel > 0 && bytesPerPixel < 0.5) compressionScore = 80;
  else if (bytesPerPixel < 1.0) compressionScore = 50;
  else if (bytesPerPixel < 2.0) compressionScore = 20;

  let blockinessScore = 0;
  let blockSamples = 0;
  for (let y = 0; y < h - 8; y += 8) {
    for (let x = 0; x < w - 8; x += 8) {
      let hDiff = 0;
      for (let ky = 0; ky < 8; ky++) {
        const idx1 = ((y + ky) * w + (x + 7)) * 4;
        const idx2 = ((y + ky) * w + (x + 8)) * 4;
        hDiff += Math.abs(data[idx1] - data[idx2]);
      }
      if (hDiff > 300) blockinessScore++;
      blockSamples++;
    }
  }
  const blockRatio = blockSamples > 0 ? blockinessScore / blockSamples : 0;
  if (blockRatio > 0.3) compressionScore = Math.max(compressionScore, 70);

  return { compressionScore, bytesPerPixel: Math.round(bytesPerPixel * 100) / 100, blockRatio: Math.round(blockRatio * 100) / 100 };
}

async function analyzeImageQuality(buffer) {
  const result = {
    passed: true,
    blurScore: 0,
    lowResolution: false,
    rotationDegrees: 0,
    cropRatio: 1.0,
    screenshotInScreenshot: { detected: false, confidence: 0, reasons: [] },
    avgBrightness: 127,
    darkScore: 0,
    glareScore: 0,
    compressionScore: 0,
    overallGrade: 'good',
    issues: [],
    dimensions: { width: 0, height: 0 },
    warnings: [],
  };

  try {
    const image = await Jimp.read(buffer);
    if (!image || !image.bitmap) {
      result.issues.push('Could not parse image');
      result.passed = false;
      result.overallGrade = 'poor';
      return result;
    }

    result.dimensions = { width: image.bitmap.width, height: image.bitmap.height };

    if (image.bitmap.width < 200 || image.bitmap.height < 200) {
      result.lowResolution = true;
      result.issues.push('Resolution too low: ' + image.bitmap.width + 'x' + image.bitmap.height);
    }

    const blur = laplacianVariance(image);
    result.blurScore = Math.min(100, Math.max(0, Math.round((1 - blur / 500) * 100)));
    if (result.blurScore > 80) {
      result.issues.push('Very blurry screenshot (blurScore=' + result.blurScore + ')');
    } else if (result.blurScore > 60) {
      result.warnings.push('Moderate blur (blurScore=' + result.blurScore + ')');
    }

    const angles = sobelAngles(image);
    result.rotationDegrees = Math.round(detectRotationDegrees(angles) * 10) / 10;
    if (result.rotationDegrees > 15) {
      result.issues.push('Image rotated by ~' + result.rotationDegrees + ' degrees');
    }

    const cropResult = detectCropRatio(image);
    result.cropRatio = Math.round(cropResult.cropRatio * 100) / 100;
    if (result.cropRatio < 0.6) {
      result.issues.push('Heavily cropped (cropRatio=' + result.cropRatio + ')');
    } else if (result.cropRatio < 0.8) {
      result.warnings.push('Partially cropped (cropRatio=' + result.cropRatio + ')');
    }

    const sis = detectScreenshotInScreenshot(image);
    result.screenshotInScreenshot = sis;
    if (sis.detected) {
      result.warnings.push('Possible screenshot-in-screenshot (confidence=' + sis.confidence + '%)');
    }

    const darkness = analyzeDarkness(image);
    result.avgBrightness = Math.round(darkness.avgBrightness);
    result.darkScore = darkness.darkScore;
    if (result.darkScore > 70) {
      result.issues.push('Very dark image (brightness=' + result.avgBrightness.toFixed(0) + ')');
    }

    const glare = detectGlare(image);
    result.glareScore = glare.glareScore;
    if (result.glareScore > 60) {
      result.warnings.push('Glare detected (score=' + result.glareScore + ')');
    }

    const compression = detectCompressionArtifacts(image, buffer.length);
    result.compressionScore = compression.compressionScore;
    if (result.compressionScore > 70) {
      result.warnings.push('Heavy compression artifacts (score=' + result.compressionScore + ')');
    }

    const totalIssues = result.issues.length;
    const totalWarnings = result.warnings.length;

    if (totalIssues >= 2 || result.blurScore > 80 || result.darkScore > 80 || result.cropRatio < 0.5) {
      result.overallGrade = 'poor';
      result.passed = false;
    } else if (totalIssues >= 1 || totalWarnings >= 2 || result.blurScore > 60) {
      result.overallGrade = 'fair';
    } else {
      result.overallGrade = 'good';
    }

  } catch (e) {
    result.issues.push('Image analysis error: ' + e.message);
    result.passed = false;
    result.overallGrade = 'poor';
  }

  return result;
}

module.exports = { analyzeImageQuality, laplacianVariance, sobelAngles, detectRotationDegrees, detectCropRatio, detectScreenshotInScreenshot, analyzeDarkness, detectGlare, detectCompressionArtifacts };
