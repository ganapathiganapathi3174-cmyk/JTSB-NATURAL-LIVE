const crypto = require('crypto');

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
// COL_RAZORPAY_ORDERS removed — webhook flow deprecated
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
const MAX_REFERRALS = 2;

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
  COL_PENDING_REGS, COL_PROCESSED_PAYMENTS, COL_SESSIONS,
  COL_UPI_PAYMENTS, COL_TOPUP_INCOME, COL_VERIFICATION_LOGS, COL_DELETION_AUDIT_LOGS,
  COL_REFERRALS, COL_NOTIFICATIONS, COL_CHAT_MESSAGES, COL_CHAT_CONVOS,
  COL_ADMINS, COL_UNIQUES, COL_SPONSOR_DATA, COL_SPONSOR_CLAIMS, COL_PAYMENT_CONFIRM_SESSIONS, COL_SMS_SESSIONS,
  MAX_REFERRALS, randomString, hashPassword, crypto, generateIdempotencyKey,
};
