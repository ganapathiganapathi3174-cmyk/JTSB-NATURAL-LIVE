// ─────────────────────────────────────────────────────────────
// VALIDATE LIVE SUPABASE SCHEMA  (scripts/validate-live-schema.js)
//
// Verifies that every table/column the current verification system
// reads/writes EXISTS in the LIVE Supabase database. Run BEFORE and
// AFTER applying scripts/0004-verification-migration-fix.sql.
//
//   BEFORE migration: prints the missing-schema inventory (deployment
//                     report section 1) and exits with code 1.
//   AFTER  migration: expects ZERO missing columns/tables; exits 0.
//
// Uses the service key + PostgREST `select=<col>` probe (read-only,
// safe on production data). No npm deps — Node >= 18 global fetch.
//
// Usage:  node scripts/validate-live-schema.js [--expect-clean]
// ─────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const EXPECT_CLEAN = process.argv.includes('--expect-clean');

// Load SUPABASE_URL / SUPABASE_SERVICE_KEY from .env.local (or env).
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

// Every table -> column the verification system reads or writes.
// Source: live-schema probe + code inventory of the 7 flows
// (preRegister, createPaymentOrder, submitPaymentProof,
//  getPaymentOrderStatus, approveUPIPayment, processPendingPayments,
//  topup payment) + _approvalPipeline / _auditLogger /
//  _notificationService / _cycleEngine / _newEngine.
const INVENTORY = {
  'payment_sessions': [
    'id', 'user_id', 'pending_reg_id', 'type', 'amount', 'status',
    'expires_at', 'created_at', 'updated_at', 'screenshot_url', 'utr',
    'expected_amount', 'expected_upi_id', 'verification_status', 'verification_score',
    'ocr_result', 'rejection_reasons',
    'screenshot_phash', 'verification_attempts', 'next_retry_at', 'last_error',
  ],
  'upi_payments': [
    'id', 'utr', 'upi_id', 'amount', 'amount_option', 'payment_type', 'screenshot_url',
    'status', 'user_id', 'pending_reg_id', 'payment_date', 'created_at',
    'ocr_result', 'final_score', 'fraud_score', 'risk_score', 'utr_hash',
    'screenshot_hash', 'screenshot_phash', 'rejection_reasons', 'verified_at',
    'verification_locked', 'verification_completed_at', 'verification_duration',
    'verified_by',
  ],
  'verification_logs': [
    'id', 'payment_id', 'status', 'created_at',
    'confidence', 'reasons', 'matched_fields', 'extracted_fields', 'checks',
    'fraud_score', 'fraud_flags', 'ocr_engines', 'ocr_confidence',
    'duplicate_check', 'decision_factors', 'stages', 'duration_ms',
  ],
  'notifications': ['id', 'receiverId', 'title', 'message', 'type', 'status', 'createdAt', 'senderId', 'senderName'],
  'audit_logs': ['id', 'action', 'target_id', 'target_type', 'admin_id', 'details', 'created_at'],
  'users': ['id', 'email', 'name', 'phone', 'password_hash', 'referral_code', 'referred_by', 'account_status', 'payment_status', 'approved', 'active', 'membership_paid', 'membership_type', 'joined_date', 'approved_date', 'referrals_count', 'total_referral_count', 'referral_limit_reached', 'referral_active', 'is_qualified', 'topup_referral_qualified_count', 'topup_referral_qualified', 'sponsor_topup_completed', 'sponsor_awaiting_credit', 'referred_by_status', 'inactive_reason', 'email_hash', 'phone_hash', 'current_cycle_referral_count', 'total_referrals', 'referral_cycle_number', 'topup_cycle_number', 'inactive_at', 'reactivated_at', 'sponsor_topup_pending', 'sponsor_credited', 'sponsor_credited_amount', 'sponsor_topup_id', 'sponsor_topup_amount', 'topup_status'],
  'wallet_balances': ['id', 'user_id', 'balance', 'total_earned'],
  'wallet_transactions': ['id', 'user_id', 'type', 'amount', 'description', 'reference_id', 'balance_after', 'created_at'],
  'topups': ['id', 'user_id', 'amount', 'utr', 'screenshot_url', 'status', 'verified_at', 'created_at'],
  'topup_referral_income': ['id', 'user_id', 'from_user_id', 'topup_id', 'amount', 'level', 'status', 'created_at'],
  'pending_registrations': ['id', 'name', 'email', 'phone', 'password_hash', 'referral_code', 'created_at'],
  'cycle_history': ['id', 'user_id', 'cycle_type', 'cycle_number', 'action', 'details', 'admin_id', 'created_at'],
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
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY required (set in .env.local or env).');
    process.exit(2);
  }
  const base = String(url).replace(/\/$/, '');

  const report = [];
  let probed = 0;
  for (const [table, cols] of Object.entries(INVENTORY)) {
    for (const col of cols) {
      probed++;
      const r = await probeColumn(base, key, table, col);
      if (r !== 'OK') report.push({ table, col, result: r });
    }
  }

  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  LIVE SCHEMA VALIDATION — ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '  │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('  Supabase: ' + base);
  console.log('  Tables probed:  ' + Object.keys(INVENTORY).length);
  console.log('  Columns probed: ' + probed);
  console.log('  Missing/broken: ' + report.length);

  for (const item of report) {
    console.log(`    MISSING  ${item.table}.${item.col}  ->  ${item.result}`);
  }

  if (EXPECT_CLEAN && report.length > 0) {
    console.error('\nRESULT: FAIL — expected a fully-migrated schema, but ' + report.length + ' columns/tables are still missing.');
    console.error('Apply scripts/0004-verification-migration-fix.sql in the Supabase SQL Editor, then re-run.');
    process.exit(1);
  }
  if (report.length === 0) {
    console.log('\nRESULT: PASS — schema matches code. No 42703 risk remains on the 7 payment flows.');
    process.exit(0);
  }
  console.log('\nRESULT: PRE-MIGRATION BASELINE CAPTURED — ' + report.length + ' schema gaps documented.');
  console.log('Apply scripts/0004-verification-migration-fix.sql, then re-run with --expect-clean.');
  process.exit(1);
})().catch((e) => { console.error('FATAL:', e); process.exit(2); });
