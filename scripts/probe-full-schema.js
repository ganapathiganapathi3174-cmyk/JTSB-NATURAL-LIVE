// ─────────────────────────────────────────────────────────────
// COMPREHENSIVE LIVE SCHEMA PROBE  (scripts/probe-full-schema.js)
//
// Probes EVERY table/column referenced by the 6 payment-pipeline
// files + their transitive helpers (_approvalPipeline, _auditLogger,
// _notificationService, _verifyQueue, _cycleEngine, _newEngine).
// Read-only PostgREST `select=<col>&limit=1` via service key.
//
// Usage: node scripts/probe-full-schema.js [--expect-clean]
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const EXPECT_CLEAN = process.argv.includes('--expect-clean');

function loadEnv() {
  const envFile = path.join(__dirname, '..', '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2];
    }
  }
  return env;
}

// Full inventory derived from code audit of the 6 files + helpers.
// W = written, R = read, * = optional (stripped if missing — does not abort write).
const INVENTORY = {
  'payment_sessions': [
    'id', 'user_id', 'pending_reg_id', 'type', 'amount', 'status',
    'expires_at', 'created_at', 'updated_at', 'verification_status',
    'verification_score', 'ocr_result', 'rejection_reasons', 'screenshot_url',
    'utr', 'expected_amount', 'expected_upi_id', 'upi_id',
    'screenshot_phash*', 'verification_attempts*', 'next_retry_at*', 'last_error*',
    'paymentId', 'paymentid',
  ],
  'upi_payments': [
    'id', 'utr', 'upi_id', 'amount', 'amount_option', 'payment_type',
    'screenshot_url', 'status', 'user_id', 'pending_reg_id', 'payment_date',
    'verification_locked', 'created_at', 'updated_at', 'ocr_result', 'final_score',
    'fraud_score', 'risk_score', 'utr_hash', 'screenshot_hash', 'rejection_reasons',
    'verified_at', 'verification_completed_at', 'verification_duration',
    'screenshot_phash*', 'verification_attempts*', 'next_retry_at*', 'last_error*',
    'verified_by',
  ],
  'verification_logs': [
    'id', 'payment_id', 'status', 'created_at', 'ocr_confidence',
    'confidence*', 'reasons*', 'matched_fields*', 'extracted_fields*', 'checks*',
    'fraud_score*', 'fraud_flags*', 'ocr_engines*', 'duplicate_check*',
    'decision_factors*', 'stages*', 'duration_ms*',
  ],
  'notifications': [
    'id', 'receiverId', 'title', 'message', 'type', 'status',
    'createdAt', 'senderId', 'senderName', 'created_at',
  ],
  'audit_logs': [
    'id', 'action', 'target_id', 'target_type', 'admin_id', 'details', 'created_at',
  ],
  'users': [
    'id', 'email', 'email_hash', 'phone', 'phone_hash', 'password_hash', 'name',
    'referral_code', 'referred_by', 'account_status', 'payment_status', 'approved',
    'active', 'membership_paid', 'membership_type', 'joined_date', 'approved_date',
    'created_at', 'updated_at', 'referrals_count', 'total_referral_count',
    'referral_limit_reached', 'referral_active', 'is_qualified',
    'topup_referral_qualified_count', 'topup_referral_qualified',
    'sponsor_topup_completed', 'sponsor_awaiting_credit', 'sponsor_topup_pending',
    'referred_by_status', 'inactive_reason', 'inactive_at',
    'current_cycle_referral_count', 'total_referrals', 'referral_cycle_number',
    'topup_cycle_number',
  ],
  'wallet_balances': [
    'id', 'user_id', 'balance', 'total_earned', 'created_at', 'updated_at',
  ],
  'wallet_transactions': [
    'id', 'user_id', 'type', 'amount', 'description', 'reference_id',
    'balance_after', 'created_at',
  ],
  'topups': [
    'id', 'user_id', 'amount', 'utr', 'screenshot_url', 'status',
    'verified_at', 'created_at', 'updated_at',
  ],
  'topup_referral_income': [
    'id', 'user_id', 'from_user_id', 'topup_id', 'amount', 'level', 'status',
    'created_at', 'updated_at',
  ],
  'pending_registrations': [
    'id', 'name', 'email', 'phone', 'password_hash', 'referral_code', 'created_at',
  ],
  'cycle_history': [
    'id', 'user_id', 'cycle_type', 'cycle_number', 'action', 'details',
    'admin_id', 'created_at',
  ],
  'upgrade_requests': [
    'id', 'user_id', 'user_name', 'user_email', 'user_phone', 'current_plan',
    'requested_plan', 'amount', 'referral_code', 'status', 'admin_id',
    'rejection_reason', 'reviewed_at', 'created_at', 'updated_at',
  ],
  'sponsor_transfers': [
    'id', 'user_id', 'old_sponsor_id', 'old_sponsor_code', 'new_sponsor_id',
    'new_sponsor_code', 'user_plan', 'status', 'requested_at', 'responded_at',
    'rejection_reason', 'created_at', 'updated_at',
  ],
  'payment_ai_logs': [
    'id', 'payment_id', 'user_id', 'utr', 'image_score', 'vision_score',
    'final_decision', 'confidence', 'fraud_score', 'fraud_flags', 'reasons',
    'matched_fields', 'processing_time_ms', 'ai_model_used', 'created_at',
  ],
};

async function probeColumn(url, key, table, column) {
  const res = await fetch(`${url}/rest/v1/${table}?select=${encodeURIComponent(column)}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (res.ok) return 'OK';
  const body = await res.text().catch(() => '');
  const msg = body.slice(0, 200);
  if (/does not exist|PGRST204|42703/.test(msg)) return 'MISSING';
  if (/PGRST205|Could not find the table/i.test(msg)) return 'TABLE_MISSING';
  return 'ERR ' + res.status + ' ' + msg;
}

(async () => {
  const env = loadEnv();
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('FATAL: SUPABASE_URL / SUPABASE_SERVICE_KEY required'); process.exit(2); }

  const report = [];
  let probed = 0;
  for (const [table, cols] of Object.entries(INVENTORY)) {
    for (const rawCol of cols) {
      probed++;
      const col = rawCol.replace('*', '');
      const r = await probeColumn(url, key, table, col);
      if (r !== 'OK') report.push({ table, col, optional: rawCol.endsWith('*'), result: r });
    }
  }

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  FULL SCHEMA PROBE — ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '  │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('  Tables probed:  ' + Object.keys(INVENTORY).length);
  console.log('  Columns probed: ' + probed);
  console.log('  Missing/broken: ' + report.length);

  const critical = report.filter(r => !r.optional);
  const optional = report.filter(r => r.optional);

  if (critical.length) {
    console.log('\n  — CRITICAL (written/read unconditionally — abort writes or cause wrong results):');
    for (const item of critical) console.log(`    MISSING  ${item.table}.${item.col}  ->  ${item.result}`);
  }
  if (optional.length) {
    console.log('\n  — OPTIONAL (stripped via addDocFiltered/updateDocFiltered — degrades, does not abort):');
    for (const item of optional) console.log(`    STRIPPED ${item.table}.${item.col}  ->  ${item.result}`);
  }

  if (EXPECT_CLEAN && critical.length > 0) {
    console.error('\nRESULT: FAIL — ' + critical.length + ' critical schema gaps remain.');
    process.exit(1);
  }
  if (critical.length === 0) {
    console.log('\nRESULT: PASS — all critical columns/tables present.');
    process.exit(0);
  }
  console.log('\nRESULT: ' + critical.length + ' CRITICAL gaps (optional stripped gaps: ' + optional.length + ').');
  process.exit(1);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
