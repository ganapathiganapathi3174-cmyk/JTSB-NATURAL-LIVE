const C = require('./config.js');

function decide(businessResult, duplicateResult, fraudResult, ocrConfidence) {
  const reasons = [];

  if (duplicateResult && duplicateResult.duplicateUtr) {
    return { status: 'rejected', confidence: 0, reasons: ['Duplicate UTR detected — payment already processed'] };
  }

  if (businessResult.hardFails.length > 0) {
    reasons.push(...businessResult.hardFails);
    return { status: 'rejected', confidence: 0, reasons };
  }

  if (duplicateResult && duplicateResult.duplicateImage) {
    reasons.push('Duplicate screenshot detected');
  }

  if (fraudResult && fraudResult.score >= C.FRAUD_HIGH_RISK_THRESHOLD) {
    reasons.push('High fraud risk score: ' + fraudResult.score);
    reasons.push(...fraudResult.flags);
    return { status: 'rejected', confidence: 0, reasons };
  }

  if (businessResult.softFails.length > 0) {
    reasons.push(...businessResult.softFails);
    return { status: 'manual_review', confidence: 50, reasons };
  }

  if (fraudResult && fraudResult.score >= C.FRAUD_MEDIUM_RISK_THRESHOLD) {
    reasons.push('Medium fraud risk: ' + fraudResult.score);
    reasons.push(...fraudResult.flags);
    return { status: 'manual_review', confidence: 60, reasons };
  }

  const allMandatoryPass = businessResult.amount && businessResult.upi && businessResult.status;
  if (!allMandatoryPass && !businessResult.hardFails.length) {
    reasons.push('Insufficient evidence for auto-approval');
    return { status: 'manual_review', confidence: 40, reasons };
  }

  return { status: 'verified', confidence: 90, reasons: ['All checks passed'] };
}

module.exports = { decide };
