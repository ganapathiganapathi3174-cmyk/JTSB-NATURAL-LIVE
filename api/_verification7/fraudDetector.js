const C = require('./config.js');
const crypto = require('crypto');

function detectBlur(imageBuffer) {
  try {
    const pixels = [];
    for (let i = 0; i < Math.min(imageBuffer.length, 10000); i++) {
      pixels.push(imageBuffer[i]);
    }
    if (pixels.length < 2) return { isBlurred: false, blurScore: 0 };
    const mean = pixels.reduce((s, v) => s + v, 0) / pixels.length;
    const variance = pixels.reduce((s, v) => s + (v - mean) ** 2, 0) / pixels.length;
    const isBlurred = variance < C.BLUR_THRESHOLD;
    return { isBlurred, blurScore: Math.round(variance) };
  } catch (e) {
    return { isBlurred: false, blurScore: 0, error: e.message };
  }
}

function detect(imageBuffer, normalized, userId, recentSubmissions) {
  const flags = [];
  let score = 0;

  const blur = detectBlur(imageBuffer);
  if (blur.isBlurred) { flags.push('blurred_image'); score += 20; }

  if (imageBuffer.length < 5000) { flags.push('image_too_small'); score += 15; }

  if (normalized.amount !== null && !C.ALLOWED_AMOUNTS.includes(normalized.amount)) {
    flags.push('unusual_amount:' + normalized.amount);
    score += 10;
  }

  if (recentSubmissions && recentSubmissions > C.MAX_RAPID_SUBMISSIONS) {
    flags.push('rapid_submissions:' + recentSubmissions);
    score += 20;
  }

  if (!normalized.name && !normalized.upi) {
    flags.push('no_receiver_identifier');
    score += 10;
  }

  const finalScore = Math.min(score, C.FRAUD_SCORE_MAX);
  return {
    score: finalScore,
    flags,
    blur,
    risk: finalScore >= C.FRAUD_HIGH_RISK_THRESHOLD ? 'high' : finalScore >= C.FRAUD_MEDIUM_RISK_THRESHOLD ? 'medium' : 'low',
  };
}

module.exports = { detect, detectBlur };
