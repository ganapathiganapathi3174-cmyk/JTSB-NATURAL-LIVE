// Production metrics tracking module
// Tracks application-level health metrics

const metrics = {
  api_calls: { total: 0, by_endpoint: {} },
  auth: { success: 0, failure: 0, last_failure: null },
  payments: {
    submitted: 0,
    approved: { auto: 0, manual: 0 },
    rejected: { auto: 0, manual: 0 },
    manual_review: 0,
    failed: 0,
    last_failure: null,
  },
  ocr: {
    attempted: 0,
    success: 0,
    failure: 0,
    last_failure: null,
  },
  registrations: {
    pending: 0,
    approved: 0,
    failed: 0,
  },
  wallet: {
    credits: 0,
    total_amount: 0,
    last_credit: null,
  },
  referral: {
    bonuses_given: 0,
    total_amount: 0,
    topup_income_created: 0,
  },
  database: {
    supabase_errors: 0,
    turso_errors: 0,
    queue_errors: 0,
    last_error: null,
  },
  started_at: new Date().toISOString(),
};

// Track API calls
function trackAPICall(endpoint, method, statusCode) {
  metrics.api_calls.total++;
  const key = method + ' ' + endpoint;
  if (!metrics.api_calls.by_endpoint[key]) metrics.api_calls.by_endpoint[key] = { calls: 0, errors: 0 };
  metrics.api_calls.by_endpoint[key].calls++;
  if (statusCode >= 400) metrics.api_calls.by_endpoint[key].errors++;
}

// Track auth events
function trackAuth(success) {
  if (success) metrics.auth.success++;
  else {
    metrics.auth.failure++;
    metrics.auth.last_failure = new Date().toISOString();
  }
}

// Track payment events
function trackPaymentSubmitted() {
  metrics.payments.submitted++;
}

function trackPaymentApproved(type = 'manual') {
  if (type === 'auto') metrics.payments.approved.auto++;
  else metrics.payments.approved.manual++;
}

function trackPaymentRejected(type = 'manual') {
  if (type === 'auto') metrics.payments.rejected.auto++;
  else metrics.payments.rejected.manual++;
}

function trackPaymentManualReview() {
  metrics.payments.manual_review++;
}

function trackPaymentFailed() {
  metrics.payments.failed++;
  metrics.payments.last_failure = new Date().toISOString();
}

// Track OCR events
function trackOCR(success) {
  metrics.ocr.attempted++;
  if (success) metrics.ocr.success++;
  else {
    metrics.ocr.failure++;
    metrics.ocr.last_failure = new Date().toISOString();
  }
}

// Track registration events
function trackRegistrationPending() {
  metrics.registrations.pending++;
}

function trackRegistrationApproved() {
  metrics.registrations.approved++;
}

function trackRegistrationFailed() {
  metrics.registrations.failed++;
}

// Track wallet events
function trackWalletCredit(amount) {
  metrics.wallet.credits++;
  metrics.wallet.total_amount += amount;
  metrics.wallet.last_credit = new Date().toISOString();
}

// Track referral events
function trackReferralBonus(amount) {
  metrics.referral.bonuses_given++;
  metrics.referral.total_amount += amount;
}

function trackReferralTopupIncome() {
  metrics.referral.topup_income_created++;
}

// Track database errors
function trackDBError(service) {
  if (service === 'supabase') metrics.database.supabase_errors++;
  else if (service === 'turso') metrics.database.turso_errors++;
  else if (service === 'queue') metrics.database.queue_errors++;
  metrics.database.last_error = new Date().toISOString() + ' [' + service + ']';
}

// Get metrics snapshot
function getMetrics() {
  const now = new Date().toISOString();
  const uptime = Math.floor((new Date(now).getTime() - new Date(metrics.started_at).getTime()) / 1000);

  // Calculate failure rates
  const totalAuth = metrics.auth.success + metrics.auth.failure;
  const totalPayments = metrics.payments.submitted;
  const totalOcr = metrics.ocr.attempted;

  return {
    uptime_seconds: uptime,
    started_at: metrics.started_at,
    api_calls: metrics.api_calls,
    auth: {
      ...metrics.auth,
      failure_rate: totalAuth > 0 ? Math.round((metrics.auth.failure / totalAuth) * 10000) / 100 : 0,
    },
    payments: {
      ...metrics.payments,
      approval_rate: totalPayments > 0
        ? Math.round(((metrics.payments.approved.auto + metrics.payments.approved.manual) / totalPayments) * 10000) / 100
        : 0,
    },
    ocr: {
      ...metrics.ocr,
      success_rate: totalOcr > 0 ? Math.round((metrics.ocr.success / totalOcr) * 10000) / 100 : 0,
    },
    registrations: metrics.registrations,
    wallet: metrics.wallet,
    referral: metrics.referral,
    database: metrics.database,
  };
}

function resetMetrics() {
  metrics.api_calls.total = 0;
  metrics.api_calls.by_endpoint = {};
  metrics.auth.success = 0;
  metrics.auth.failure = 0;
  metrics.payments.submitted = 0;
  metrics.payments.approved.auto = 0;
  metrics.payments.approved.manual = 0;
  metrics.payments.rejected.auto = 0;
  metrics.payments.rejected.manual = 0;
  metrics.payments.manual_review = 0;
  metrics.registrations.pending = 0;
  metrics.registrations.approved = 0;
  metrics.wallet.credits = 0;
  metrics.referral.bonuses_given = 0;
  metrics.ocr.attempted = 0;
  metrics.ocr.success = 0;
  metrics.ocr.failure = 0;
}

module.exports = {
  trackAPICall,
  trackAuth,
  trackPaymentSubmitted,
  trackPaymentApproved,
  trackPaymentRejected,
  trackPaymentManualReview,
  trackPaymentFailed,
  trackOCR,
  trackRegistrationPending,
  trackRegistrationApproved,
  trackRegistrationFailed,
  trackWalletCredit,
  trackReferralBonus,
  trackReferralTopupIncome,
  trackDBError,
  getMetrics,
  resetMetrics,
};
