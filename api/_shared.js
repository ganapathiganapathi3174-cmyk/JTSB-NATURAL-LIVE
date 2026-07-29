const crypto = require('crypto');

// ── TEST MODE CONFIGURATION ──
// Set TEST_MODE=true to use ₹1 fixed amount across all payment modules
// All existing business logic is preserved: referral, wallet, sponsor, OTP
// In production, set NODE_ENV=production or TEST_MODE=false in .env.local to disable
const TEST_MODE = process.env.NODE_ENV === 'production' ? false : (process.env.TEST_MODE !== 'false');
const TEST_PAYMENT_AMOUNT = 1;
const TEST_UPI_ID = 'jayarajj126-3@okicici';
const TEST_PAYEE_NAME = 'Test Payment';

// Polyfill crypto.randomUUID for Node 18 compatibility
if (!crypto.randomUUID) {
  crypto.randomUUID = function randomUUIDPolyfill() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = crypto.randomBytes(1)[0] % 16 | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };
}

function generateIdempotencyKey() {
  return crypto.randomUUID();
}

const COL_USERS = 'users';
const COL_TOPUPS = 'topups';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_PENDING_REGS = 'pending_registrations';
const COL_PROCESSED_PAYMENTS = 'processed_payments';
const COL_SESSIONS = 'payment_sessions';
const COL_ORDERS = 'payment_sessions';
const COL_UPI_PAYMENTS = 'upi_payments';
const COL_TOPUP_INCOME = 'topup_referral_income';
const COL_VERIFICATION_LOGS = 'verification_logs';
const COL_DELETION_AUDIT_LOGS = 'deletion_audit_logs';
const COL_PAYMENT_CONFIRM_SESSIONS = 'payment_confirm_sessions';
const COL_REFERRALS = 'referrals';
const COL_NOTIFICATIONS = 'notifications';
const COL_CHAT_MESSAGES = 'chat_messages';
const COL_CHAT_CONVOS = 'chat_conversations';
const COL_ADMINS = 'admins';
const COL_UNIQUES = 'uniques';
const COL_SPONSOR_DATA = 'sponsor_data';
const COL_SPONSOR_CLAIMS = 'sponsor_claims';
const COL_SMS_SESSIONS = 'paymentSessions';
const COL_SPONSOR_TRANSFERS = 'sponsor_transfers';
const COL_AUDIT_LOGS = 'audit_logs';
const COL_TOPUP_AUDIT_LOG = 'topup_audit_log';
const MAX_REFERRALS = 2;
const ADMIN_UPI_ID = 'jayarajj126-3@okicici';
const ADMIN_ACCOUNT_MASK = '4714';
const ADMIN_NAME = 'JEYARAJ ALAG';

const PACKAGES = { 120: '120', 500: '500', 1000: '1000' };
const ALLOWED_PACKAGE_AMOUNTS = Object.keys(PACKAGES).map(Number);

const SYSTEM_REFERRAL_CODES = ['SYS120', 'SYS500', 'SYS1000'];

function isSystemReferralCode(code) {
  return code && SYSTEM_REFERRAL_CODES.includes(code.toUpperCase());
}

function getPackageByReferral(referralCode) {
  if (!referralCode) return null;
  const upper = referralCode.toUpperCase();
  if (upper === 'SYS120') return '120';
  if (upper === 'SYS500') return '500';
  if (upper === 'SYS1000') return '1000';
  return null;
}

function getReferrerPackage(referrer) {
  if (!referrer || !referrer.membership_type) return null;
  const pkg = String(referrer.membership_type).trim();
  return PACKAGES[pkg] || null;
}

function validatePackageAmount(pkg, amount) {
  if (!pkg) return true;
  return String(pkg) === String(amount);
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) {
    s += chars.charAt(bytes[i] % chars.length);
  }
  return s;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

module.exports = {
  COL_USERS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_PENDING_REGS, COL_PROCESSED_PAYMENTS, COL_SESSIONS, COL_ORDERS,
  COL_UPI_PAYMENTS, COL_TOPUP_INCOME, COL_VERIFICATION_LOGS, COL_DELETION_AUDIT_LOGS,
  COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS,
  COL_ADMINS, COL_UNIQUES, COL_SPONSOR_DATA, COL_SPONSOR_CLAIMS, COL_PAYMENT_CONFIRM_SESSIONS, COL_SMS_SESSIONS,
  COL_SPONSOR_TRANSFERS, COL_AUDIT_LOGS, COL_TOPUP_AUDIT_LOG, MAX_REFERRALS, randomString, hashPassword, crypto, generateIdempotencyKey,
  COL_UPGRADE_REQUESTS: 'upgrade_requests', COL_PAYMENT_AI_LOGS: 'payment_ai_logs',
  TEST_MODE, TEST_PAYMENT_AMOUNT, TEST_UPI_ID, TEST_PAYEE_NAME, ADMIN_UPI_ID, ADMIN_ACCOUNT_MASK, ADMIN_NAME,
  SYSTEM_REFERRAL_CODES, isSystemReferralCode,
  PACKAGES, ALLOWED_PACKAGE_AMOUNTS, getPackageByReferral, getReferrerPackage, validatePackageAmount,
};

