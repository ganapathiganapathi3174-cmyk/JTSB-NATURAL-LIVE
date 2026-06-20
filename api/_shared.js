const crypto = require('crypto');

const COL_USERS = 'users_new';
const COL_TOPUPS = 'topups_new';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_PENDING_REGS = 'pending_registrations';
const COL_PROCESSED_PAYMENTS = 'processed_payments';
const COL_SESSIONS = 'payment_sessions';
const COL_RAZORPAY_ORDERS = 'razorpay_orders';
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

function getProjectId() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return process.env.VITE_FIREBASE_PROJECT_ID || 'jtsb-natural-live';
  }
  try {
    const sa = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY, 'base64').toString());
    return sa.project_id;
  } catch {
    return process.env.VITE_FIREBASE_PROJECT_ID || 'jtsb-natural-live';
  }
}

module.exports = {
  COL_USERS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_PENDING_REGS, COL_PROCESSED_PAYMENTS, COL_SESSIONS, COL_RAZORPAY_ORDERS,
  MAX_REFERRALS,
  randomString, hashPassword, getProjectId, crypto,
};
