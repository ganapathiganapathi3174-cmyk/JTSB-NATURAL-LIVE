/**
 * Appwrite Payment Module (Frontend)
 *
 * SECURITY: No API key in frontend code.
 * All privileged operations proxy through the Vercel API route
 * which holds the Appwrite API key as a server-side secret.
 */

const ENDPOINT = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = import.meta.env.VITE_APPWRITE_PROJECT_ID || '';
const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || '';

function isConfigured() {
  return !!(PROJECT_ID && DATABASE_ID);
}

async function workerApi(endpoint, body) {
  const url = `/api/appwrite/${endpoint}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `${endpoint} failed`);
  return data;
}

async function createPaymentSession(userIdOrOpts, type, amount) {
  if (!isConfigured()) throw new Error('Appwrite not configured');

  if (typeof userIdOrOpts === 'object') {
    const { name, email, phone, amount: amt } = userIdOrOpts;
    if (!email) throw new Error('Email is required for registration payment');
    return workerApi('create-session', {
      type: 'registration',
      amount: amt || 120,
      name: name || '',
      email: email.toLowerCase().trim(),
      phone: phone || '',
    });
  }

  const userId = userIdOrOpts;
  if (!userId || !type) throw new Error('Missing userId or type');
  return workerApi('create-session', {
    type: type || 'topup',
    amount: amount || 120,
    userId,
  });
}

async function getVerificationCode(sessionId) {
  if (!sessionId || !isConfigured()) return null;
  try {
    const r = await fetch(`/api/appwrite/code?sessionId=${encodeURIComponent(sessionId)}`);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

async function generateVerificationCode(sessionId, razorpayOrderId, razorpayPaymentId) {
  if (!sessionId) throw new Error('Missing sessionId');
  if (!isConfigured()) throw new Error('Appwrite not configured');
  return workerApi('generate-code', { sessionId, razorpayOrderId, razorpayPaymentId });
}

async function verifyPaymentCode(sessionId, code, userData = {}) {
  if (!sessionId || !code) throw new Error('Missing sessionId or code');
  if (!isConfigured()) throw new Error('Appwrite not configured');
  return workerApi('verify-code', {
    sessionId,
    code: code.toUpperCase().trim(),
    amount: userData.amount || 120,
    isTopup: userData.isTopup || false,
    name: userData.name || '',
    email: userData.email || '',
    phone: userData.phone || '',
    password: userData.password || '',
    referredBy: userData.referredBy || '',
  });
}

async function ping() {
  if (!isConfigured()) return;
  try {
    await fetch(`/api/appwrite/health`);
  } catch {}
}

export const AppwritePayment = {
  isConfigured,
  createPaymentSession,
  getVerificationCode,
  generateVerificationCode,
  verifyPaymentCode,
  ping,
};
