const { Jimp } = require('jimp');

const APP_SIGNATURES = {
  'Google Pay': {
    primaryColor: '#1A73E8',
    secondaryColor: '#FFFFFF',
    accentColor: '#34A853',
    layoutHints: ['card', 'clean', 'minimal', 'google'],
    headerPattern: ['google pay', 'gpay'],
    successBanner: ['paid', 'success', 'completed'],
    navBar: ['home', 'scan', 'history'],
    uiElements: ['upi id', 'bank account'],
  },
  'PhonePe': {
    primaryColor: '#7C3AED',
    secondaryColor: '#FFFFFF',
    accentColor: '#F59E0B',
    layoutHints: ['compact', 'detailed', 'purple'],
    headerPattern: ['phonepe'],
    successBanner: ['payment successful', 'paid'],
    navBar: ['home', 'pay', 'history', 'profile'],
    uiElements: ['phonepe number', 'upi id'],
  },
  'Paytm': {
    primaryColor: '#00BAF2',
    secondaryColor: '#FFFFFF',
    accentColor: '#002970',
    layoutHints: ['card', 'blue', 'paytm'],
    headerPattern: ['paytm', 'paytm payment'],
    successBanner: ['payment success', 'paid'],
    navBar: ['home', 'pay', 'history', 'profile'],
    uiElements: ['paytm id', 'wallet'],
  },
  'BHIM': {
    primaryColor: '#FF9933',
    secondaryColor: '#FFFFFF',
    accentColor: '#138808',
    layoutHints: ['simple', 'government', 'saffron'],
    headerPattern: ['bhim', 'bharat interface for money'],
    successBanner: ['paid successfully', 'success'],
    navBar: ['home', 'pay', 'history', 'profile'],
    uiElements: ['bhim id', 'vpa'],
  },
  'Amazon Pay': {
    primaryColor: '#FF9900',
    secondaryColor: '#232F3E',
    accentColor: '#FFFFFF',
    layoutHints: ['clean', 'amazon', 'orange'],
    headerPattern: ['amazon pay', 'amazon'],
    successBanner: ['paid', 'successful'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['amazon id', 'vpa'],
  },
  'WhatsApp Pay': {
    primaryColor: '#25D366',
    secondaryColor: '#075E54',
    accentColor: '#128C7E',
    layoutHints: ['chat', 'green', 'minimal'],
    headerPattern: ['whatsapp', 'payment'],
    successBanner: ['payment sent', 'paid'],
    navBar: ['chats', 'status', 'calls'],
    uiElements: ['phone number'],
  },
  'CRED': {
    primaryColor: '#1A1A2E',
    secondaryColor: '#16213E',
    accentColor: '#0F3460',
    layoutHints: ['dark', 'modern', 'premium'],
    headerPattern: ['cred', 'cred pay'],
    successBanner: ['paid', 'cleared'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['cred id'],
  },
  'Mobikwik': {
    primaryColor: '#FC427B',
    secondaryColor: '#FFFFFF',
    accentColor: '#2D3436',
    layoutHints: ['pink', 'wallet'],
    headerPattern: ['mobikwik'],
    successBanner: ['payment success', 'paid'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['mobikwik id', 'wallet'],
  },
  'Axis Pay': {
    primaryColor: '#970044',
    secondaryColor: '#FFFFFF',
    accentColor: '#EAA200',
    layoutHints: ['red', 'maroon', 'banking'],
    headerPattern: ['axis', 'axis pay'],
    successBanner: ['paid', 'successful'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['axis bank', 'upi'],
  },
  'HDFC PayZapp': {
    primaryColor: '#E4002B',
    secondaryColor: '#FFFFFF',
    accentColor: '#004C97',
    layoutHints: ['red', 'white', 'banking'],
    headerPattern: ['payzapp', 'hdfc', 'hdfc payzapp'],
    successBanner: ['paid', 'payment success'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['hdfc', 'upi'],
  },
  'SBI YONO': {
    primaryColor: '#1A237E',
    secondaryColor: '#FFFFFF',
    accentColor: '#FFD600',
    layoutHints: ['blue', 'yellow', 'banking'],
    headerPattern: ['yono', 'sbi', 'state bank'],
    successBanner: ['paid', 'success', 'debited'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['sbi', 'yono'],
  },
  'ICICI Pockets': {
    primaryColor: '#F58220',
    secondaryColor: '#FFFFFF',
    accentColor: '#9D9D9D',
    layoutHints: ['orange', 'banking'],
    headerPattern: ['icici', 'pockets', 'icici pockets'],
    successBanner: ['paid', 'successful'],
    navBar: ['home', 'pay', 'history'],
    uiElements: ['icici', 'pockets'],
  },
};

const UPI_COLORS = ['#1A73E8', '#7C3AED', '#00BAF2', '#FF9933', '#FF9900', '#25D366', '#FC427B', '#970044', '#E4002B', '#1A237E', '#F58220'];

const SUCCESS_INDICATOR_COLORS = ['#34A853', '#4CAF50', '#2E7D32', '#138808', '#00C853'];
const FAILURE_INDICATOR_COLORS = ['#EA4335', '#F44336', '#C62828', '#D32F2F'];
const WARNING_INDICATOR_COLORS = ['#FBBC04', '#FFC107', '#F57F17', '#FF9800'];

function extractDominantColors(image, numColors) {
  numColors = numColors || 8;
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const colorMap = {};
  const step = Math.max(1, Math.floor(Math.min(w, h) / 100));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4;
      const r = Math.round(data[idx] / 32) * 32;
      const g = Math.round(data[idx + 1] / 32) * 32;
      const b = Math.round(data[idx + 2] / 32) * 32;
      const key = r + ',' + g + ',' + b;
      colorMap[key] = (colorMap[key] || 0) + 1;
    }
  }

  const sorted = Object.entries(colorMap)
    .map(([key, count]) => ({ color: key, count }))
    .sort((a, b) => b.count - a.count);

  const total = sorted.reduce((s, c) => s + c.count, 0);

  return sorted.slice(0, numColors).map(c => {
    const [r, g, b] = c.color.split(',').map(Number);
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    return { color: c.color, hex, r, g, b, ratio: Math.round((c.count / total) * 1000) / 1000 };
  });
}

function colorDistance(c1, c2) {
  return Math.sqrt(
    Math.pow(c1[0] - c2[0], 2) +
    Math.pow(c1[1] - c2[1], 2) +
    Math.pow(c1[2] - c2[2], 2)
  );
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0, 0, 0];
}

function interpolateColor(hex1, hex2, ratio) {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  return [
    Math.round(c1[0] * (1 - ratio) + c2[0] * ratio),
    Math.round(c1[1] * (1 - ratio) + c2[1] * ratio),
    Math.round(c1[2] * (1 - ratio) + c2[2] * ratio),
  ];
}

function detectAppByColorPalette(dominantColors) {
  const rgbColors = dominantColors.map(c => [c.r, c.g, c.b]);

  let bestMatch = null;
  let bestScore = 0;

  for (const [appName, sig] of Object.entries(APP_SIGNATURES)) {
    let score = 0;
    const primaryRgb = hexToRgb(sig.primaryColor);
    const secondaryRgb = hexToRgb(sig.secondaryColor);
    const accentRgb = hexToRgb(sig.accentColor);

    for (const dc of rgbColors) {
      const dPrimary = colorDistance(dc, primaryRgb);
      const dSecondary = colorDistance(dc, secondaryRgb);
      const dAccent = colorDistance(dc, accentRgb);

      if (dPrimary < 60) score += 25;
      else if (dPrimary < 100) score += 15;
      if (dSecondary < 60) score += 15;
      else if (dSecondary < 100) score += 8;
      if (dAccent < 60) score += 10;
      else if (dAccent < 100) score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = appName;
    }
  }

  return { detectedApp: bestMatch, appColorConfidence: Math.min(100, bestScore) };
}

function analyzeLayoutStructure(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const horizontalEdges = [];
  const step = Math.max(1, Math.floor(h / 200));

  for (let y = 1; y < h - 1; y += step) {
    let edgeCount = 0;
    for (let x = 1; x < w - 1; x += 2) {
      const idx = (y * w + x) * 4;
      const idxUp = ((y - 1) * w + x) * 4;
      const idxDown = ((y + 1) * w + x) * 4;
      const diffUp = Math.abs(data[idx] - data[idxUp]) + Math.abs(data[idx + 1] - data[idxUp + 1]) + Math.abs(data[idx + 2] - data[idxUp + 2]);
      const diffDown = Math.abs(data[idx] - data[idxDown]) + Math.abs(data[idx + 1] - data[idxDown + 1]) + Math.abs(data[idx + 2] - data[idxDown + 2]);
      if (diffUp > 80 || diffDown > 80) edgeCount++;
    }
    horizontalEdges.push({ y, edgeRatio: edgeCount / (w / 2) });
  }

  const strongEdges = horizontalEdges.filter(e => e.edgeRatio > 0.3);
  const topEdge = strongEdges.length > 0 ? strongEdges[0] : null;
  const bottomEdge = strongEdges.length > 0 ? strongEdges[strongEdges.length - 1] : null;

  const topSectionEnd = topEdge ? topEdge.y : Math.floor(h * 0.15);
  const bottomSectionStart = bottomEdge ? bottomEdge.y : Math.floor(h * 0.88);

  const headerHeight = topSectionEnd;
  const footerHeight = h - bottomSectionStart;
  const contentHeight = bottomSectionStart - topSectionEnd;

  const hasHeader = headerHeight > h * 0.04;
  const hasFooter = footerHeight > h * 0.04;
  const hasContentRegion = contentHeight > h * 0.3;

  return {
    headerRatio: headerHeight / h,
    footerRatio: footerHeight / h,
    contentRatio: contentHeight / h,
    hasHeader,
    hasFooter,
    hasContentRegion,
    totalStrongEdges: strongEdges.length,
    structureScore: (hasHeader ? 20 : 0) + (hasContentRegion ? 40 : 0) + (hasFooter ? 20 : 0),
  };
}

function detectStatusBanner(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const bannerRegions = [];
  const scanHeight = Math.floor(h * 0.35);
  const startY = Math.floor(h * 0.3);

  const successColors = SUCCESS_INDICATOR_COLORS.map(hexToRgb);
  const failureColors = FAILURE_INDICATOR_COLORS.map(hexToRgb);
  const warningColors = WARNING_INDICATOR_COLORS.map(hexToRgb);

  for (let y = startY; y < startY + scanHeight; y += 2) {
    let successPixels = 0;
    let failurePixels = 0;
    let warningPixels = 0;
    let totalChecked = 0;

    for (let x = 0; x < w; x += 2) {
      const idx = (y * w + x) * 4;
      const pixelRgb = [data[idx], data[idx + 1], data[idx + 2]];

      for (const sc of successColors) {
        if (colorDistance(pixelRgb, sc) < 40) { successPixels++; break; }
      }
      for (const fc of failureColors) {
        if (colorDistance(pixelRgb, fc) < 40) { failurePixels++; break; }
      }
      for (const wc of warningColors) {
        if (colorDistance(pixelRgb, wc) < 40) { warningPixels++; break; }
      }
      totalChecked++;
    }

    if (totalChecked > 0) {
      const sRatio = successPixels / totalChecked;
      const fRatio = failurePixels / totalChecked;
      const wRatio = warningPixels / totalChecked;
      if (sRatio > 0.15 || fRatio > 0.15 || wRatio > 0.15) {
        bannerRegions.push({ y, successRatio: sRatio, failureRatio: fRatio, warningRatio: wRatio });
      }
    }
  }

  let status = null;
  let statusConfidence = 0;
  if (bannerRegions.length > 0) {
    const avgSuccess = bannerRegions.reduce((s, b) => s + b.successRatio, 0) / bannerRegions.length;
    const avgFailure = bannerRegions.reduce((s, b) => s + b.failureRatio, 0) / bannerRegions.length;
    const avgWarning = bannerRegions.reduce((s, b) => s + b.warningRatio, 0) / bannerRegions.length;

    if (avgSuccess > avgFailure && avgSuccess > avgWarning) {
      status = 'success';
      statusConfidence = Math.min(100, Math.round(avgSuccess * 200));
    } else if (avgFailure > avgSuccess && avgFailure > avgWarning) {
      status = 'failure';
      statusConfidence = Math.min(100, Math.round(avgFailure * 200));
    } else if (avgWarning > avgSuccess && avgWarning > avgFailure) {
      status = 'warning';
      statusConfidence = Math.min(100, Math.round(avgWarning * 200));
    }
  }

  return { status, confidence: statusConfidence, bannerCount: bannerRegions.length };
}

function detectSuccessIndicators(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const greenRange = { rMin: 0, rMax: 80, gMin: 150, gMax: 255, bMin: 0, bMax: 100 };
  let greenCheckPixels = 0;
  let totalCheckPixels = 0;

  const checkRegionStart = Math.floor(h * 0.2);
  const checkRegionEnd = Math.floor(h * 0.6);

  for (let y = checkRegionStart; y < checkRegionEnd; y += 2) {
    for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x += 2) {
      const idx = (y * w + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (r >= greenRange.rMin && r <= greenRange.rMax &&
          g >= greenRange.gMin && g <= greenRange.gMax &&
          b >= greenRange.bMin && b <= greenRange.bMax) {
        greenCheckPixels++;
      }
      totalCheckPixels++;
    }
  }

  const greenRatio = totalCheckPixels > 0 ? greenCheckPixels / totalCheckPixels : 0;
  const hasGreenIndicator = greenRatio > 0.05;

  let darkGreenRatio = 0;
  let greenClusterSize = 0;
  if (hasGreenIndicator) {
    for (let y = checkRegionStart; y < checkRegionEnd; y += 4) {
      let clusterCount = 0;
      for (let x = Math.floor(w * 0.3); x < Math.floor(w * 0.7); x += 2) {
        const idx = (y * w + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        if (r < 80 && g > 180 && b < 80) {
          clusterCount++;
        } else if (clusterCount > 5) {
          greenClusterSize = Math.max(greenClusterSize, clusterCount);
          clusterCount = 0;
        }
      }
    }
  }

  return {
    hasSuccessIndicator: hasGreenIndicator,
    successIndicatorConfidence: hasGreenIndicator ? Math.min(100, Math.round(greenRatio * 500 + (greenClusterSize > 10 ? 20 : 0))) : 0,
    greenPixelRatio: Math.round(greenRatio * 1000) / 1000,
    greenClusterMaxSize: greenClusterSize,
  };
}

function detectUPILogo(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  let upiColorPixels = 0;
  let totalChecked = 0;

  const upiGreen = hexToRgb('#34A853');
  const upiBlue = hexToRgb('#4285F4');

  for (let y = Math.floor(h * 0.02); y < Math.floor(h * 0.2); y += 2) {
    for (let x = Math.floor(w * 0.7); x < w; x += 2) {
      const idx = (y * w + x) * 4;
      const pixelRgb = [data[idx], data[idx + 1], data[idx + 2]];
      const dGreen = colorDistance(pixelRgb, upiGreen);
      const dBlue = colorDistance(pixelRgb, upiBlue);
      if (dGreen < 50 || dBlue < 50) upiColorPixels++;
      totalChecked++;
    }
  }

  const upiRatio = totalChecked > 0 ? upiColorPixels / totalChecked : 0;
  return {
    detected: upiRatio > 0.02,
    confidence: Math.min(100, Math.round(upiRatio * 500)),
    pixelRatio: Math.round(upiRatio * 1000) / 1000,
  };
}

function detectTextOverlay(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  let anomalyCount = 0;
  let totalChecked = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 200));

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const idx = (y * w + x) * 4;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const idxLeft = (y * w + (x - 1)) * 4;
      const idxRight = (y * w + (x + 1)) * 4;
      const dx = Math.abs(data[idxLeft] - data[idxRight]) + Math.abs(data[idxLeft + 1] - data[idxRight + 1]) + Math.abs(data[idxLeft + 2] - data[idxRight + 2]);
      const idxUp = ((y - 1) * w + x) * 4;
      const idxDown = ((y + 1) * w + x) * 4;
      const dy = Math.abs(data[idxUp] - data[idxDown]) + Math.abs(data[idxUp + 1] - data[idxDown + 1]) + Math.abs(data[idxUp + 2] - data[idxDown + 2]);
      const gradientMag = Math.sqrt(dx * dx + dy * dy);

      if (gradientMag > 200 && (brightness > 240 || brightness < 15)) {
        const idxR = (y * w + (x + 3)) * 4;
        const idxL = (y * w + (x - 3)) * 4;
        const surroundAvg = (
          (data[idxL] + data[idxL + 1] + data[idxL + 2]) +
          (data[idxR] + data[idxR + 1] + data[idxR + 2])
        ) / 6;
        const contrast = Math.abs(brightness - surroundAvg);
        if (contrast > 200 && gradientMag > 300) {
          anomalyCount++;
        }
      }
      totalChecked++;
    }
  }

  const anomalyRatio = totalChecked > 0 ? anomalyCount / totalChecked : 0;

  return {
    overlayScore: Math.min(100, Math.round(anomalyRatio * 1000)),
    anomalyRatio: Math.round(anomalyRatio * 10000) / 10000,
    detected: anomalyRatio > 0.005,
  };
}

function detectPixelRepeat(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const step = Math.max(1, Math.floor(Math.min(w, h) / 150));
  let repeatScore = 0;
  let totalComparisons = 0;

  for (let y = step; y < h - step * 2; y += step * 4) {
    for (let x = step; x < w - step * 2; x += step * 4) {
      let matchCount = 0;
      let compareCount = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const idx1 = ((y + dy) * w + (x + dx)) * 4;
          const idx2 = ((y + dy + step) * w + (x + dx + step)) * 4;
          const diff = Math.abs(data[idx1] - data[idx2]) + Math.abs(data[idx1 + 1] - data[idx2 + 1]) + Math.abs(data[idx1 + 2] - data[idx2 + 2]);
          if (diff < 10) matchCount++;
          compareCount++;
        }
      }
      if (compareCount > 0 && matchCount / compareCount > 0.9) {
        repeatScore++;
      }
      totalComparisons++;
    }
  }

  const repeatRatio = totalComparisons > 0 ? repeatScore / totalComparisons : 0;

  return {
    repeatRatio: Math.round(repeatRatio * 10000) / 10000,
    tamperScore: Math.min(100, Math.round(repeatRatio * 500)),
    detected: repeatRatio > 0.1,
  };
}

function detectCompressionMismatch(image, fileSize) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  const gridSize = 32;
  const regions = [];

  for (let gy = 0; gy < Math.floor(h / gridSize); gy++) {
    for (let gx = 0; gx < Math.floor(w / gridSize); gx++) {
      let sumDiff = 0;
      let count = 0;
      for (let y = gy * gridSize; y < (gy + 1) * gridSize - 1; y += 2) {
        for (let x = gx * gridSize; x < (gx + 1) * gridSize - 1; x += 2) {
          const idx = (y * w + x) * 4;
          const idxR = (y * w + x + 1) * 4;
          const idxD = ((y + 1) * w + x) * 4;
          const diff = Math.abs(data[idx] - data[idxR]) + Math.abs(data[idx + 2] - data[idxD + 2]);
          sumDiff += diff;
          count++;
        }
      }
      regions.push({
        gx, gy,
        avgDiff: count > 0 ? sumDiff / count : 0,
        x: gx * gridSize, y: gy * gridSize,
      });
    }
  }

  if (regions.length < 4) return { mismatchScore: 0, detected: false };

  const diffs = regions.map(r => r.avgDiff);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const variance = diffs.reduce((s, d) => s + (d - mean) * (d - mean), 0) / diffs.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  const outlierRegions = regions.filter(r => Math.abs(r.avgDiff - mean) > stdDev * 2).length;
  const outlierRatio = outlierRegions / regions.length;

  return {
    mismatchScore: Math.min(100, Math.round(cv * 100)),
    coefficientOfVariation: Math.round(cv * 100) / 100,
    outlierRatio: Math.round(outlierRatio * 100) / 100,
    detected: cv > 0.5 && outlierRatio > 0.1,
  };
}

function detectAIGeneration(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const data = image.bitmap.data;

  let smoothScore = 0;
  let totalChecked = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 150));

  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const idx = (y * w + x) * 4;
      const leftIdx = (y * w + (x - 1)) * 4;
      const rightIdx = (y * w + (x + 1)) * 4;
      const upIdx = ((y - 1) * w + x) * 4;
      const downIdx = ((y + 1) * w + x) * 4;

      const dx = Math.abs(data[idx] - data[rightIdx]) + Math.abs(data[idx + 1] - data[rightIdx + 1]) + Math.abs(data[idx + 2] - data[rightIdx + 2]);
      const dy = Math.abs(data[idx] - data[downIdx]) + Math.abs(data[idx + 1] - data[downIdx + 1]) + Math.abs(data[idx + 2] - data[downIdx + 2]);

      const gradMag = Math.sqrt(dx * dx + dy * dy);
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      if (brightness > 20 && brightness < 235 && gradMag < 3) {
        smoothScore++;
      }
      totalChecked++;
    }
  }

  const smoothRatio = totalChecked > 0 ? smoothScore / totalChecked : 0;

  let edgeConsistencyScore = 0;
  let edgeTotal = 0;
  for (let y = step; y < h - step; y += step * 2) {
    for (let x = step; x < w - step; x += step * 2) {
      const idx = (y * w + x) * 4;
      const leftIdx = (y * w + (x - 2)) * 4;
      const rightIdx = (y * w + (x + 2)) * 4;
      const dx = Math.abs(data[leftIdx] - data[rightIdx]);
      const dy = Math.abs(data[((y - 2) * w + x) * 4] - data[((y + 2) * w + x) * 4]);
      if (dx > 100 && dy > 100) {
        edgeConsistencyScore++;
      }
      edgeTotal++;
    }
  }

  const edgeRatio = edgeTotal > 0 ? edgeConsistencyScore / edgeTotal : 0;

  const unnaturalSmoothness = smoothRatio > 0.6;
  const unnaturalEdges = edgeRatio > 0.4;

  let aiScore = 0;
  if (unnaturalSmoothness) aiScore += 40;
  if (unnaturalEdges) aiScore += 30;
  if (smoothRatio > 0.75) aiScore += 20;

  return {
    aiGenerationScore: Math.min(100, aiScore),
    smoothRatio: Math.round(smoothRatio * 100) / 100,
    edgeConsistencyRatio: Math.round(edgeRatio * 100) / 100,
    detected: aiScore > 50,
  };
}

async function analyzeVisualAuthenticity(buffer) {
  const result = {
    detectedApp: null,
    appColorConfidence: 0,
    visualAuthenticityScore: 0,
    hasUPILogo: false,
    upiLogoConfidence: 0,
    hasSuccessIndicator: false,
    successIndicatorConfidence: 0,
    statusBanner: { status: null, confidence: 0, bannerCount: 0 },
    dominantColors: [],
    layoutScore: 0,
    tamperingScore: 0,
    tamperingReasons: [],
    confidence: 0,
    uiMatchScore: 0,
    details: {},
  };

  try {
    const image = await Jimp.read(buffer);
    if (!image || !image.bitmap) return result;

    const dominantColors = extractDominantColors(image, 10);
    result.dominantColors = dominantColors;

    const appDetection = detectAppByColorPalette(dominantColors);
    result.detectedApp = appDetection.detectedApp;
    result.appColorConfidence = appDetection.appColorConfidence;

    const upiLogo = detectUPILogo(image);
    result.hasUPILogo = upiLogo.detected;
    result.upiLogoConfidence = upiLogo.confidence;

    const successIndicators = detectSuccessIndicators(image);
    result.hasSuccessIndicator = successIndicators.hasSuccessIndicator;
    result.successIndicatorConfidence = successIndicators.successIndicatorConfidence;

    const statusBanner = detectStatusBanner(image);
    result.statusBanner = statusBanner;

    const layout = analyzeLayoutStructure(image);
    result.layoutScore = layout.structureScore;

    const textOverlay = detectTextOverlay(image);
    const pixelRepeat = detectPixelRepeat(image);
    const compressionMismatch = detectCompressionMismatch(image, buffer.length);
    const aiGeneration = detectAIGeneration(image);

    let tamperingScore = 0;
    const tamperingReasons = [];

    if (textOverlay.detected) {
      tamperingScore += 25;
      tamperingReasons.push('Text overlay artifacts (score=' + textOverlay.overlayScore + ')');
    }
    if (pixelRepeat.detected) {
      tamperingScore += 30;
      tamperingReasons.push('Repeated pixel regions detected (repeatRatio=' + pixelRepeat.repeatRatio + ')');
    }
    if (compressionMismatch.detected) {
      tamperingScore += 20;
      tamperingReasons.push('Compression mismatch between regions (cv=' + compressionMismatch.coefficientOfVariation + ')');
    }
    if (aiGeneration.detected) {
      tamperingScore += 35;
      tamperingReasons.push('Possible AI generation artifacts (score=' + aiGeneration.aiGenerationScore + ')');
    }

    result.tamperingScore = Math.min(100, tamperingScore);
    result.tamperingReasons = tamperingReasons;

    let uiScore = 0;
    uiScore += result.appColorConfidence > 50 ? 20 : (result.appColorConfidence > 20 ? 10 : 0);
    uiScore += result.hasUPILogo ? 15 : 0;
    uiScore += result.upiLogoConfidence > 50 ? 5 : 0;
    uiScore += result.hasSuccessIndicator ? 12 : 0;
    uiScore += statusBanner.status ? 8 : 0;
    uiScore += Math.min(20, Math.round(result.layoutScore / 4));
    uiScore += result.appColorConfidence > 70 ? 10 : (result.appColorConfidence > 40 ? 5 : 0);
    uiScore = Math.min(100, uiScore);

    result.uiMatchScore = uiScore;
    result.visualAuthenticityScore = Math.max(0, Math.min(100, uiScore - (result.tamperingScore > 30 ? 20 : 0)));
    result.confidence = result.visualAuthenticityScore;

    result.details = {
      dominantColorCount: dominantColors.length,
      appsTested: Object.keys(APP_SIGNATURES).length,
      textOverlay,
      pixelRepeat,
      compressionMismatch,
      aiGeneration,
    };

  } catch (e) {
    result.tamperingReasons.push('Visual analysis error: ' + e.message);
    result.visualAuthenticityScore = 0;
  }

  return result;
}

module.exports = { analyzeVisualAuthenticity, extractDominantColors, detectAppByColorPalette, detectUPILogo, detectSuccessIndicators, detectStatusBanner, analyzeLayoutStructure, detectTextOverlay, detectPixelRepeat, detectCompressionMismatch, detectAIGeneration };
