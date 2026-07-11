const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_PAYMENT_CONFIRM_SESSIONS, MAX_REFERRALS, randomString,
  TEST_MODE, TEST_PAYMENT_AMOUNT,
} = require('./_shared.js');
const { runQuery, addDoc, writeDoc, updateDoc, getDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const crypto = require('crypto');

const BASE_PLANS = { registration: [120, 500, 1000], topup: [120, 500, 1000] };
const ALLOWED_PLANS = TEST_MODE
  ? { registration: [...BASE_PLANS.registration, TEST_PAYMENT_AMOUNT], topup: [...BASE_PLANS.topup, TEST_PAYMENT_AMOUNT] }
  : BASE_PLANS;
const SESSION_TTL_MS = 30 * 60 * 1000;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [PAYMENT-CONFIRM] ${msg}`);
}

function now() {
  return new Date().toISOString();
}

function future(ms) {
  return new Date(Date.now() + ms).toISOString();
}

async function createSession(data) {
  const { type, plan, amount, pendingRegId, userId, email } = data;

  if (!type || !ALLOWED_PLANS[type]) throw Object.assign(new Error('Invalid payment type'), { status: 400 });
  if (!ALLOWED_PLANS[type].includes(amount)) throw Object.assign(new Error('Invalid amount for ' + type), { status: 400 });

  const session = {
    type,
    plan,
    amount,
    status: 'pending',
    transactionReference: null,
    transactionTime: null,
    createdAt: now(),
    expiresAt: future(SESSION_TTL_MS),
    approvedAt: null,
    metadata: {},
  };

  if (type === 'registration') {
    if (!pendingRegId) throw Object.assign(new Error('pendingRegId required for registration'), { status: 400 });
    session.pendingRegId = pendingRegId;
    session.userId = null;
    const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pending) throw Object.assign(new Error('Pending registration not found'), { status: 404 });
    session.metadata.email = pending.email || email || null;
    session.metadata.name = pending.name || null;
  } else {
    if (!userId) throw Object.assign(new Error('userId required for topup'), { status: 400 });
    session.userId = userId;
    session.pendingRegId = null;
    const user = await getDoc(COL_USERS, userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    session.metadata.email = user.email || email || null;
  }

  const doc = await addDoc(COL_PAYMENT_CONFIRM_SESSIONS, session);
  if (!doc || !doc.id) throw Object.assign(new Error('Failed to create session'), { status: 500 });

  log(`Session created: id=${doc.id}, type=${type}, amount=${amount}, status=pending`);

  return {
    sessionId: doc.id,
    type,
    amount,
    plan,
    status: 'pending',
    expiresAt: session.expiresAt,
  };
}

async function matchAndApprove(data) {
  const { amount, transactionReference, transactionTime } = data;

  if (!amount || !transactionReference) {
    return { matched: false, error: 'amount and transactionReference are required' };
  }

  if (transactionTime && isNaN(Date.parse(transactionTime))) {
    return { matched: false, error: 'Invalid transactionTime format' };
  }

  const dupCheck = await runQuery(COL_PAYMENT_CONFIRM_SESSIONS, [
    { field: 'transactionReference', op: 'EQUAL', value: transactionReference },
  ], { limit: 1 });
  if (dupCheck.length > 0) {
    const existing = dupCheck[0];
    log(`Duplicate ref=${transactionReference}, existing session=${existing.id}, status=${existing.status}`);
    return {
      matched: false,
      error: 'Transaction reference already processed',
      existingSessionId: existing.id,
      existingStatus: existing.status,
    };
  }

  const pendingSessions = await runQuery(COL_PAYMENT_CONFIRM_SESSIONS, [
    { field: 'amount', op: 'EQUAL', value: amount },
    { field: 'status', op: 'EQUAL', value: 'pending' },
  ], { orderBy: 'createdAt', ascending: true });

  if (!pendingSessions || pendingSessions.length === 0) {
    log(`No pending session for amount=${amount}`);
    return { matched: false, error: 'No pending session found for this amount' };
  }

  const nowTime = Date.now();
  let matchedSession = null;

  for (const session of pendingSessions) {
    const expiresAt = new Date(session.expiresAt).getTime();
    if (nowTime > expiresAt) {
      await updateDoc(COL_PAYMENT_CONFIRM_SESSIONS, session.id, { status: 'expired' });
      log(`Session ${session.id} expired, marked expired`);
      continue;
    }
    matchedSession = session;
    break;
  }

  if (!matchedSession) {
    log(`All pending sessions for amount=${amount} are expired`);
    return { matched: false, error: 'All matching sessions have expired' };
  }

  log(`Match found: session=${matchedSession.id}, type=${matchedSession.type}, amount=${amount}`);

  await updateDoc(COL_PAYMENT_CONFIRM_SESSIONS, matchedSession.id, {
    status: 'matched',
    transactionReference,
    transactionTime: transactionTime || now(),
  });

  try {
    let approveResult;
    if (matchedSession.type === 'registration') {
      approveResult = await approveRegistration(matchedSession, transactionReference);
    } else {
      approveResult = await approveTopup(matchedSession, transactionReference);
    }

    await updateDoc(COL_PAYMENT_CONFIRM_SESSIONS, matchedSession.id, {
      status: 'approved',
      approvedAt: now(),
    });

    log(`Session ${matchedSession.id} approved successfully`);

    try {
      broadcast('paymentConfirmed', {
        sessionId: matchedSession.id,
        type: matchedSession.type,
        amount,
        status: 'approved',
      });
    } catch (_) {}

    return {
      matched: true,
      sessionId: matchedSession.id,
      type: matchedSession.type,
      amount,
      status: 'approved',
      ...approveResult,
    };
  } catch (err) {
    log(`Approval failed for session ${matchedSession.id}: ${err.message}`);
    await updateDoc(COL_PAYMENT_CONFIRM_SESSIONS, matchedSession.id, {
      status: 'matched',
      approvalError: err.message,
    });
    return { matched: true, sessionId: matchedSession.id, error: 'Approval failed: ' + err.message };
  }
}

async function approveRegistration(session, transactionReference) {
  const pendingRegId = session.pendingRegId;
  if (!pendingRegId) throw new Error('No pending registration ID');

  const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
  if (!pending) throw new Error('Pending registration not found or already processed');

  const newUserId = crypto.randomUUID();
  const userName = pending.name || '';
  const userEmail = pending.email || '';
  const userPhone = pending.phone || '';

  const refCode = pending.referral_code;
  let referredByUserId = null;
  let referredByCode = null;
  if (refCode) {
    const refUsers = await runQuery(COL_USERS, [
      { field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() },
    ], { limit: 1 });
    if (refUsers.length) {
      referredByUserId = refUsers[0].id;
      referredByCode = refCode.toUpperCase();
    }
  }

  await writeDoc(COL_USERS, newUserId, {
    id: newUserId, email: userEmail, name: userName,
    phone: userPhone, password_hash: pending.password_hash,
    referral_code: randomString(8), referred_by: referredByCode,
    account_status: 'active', payment_status: 'success',
    approved: true, active: true, membership_paid: true,
    joined_date: now(), approved_date: now(),
    plan: session.plan || session.amount,
  });

  await writeDoc(COL_WALLET_BALANCES, newUserId, {
    balance: 0, total_earned: session.amount,
  });
  await addDoc(COL_WALLET_TX, {
    user_id: newUserId, type: 'deposit', amount: session.amount,
    description: 'Registration payment (auto-confirm)',
    reference_id: transactionReference, balance_after: session.amount,
  });

  if (referredByUserId) {
    await atomicCreditWallet(
      referredByUserId, session.amount * 0.1, transactionReference,
      'Referral bonus for ' + newUserId, 'referral_bonus'
    );
    // Increment referrer's referral count
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
      }
    } catch (e) { log(`Referral count increment error: ${e.message}`); }
  }

  try {
    await updateDoc(COL_USERS, newUserId, { referred_by_status: 'approved' });
  } catch (_) {}

  try {
    const { deleteDoc } = require('./_supabase.js');
    await deleteDoc(COL_PENDING_REGS, pendingRegId);
  } catch (_) {}

  try {
    await addDoc('notifications', {
      receiverId: newUserId, title: 'Registration Approved',
      message: 'Your registration payment of \u20B9' + session.amount + ' has been confirmed.',
      type: 'payment_approved', status: 'unread', createdAt: now(),
      senderId: 'system', senderName: 'System',
    });
  } catch (_) {}

  try {
    await addDoc('audit_logs', {
      action: 'auto_approve_registration', target_id: transactionReference,
      target_type: 'payment_confirm', admin_id: 'system',
      details: { userId: newUserId, sessionId: session.id, amount: session.amount },
      created_at: now(),
    });
  } catch (_) {}

  log(`Registration approved: userId=${newUserId}, amount=${session.amount}`);

  return { userId: newUserId, type: 'registration' };
}

async function approveTopup(session, transactionReference) {
  const userId = session.userId;
  if (!userId) throw new Error('No user ID');

  const user = await getDoc(COL_USERS, userId);
  if (!user) throw new Error('User not found');

  const amount = session.amount;

  await atomicCreditWallet(userId, amount, transactionReference, 'Topup via auto-confirm');

  const topupId = (await addDoc(COL_TOPUPS, {
    user_id: userId, amount, utr: transactionReference,
    screenshot_url: null, status: 'approved', verified_at: now(),
  })).id;

  const referredByCode = user.referred_by || null;
  if (referredByCode) {
    try {
      const refUsers = await runQuery(COL_USERS, [
        { field: 'referral_code', op: 'EQUAL', value: referredByCode },
      ], { limit: 1 });
      const referrer = refUsers.length ? refUsers[0] : null;
      if (referrer) {
        const { COL_TOPUP_INCOME } = require('./_shared.js');
        const sponsorTopups = await runQuery(COL_TOPUPS, [
          { field: 'user_id', op: 'EQUAL', value: referrer.id },
          { field: 'status', op: 'EQUAL', value: 'approved' },
        ], { limit: 1 });
        const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';
        await addDoc(COL_TOPUP_INCOME, {
          user_id: referrer.id, from_user_id: userId,
          topup_id: topupId, amount, level: 1, status: incomeStatus,
        });
        const currentCount = referrer.topup_referral_qualified_count || 0;
        await updateDoc(COL_USERS, referrer.id, {
          topup_referral_qualified_count: currentCount + 1,
          topup_referral_qualified: (referrer.referrals_count || 0) + currentCount + 1 >= MAX_REFERRALS,
        });
        if (user.referred_by_status !== 'approved') {
          await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
        }
      }
    } catch (e) {
      log(`Topup referral processing failed: ${e.message}`);
    }
  }

  try {
    await addDoc('notifications', {
      receiverId: userId, title: 'Topup Approved',
      message: 'Your topup of \u20B9' + amount + ' has been confirmed.',
      type: 'payment_approved', status: 'unread', createdAt: now(),
      senderId: 'system', senderName: 'System',
    });
  } catch (_) {}

  try {
    await addDoc('audit_logs', {
      action: 'auto_approve_topup', target_id: transactionReference,
      target_type: 'payment_confirm', admin_id: 'system',
      details: { userId, sessionId: session.id, amount },
      created_at: now(),
    });
  } catch (_) {}

  log(`Topup approved: userId=${userId}, amount=${amount}`);

  return { userId, type: 'topup' };
}

module.exports = { createSession, matchAndApprove };
