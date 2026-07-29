const C = require('./config.js');

function detectFraud(extracted, imageInfo, options) {
  const result = {
    score: 0, flags: [], reasons: [],
    suspicious: false,
  };

  let signals = 0;

  if (imageInfo?.width && imageInfo?.height) {
    if (imageInfo.width < C.MIN_WIDTH || imageInfo.height < C.MIN_HEIGHT) {
      result.flags.push('low_resolution');
      result.reasons.push('Low resolution: ' + imageInfo.width + 'x' + imageInfo.height);
      signals += 20;
    }
  }

  if (imageInfo?.blurScore !== undefined && imageInfo.blurScore > 0) {
    if (imageInfo.blurScore < C.BLUR_THRESHOLD) {
      result.flags.push('blurred');
      result.reasons.push('Image appears blurry (score=' + imageInfo.blurScore + ')');
      signals += 15;
    }
  }

  if (extracted?.amount !== null && extracted?.amount !== undefined && options?.expectedAmount) {
    const diff = Math.abs(extracted.amount - options.expectedAmount);
    if (diff > 0 && diff > options.expectedAmount * 0.5) {
      result.flags.push('amount_anomaly');
      result.reasons.push('Extracted amount (' + extracted.amount + ') far from expected (' + options.expectedAmount + ')');
      signals += 10;
    }
  }

  if (!extracted?.utr || String(extracted.utr).length < 12) {
    result.flags.push('missing_utr');
    result.reasons.push('No valid UTR found');
    signals += 10;
  }

  if (!extracted?.upi_id) {
    result.flags.push('missing_upi');
    result.reasons.push('No UPI ID found');
    signals += 5;
  }

  if (extracted?.status === 'FAILED') {
    result.flags.push('failed_status');
    result.reasons.push('Payment status is FAILED');
    signals += 25;
  }

  result.score = Math.min(100, signals);
  result.suspicious = signals >= 30;

  return result;
}

module.exports = { detectFraud };
