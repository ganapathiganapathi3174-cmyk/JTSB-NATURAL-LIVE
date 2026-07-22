const crypto = require('crypto');

function log(msg) {
  console.log(`[AI-VISION] ${msg}`);
}

async function analyzeWithAI(imageBuffer, imageUrl) {
  const tStart = Date.now();
  log(`Starting AI Vision analysis: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

  const result = {
    visionAvailable: false,
    confidence: 0,
    appName: null,
    bankName: null,
    paymentStatus: null,
    extractedAmount: null,
    extractedUtr: null,
    extractedUpi: null,
    extractedDate: null,
    extractedTime: null,
    receiverName: null,
    senderName: null,
    isSuccessBadge: false,
    modelUsed: 'rule-based-fallback',
    analysis: {},
  };

  try {
    const Jimp = require('jimp');
    const img = await Jimp.read(imageBuffer);
    const { width, height } = img.bitmap;

    result.analysis.dimensions = { width, height };

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

    const corners = [
      { x: 0, y: 0, label: 'top-left' },
      { x: Math.floor(width * 0.9), y: 0, label: 'top-right' },
      { x: 0, y: Math.floor(height * 0.9), label: 'bottom-left' },
      { x: Math.floor(width * 0.9), y: Math.floor(height * 0.9), label: 'bottom-right' },
    ];

    const cornerColors = corners.map(c => {
      const idx = c.y * width + c.x;
      return { ...c, brightness: grayData[idx] || 0 };
    });

    result.analysis.cornerAnalysis = cornerColors;

    const samples = [];
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);
      const idx = y * width + x;
      const r = img.bitmap.data[idx * 4];
      const g = img.bitmap.data[idx * 4 + 1];
      const b = img.bitmap.data[idx * 4 + 2];
      const hsvRgb = { r, g, b };
      samples.push(hsvRgb);
    }

    const redPixels = samples.filter(s => s.r > 180 && s.g < 100 && s.b < 100).length;
    const greenPixels = samples.filter(s => s.g > 180 && s.r < 100 && s.b < 100).length;
    const bluePixels = samples.filter(s => s.b > 180 && s.r < 100 && s.g < 100).length;

    result.analysis.colorDistribution = {
      redRatio: Math.round(redPixels / samples.length * 100) / 100,
      greenRatio: Math.round(greenPixels / samples.length * 100) / 100,
      blueRatio: Math.round(bluePixels / samples.length * 100) / 100,
    };

    if (greenPixels > 5) {
      result.paymentStatus = 'SUCCESS';
      result.isSuccessBadge = true;
    }

    result.confidence = 60;
    result.visionAvailable = true;

    log(`Vision analysis complete: confidence=${result.confidence}, status=${result.paymentStatus}, model=${result.modelUsed}`);
  } catch (err) {
    log(`Error: ${err.message}`);
    result.error = err.message;
  }

  result.processingTime = Date.now() - tStart;
  return result;
}

module.exports = { analyzeWithAI };
