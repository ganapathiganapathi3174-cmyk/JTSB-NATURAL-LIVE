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
  if (amountCheck) {
    totalWeight += weights.amount;
    if (amountCheck.passed) earned += weights.amount;
    else if (amountCheck.severity === 'soft') earned += Math.round(weights.amount * 0.5);
  }

  const receiverCheck = validationMap.receiver_upi;
  if (receiverCheck) {
    totalWeight += weights.receiver;
    if (receiverCheck.passed) earned += weights.receiver;
    else if (receiverCheck.severity === 'soft') earned += Math.round(weights.receiver * 0.5);
  }

  const statusCheck = validationMap.payment_status;
  if (statusCheck) {
    totalWeight += weights.status;
    if (statusCheck.passed) earned += weights.status;
    else if (statusCheck.severity === 'missing') earned += Math.round(weights.status * 0.5);
  }

  const dateCheck = validationMap.date;
  if (dateCheck) {
    totalWeight += weights.date;
    if (dateCheck.passed) earned += weights.date;
    else if (dateCheck.severity === 'soft') earned += Math.round(weights.date * 0.3);
  }

  const timeCheck = validationMap.time;
  if (timeCheck) {
    totalWeight += weights.time;
    if (timeCheck.passed) earned += weights.time;
    else if (timeCheck.severity === 'missing') earned += Math.round(weights.time * 0.5);
  }

  const utrFormatCheck = validationMap.utr_format;
  if (utrFormatCheck) {
    totalWeight += weights.utr_valid;
    if (utrFormatCheck.passed) earned += weights.utr_valid;
  }

  const userUtrCheck = validationMap.user_utr;
  if (userUtrCheck && userUtrCheck.passed) {
    totalWeight += weights.utr_match;
    earned += weights.utr_match;
  } else if (userUtrCheck && !userUtrCheck.passed && userUtrCheck.severity === 'missing') {
    totalWeight += weights.utr_match;
  }

  const ocrConfPct = Math.min(100, Math.max(0, ocrConfidence || 0));
  totalWeight += weights.ocr_confidence;
  if (ocrConfPct >= 50) {
    earned += Math.round(weights.ocr_confidence * ocrConfPct / 100);
  } else {
    earned += Math.round(weights.ocr_confidence * ocrConfPct / 200);
  }

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
  const { score: finalScore } = computeFinalScore(validationResult, fraudResult, ocrConfidence, authResult);
  const validationMap = {};
  for (const check of (validationResult.checks || [])) validationMap[check.name] = check;

  const utrFormatPassed = validationMap.utr_format && validationMap.utr_format.passed;
  const userUtrPassed = validationMap.user_utr && validationMap.user_utr.passed;
  const datePassed = validationMap.date && validationMap.date.passed;
  const receiverPassed = validationMap.receiver_upi && validationMap.receiver_upi.passed;
  const statusPassed = validationMap.payment_status && validationMap.payment_status.passed;
  const amountPassed = validationMap.amount && validationMap.amount.passed;
  const isDuplicate = duplicateResult && duplicateResult.isDuplicate;
  const fraudHigh = fraudResult && fraudResult.fraudScore >= C.FRAUD_THRESHOLDS.high;

  const reasons = [];
  let decision, status;

  const hasUtr = utrFormatPassed || userUtrPassed;
  const hasDate = datePassed;

  if (hasUtr && hasDate && !isDuplicate && !fraudHigh) {
    decision = 'APPROVED';
    status = C.APPROVED_STATUS;
    reasons.push('UTR + Date match confirmed — auto-approved');
    reasons.push('Score: ' + finalScore + '%');
    if (!amountPassed) reasons.push('Amount unclear but ignored per UTR+Date priority rule');
    if (!receiverPassed) reasons.push('Receiver UPI partially matched');
    log.info('', 'DECISION: APPROVED via UTR+Date priority (score=' + finalScore + '%)');
    log.info('', 'Decision: ' + decision + ' (score=' + finalScore + '%, utr=' + hasUtr + ', date=' + hasDate + ', dup=' + isDuplicate + ', fraud=' + (fraudResult ? fraudResult.fraudScore : 0) + ') (' + (Date.now() - t0) + 'ms)');
    return { decision, status, finalScore, reasons, duration: Date.now() - t0 };
  }

  let rejectSignals = 0;
  if (!utrFormatPassed && validationMap.utr_format && validationMap.utr_format.severity === 'hard') rejectSignals++;
  if (validationMap.user_utr && !userUtrPassed && validationMap.user_utr.severity === 'hard') rejectSignals++;
  if (!receiverPassed && validationMap.receiver_upi && validationMap.receiver_upi.severity === 'hard') rejectSignals++;
  if (isDuplicate) rejectSignals++;
  if (fraudHigh) rejectSignals++;
  if (statusPassed === false && validationMap.payment_status && validationMap.payment_status.severity === 'hard') rejectSignals++;

  if (rejectSignals >= 2) {
    decision = 'REJECTED';
    status = C.REJECTED_STATUS;
    reasons.push('Rejected: ' + rejectSignals + ' strong reject signals');
    if (!utrFormatPassed) reasons.push('UTR format invalid');
    if (!receiverPassed) reasons.push('Receiver UPI mismatch');
    if (isDuplicate) reasons.push('Duplicate payment detected');
    if (fraudHigh) reasons.push('High fraud score: ' + (fraudResult ? fraudResult.fraudScore : 0));
    log.info('', 'Decision: REJECTED (signals=' + rejectSignals + ', score=' + finalScore + '%)');
    return { decision, status, finalScore, reasons, duration: Date.now() - t0 };
  }

  if (finalScore >= C.SCORE_THRESHOLDS.autoApprove && !isDuplicate && !fraudHigh) {
    decision = 'APPROVED';
    status = C.APPROVED_STATUS;
    reasons.push('All checks pass, score ' + finalScore + '%');
  } else if (finalScore >= C.SCORE_THRESHOLDS.manualReview || isDuplicate) {
    decision = 'MANUAL_REVIEW';
    status = C.MANUAL_REVIEW_STATUS;
    reasons.push('Score ' + finalScore + '% — needs manual review');
    for (const check of (validationResult.checks || [])) {
      if (!check.passed && !check.isUserCheck) reasons.push('Failed: ' + check.name + ' — ' + check.reason);
    }
  } else {
    decision = 'REJECTED';
    status = C.REJECTED_STATUS;
    reasons.push('Score ' + finalScore + '% is below ' + C.SCORE_THRESHOLDS.manualReview + '%');
    for (const check of (validationResult.checks || [])) {
      if (!check.passed && !check.isUserCheck) reasons.push('Failed: ' + check.name + ' — ' + check.reason);
    }
  }

  log.info('', 'Decision: ' + decision + ' (score=' + finalScore + '%, mandatory=' + validationResult.allMandatoryPass + ', dup=' + isDuplicate + ', fraud=' + (fraudResult ? fraudResult.fraudScore : 0) + ') (' + (Date.now() - t0) + 'ms)');
  return { decision, status, finalScore, reasons, duration: Date.now() - t0 };
}

module.exports = { run: makeDecision, computeFinalScore };
