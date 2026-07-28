const C = require('./config');

function decide(rules, duplicate) {
  if (duplicate && duplicate.duplicate) {
    return { status: C.REJECTED, reason: 'Duplicate payment' };
  }

  if (rules.hard.length > 0) {
    return { status: C.REJECTED, reason: rules.hard.map(r => r.reason).join('; ') };
  }

  if (rules.soft.length > 0) {
    const reasons = rules.soft.map(r => r.reason);
    return { status: C.MANUAL_REVIEW, reason: reasons.join('; ') };
  }

  if (rules.pass) {
    return { status: C.APPROVED, reason: 'All checks passed' };
  }

  return { status: C.MANUAL_REVIEW, reason: 'Ambiguous result' };
}

module.exports = { decide };