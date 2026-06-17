/**
 * Vercel Serverless Function — Appwrite Proxy
 *
 * Handles all /api/appwrite/* requests using Appwrite REST API.
 * APPWRITE_API_KEY is a Vercel environment secret (never in frontend).
 */

import crypto from 'crypto';

const APPWRITE_BASE = 'https://cloud.appwrite.io/v1';

function json(data, status = 200) {
  return { data, status };
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

function getHeaders() {
  return {
    'X-Appwrite-Project': process.env.VITE_APPWRITE_PROJECT_ID,
    'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
    'X-Appwrite-Response-Format': '1.6.0',
    'Content-Type': 'application/json',
  };
}

async function appwriteApi(method, path, body) {
  const url = APPWRITE_BASE + path;
  const opts = { method, headers: getHeaders() };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok) throw new Error(data.message || `Appwrite ${method} ${path} failed: ${res.status}`);
  return data;
}

function genId(prefix, len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(len);
  let id = prefix + '-';
  for (let i = 0; i < len; i++) id += chars.charAt(bytes[i] % chars.length);
  return id;
}

// ---- Handlers ----

async function handleCreateSession(body) {
  const dbId = process.env.VITE_APPWRITE_DATABASE_ID;
  const { type, amount, ...fields } = body;
  const sessionId = genId('PAY', 8);
  const now = new Date().toISOString();
  let data;
  if (type === 'registration') {
    if (!fields.email) return error('Email is required');
    data = { sessionId, email: fields.email.toLowerCase().trim(), name: fields.name || '', phone: fields.phone || '', amount: String(amount || 120), type: 'registration', paymentStatus: 'created', createdAt: now, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  } else {
    if (!fields.userId) return error('Missing userId');
    data = { sessionId, userId: fields.userId, type: type || 'topup', amount: String(amount || 120), paymentStatus: 'created', createdAt: now, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  }
  try {
    const result = await appwriteApi('POST', `/databases/${dbId}/collections/payment_sessions/documents`, { documentId: sessionId, data, permissions: ['read("any")', 'write("any")'] });
    return json({ sessionId, razorpayOrderId: null, ...data, appwriteId: result.$id });
  } catch (e) { return error(e.message, 500); }
}

async function handleGenerateCode(body) {
  const { sessionId, razorpayOrderId, razorpayPaymentId } = body;
  if (!sessionId) return error('Missing sessionId');
  const dbId = process.env.VITE_APPWRITE_DATABASE_ID;
  try {
    const session = await appwriteApi('GET', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`);
    if (!session) return error('Session not found', 404);
    const code = genId('JTSB', 6);
    const now = new Date().toISOString();
    await appwriteApi('POST', `/databases/${dbId}/collections/verification_codes/documents`, { documentId: code, data: { code, sessionId, userId: session.userId || null, type: session.type || 'registration', amount: session.amount || '120', paymentId: razorpayPaymentId || null, orderId: razorpayOrderId || null, paymentStatus: 'active', approved: false, createdAt: now, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), used: false }, permissions: ['read("any")', 'write("any")'] });
    await appwriteApi('PATCH', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, { data: { paymentStatus: 'completed', razorpayPaymentId: razorpayPaymentId || null, razorpayOrderId: razorpayOrderId || null, verificationCode: code, completedAt: now } });
    return json({ code });
  } catch (e) { return error(e.message, 500); }
}

async function handleVerifyCode(body) {
  const { sessionId, code, amount, isTopup, name, email, phone, password, referredBy } = body;
  if (!sessionId || !code) return error('Missing sessionId or code');
  const dbId = process.env.VITE_APPWRITE_DATABASE_ID;
  try {
    const normalizedCode = code.toUpperCase().trim();
    const codeDoc = await appwriteApi('GET', `/databases/${dbId}/collections/verification_codes/documents/${normalizedCode}`);
    if (!codeDoc) return error('Invalid verification code', 404);
    if (codeDoc.sessionId !== sessionId) return error('Code does not match this session');
    if (codeDoc.paymentStatus !== 'active' || codeDoc.used === true || codeDoc.used === 'true') return error('Code has already been used');
    if (new Date(codeDoc.expiresAt) < new Date()) return error('Code has expired');
    if (String(codeDoc.amount) !== String(amount || '120')) return error('Amount mismatch');
    await appwriteApi('PATCH', `/databases/${dbId}/collections/verification_codes/documents/${normalizedCode}`, { data: { paymentStatus: 'used', approved: true, used: true, usedAt: new Date().toISOString() } });
    await appwriteApi('PATCH', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, { data: { paymentStatus: 'verified', verifiedAt: new Date().toISOString() } });
    if (!isTopup && email) {
      const normalizedEmail = email.toLowerCase().trim();
      const userId = normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const hashedPassword = crypto.createHash('sha256').update(password || '').digest('hex');
      const refChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const refBytes = crypto.randomBytes(8);
      let referralCode = '';
      for (let i = 0; i < 8; i++) referralCode += refChars.charAt(refBytes[i] % refChars.length);
      let existingUser = null;
      try { existingUser = await appwriteApi('GET', `/databases/${dbId}/collections/users/documents/${userId}`); } catch {}
      if (!existingUser) {
        await appwriteApi('POST', `/databases/${dbId}/collections/users/documents`, {
          documentId: userId,
          data: {
            userId,
            name: name || '',
            email: normalizedEmail,
            phone: phone || '',
            password: hashedPassword,
            referral_code: referralCode,
            referred_by: referredBy || '',
            referrals_count: 0,
            account_status: 'pending',
            payment_status: 'approved',
            is_first_payment_done: true,
            created_at: new Date().toISOString(),
          },
        });
      }
    }
    return json({ success: true, session: { userId: codeDoc.userId || (email ? email.replace(/[^a-zA-Z0-9]/g, '_') : null), amount: Number(codeDoc.amount), type: codeDoc.type } });
  } catch (e) { return error(e.message, 500); }
}

async function handleGetCode(url) {
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return error('Missing sessionId');
  const dbId = process.env.VITE_APPWRITE_DATABASE_ID;
  try {
    const session = await appwriteApi('GET', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`);
    if (!session || !session.verificationCode) return json(null);
    const codeDoc = await appwriteApi('GET', `/databases/${dbId}/collections/verification_codes/documents/${session.verificationCode}`);
    if (!codeDoc) return json(null);
    const av = codeDoc.approved, uv = codeDoc.used;
    return json({ code: codeDoc.code, status: codeDoc.paymentStatus, approved: av === true || av === 'true', used: uv === true || uv === 'true', expiresAt: codeDoc.expiresAt, type: codeDoc.type, amount: codeDoc.amount });
  } catch { return json(null); }
}

async function handleApproveUser(body) {
  const { userId, adminName } = body;
  if (!userId) return error('Missing userId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/users/documents/${userId}`, { data: { payment_status: 'approved', admin_approval_status: 'approved', account_status: 'active', approved_by: adminName || 'admin', approved_at: new Date().toISOString() } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleRejectUser(body) {
  const { userId, adminName, reason } = body;
  if (!userId) return error('Missing userId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/users/documents/${userId}`, { data: { payment_status: 'rejected', account_status: 'rejected', rejected_by: adminName || 'admin', rejected_at: new Date().toISOString(), rejection_reason: reason || '' } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleApproveTopup(body) {
  const { topupId, adminId } = body;
  if (!topupId) return error('Missing topupId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/topups/documents/${topupId}`, { data: { status: 'approved', adminId: adminId || 'admin', approvedAt: new Date().toISOString() } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleRejectTopup(body) {
  const { topupId, adminId } = body;
  if (!topupId) return error('Missing topupId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/topups/documents/${topupId}`, { data: { status: 'rejected', adminId: adminId || 'admin', rejectedAt: new Date().toISOString() } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleForceApprove(body) {
  const { userId, adminName, reason } = body;
  if (!userId) return error('Missing userId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/users/documents/${userId}`, { data: { payment_status: 'approved', admin_approval_status: 'approved', approved_by: adminName || 'admin', approved_at: new Date().toISOString(), manual_override: true, override_reason: reason || '' } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleUpdateProfilePic(body) {
  const { userId, base64DataUrl } = body;
  if (!userId) return error('Missing userId');
  try {
    await appwriteApi('PATCH', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/users/documents/${userId}`, { data: { profile_picture_url: base64DataUrl || '' } });
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

async function handleCreateAdmin(body) {
  const { email, password } = body;
  if (!email || !password) return error('Missing email or password');
  try {
    const adminId = email.replace(/[^a-zA-Z0-9]/g, '_');
    await appwriteApi('POST', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}/collections/admins/documents`, { documentId: adminId, data: { email, password, createdAt: new Date().toISOString() }, permissions: ['read("any")', 'write("any")'] });
    return json({ success: true, id: adminId });
  } catch (e) { return error(e.message, 500); }
}

async function handleHealth() {
  try {
    await appwriteApi('GET', `/databases/${process.env.VITE_APPWRITE_DATABASE_ID}`);
    return json({ status: 'ok', appwrite: 'connected' });
  } catch (e) { return json({ status: 'degraded', appwrite: e.message }, 503); }
}

// ---- Router ----

const ROUTES = {
  'create-session': handleCreateSession,
  'generate-code': handleGenerateCode,
  'verify-code': handleVerifyCode,
  'code': handleGetCode,
  'approve-user': handleApproveUser,
  'reject-user': handleRejectUser,
  'approve-topup': handleApproveTopup,
  'reject-topup': handleRejectTopup,
  'force-approve': handleForceApprove,
  'update-profile-pic': handleUpdateProfilePic,
  'create-admin': handleCreateAdmin,
  'health': handleHealth,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const slug = req.query.slug || [];
  const endpoint = slug[0] || 'health';
  const handlerFn = ROUTES[endpoint];

  if (!handlerFn) return res.status(404).json({ error: 'Not found' });

  try {
    if (endpoint === 'code') {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const { data, status } = await handlerFn(url);
      return res.status(status).json(data);
    }
    const { data, status } = await handlerFn(req.body || {});
    return res.status(status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
