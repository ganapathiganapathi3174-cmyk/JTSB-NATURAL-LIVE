const C = require('./config.js');

function decide(rules, duplicate, fraud, extracted, options) {
  const result = {
    status: C.DECISION.MANUAL_REVIEW,
    confidence: 0,
    reasons: [],
    matchedFields: {},
    decisionFactors: {},
  };

  const checks = rules.checks || {};
  result.matchedFields = {
    amount: checks.amount === 'matched',
    utr: checks.utr === 'matched' || checks.utr === 'partial_match',
    upi_id: checks.upi_id === 'matched' || checks.upi_id === 'partial_match',
    date: checks.date === 'today_or_near',
    status: checks.status === 'success',
  };

  const matchedCount = Object.values(result.matchedFields).filter(Boolean).length;

  if (duplicate?.duplicate) {
    result.status = C.DECISION.REJECT;
    result.reasons = duplicate.reasons || ['Duplicate transaction detected'];
    result.confidence = 100;
    result.decisionFactors = { duplicate: true, matchedCount };
    return result;
  }

  if (rules.hardFail) {
    result.status = C.DECISION.REJECT;
    result.reasons = rules.reasons.filter(r => !r.includes('Amount'));
    if (result.reasons.length === 0) result.reasons = ['Hard validation failed'];
    result.confidence = 100;
    result.decisionFactors = { hardFail: true, matchedCount };
    return result;
  }

  if (fraud?.suspicious && fraud.score >= 40) {
    result.status = C.DECISION.REJECT;
    result.reasons = (fraud.reasons || []).concat(['Suspicious activity detected']);
    result.confidence = fraud.score;
    result.decisionFactors = { fraud: true, fraudScore: fraud.score, matchedCount };
    return result;
  }

  const utrMatched = checks.utr === 'matched' || checks.utr === 'partial_match';
  const dateMatched = checks.date === 'today_or_near';
  const amountMatched = checks.amount === 'matched' || checks.amount === 'close_match';
  const upiMatched = checks.upi_id === 'matched' || checks.upi_id === 'partial_match';
  const statusMatched = checks.status === 'success';

  if (utrMatched && dateMatched) {
    result.status = C.DECISION.APPROVE;
    result.reasons = ['UTR matched', 'Date matches'];
    if (amountMatched) result.reasons.push('Amount matches');
    if (!amountMatched) result.reasons.push('Amount unclear but UTR+Date confirmed');
    if (upiMatched) result.reasons.push('UPI ID matches');
    result.confidence = Math.max(95, matchedCount * 20);
    result.decisionFactors = { utrDateMatch: true, matchedCount };
    return result;
  }

  if (utrMatched && amountMatched) {
    result.status = C.DECISION.APPROVE;
    result.reasons = ['UTR matched', 'Amount matches'];
    if (upiMatched) result.reasons.push('UPI ID matches');
    result.confidence = 90;
    result.decisionFactors = { utrAmountMatch: true, matchedCount };
    return result;
  }

  if (amountMatched && upiMatched && dateMatched && statusMatched) {
    result.status = C.DECISION.APPROVE;
    result.reasons = ['Amount matches', 'UPI ID matches', 'Date matches', 'Payment status SUCCESS'];
    result.confidence = 90;
    result.decisionFactors = { fullMatch: true, matchedCount };
    return result;
  }

  if (utrMatched) {
    result.status = C.DECISION.MANUAL_REVIEW;
    result.reasons = ['UTR found but insufficient confirmation'];
    if (!dateMatched) result.reasons.push('Date not confirmed');
    if (!amountMatched) result.reasons.push('Amount unclear');
    result.confidence = 60;
    result.decisionFactors = { utrOnly: true, matchedCount };
    return result;
  }

  if (amountMatched && upiMatched) {
    result.status = C.DECISION.MANUAL_REVIEW;
    result.reasons = ['Amount and UPI matched, but UTR not found'];
    result.confidence = 50;
    result.decisionFactors = { amountUpiMatch: true, matchedCount };
    return result;
  }

  result.status = C.DECISION.MANUAL_REVIEW;
  result.reasons = ['Insufficient evidence for auto-approval'];
  if (rules.softFail) result.reasons = result.reasons.concat(rules.reasons);
  result.confidence = Math.max(10, matchedCount * 15);
  result.decisionFactors = { insufficient: true, matchedCount };

  return result;
}

module.exports = { decide };
