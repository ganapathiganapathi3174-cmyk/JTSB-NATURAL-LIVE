/**
 * JTSB Natural Live - Cloudflare Worker
 *
 * Server-side proxy for privileged Appwrite operations.
 * The API key lives here, never in the frontend.
 *
 * Endpoints:
 *   POST /api/appwrite/create-session    — create payment_sessions document
 *   POST /api/appwrite/generate-code     — create verification_codes + update session
 *   POST /api/appwrite/verify-code       — verify and mark codes used
 *   GET  /api/appwrite/code?sessionId=   — get verification code for a session
 *   POST /api/appwrite/approve-user      — approve user registration payment
 *   POST /api/appwrite/reject-user       — reject user account
 *   POST /api/appwrite/approve-topup     — approve topup payment
 *   POST /api/appwrite/reject-topup      — reject topup payment
 *   POST /api/appwrite/force-approve     — admin force approve payment
 *   POST /api/appwrite/update-profile-pic — store profile picture
 *   POST /api/appwrite/create-admin      — create admin user
 *   GET  /api/health                     — health check
 */

const APPWRITE_BASE = 'https://cloud.appwrite.io/v1';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Appwrite-Project, X-Appwrite-Key, X-Appwrite-Response-Format',
  };
}

function genId(prefix, len) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let id = prefix + '-';
  for (let i = 0; i < len; i++) id += chars.charAt(bytes[i] % chars.length);
  return id;
}

async function appwriteApi(method, path, body, env) {
  const url = APPWRITE_BASE + path;
  const opts = {
    method,
    headers: {
      'X-Appwrite-Project': env.APPWRITE_PROJECT_ID,
      'X-Appwrite-Key': env.APPWRITE_API_KEY,
      'X-Appwrite-Response-Format': '1.6.0',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok) throw new Error(data.message || `Appwrite ${method} ${path} failed: ${res.status}`);
  return data;
}

async function handleCreateSession(request, env) {
  const { type, amount, ...fields } = await request.json();
  const dbId = env.APPWRITE_DATABASE_ID;
  const sessionId = genId('PAY', 8);
  const now = new Date().toISOString();

  let data;
  if (type === 'registration') {
    if (!fields.email) return error('Email is required');
    data = {
      sessionId,
      email: fields.email.toLowerCase().trim(),
      name: fields.name || '',
      phone: fields.phone || '',
      amount: String(amount || 120),
      type: 'registration',
      paymentStatus: 'created',
      createdAt: now,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  } else {
    if (!fields.userId) return error('Missing userId');
    data = {
      sessionId,
      userId: fields.userId,
      type: type || 'topup',
      amount: String(amount || 120),
      paymentStatus: 'created',
      createdAt: now,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  try {
    const result = await appwriteApi('POST', `/databases/${dbId}/collections/payment_sessions/documents`, {
      documentId: sessionId,
      data,
      permissions: ['read("any")', 'write("any")'],
    }, env);
    return json({ sessionId, razorpayOrderId: null, ...data, appwriteId: result.$id });
  } catch (e) {
    return error(e.message, 500);
  }
}

async function handleGenerateCode(request, env) {
  const { sessionId, razorpayOrderId, razorpayPaymentId } = await request.json();
  if (!sessionId) return error('Missing sessionId');
  const dbId = env.APPWRITE_DATABASE_ID;

  try {
    const session = await appwriteApi('GET', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, null, env);
    if (!session) return error('Session not found', 404);

    const code = genId('JTSB', 6);
    const now = new Date().toISOString();
    const codeData = {
      code,
      sessionId,
      userId: session.userId || null,
      type: session.type || 'registration',
      amount: session.amount || '120',
      paymentId: razorpayPaymentId || null,
      orderId: razorpayOrderId || null,
      paymentStatus: 'active',
      approved: false,
      createdAt: now,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      used: false,
    };

    await appwriteApi('POST', `/databases/${dbId}/collections/verification_codes/documents`, {
      documentId: code,
      data: codeData,
      permissions: ['read("any")', 'write("any")'],
    }, env);

    await appwriteApi('PATCH', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, {
      data: {
        paymentStatus: 'completed',
        razorpayPaymentId: razorpayPaymentId || null,
        razorpayOrderId: razorpayOrderId || null,
        verificationCode: code,
        completedAt: now,
      },
    }, env);

    return json({ code });
  } catch (e) {
    return error(e.message, 500);
  }
}

async function handleVerifyCode(request, env) {
  const { sessionId, code, amount } = await request.json();
  if (!sessionId || !code) return error('Missing sessionId or code');
  const dbId = env.APPWRITE_DATABASE_ID;

  try {
    const normalizedCode = code.toUpperCase().trim();
    const codeDoc = await appwriteApi('GET', `/databases/${dbId}/collections/verification_codes/documents/${normalizedCode}`, null, env);
    if (!codeDoc) return error('Invalid verification code', 404);

    if (codeDoc.sessionId !== sessionId) return error('Code does not match this session');
    if (codeDoc.paymentStatus !== 'active' || codeDoc.used === true || codeDoc.used === 'true') return error('Code has already been used');
    if (new Date(codeDoc.expiresAt) < new Date()) return error('Code has expired');
    if (String(codeDoc.amount) !== String(amount || '120')) return error('Amount mismatch');

    await appwriteApi('PATCH', `/databases/${dbId}/collections/verification_codes/documents/${normalizedCode}`, {
      data: {
        paymentStatus: 'used',
        approved: true,
        used: true,
        usedAt: new Date().toISOString(),
      },
    }, env);

    await appwriteApi('PATCH', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, {
      data: {
        paymentStatus: 'verified',
        verifiedAt: new Date().toISOString(),
      },
    }, env);

    return json({
      success: true,
      session: { userId: codeDoc.userId, amount: Number(codeDoc.amount), type: codeDoc.type },
    });
  } catch (e) {
    return error(e.message, 500);
  }
}

async function handleGetCode(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return error('Missing sessionId');

  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    const session = await appwriteApi('GET', `/databases/${dbId}/collections/payment_sessions/documents/${sessionId}`, null, env);
    if (!session || !session.verificationCode) return json(null);

    const codeDoc = await appwriteApi('GET', `/databases/${dbId}/collections/verification_codes/documents/${session.verificationCode}`, null, env);
    if (!codeDoc) return json(null);

    const approvedVal = codeDoc.approved;
    const usedVal = codeDoc.used;
    return json({
      code: codeDoc.code,
      status: codeDoc.paymentStatus,
      approved: approvedVal === true || approvedVal === 'true',
      used: usedVal === true || usedVal === 'true',
      expiresAt: codeDoc.expiresAt,
      type: codeDoc.type,
      amount: codeDoc.amount,
    });
  } catch {
    return json(null);
  }
}

// ---- Admin: Approve User ----
async function handleApproveUser(request, env) {
  const { userId, adminName } = await request.json();
  if (!userId) return error('Missing userId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/users/documents/${userId}`, {
      data: {
        payment_status: 'approved',
        admin_approval_status: 'approved',
        account_status: 'active',
        approved_by: adminName || 'admin',
        approved_at: new Date().toISOString(),
      },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Reject User ----
async function handleRejectUser(request, env) {
  const { userId, adminName, reason } = await request.json();
  if (!userId) return error('Missing userId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/users/documents/${userId}`, {
      data: {
        payment_status: 'rejected',
        account_status: 'rejected',
        rejected_by: adminName || 'admin',
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || '',
      },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Approve Topup ----
async function handleApproveTopup(request, env) {
  const { topupId, adminId } = await request.json();
  if (!topupId) return error('Missing topupId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/topups/documents/${topupId}`, {
      data: {
        status: 'approved',
        adminId: adminId || 'admin',
        approvedAt: new Date().toISOString(),
      },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Reject Topup ----
async function handleRejectTopup(request, env) {
  const { topupId, adminId } = await request.json();
  if (!topupId) return error('Missing topupId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/topups/documents/${topupId}`, {
      data: {
        status: 'rejected',
        adminId: adminId || 'admin',
        rejectedAt: new Date().toISOString(),
      },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Force Approve ----
async function handleForceApprove(request, env) {
  const { userId, adminName, reason } = await request.json();
  if (!userId) return error('Missing userId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/users/documents/${userId}`, {
      data: {
        payment_status: 'approved',
        admin_approval_status: 'approved',
        approved_by: adminName || 'admin',
        approved_at: new Date().toISOString(),
        manual_override: true,
        override_reason: reason || '',
      },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Update Profile Picture ----
async function handleUpdateProfilePic(request, env) {
  const { userId, base64DataUrl } = await request.json();
  if (!userId) return error('Missing userId');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    await appwriteApi('PATCH', `/databases/${dbId}/collections/users/documents/${userId}`, {
      data: { profile_picture_url: base64DataUrl || '' },
    }, env);
    return json({ success: true });
  } catch (e) { return error(e.message, 500); }
}

// ---- Admin: Create Admin ----
async function handleCreateAdmin(request, env) {
  const { email, password } = await request.json();
  if (!email || !password) return error('Missing email or password');
  const dbId = env.APPWRITE_DATABASE_ID;
  try {
    const adminId = email.replace(/[^a-zA-Z0-9]/g, '_');
    await appwriteApi('POST', `/databases/${dbId}/collections/admins/documents`, {
      documentId: adminId,
      data: {
        email,
        password,
        createdAt: new Date().toISOString(),
      },
      permissions: ['read("any")', 'write("any")'],
    }, env);
    return json({ success: true, id: adminId });
  } catch (e) { return error(e.message, 500); }
}

async function handleHealth(env) {
  try {
    await appwriteApi('GET', `/databases/${env.APPWRITE_DATABASE_ID}`, null, env);
    return json({ status: 'ok', appwrite: 'connected' });
  } catch (e) {
    return json({ status: 'degraded', appwrite: e.message }, 503);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (true) {
        case path === '/api/appwrite/create-session' && request.method === 'POST':
          return await handleCreateSession(request, env);
        case path === '/api/appwrite/generate-code' && request.method === 'POST':
          return await handleGenerateCode(request, env);
        case path === '/api/appwrite/verify-code' && request.method === 'POST':
          return await handleVerifyCode(request, env);
        case path === '/api/appwrite/code' && request.method === 'GET':
          return await handleGetCode(request, env);
        case path === '/api/appwrite/approve-user' && request.method === 'POST':
          return await handleApproveUser(request, env);
        case path === '/api/appwrite/reject-user' && request.method === 'POST':
          return await handleRejectUser(request, env);
        case path === '/api/appwrite/approve-topup' && request.method === 'POST':
          return await handleApproveTopup(request, env);
        case path === '/api/appwrite/reject-topup' && request.method === 'POST':
          return await handleRejectTopup(request, env);
        case path === '/api/appwrite/force-approve' && request.method === 'POST':
          return await handleForceApprove(request, env);
        case path === '/api/appwrite/update-profile-pic' && request.method === 'POST':
          return await handleUpdateProfilePic(request, env);
        case path === '/api/appwrite/create-admin' && request.method === 'POST':
          return await handleCreateAdmin(request, env);
        case path === '/api/health':
          return await handleHealth(env);
        default:
          return error('Not found', 404);
      }
    } catch (e) {
      return error('Internal error: ' + e.message, 500);
    }
  },
};
