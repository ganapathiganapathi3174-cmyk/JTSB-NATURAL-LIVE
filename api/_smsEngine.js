const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_SMS_SESSIONS, MAX_REFERRALS, randomString,
  TEST_MODE, TEST_PAYMENT_AMOUNT,
  PACKAGES, ALLOWED_PACKAGE_AMOUNTS, getPackageByReferral, getReferrerPackage, validatePackageAmount,
} = require('./_shared.js');
const { runQuery, addDoc, writeDoc, updateDoc, getDoc, deleteDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');

const SESSION_TTL_MS = 30 * 60 * 1000;
const ALLOWED_AMOUNTS = TEST_MODE ? [...ALLOWED_PACKAGE_AMOUNTS, TEST_PAYMENT_AMOUNT] : ALLOWED_PACKAGE_AMOUNTS;
const memStore = new Map();
let usingMemStore = false;

function log(m) { console.log(`[${new Date().toISOString().slice(0,19).replace('T',' ')}] [SMS-ENGINE] ${m}`); }
function now() { return new Date().toISOString(); }
function future(ms) { return new Date(Date.now() + ms).toISOString(); }

async function ensureTable() {
  if (usingMemStore) return;
  try {
    await runQuery(COL_SMS_SESSIONS, [{ field: 'id', op: 'EQUAL', value: '00000000-0000-0000-0000-000000000000' }], { limit: 1 });
  } catch (e) {
    if (e.message && e.message.includes('Could not find the table')) {
      log('Table paymentSessions not found — trying auto-create...');
      try {
        const { Pool } = require('pg');
        const dbUrl = process.env.SUPABASE_DB_URL;
        if (dbUrl) {
          const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
          const sql = `CREATE TABLE IF NOT EXISTS public."paymentSessions" (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            "paymentType" TEXT NOT NULL,
            plan TEXT, amount NUMERIC NOT NULL, status TEXT DEFAULT 'pending',
            "userId" TEXT, "pendingRegId" TEXT, "transactionReference" TEXT,
            "transactionTime" TEXT, "createdAt" TIMESTAMPTZ DEFAULT NOW(),
            "expiresAt" TIMESTAMPTZ, "approvedAt" TIMESTAMPTZ,
            matched BOOLEAN DEFAULT FALSE, metadata JSONB DEFAULT '{}',
            "created_at" TIMESTAMPTZ DEFAULT NOW(), "updated_at" TIMESTAMPTZ DEFAULT NOW()
          )`;
          await pool.query(sql);
          await pool.end();
          log('Table created via SUPABASE_DB_URL');
          return;
        }
      } catch (err) {
        log('Auto-create failed: ' + err.message);
      }
      log('WARNING: Using in-memory storage. Set SUPABASE_DB_URL for persistent storage.');
      log('SQL: See api/_sms_table.sql to create the table manually.');
      usingMemStore = true;
    }
  }
}

function memAdd(data) {
  const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const doc = { ...data, id, created_at: now() };
  memStore.set(id, doc);
  return { id, ...doc };
}

function memUpdate(id, data) {
  const doc = memStore.get(id);
  if (doc) { Object.assign(doc, data, { updated_at: now() }); memStore.set(id, doc); }
  return true;
}

function memQuery(filters) {
  let results = Array.from(memStore.values());
  for (const f of filters || []) {
    if (f.op === 'EQUAL') results = results.filter(r => r[f.field] === f.value);
    else if (f.op === 'NOT_EQUAL') results = results.filter(r => r[f.field] !== f.value);
  }
  return results.sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
}

function extractAmount(smsBody) {
  if (!smsBody) return null;
  const patterns = [
    /(?:Rs\.?|INR|₹)\s*(\d{1,9}(?:[.,]\d{1,2})?)/i,
    /(?:credited|debited|paid|received|sent)\s+Rs\.?\s*(\d{1,9}(?:[.,]\d{1,2})?)/i,
    /(?:amount|amt)[:\s]*Rs\.?\s*(\d{1,9}(?:[.,]\d{1,2})?)/i,
    /(\d{1,9}(?:[.,]\d{1,2})?)\s*(?:Rs\.?|INR|₹)/i,
    /(?:of|for)\s*Rs\.?\s*(\d{1,9}(?:[.,]\d{1,2})?)/i,
  ];
  for (const p of patterns) {
    const m = smsBody.match(p);
    if (m) {
      let v = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isInteger(v)) return v;
      return Math.round(v);
    }
  }
  return null;
}

function extractReference(smsBody) {
  if (!smsBody) return null;
  const patterns = [
    /(?:UTR|Ref|Reference|Transaction\s*ID|Txn\s*Id)[:\s]*([A-Z0-9]{6,})/i,
    /(?:ref[:\s]*|utr[:\s]*)([A-Z0-9]{6,})/i,
    /\b(\d{12,})\b/,
  ];
  for (const p of patterns) { const m = smsBody.match(p); if (m) return m[1]; }
  return null;
}

function extractTime(smsBody) {
  if (!smsBody) return null;
  const patterns = [
    /(?:on|at|date)[:\s]*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i,
    /(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?)/,
    /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/,
  ];
  for (const p of patterns) { const m = smsBody.match(p); if (m) return m[1]; }
  return null;
}

function validateSmsFormat(smsBody) {
  if (!smsBody || smsBody.length < 20) return false;
  return /(?:Rs\.?|INR|₹|\d{2,})/i.test(smsBody) &&
    /(?:credited|debited|paid|received|sent|transfer|payment|transaction|txn|ref|UTR)/i.test(smsBody);
}

async function createSession(data) {
  await ensureTable();
  const { paymentType, type, plan, amount, userId, pendingRegId, email } = data;
  const pt = paymentType || type;
  if (!pt || !['registration', 'topup'].includes(pt)) throw Object.assign(new Error('paymentType must be registration or topup'), { status: 400 });
  if (!amount || amount <= 0 || isNaN(amount)) throw Object.assign(new Error('A valid positive amount is required'), { status: 400 });
  const finalAmount = Math.round(parseFloat(amount));
  if (!ALLOWED_AMOUNTS.includes(finalAmount)) throw Object.assign(new Error('Amount must be one of: ' + ALLOWED_AMOUNTS.map(a => '₹' + a).join(', ')), { status: 400 });
  if (pt === 'registration' && !pendingRegId) throw Object.assign(new Error('pendingRegId required for registration'), { status: 400 });
  if (pt === 'topup' && !userId) throw Object.assign(new Error('userId required for topup'), { status: 400 });
  const session = {
    paymentType: pt,
    plan: plan || String(finalAmount),
    amount: finalAmount,
    status: 'pending',
    userId: pt === 'topup' ? userId : null,
    pendingRegId: pt === 'registration' ? pendingRegId : null,
    transactionReference: null, transactionTime: null,
    createdAt: now(), expiresAt: future(SESSION_TTL_MS),
    approvedAt: null, matched: false, metadata: {},
  };

  if (pt === 'registration' && pendingRegId) {
    const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pending) throw Object.assign(new Error('Pending registration not found'), { status: 404 });
    session.metadata.email = pending.email || email || null;
    session.metadata.name = pending.name || null;
    const refCode = pending.referral_code;
    if (refCode) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
      let allowedPkg = null;
      if (refUsers.length) {
        allowedPkg = getReferrerPackage(refUsers[0]);
      } else {
        allowedPkg = getPackageByReferral(refCode);
      }
      if (allowedPkg && !validatePackageAmount(allowedPkg, finalAmount)) {
        throw Object.assign(new Error('This referral link accepts only \u20B9' + allowedPkg + ' package. Selected \u20B9' + finalAmount + ' does not match.'), { status: 400 });
      }
    }
  } else if (pt === 'topup' && userId) {
    const user = await getDoc(COL_USERS, userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    session.metadata.email = user.email || email || null;
    const userPkg = getReferrerPackage(user);
    if (userPkg && !validatePackageAmount(userPkg, finalAmount)) {
      throw Object.assign(new Error('Your ' + userPkg + ' package only accepts \u20B9' + userPkg + ' topup. Selected \u20B9' + finalAmount + ' does not match.'), { status: 400 });
    }
  }

  if (usingMemStore) {
    const doc = memAdd(session);
    log(`Session created (mem): id=${doc.id}, paymentType=${pt}, amount=${finalAmount}, plan=${session.plan}`);
    return { sessionId: doc.id, paymentType: pt, amount: finalAmount, plan: session.plan, status: 'pending', expiresAt: session.expiresAt };
  }

  const doc = await addDoc(COL_SMS_SESSIONS, session);
  if (!doc || !doc.id) throw Object.assign(new Error('Failed to create session'), { status: 500 });
  log(`Session created: id=${doc.id}, paymentType=${pt}, amount=${finalAmount}, plan=${session.plan}`);
  return { sessionId: doc.id, paymentType: pt, amount: finalAmount, plan: session.plan, status: 'pending', expiresAt: session.expiresAt };
}

async function processSmsAndApprove(data) {
  await ensureTable();
  const { amount, reference, time, bank, smsBody } = data;
  if (!smsBody) return { matched: false, error: 'smsBody is required' };
  if (!validateSmsFormat(smsBody)) return { matched: false, error: 'Invalid SMS format' };

  const extractedAmount = extractAmount(smsBody);
  const extractedRef = extractReference(smsBody);
  const extractedTime = extractTime(smsBody);
  const matchAmount = amount ? Math.round(parseFloat(amount)) : extractedAmount;
  const matchRef = reference || extractedRef;
  const matchTime = time || extractedTime;

  if (!matchAmount || matchAmount <= 0) return { matched: false, error: 'Could not determine payment amount from SMS' };
  if (!matchRef) return { matched: false, error: 'Could not determine transaction reference from SMS' };

  let existingSessions;
  if (usingMemStore) {
    existingSessions = memQuery([{ field: 'transactionReference', op: 'EQUAL', value: matchRef }]).slice(0, 1);
  } else {
    existingSessions = await runQuery(COL_SMS_SESSIONS, [
      { field: 'transactionReference', op: 'EQUAL', value: matchRef },
    ], { limit: 1 });
  }

  if (existingSessions.length > 0) {
    log(`Duplicate ref=${matchRef}`);
    return { matched: false, error: 'Duplicate transaction reference', existingSessionId: existingSessions[0].id };
  }

  let pendingSessions;
  if (usingMemStore) {
    pendingSessions = memQuery([
      { field: 'amount', op: 'EQUAL', value: matchAmount },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ]);
  } else {
    pendingSessions = await runQuery(COL_SMS_SESSIONS, [
      { field: 'amount', op: 'EQUAL', value: matchAmount },
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { orderBy: 'createdAt', ascending: true });
  }

  if (!pendingSessions || pendingSessions.length === 0) {
    log(`No pending session for amount=${matchAmount}`);
    return { matched: false, error: 'No pending session matches the payment amount' };
  }

  const nowTime = Date.now();
  let matchedSession = null;
  for (const session of pendingSessions) {
    if (nowTime > new Date(session.expiresAt).getTime()) {
      if (usingMemStore) memUpdate(session.id, { status: 'expired' });
      else await updateDoc(COL_SMS_SESSIONS, session.id, { status: 'expired' });
      log(`Session ${session.id} expired`);
      continue;
    }
    matchedSession = session;
    break;
  }

  if (!matchedSession) return { matched: false, error: 'All matching sessions have expired' };
  log(`Match found: session=${matchedSession.id}, paymentType=${matchedSession.paymentType}, amount=${matchAmount}`);

  if (usingMemStore) {
    memUpdate(matchedSession.id, { status: 'matched', transactionReference: matchRef, transactionTime: matchTime || now(), matched: true });
  } else {
    await updateDoc(COL_SMS_SESSIONS, matchedSession.id, {
      status: 'matched', transactionReference: matchRef,
      transactionTime: matchTime || now(), matched: true,
      metadata: { ...matchedSession.metadata, bank: bank || null, smsReceivedAt: now() },
    });
  }

  try {
    let approveResult;
    if (matchedSession.paymentType === 'registration') approveResult = await approveRegistration(matchedSession, matchRef);
    else approveResult = await approveTopup(matchedSession, matchRef);

    if (usingMemStore) memUpdate(matchedSession.id, { status: 'approved', approvedAt: now() });
    else await updateDoc(COL_SMS_SESSIONS, matchedSession.id, { status: 'approved', approvedAt: now() });

    log(`Session ${matchedSession.id} approved`);
    try { broadcast('smsPaymentApproved', { sessionId: matchedSession.id, paymentType: matchedSession.paymentType, amount: matchAmount, status: 'approved' }); } catch (e) { log(`Broadcast smsPaymentApproved failed: ${e.message}`); }
    return { matched: true, sessionId: matchedSession.id, paymentType: matchedSession.paymentType, amount: matchAmount, status: 'approved', ...approveResult };
  } catch (err) {
    log(`Approval failed: ${err.message}`);
    if (usingMemStore) memUpdate(matchedSession.id, { status: 'matched', approvalError: err.message });
    else await updateDoc(COL_SMS_SESSIONS, matchedSession.id, { status: 'matched', approvalError: err.message });
    return { matched: true, sessionId: matchedSession.id, error: 'Approval failed: ' + err.message };
  }
}

async function approveRegistration(session, transactionReference) {
  const pendingRegId = session.pendingRegId;
  if (!pendingRegId) throw new Error('No pending registration ID');
  const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
  if (!pending) throw new Error('Pending registration not found');

  const newUserId = require('crypto').randomUUID();
  let referredByUserId = null, referredByCode = null;
  if (pending.referral_code) {
    const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: pending.referral_code }], { limit: 1 });
    if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = pending.referral_code; }
  }

  const userPkg = getReferrerPackage(pending) || getPackageByReferral(pending.referral_code) || String(session.amount);

  await writeDoc(COL_USERS, newUserId, {
    id: newUserId, email: pending.email || '', name: pending.name || '',
    phone: pending.phone || '', password_hash: pending.password_hash,
    referral_code: randomString(8), referred_by: referredByCode,
    account_status: 'active', payment_status: 'success',
    approved: true, active: true, membership_paid: true,
    membership_type: userPkg,
    joined_date: now(), approved_date: now(), plan: session.plan || String(session.amount),
  });

  await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: session.amount });
  await addDoc(COL_WALLET_TX, { user_id: newUserId, type: 'deposit', amount: session.amount, description: 'Registration (SMS auto)', reference_id: transactionReference, balance_after: session.amount });

  if (referredByUserId) await atomicCreditWallet(referredByUserId, session.amount * 0.1, transactionReference, 'Referral from ' + newUserId, 'referral_bonus');

  // Increment referrer's referral count
  if (referredByUserId) {
    try {
      const referrerDoc = await getDoc(COL_USERS, referredByUserId);
      if (referrerDoc) {
        const currentCount = (referrerDoc.referrals_count || 0) + 1;
        const limitReached = currentCount >= MAX_REFERRALS;
        await updateDoc(COL_USERS, referredByUserId, {
          referrals_count: currentCount,
          total_referral_count: (referrerDoc.total_referral_count || 0) + 1,
          referral_limit_reached: limitReached,
          referral_active: !limitReached,
          is_qualified: limitReached,
        });
        await updateDoc(COL_USERS, newUserId, { referred_by_status: 'approved' });
      }
    } catch (e) { log(`Referral count increment error: ${e.message}`); }
  }

  try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch (e) { log(`Delete pending registration failed: ${e.message}`); }
  try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Payment of ₹' + session.amount + ' confirmed via SMS!', type: 'payment_approved', status: 'unread', createdAt: now(), senderId: 'system', senderName: 'System' }); } catch (e) { log(`Registration notification failed: ${e.message}`); }
  try { await addDoc('audit_logs', { action: 'sms_auto_approve_registration', target_id: transactionReference, target_type: 'sms_payment', admin_id: 'system', details: { userId: newUserId, sessionId: session.id, amount: session.amount, plan: session.plan }, created_at: now() }); } catch (e) { log(`Registration audit log failed: ${e.message}`); }

  log(`Registration approved: userId=${newUserId}, amount=${session.amount}, plan=${session.plan}`);
  return { userId: newUserId, paymentType: 'registration', plan: session.plan };
}

async function approveTopup(session, transactionReference) {
  const userId = session.userId;
  if (!userId) throw new Error('No user ID');
  const user = await getDoc(COL_USERS, userId);
  if (!user) throw new Error('User not found');
  const amount = session.amount;

  await atomicCreditWallet(userId, amount, transactionReference, 'Topup via SMS auto');
  const topupId = (await addDoc(COL_TOPUPS, { user_id: userId, amount, utr: transactionReference, screenshot_url: null, status: 'approved', verified_at: now() })).id;

  const referredByCode = user.referred_by || null;
  if (referredByCode) {
    try {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
      const referrer = refUsers.length ? refUsers[0] : null;
      if (referrer) {
        const { COL_TOPUP_INCOME } = require('./_shared.js');
        const st = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: referrer.id }, { field: 'status', op: 'EQUAL', value: 'approved' }], { limit: 1 });
        await addDoc(COL_TOPUP_INCOME, { user_id: referrer.id, from_user_id: userId, topup_id: topupId, amount, level: 1, status: st.length > 0 ? 'eligible' : 'locked' });
        await updateDoc(COL_USERS, referrer.id, { topup_referral_qualified_count: (referrer.topup_referral_qualified_count || 0) + 1 });
        if (user.referred_by_status !== 'approved') await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
      }
    } catch (e) { log(`Topup referral error: ${e.message}`); }
  }

  try { await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Topup of ₹' + amount + ' confirmed via SMS.', type: 'payment_approved', status: 'unread', createdAt: now(), senderId: 'system', senderName: 'System' }); } catch (e) { log(`Topup notification failed: ${e.message}`); }
  try { await addDoc('audit_logs', { action: 'sms_auto_approve_topup', target_id: transactionReference, target_type: 'sms_payment', admin_id: 'system', details: { userId, sessionId: session.id, amount }, created_at: now() }); } catch (e) { log(`Topup audit log failed: ${e.message}`); }

  log(`Topup approved: userId=${userId}, amount=${amount}`);
  return { userId, paymentType: 'topup' };
}

module.exports = { createSession, processSmsAndApprove, extractAmount, extractReference, validateSmsFormat };
