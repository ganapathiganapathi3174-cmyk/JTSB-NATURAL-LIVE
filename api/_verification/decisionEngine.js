const C = require('./config');
const log = require('./logger').DECIDE;

function computeFinalScore(validationResult, fraudResult, ocrConfidence, authResult) {
  const weights = { ...C.WEIGHTS };
  let earned = 0;
  let totalWeight = 0;
  const validationMap = {};
  for (const check of (validationResult.checks || [])) {
    validationMap[check.name] = check;
  }
  const amountCheck = validationMap.amount;
  if (amountCheck) { totalWeight += weights.amount; if (amountCheck.passed) earned += weights.amount; }
  const receiverCheck = validationMap.receiver_upi;
  if (receiverCheck) { totalWeight += weights.receiver; if (receiverCheck.passed) earned += weights.receiver; }
  const statusCheck = validationMap.payment_status;
  if (statusCheck) { totalWeight += weights.status; if (statusCheck.passed) earned += weights.status; }
  const dateCheck = validationMap.date;
  if (dateCheck) { totalWeight += weights.date; if (dateCheck.passed) earned += weights.date; }
  const timeCheck = validationMap.time;
  if (timeCheck) { totalWeight += weights.time; if (timeCheck.passed) earned += weights.time; }
  const utrFormatCheck = validationMap.utr_format;
  if (utrFormatCheck) { totalWeight += weights.utr_valid; if (utrFormatCheck.passed) earned += weights.utr_valid; }
  const userUtrCheck = validationMap.user_utr;
  if (userUtrCheck && userUtrCheck.passed) { totalWeight += weights.utr_match; earned += weights.utr_match; }
  const ocrConfPct = Math.min(100, Math.max(0, ocrConfidence || 0));
  totalWeight += weights.ocr_confidence;
  earned += Math.round(weights.ocr_confidence * ocrConfPct / 100);
  if (authResult) {
    totalWeight += weights.authenticity;
    const authScore = authResult.passed ? 100 : Math.max(0, 100 - authResult.tamperScore);
    earned += Math.round(weights.authenticity * authScore / 100);
  }
  if (fraudResult) {
    const fraudPenalty = Math.round(weights.fraud * (fraudResult.fraudScore / 100));
    totalWeight += weights.fraud;
    earned += weights.fraud - fraudPenalty;
  }
  if (totalWeight === 0) return { score: 0, earned: 0, totalWeight: 0, pct: 0 };
  const pct = Math.round((earned / totalWeight) * 100);
  return { score: Math.min(100, Math.max(0, pct)), earned, totalWeight, pct: Math.min(100, Math.max(0, pct)) };
}

function makeDecision(validationResult, fraudResult, duplicateResult, ocrConfidence, authResult) {
  const t0 = Date.now();
  const { score: finalScore, earned, totalWeight, pct } = computeFinalScore(validationResult, fraudResult, ocrConfidence, authResult);
  const mandatoryPass = validationResult.allMandatoryPass;
  const isDuplicate = duplicateResult && duplicateResult.isDuplicate;
  const fraudHigh = fraudResult && fraudResult.fraudScore >= C.FRAUD_THRESHOLDS.high;
  const reasons = [];
  let decision, status;

  if (mandatoryPass && !isDuplicate && !fraudHigh && finalScore >= C.SCORE_THRESHOLDS.autoApprove) {
    decision = 'APPROVED';
    status = C.APPROVED_STATUS;
    reasons.push('All mandatory validations passed');
    reasons.push('Final score: ' + finalScore + '%');
    if (isDuplicate) reasons.push('Warning: UTR/screenshot duplicates found but score high enough to override');
  } else if (isDuplicate) {
    decision = 'MANUAL_REVIEW';
    status = C.MANUAL_REVIEW_STATUS;
    reasons.push('Duplicate detected: UTR/screenshot/OCR text already exists in system');
  } else if (fraudHigh) {
    decision = 'REJECTED';
    status = C.REJECTED_STATUS;
    reasons.push('High fraud score: ' + fraudResult.fraudScore + '/100');
    reasons.push(...(fraudResult.issues || []).slice(0, 3));
  } else if (finalScore >= C.SCORE_THRESHOLDS.autoApprove && mandatoryPass) {
    decision = 'APPROVED';
    status = C.APPROVED_STATUS;
    reasons.push('All mandatory checks pass, score ' + finalScore + '%');
  } else if (finalScore >= C.SCORE_THRESHOLDS.manualReview) {
    decision = 'MANUAL_REVIEW';
    status = C.MANUAL_REVIEW_STATUS;
    reasons.push('Score ' + finalScore + '% is between ' + C.SCORE_THRESHOLDS.manualReview + '-' + C.SCORE_THRESHOLDS.autoApprove + '% (needs review)');
    for (const check of (validationResult.checks || [])) {
      if (!check.passed && !check.isUserCheck) reasons.push('Failed: ' + check.name + ' — ' + check.reason);
    }
  } else {
    decision = 'REJECTED';
    status = C.REJECTED_STATUS;
    reasons.push('Score ' + finalScore + '% is below ' + C.SCORE_THRESHOLDS.manualReview + '% (auto-reject)');
    for (const check of (validationResult.checks || [])) {
      if (!check.passed && !check.isUserCheck) reasons.push('Failed: ' + check.name + ' — ' + check.reason);
    }
    if (!mandatoryPass) reasons.push('Mandatory validation failed: ' + validationResult.mandatoryPassed + '/' + validationResult.mandatoryTotal + ' passed');
  }

  log.info('', decision + ' (score=' + finalScore + '%, mandatory=' + mandatoryPass + ', dup=' + isDuplicate + ', fraud=' + (fraudResult ? fraudResult.fraudScore : 0) + ') (' + (Date.now() - t0) + 'ms)');
  return { decision, status, finalScore, reasons, duration: Date.now() - t0 };
}

module.exports = { run: makeDecision, computeFinalScore };
