function decide(validation, duplicate) {
  const reasons = [];
  if (duplicate && duplicate.duplicateUtr) {
    return { status: 'rejected', confidence: 0, reasons: ['Duplicate UTR detected'] };
  }
  if (validation.hardFails.length > 0) {
    reasons.push(...validation.hardFails);
    return { status: 'rejected', confidence: 0, reasons };
  }
  if (validation.softFails.length > 0) {
    reasons.push(...validation.softFails);
    return { status: 'manual_review', confidence: 50, reasons };
  }
  if (!validation.amount && !validation.utr && !validation.upi) {
    return { status: 'manual_review', confidence: 10, reasons: ['Insufficient extracted fields'] };
  }
  return { status: 'verified', confidence: 90, reasons: ['All checks passed'] };
}

module.exports = { decide };
