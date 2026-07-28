const C = require('./config');
const log = require('./logger').DECIDE;

function run(validationResult, fraudResult, duplicateResult, ocrConfidence) {
  const t0 = Date.now();
  const vm = validationResult.validationMap || {};
  const reasons = [];
  const { hardFailures, softFailures } = validationResult;

  const isDuplicate = !!(duplicateResult && duplicateResult.isDuplicate);
  const isFraudHigh = fraudResult && fraudResult.fraudScore >= C.FRAUD_THRESHOLD_HIGH;
  const validConfidence = typeof ocrConfidence === 'number' && !isNaN(ocrConfidence);

  // ── BUSINESS RULES FIRST ──
  // Any hard failure → immediate REJECT (wrong amount, UPI, status, date, UTR, etc.)
  if (hardFailures > 0) {
    for (const [field, check] of Object.entries(vm)) {
      if (!check.passed) reasons.push(check.reason);
    }
    log.info('DECISION: REJECTED (' + hardFailures + ' hard business rule failures)');
    return makeDecision('REJECTED', C.REJECTED_STATUS, 0, reasons, t0);
  }

  // Duplicate → REJECT
  if (isDuplicate) {
    reasons.push('Duplicate payment detected');
    log.info('DECISION: REJECTED (duplicate)');
    return makeDecision('REJECTED', C.REJECTED_STATUS, 0, reasons, t0);
  }

  // Fraud → REJECT
  if (isFraudHigh) {
    reasons.push('Fraud indicators detected (score=' + fraudResult.fraudScore + ')');
    log.info('DECISION: REJECTED (fraud)');
    return makeDecision('REJECTED', C.REJECTED_STATUS, 0, reasons, t0);
  }

  // ── CONFIDENCE EVALUATION ──
  // All business rules pass. Confidence only affects routing:
  //   Low confidence → MANUAL_REVIEW (never reject)
  //   Acceptable confidence → APPROVE
  const score = validConfidence ? Math.min(100, Math.max(0, Math.round(ocrConfidence))) : 0;

  if (softFailures > 0) {
    for (const [field, check] of Object.entries(vm)) {
      if (!check.passed) reasons.push(check.reason);
    }
    log.info('DECISION: MANUAL_REVIEW (soft=' + softFailures + ' business rules need review)');
    return makeDecision('MANUAL_REVIEW', C.MANUAL_REVIEW_STATUS, score, reasons, t0);
  }

  if (!validConfidence || ocrConfidence < C.CONFIDENCE_AUTO_APPROVE) {
    reasons.push('Business rules passed but OCR quality needs review (confidence=' + Math.round(ocrConfidence || 0) + '%)');
    log.info('DECISION: MANUAL_REVIEW (business pass, conf=' + Math.round(ocrConfidence || 0) + '% < ' + C.CONFIDENCE_AUTO_APPROVE + ')');
    return makeDecision('MANUAL_REVIEW', C.MANUAL_REVIEW_STATUS, score, reasons, t0);
  }

  // All business rules pass + confidence acceptable → APPROVE
  reasons.push('All business validations passed');
  reasons.push('No duplicate detected');
  reasons.push('No fraud detected');
  reasons.push('Image quality acceptable (confidence=' + Math.round(ocrConfidence) + '%)');
  log.info('DECISION: APPROVED (all pass, conf=' + Math.round(ocrConfidence) + '%)');
  return makeDecision('APPROVED', C.APPROVED_STATUS, Math.min(100, score + 5), reasons, t0);
}

function makeDecision(decision, status, score, reasons, t0) {
  return { decision, status, finalScore: Math.min(100, score), reasons, duration: Date.now() - t0 };
}

module.exports = { run };