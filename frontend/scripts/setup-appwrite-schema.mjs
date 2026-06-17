/**
 * Appwrite Schema Setup Script
 * Creates all required collections and attributes for the payments database.
 *
 * Usage:
 *   1. Create an API key in Appwrite Console with scopes:
 *      collections.read, collections.write, attributes.read, attributes.write
 *      documents.read, documents.write
 *   2. Set the key in environment variable: $env:VITE_APPWRITE_API_KEY="key"
 *      OR add it to .env.local temporarily
 *   3. Run: node scripts/setup-appwrite-schema.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');

function loadEnv() {
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const ENDPOINT = process.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const PROJECT_ID = process.env.VITE_APPWRITE_PROJECT_ID;
const DATABASE_ID = process.env.VITE_APPWRITE_DATABASE_ID;
const API_KEY = process.env.VITE_APPWRITE_API_KEY;

if (!PROJECT_ID || !DATABASE_ID || !API_KEY) {
  console.error('ERROR: Missing Appwrite configuration. Set VITE_APPWRITE_PROJECT_ID, VITE_APPWRITE_DATABASE_ID, VITE_APPWRITE_API_KEY');
  process.exit(1);
}

// ---- All collection definitions ----

const COLLECTIONS = [
  { id: 'payment_sessions', name: 'Payment Sessions' },
  { id: 'verification_codes', name: 'Verification Codes' },
  { id: 'users', name: 'Users' },
  { id: 'referrals', name: 'Referrals' },
  { id: 'topups', name: 'Topups' },
  { id: 'topup_income', name: 'Topup Income' },
  { id: 'notifications', name: 'Notifications' },
  { id: 'chat_messages', name: 'Chat Messages' },
  { id: 'chat_conversations', name: 'Chat Conversations' },
  { id: 'admins', name: 'Admins' },
  { id: 'payment_images', name: 'Payment Images' },
];

const ATTRIBUTES = {
  payment_sessions: [
    { key: 'sessionId', type: 'string', size: 64 },
    { key: 'email', type: 'string', size: 255 },
    { key: 'name', type: 'string', size: 255 },
    { key: 'phone', type: 'string', size: 20 },
    { key: 'amount', type: 'string', size: 32 },
    { key: 'type', type: 'string', size: 64 },
    { key: 'paymentStatus', type: 'string', size: 64 },
    { key: 'createdAt', type: 'string', size: 64 },
    { key: 'expiresAt', type: 'string', size: 64 },
    { key: 'userId', type: 'string', size: 128 },
    { key: 'razorpayPaymentId', type: 'string', size: 255 },
    { key: 'razorpayOrderId', type: 'string', size: 255 },
    { key: 'verificationCode', type: 'string', size: 64 },
    { key: 'completedAt', type: 'string', size: 64 },
    { key: 'verifiedAt', type: 'string', size: 64 },
  ],

  verification_codes: [
    { key: 'code', type: 'string', size: 64 },
    { key: 'sessionId', type: 'string', size: 64 },
    { key: 'userId', type: 'string', size: 128 },
    { key: 'type', type: 'string', size: 64 },
    { key: 'amount', type: 'string', size: 32 },
    { key: 'paymentId', type: 'string', size: 255 },
    { key: 'orderId', type: 'string', size: 255 },
    { key: 'paymentStatus', type: 'string', size: 64 },
    { key: 'approved', type: 'boolean', default: false },
    { key: 'createdAt', type: 'string', size: 64 },
    { key: 'expiresAt', type: 'string', size: 64 },
    { key: 'used', type: 'boolean', default: false },
    { key: 'usedAt', type: 'string', size: 64 },
  ],

  users: [
    { key: 'userId', type: 'string', size: 128 },
    { key: 'name', type: 'string', size: 255 },
    { key: 'email', type: 'string', size: 255 },
    { key: 'phone', type: 'string', size: 20 },
    { key: 'password', type: 'string', size: 128 },
    { key: 'status', type: 'string', size: 32 },
    { key: 'account_status', type: 'string', size: 32 },
    { key: 'payment_status', type: 'string', size: 32 },
    { key: 'referral_code', type: 'string', size: 32 },
    { key: 'referred_by', type: 'string', size: 32 },
    { key: 'referrals_count', type: 'integer', default: 0 },
    { key: 'joinedDate', type: 'string', size: 64 },
    { key: 'approvedDate', type: 'string', size: 64 },
    { key: 'lastActiveAt', type: 'string', size: 64 },
    { key: 'created_at', type: 'string', size: 64 },
    { key: 'is_first_payment_done', type: 'boolean', default: false },
    { key: 'profile_picture_url', type: 'string', size: 512 },
    { key: 'theme_color', type: 'string', size: 16 },
    { key: 'upi_screenshot_url', type: 'string', size: 512 },
    { key: 'utr_number', type: 'string', size: 64 },
    { key: 'cycle_payment_status', type: 'string', size: 32 },
    { key: 'cycle_upi_screenshot_url', type: 'string', size: 512 },
    { key: 'cycle_payment_utr', type: 'string', size: 64 },
    { key: 'admin_approval_status', type: 'string', size: 32 },
    { key: 'approved_by', type: 'string', size: 128 },
    { key: 'approved_at', type: 'string', size: 64 },
    { key: 'rejected_by', type: 'string', size: 128 },
    { key: 'rejected_at', type: 'string', size: 64 },
    { key: 'rejection_reason', type: 'string', size: 512 },
    { key: 'manual_override', type: 'boolean', default: false },
    { key: 'validation_status', type: 'string', size: 32 },
    { key: 'confidence_score', type: 'integer', default: 0 },
    { key: 'screenshot_hash', type: 'string', size: 128 },
    { key: 'referral_view_count', type: 'integer', default: 0 },
    { key: 'sponsor_awaiting_credit', type: 'boolean', default: false },
    { key: 'inactive_reason', type: 'string', size: 256 },
  ],

  referrals: [
    { key: 'user_id', type: 'string', size: 128 },
    { key: 'name', type: 'string', size: 255 },
    { key: 'email', type: 'string', size: 255 },
    { key: 'phone', type: 'string', size: 20 },
    { key: 'created_at', type: 'string', size: 64 },
  ],

  topups: [
    { key: 'userId', type: 'string', size: 128 },
    { key: 'userName', type: 'string', size: 255 },
    { key: 'userEmail', type: 'string', size: 255 },
    { key: 'userPhone', type: 'string', size: 20 },
    { key: 'userReferralCode', type: 'string', size: 32 },
    { key: 'referred_by', type: 'string', size: 32 },
    { key: 'amount', type: 'string', size: 32 },
    { key: 'transactionId', type: 'string', size: 128 },
    { key: 'screenshotData', type: 'string', size: 9999 },
    { key: 'sessionId', type: 'string', size: 64 },
    { key: 'verifiedViaCode', type: 'boolean', default: false },
    { key: 'status', type: 'string', size: 32 },
    { key: 'adminId', type: 'string', size: 128 },
    { key: 'approvedAt', type: 'string', size: 64 },
    { key: 'rejectedAt', type: 'string', size: 64 },
    { key: 'createdAt', type: 'string', size: 64 },
  ],

  topup_income: [
    { key: 'userId', type: 'string', size: 128 },
    { key: 'fromUserId', type: 'string', size: 128 },
    { key: 'fromUserName', type: 'string', size: 255 },
    { key: 'topupId', type: 'string', size: 128 },
    { key: 'amount', type: 'string', size: 32 },
    { key: 'status', type: 'string', size: 32 },
    { key: 'claimedAt', type: 'string', size: 64 },
    { key: 'createdAt', type: 'string', size: 64 },
  ],

  notifications: [
    { key: 'senderId', type: 'string', size: 128 },
    { key: 'receiverId', type: 'string', size: 128 },
    { key: 'receiverName', type: 'string', size: 255 },
    { key: 'senderName', type: 'string', size: 255 },
    { key: 'title', type: 'string', size: 255 },
    { key: 'message', type: 'string', size: 2048 },
    { key: 'type', type: 'string', size: 64 },
    { key: 'status', type: 'string', size: 32 },
    { key: 'createdAt', type: 'string', size: 64 },
    { key: 'readAt', type: 'string', size: 64 },
  ],

  chat_messages: [
    { key: 'convoId', type: 'string', size: 128 },
    { key: 'senderId', type: 'string', size: 128 },
    { key: 'receiverId', type: 'string', size: 128 },
    { key: 'messageText', type: 'string', size: 2048 },
    { key: 'createdAt', type: 'string', size: 64 },
    { key: 'isRead', type: 'boolean', default: false },
    { key: 'isDelivered', type: 'boolean', default: false },
  ],

  chat_conversations: [
    { key: 'convoId', type: 'string', size: 128 },
    { key: 'userId', type: 'string', size: 128 },
    { key: 'userName', type: 'string', size: 255 },
    { key: 'userEmail', type: 'string', size: 255 },
    { key: 'createdAt', type: 'string', size: 64 },
    { key: 'updatedAt', type: 'string', size: 64 },
    { key: 'lastMessage', type: 'string', size: 255 },
  ],

  admins: [
    { key: 'email', type: 'string', size: 255 },
    { key: 'password', type: 'string', size: 128 },
    { key: 'createdAt', type: 'string', size: 64 },
  ],

  payment_images: [
    { key: 'fileId', type: 'string', size: 128 },
    { key: 'userId', type: 'string', size: 128 },
    { key: 'type', type: 'string', size: 32 },
    { key: 'base64', type: 'string', size: 9999 },
    { key: 'fileName', type: 'string', size: 255 },
    { key: 'createdAt', type: 'string', size: 64 },
  ],
};

// ---- API helpers ----

async function api(method, path, body) {
  const url = `${ENDPOINT}${path}`;
  const opts = {
    method,
    headers: {
      'X-Appwrite-Project': PROJECT_ID,
      'X-Appwrite-Key': API_KEY,
      'X-Appwrite-Response-Format': '1.6.0',
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 204) return { $id: 'deleted' };
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { message: text }; }
  if (!res.ok && res.status !== 409) {
    console.error(`  FAILED [${res.status}] ${method} ${path}: ${data.message || text}`);
    return null;
  }
  return data;
}

async function collectionExists(collectionId) {
  const r = await api('GET', `/databases/${DATABASE_ID}/collections/${collectionId}`);
  return r !== null && r.$id === collectionId;
}

async function ensureCollection(collectionId, name) {
  const exists = await collectionExists(collectionId);
  if (exists) { console.log(`  Collection "${collectionId}" already exists.`); return true; }
  const r = await api('POST', `/databases/${DATABASE_ID}/collections`, {
    collectionId,
    name: name || collectionId,
    permissions: ['read("any")', 'write("any")'],
    documentSecurity: true,
  });
  return r !== null;
}

async function attributeExists(collectionId, attrKey) {
  const r = await api('GET', `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/${attrKey}`);
  return r !== null && r.key === attrKey;
}

async function createAttribute(collectionId, attr) {
  const { key, type } = attr;
  process.stdout.write(`  ${key} (${type})... `);

  const exists = await attributeExists(collectionId, key);
  if (exists) { console.log(`already exists`); return true; }

  let typeEndpoint, body;
  switch (type) {
    case 'string':
      typeEndpoint = 'string';
      body = { key, type: 'string', size: attr.size || 512, required: false, array: false };
      if (attr.default !== undefined) body.default = attr.default;
      break;
    case 'integer':
      typeEndpoint = 'integer';
      body = { key, type: 'integer', required: false, array: false, min: 0, max: 999999999, default: attr.default ?? null };
      break;
    case 'boolean':
      typeEndpoint = 'boolean';
      body = { key, type: 'boolean', required: false, array: false, default: attr.default ?? null };
      break;
    default:
      console.log(`UNKNOWN TYPE`);
      return false;
  }

  const result = await api('POST', `/databases/${DATABASE_ID}/collections/${collectionId}/attributes/${typeEndpoint}`, body);
  if (!result) { console.log(`FAIL`); return false; }

  process.stdout.write(`waiting`);
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const check = await attributeExists(collectionId, key);
    if (check) { process.stdout.write(' OK\n'); return true; }
    process.stdout.write('.');
  }
  console.log(' TIMEOUT');
  return false;
}

async function setupCollection(collectionId) {
  const info = COLLECTIONS.find(c => c.id === collectionId);
  const attrs = ATTRIBUTES[collectionId];
  if (!attrs) { console.log(`  No attributes defined for "${collectionId}", skipping.`); return; }

  console.log(`\n=== ${info ? info.name : collectionId} (${attrs.length} attributes) ===`);

  const ready = await ensureCollection(collectionId, info ? info.name : collectionId);
  if (!ready) { console.log('  SKIPPED (could not create/find collection)'); return; }

  let ok = 0, fail = 0;
  for (const attr of attrs) {
    const r = await createAttribute(collectionId, attr);
    if (r) ok++; else fail++;
  }
  console.log(`  Result: ${ok} created, ${fail} failed`);
}

// ---- CRUD Verification ----

async function verifyCrud() {
  console.log('\n=== CRUD Verification ===');
  const db = DATABASE_ID;

  // Payment sessions CRUD
  const testSid = 'TST-' + Date.now().toString(36).toUpperCase();
  const sess = await api('POST', `/databases/${db}/collections/payment_sessions/documents`, {
    documentId: testSid,
    data: { sessionId: testSid, email: 'verify@test.com', name: 'Verify', phone: '9999999999', amount: '120', type: 'registration', paymentStatus: 'created', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900000).toISOString() },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(sess?.$id ? '  CREATE payment_sessions: PASS' : '  CREATE payment_sessions: FAIL');

  const read = await api('GET', `/databases/${db}/collections/payment_sessions/documents/${testSid}`);
  console.log(read?.sessionId === testSid ? '  READ payment_sessions: PASS' : '  READ payment_sessions: FAIL');

  const upd = await api('PATCH', `/databases/${db}/collections/payment_sessions/documents/${testSid}`, { data: { paymentStatus: 'verified' } });
  console.log(upd ? '  UPDATE payment_sessions: PASS' : '  UPDATE payment_sessions: FAIL');

  const testCode = 'VFY-' + Date.now().toString(36).toUpperCase();
  const codeDoc = await api('POST', `/databases/${db}/collections/verification_codes/documents`, {
    documentId: testCode,
    data: { code: testCode, sessionId: testSid, paymentStatus: 'active', approved: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), used: false },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(codeDoc?.$id ? '  CREATE verification_codes: PASS' : '  CREATE verification_codes: FAIL');

  const updCode = await api('PATCH', `/databases/${db}/collections/verification_codes/documents/${testCode}`, { data: { paymentStatus: 'used', approved: true, used: true } });
  console.log(updCode ? '  UPDATE verification_codes: PASS' : '  UPDATE verification_codes: FAIL');

  // Users CRUD
  const testUserId = 'usr-' + Date.now().toString(36);
  const user = await api('POST', `/databases/${db}/collections/users/documents`, {
    documentId: testUserId,
    data: { userId: testUserId, name: 'Test User', email: 'test@example.com', phone: '9888888888', status: 'pending', payment_status: 'unpaid', created_at: new Date().toISOString() },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(user?.$id ? '  CREATE users: PASS' : '  CREATE users: FAIL');

  const userRead = await api('GET', `/databases/${db}/collections/users/documents/${testUserId}`);
  console.log(userRead?.email === 'test@example.com' ? '  READ users: PASS' : '  READ users: FAIL');

  const userUpd = await api('PATCH', `/databases/${db}/collections/users/documents/${testUserId}`, { data: { status: 'active' } });
  console.log(userUpd ? '  UPDATE users: PASS' : '  UPDATE users: FAIL');

  // Topups CRUD
  const topupId = 'top-' + Date.now().toString(36);
  const topup = await api('POST', `/databases/${db}/collections/topups/documents`, {
    documentId: topupId,
    data: { userId: testUserId, amount: '120', status: 'pending', createdAt: new Date().toISOString() },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(topup?.$id ? '  CREATE topups: PASS' : '  CREATE topups: FAIL');

  // Notifications CRUD
  const notifId = 'not-' + Date.now().toString(36);
  const notif = await api('POST', `/databases/${db}/collections/notifications/documents`, {
    documentId: notifId,
    data: { receiverId: testUserId, title: 'Test', message: 'Test notification', type: 'info', status: 'unread', createdAt: new Date().toISOString() },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(notif?.$id ? '  CREATE notifications: PASS' : '  CREATE notifications: FAIL');

  // Chat CRUD
  const convoId = 'convo-' + testUserId;
  const convo = await api('POST', `/databases/${db}/collections/chat_conversations/documents`, {
    documentId: convoId,
    data: { convoId, userId: testUserId, userName: 'Test User', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(convo?.$id ? '  CREATE chat_conversations: PASS' : '  CREATE chat_conversations: FAIL');

  const msgId = 'msg-' + Date.now().toString(36);
  const msg = await api('POST', `/databases/${db}/collections/chat_messages/documents`, {
    documentId: msgId,
    data: { convoId, senderId: testUserId, receiverId: 'admin', messageText: 'Hello', createdAt: new Date().toISOString(), isRead: false, isDelivered: true },
    permissions: ['read("any")', 'write("any")'],
  });
  console.log(msg?.$id ? '  CREATE chat_messages: PASS' : '  CREATE chat_messages: FAIL');

  // List queries
  const userList = await api('GET', `/databases/${db}/collections/users/documents?queries=${encodeURIComponent(JSON.stringify({ method: 'equal', attribute: 'email', values: ['test@example.com'] }))}`);
  console.log(userList?.documents?.length > 0 ? '  LIST users by email: PASS' : '  LIST users by email: FAIL');

  // Cleanup
  const toDelete = [testSid, testCode, testUserId, topupId, notifId, convoId, msgId];
  const collections = ['payment_sessions', 'verification_codes', 'users', 'topups', 'notifications', 'chat_conversations', 'chat_messages'];
  for (let i = 0; i < toDelete.length; i++) {
    await api('DELETE', `/databases/${db}/collections/${collections[i]}/documents/${toDelete[i]}`);
  }
  console.log('  CLEANUP: done');
}

async function main() {
  console.log('=== Appwrite Full Schema Setup ===');
  console.log('Project:', PROJECT_ID);
  console.log('Database:', DATABASE_ID);
  console.log('');

  for (const col of COLLECTIONS) {
    await setupCollection(col.id);
  }

  console.log('\n=== Running CRUD Verification ===');
  await verifyCrud();

  console.log('\n=== Done ===');
  console.log('Next steps:');
  console.log('  1. Deploy Worker: cd my-worker && npx wrangler deploy');
  console.log('  2. Set Worker secret: npx wrangler secret put APPWRITE_API_KEY');
  console.log('  3. Update VITE_WORKER_URL in .env.local');
  console.log('  4. Restart: npm run dev');
}

main().catch(e => console.error('Fatal:', e));
