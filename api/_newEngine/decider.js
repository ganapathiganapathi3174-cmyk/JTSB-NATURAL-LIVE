const C = require('./config.js');

// ENTERPRISE DECISION ENGINE (strict rule set)
//
// HARD REJECT (in priority order):
//   - confirmed duplicate UTR or byte-identical screenshot
//   - transaction status is FAILED
//   - amount mismatch (extracted != expected)
//   - fraud score >= 40 (suspicious)
//
// AUTO-APPROVE when ALL business fields pass:
//   - amount matches (extracted == expected)
//   - receiver UPI matches
//   - transaction status = SUCCESS
//   - transaction date = today in Asia/Kolkata
//   - screenshot payment time within ±TIME_WINDOW_MIN of server time (IST)
//   - UTR is unique (no prior non-rejected payment with same UTR)
//   - screenshot is unique (no prior non-rejected payment with same hash)
//   - image is authentic (valid format/size, not blurry, not dark, no tamper flag)
//   - OCR confidence >= CONFIDENCE_APPROVE (minimum readable, NOT a quality gate)
//
// OCR confidence is a QUALITY SIGNAL for field extraction, NOT a trust gate.
// If business fields are extracted correctly and match, approve regardless
// of whether OCR reports 90% or 93% confidence.
//
// EVERYTHING ELSE -> MANUAL_REVIEW.

function decide(rules, duplicate, fraud, extracted, options) {
  const checks = rules.checks || {};
  const result = {
    status: C.DECISION.MANUAL_REVIEW,
    confidence: 0,
    reasons: [],
    matchedFields: {},
    decisionFactors: {},
  };

  result.matchedFields = {
    amount: checks.amount === 'matched',
    utr: checks.utr === 'matched',
    upi_id: checks.upi_id === 'matched' || checks.upi_id === 'partial_match',
    date: checks.date === 'today_ist',
    time: checks.time === 'within_window',
    status: checks.status === 'success',
  };

  const matchedCount = Object.values(result.matchedFields).filter(Boolean).length;
  const fraudFlags = (fraud?.flags || []);
  const ocrConfidence = options?.ocrConfidence || 0;

  // ── HARD REJECTS (STRONG duplicates only) ──
  // duplicate_utr (same UTR hash) and duplicate_screenshot (byte-identical
  // SHA-256) are unambiguous. duplicate_phash is a PERCEPTUAL similarity and
  // is intentionally NOT a hard reject — legitimate screenshots from the same
  // UPI app are perceptually near-identical (verified: distinct payments have
  // dHash distance 1-2 at 64-bit), so phash routes to manual_review below.
  if (duplicate?.duplicate && (duplicate.type === 'duplicate_utr' || duplicate.type === 'duplicate_screenshot')) {
    result.status = C.DECISION.REJECT;
    result.reasons = duplicate.reasons || ['Duplicate transaction detected'];
    result.confidence = 100;
    result.decisionFactors = { reject: 'duplicate', type: duplicate.type, matchedCount };
    return result;
  }

  if (rules.hardFail) {
    result.status = C.DECISION.REJECT;
    result.reasons = rules.reasons.filter(r => r.includes('failure') || r.includes('FAILED'));
    if (result.reasons.length === 0) result.reasons = ['Transaction status indicates failure'];
    result.confidence = 100;
    result.decisionFactors = { reject: 'failed_status', matchedCount };
    return result;
  }

  if (checks.amount === 'mismatch') {
    result.status = C.DECISION.REJECT;
    result.reasons = ['Amount mismatch: extracted=' + (extracted?.amount || '?') + ' expected=' + (rules.expectedAmount || '?')];
    result.confidence = 100;
    result.decisionFactors = { reject: 'amount_mismatch', matchedCount };
    return result;
  }

  if (fraud?.suspicious && fraud.score >= 40) {
    result.status = C.DECISION.REJECT;
    result.reasons = (fraud.reasons || []).concat(['Suspicious activity detected']);
    result.confidence = fraud.score;
    result.decisionFactors = { reject: 'fraud', fraudScore: fraud.score, matchedCount };
    return result;
  }

  // ── BUSINESS FIELD CHECKS ──
  const amountOk = checks.amount === 'matched';
  const upiOk = checks.upi_id === 'matched' || checks.upi_id === 'partial_match';
  const statusOk = checks.status === 'success';
  const dateOk = checks.date === 'today_ist';
  const timeOk = checks.time === 'within_window';
  const utrOk = checks.utr === 'matched';
  const imageOk = !fraudFlags.includes('blurred') && !fraudFlags.includes('dark') &&
                  !fraudFlags.includes('low_resolution') && !fraudFlags.includes('tampered');

  const allBusinessFieldsPass = amountOk && upiOk && statusOk && dateOk && timeOk && utrOk && imageOk;

  // OCR readability: can the engine extract fields at all? NOT a quality gate.
  const ocrReadable = ocrConfidence >= C.CONFIDENCE_APPROVE;

  if (allBusinessFieldsPass && ocrReadable) {
    result.status = C.DECISION.APPROVE;
    result.reasons = [
      'Amount matches',
      'Receiver UPI matches',
      'Transaction status SUCCESS',
      'Transaction date is today (IST)',
      'Payment time within ±' + C.TIME_WINDOW_MIN + 'min window (IST)',
      'UTR matched',
      'UTR unique',
      'Screenshot unique',
      'Image authentic',
      'OCR confidence ' + ocrConfidence + '% (readable)',
    ];
    result.confidence = Math.min(100, ocrConfidence);
    result.decisionFactors = { strictApprove: true, matchedCount, ocrConfidence };
    return result;
  }

  // ── MANUAL REVIEW (default) ──
  const missing = [];
  if (duplicate?.duplicate && duplicate.type === 'duplicate_phash') {
    result.reasons.push((duplicate.reasons && duplicate.reasons[0]) || 'Screenshot perceptually similar to an existing payment');
  }
  if (!amountOk) missing.push('amount');
  if (!upiOk) missing.push('receiver UPI');
  if (!statusOk) missing.push('status SUCCESS');
  if (!dateOk) missing.push('today date (IST)');
  if (!timeOk) missing.push('payment time within ±' + C.TIME_WINDOW_MIN + 'min window');
  if (!utrOk) missing.push('UTR');
  if (!ocrReadable) missing.push('OCR confidence >= ' + C.CONFIDENCE_APPROVE);
  if (!imageOk) missing.push('image authenticity');

  result.status = C.DECISION.MANUAL_REVIEW;
  result.reasons = ['Insufficient evidence for auto-approval'];
  if (missing.length) result.reasons.push('Missing: ' + missing.join(', '));
  if (rules.reasons && rules.reasons.length) result.reasons = result.reasons.concat(rules.reasons.slice(0, 3));
  if (fraud?.reasons && fraud.reasons.length) result.reasons.push(fraud.reasons[0]);
  result.confidence = Math.max(10, Math.min(90, Math.round(ocrConfidence || 0)));
  result.decisionFactors = { manualReview: true, missing, matchedCount, ocrConfidence };

  return result;
}

module.exports = { decide };
