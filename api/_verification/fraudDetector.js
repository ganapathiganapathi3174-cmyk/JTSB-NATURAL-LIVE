const C = require('./config');
const log = require('./logger').FRAUD;

function run({ ocrText, imageInfo, ocrConfidence, strategies }) {
  const t0 = Date.now();
  let fraudScore = 0;
  const issues = [];
  const text = ocrText || '';

  if (/\b(?:PHOTOSHOP|EDITED|MODIFIED|CANVA|SNAPSEED|PICSART|ADOBE)\b/i.test(text)) {
    issues.push('Editing software name detected in OCR text');
    fraudScore += 30;
  }

  if (/\b(?:SAMPLE|DUMMY|TEST\s*PAYMENT|TEMPLATE|FAKE|DEMO)\b/i.test(text)) {
    issues.push('Suspicious keyword detected');
    fraudScore += 20;
  }

  if (/(.)\1{8,}/.test(text)) {
    issues.push('Repeated characters suggest tampered image');
    fraudScore += 10;
  }

  const lines = text.split('\n').filter(l => l.trim().length > 1);
  if (lines.length < C.MIN_TEXT_LINES) {
    issues.push('Too few text lines: ' + lines.length);
    fraudScore += 10;
  }

  const numberDensity = text.replace(/[^0-9]/g, '').length / Math.max(1, text.length);
  if (numberDensity > 0.55) {
    issues.push('Abnormal digit density: ' + numberDensity.toFixed(2));
    fraudScore += 5;
  }

  if (imageInfo) {
    if (imageInfo.tamperScore > C.TAMPER_SCORE_MAX) {
      issues.push('High tamper score: ' + imageInfo.tamperScore);
      fraudScore += 15;
    }
    if (imageInfo.tamperScore > 15) {
      fraudScore += 5;
    }
  }

  if (typeof ocrConfidence === 'number' && ocrConfidence < 30) {
    issues.push('Very low OCR confidence: ' + Math.round(ocrConfidence) + '%');
    fraudScore += 15;
  } else if (typeof ocrConfidence === 'number' && ocrConfidence < 50) {
    issues.push('Low OCR confidence: ' + Math.round(ocrConfidence) + '%');
    fraudScore += 5;
  }

  fraudScore = Math.min(fraudScore, 100);
  let riskLevel = 'low';
  if (fraudScore >= C.FRAUD_THRESHOLD_HIGH) riskLevel = 'high';
  else if (fraudScore >= C.FRAUD_THRESHOLD_MEDIUM) riskLevel = 'medium';

  log.info('Fraud: score=' + fraudScore + ' risk=' + riskLevel + ' flags=' + issues.length + ' (' + (Date.now() - t0) + 'ms)');
  return { fraudScore, riskLevel, issues, duration: Date.now() - t0 };
}

module.exports = { run };