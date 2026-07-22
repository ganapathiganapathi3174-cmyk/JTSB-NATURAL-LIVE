function log(msg) {
  console.log(`[DECISION-ENGINE] ${msg}`);
}

async function makeDecision(pipelineResult) {
  const tStart = Date.now();
  log('Making verification decision');

  const {
    imageIntegrity,
    visionAnalysis,
    votingResult,
    businessRules,
    fraudDetection,
  } = pipelineResult;

  const result = {
    decision: 'MANUAL_REVIEW',
    confidence: 0,
    reasons: [],
    autoApproved: false,
    autoRejected: false,
    needsManualReview: true,
    matchedFields: {},
    score: 0,
  };

  const imageScore = imageIntegrity ? imageIntegrity.imageScore : 0;
  const visionConfidence = visionAnalysis ? visionAnalysis.confidence : 0;
  const votingConfidence = votingResult ? votingResult.overallConfidence : 0;
  const fraudScore = fraudDetection ? fraudDetection.score : 0;
  const businessPassed = businessRules ? businessRules.overallPassed : false;

  const businessBlocking = businessRules ? businessRules.blockingIssues : [];

  let score = 0;
  let scoreComponents = [];

  if (imageScore >= 80) {
    score += 20;
    scoreComponents.push({ name: 'image_integrity', weight: 20, score: 20 });
  } else if (imageScore >= 60) {
    score += 15;
    scoreComponents.push({ name: 'image_integrity', weight: 20, score: 15 });
  } else {
    score += Math.max(0, Math.floor(imageScore / 10));
    scoreComponents.push({ name: 'image_integrity', weight: 20, score: Math.max(0, Math.floor(imageScore / 10)) });
  }

  if (visionConfidence >= 85) {
    score += 15;
    scoreComponents.push({ name: 'ai_vision', weight: 15, score: 15 });
  } else if (visionConfidence >= 60) {
    score += 10;
    scoreComponents.push({ name: 'ai_vision', weight: 15, score: 10 });
  } else {
    score += 5;
    scoreComponents.push({ name: 'ai_vision', weight: 15, score: 5 });
  }

  if (votingConfidence >= 90) {
    score += 25;
    scoreComponents.push({ name: 'ocr_voting', weight: 25, score: 25 });
  } else if (votingConfidence >= 75) {
    score += 20;
    scoreComponents.push({ name: 'ocr_voting', weight: 25, score: 20 });
  } else if (votingConfidence >= 60) {
    score += 15;
    scoreComponents.push({ name: 'ocr_voting', weight: 25, score: 15 });
  } else {
    score += Math.max(0, Math.floor(votingConfidence / 10));
    scoreComponents.push({ name: 'ocr_voting', weight: 25, score: Math.max(0, Math.floor(votingConfidence / 10)) });
  }

  if (businessPassed) {
    score += 25;
    scoreComponents.push({ name: 'business_rules', weight: 25, score: 25 });
  } else {
    const passedCount = businessRules ? businessRules.allChecks.filter(c => c.passed).length : 0;
    const checkScore = Math.floor((passedCount / Math.max(1, businessRules.allChecks.length)) * 25);
    score += checkScore;
    scoreComponents.push({ name: 'business_rules', weight: 25, score: checkScore });
  }

  if (fraudScore <= 20) {
    score += 15;
    scoreComponents.push({ name: 'fraud_detection', weight: 15, score: 15 });
  } else if (fraudScore <= 50) {
    score += 10;
    scoreComponents.push({ name: 'fraud_detection', weight: 15, score: 10 });
  } else if (fraudScore <= 80) {
    score += 5;
    scoreComponents.push({ name: 'fraud_detection', weight: 15, score: 5 });
  } else {
    score += 0;
    scoreComponents.push({ name: 'fraud_detection', weight: 15, score: 0 });
  }

  result.score = Math.min(100, Math.max(0, score));
  result.confidence = result.score;
  result.scoreComponents = scoreComponents;

  const matchedFields = {};
  if (businessRules) {
    matchedFields.amount = !!(businessRules.amountCheck && businessRules.amountCheck.passed);
    matchedFields.upi = !!(businessRules.upiCheck && businessRules.upiCheck.passed);
    matchedFields.utr = !!(businessRules.utrCheck && businessRules.utrCheck.passed);
    matchedFields.date = !!(businessRules.dateCheck && businessRules.dateCheck.passed);
    matchedFields.time = !!(businessRules.timeCheck && businessRules.timeCheck.passed);
    matchedFields.status = !!(businessRules.statusCheck && businessRules.statusCheck.passed);
  }
  result.matchedFields = matchedFields;

  const strongRejectSignals = [];
  if (fraudDetection && fraudDetection.riskLevel === 'HIGH_RISK') {
    strongRejectSignals.push('High fraud risk detected');
  }
  if (fraudDetection && fraudDetection.flags.includes('duplicate_submission')) {
    strongRejectSignals.push('Duplicate submission detected');
  }
  if (businessBlocking.filter(i => i.includes('amount') && i.includes('not match')).length > 0) {
    strongRejectSignals.push('Amount mismatch');
  }
  if (businessBlocking.filter(i => i.includes('UPI') && i.includes('not match')).length > 0) {
    strongRejectSignals.push('UPI mismatch');
  }
  if (imgEdited()) strongRejectSignals.push('Screenshot appears edited');

  function imgEdited() {
    return imageIntegrity && imageIntegrity.isEdited;
  }

  if (result.score >= 95 && businessPassed && fraudScore <= 20 && !imgEdited()) {
    result.decision = 'AUTO_APPROVE';
    result.autoApproved = true;
    result.needsManualReview = false;
    result.reasons.push('All verification checks passed with high confidence');
    result.reasons.push(`Score: ${result.score}%`);
    result.reasons.push(`Fraud risk: ${fraudDetection ? fraudDetection.riskLevel : 'unknown'}`);
    result.reasons.push('Image integrity verified');
    if (matchedFields.amount) result.reasons.push('Amount matches expected');
    if (matchedFields.upi) result.reasons.push('UPI ID matches expected');
    if (matchedFields.utr) result.reasons.push('UTR extracted successfully');
    if (matchedFields.date) result.reasons.push('Date matches today');
  } else if (strongRejectSignals.length >= 2 || (fraudScore > 80) || (businessPassed === false && fraudScore > 60)) {
    result.decision = 'AUTO_REJECT';
    result.autoRejected = true;
    result.needsManualReview = false;
    result.reasons.push(...strongRejectSignals);
    result.reasons.push(`Overall confidence: ${result.score}%`);
    if (fraudScore > 80) result.reasons.push(`Fraud score exceeds threshold: ${fraudScore}`);
    if (!businessPassed) result.reasons.push('Business rule validation failed');
  } else {
    result.decision = 'MANUAL_REVIEW';
    result.needsManualReview = true;
    result.reasons.push(`Overall confidence: ${result.score}%`);
    if (result.score < 80) result.reasons.push('Confidence below auto-approve threshold');
    if (strongRejectSignals.length > 0) result.reasons.push(...strongRejectSignals);
    if (!businessPassed) result.reasons.push('Some business rules did not pass');
    if (fraudScore > 20) result.reasons.push(`Elevated fraud risk: ${fraudDetection ? fraudDetection.riskLevel : 'unknown'}`);
  }

  log(`Decision: ${result.decision}, score: ${result.score}%, reasons: ${result.reasons.join('; ')}`);
  result.processingTime = Date.now() - tStart;
  return result;
}

module.exports = { makeDecision };
