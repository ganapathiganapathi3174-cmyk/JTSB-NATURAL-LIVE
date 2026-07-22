const crypto = require('crypto');
const {
  COL_USERS, COL_PENDING_REGS, COL_UPI_PAYMENTS, COL_ORDERS,
  COL_WALLET_BALANCES, COL_WALLET_TX, COL_TOPUP_INCOME,
  COL_REFERRALS, COL_NOTIFICATIONS, COL_VERIFICATION_LOGS,
  MAX_REFERRALS, randomString, ADMIN_UPI_ID, isSystemReferralCode,
  getReferrerPackage, getPackageByReferral, validatePackageAmount,
} = require('./_shared.js');
const { runQuery, addDoc, writeDoc, updateDoc, getDoc, deleteDoc, conditionalUpdateDoc, atomicCreditWallet, getSupabaseClient } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const { runOfficerVerificationForWorker } = require('./_verificationOfficer.js');

const ORDER_TTL_MS = 30 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 180 * 1000;
const VERIFY_LOCK_TIMEOUT_MS = 180000;

// In-flight verification tracker
const verifyingOrders = new Set();
// Background queue for pending payment verification
const pendingVerificationQueue = new Set();
let verificationWorkerRunning = false;
const VERIFICATION_POLL_MS = 3000;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [ORDER-MGR] ${msg}`);
}
function now() { return new Date().toISOString(); }

function makeTimer() {
  const marks = {};
  const start = Date.now();
  function mark(name) {
    const elapsed = Date.now() - start;
    const prev = marks[name];
    if (prev) {
      marks[name] = { at: elapsed, sincePrev: elapsed - (marks._last || 0) };
    } else {
      marks[name] = { at: elapsed, sincePrev: elapsed - (marks._last || 0) };
    }
    marks._last = elapsed;
    const sp = marks[name].sincePrev;
    log('[TIMING] ' + name + ' +' + elapsed + 'ms (+' + sp + 'ms since prev)');
    if (sp > 2000) log('[BOTTLENECK] "' + name + '" took ' + sp + 'ms (> 2s threshold)');
    return elapsed;
  }
  function summary() {
    const total = Date.now() - start;
    log('=== TIMING TABLE (total=' + total + 'ms) ===');
    for (const [k, v] of Object.entries(marks)) {
      if (k === '_last') continue;
      log('  ' + k + ': ' + v.sincePrev + 'ms');
    }
    return total;
  }
  return { mark, summary, start: () => Date.now() - start };
}

async function lookupUser(userId) {
  try { const u = await getDoc(COL_USERS, userId); if (u) return u; } catch {}
  const found = await runQuery(COL_USERS, [{ field: 'email', op: 'EQUAL', value: userId }], { limit: 1 });
  if (found.length) return found[0];
  return null;
}

async function createPaymentOrder(type, amount, userId, pendingRegId) {
  if (!type || !['registration', 'topup'].includes(type)) {
    throw Object.assign(new Error('Invalid payment type'), { status: 400 });
  }
  if (!amount || amount < 1) {
    throw Object.assign(new Error('Valid amount is required'), { status: 400 });
  }
  if (type === 'registration' && !pendingRegId) {
    throw Object.assign(new Error('pendingRegId is required for registration'), { status: 400 });
  }
  if (type === 'topup' && !userId) {
    throw Object.assign(new Error('userId is required for topup'), { status: 400 });
  }

  if (type === 'registration' && pendingRegId) {
    const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pending) throw Object.assign(new Error('Pending registration not found'), { status: 404 });

    // Package validation: check if referral chain restricts the amount
    const refCode = pending.referral_code;
    if (refCode) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
      let allowedPkg = null;
      if (refUsers.length) {
        allowedPkg = getReferrerPackage(refUsers[0]);
      } else {
        allowedPkg = getPackageByReferral(refCode);
      }
      if (allowedPkg && !validatePackageAmount(allowedPkg, amount)) {
        throw Object.assign(new Error('This referral link accepts only the \u20B9' + allowedPkg + ' package. Selected \u20B9' + amount + ' does not match.'), { status: 400 });
      }
    }
  } else if (type === 'topup' && userId) {
    const user = await lookupUser(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

    // Topup package validation
    const userPkg = getReferrerPackage(user);
    if (userPkg && !validatePackageAmount(userPkg, amount)) {
      throw Object.assign(new Error('Your ' + userPkg + ' package only accepts \u20B9' + userPkg + ' topup. Selected \u20B9' + amount + ' does not match.'), { status: 400 });
    }
  }

  const orderId = 'ORD-' + randomString(12);
  const expiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();

  const supabase = getSupabaseClient();
  let insertResult;
  try {
    const { data, error } = await supabase.from(COL_ORDERS).insert({
      id: orderId,
      user_id: userId || null,
      type,
      amount: Number(amount),
      status: 'pending',
      expires_at: expiresAt,
    }).select('id').single();
    if (error) throw error;
    insertResult = data;
  } catch (insertErr) {
    log('Order insert failed: ' + (insertErr?.message || JSON.stringify(insertErr)));
    console.error('[ORDER-INSERT] Full error:', insertErr);
    throw Object.assign(new Error('Failed to create payment order'), { status: 500 });
  }
  if (!insertResult) {
    log('Order insert returned no data');
    throw Object.assign(new Error('Failed to create payment order: no data returned'), { status: 500 });
  }

  const finalOrderId = insertResult.id;

  let paymentUserId = null;
  let paymentPendingRegId = null;
  if (type === 'registration') {
    paymentPendingRegId = pendingRegId;
  } else {
    paymentUserId = userId;
  }

  await addDoc(COL_UPI_PAYMENTS, {
    utr: null,
    upi_id: ADMIN_UPI_ID,
    amount: Number(amount),
    amount_option: String(amount),
    payment_type: type,
    screenshot_url: null,
    status: 'pending',
    user_id: paymentUserId,
    pending_reg_id: paymentPendingRegId,
    payment_date: now(),
    verification_locked: false,
    created_at: now(),
  }).catch(e => log('UPI_PAYMENTS insert failed (non-fatal): ' + e.message));

  log(`CREATE order=${finalOrderId} type=${type} amount=${amount} expectedUpi=${ADMIN_UPI_ID}`);

  try { broadcast('paymentCreated', { orderId: finalOrderId, type, amount, status: 'pending' }); } catch {}

  return {
    orderId: finalOrderId,
    type,
    amount: Number(amount),
    expectedUpi: ADMIN_UPI_ID,
    status: 'pending',
    expiresAt,
    pendingRegId: type === 'registration' ? pendingRegId : null,
    userId: userId || paymentPendingRegId,
  };
}

async function getPaymentOrder(orderId) {
  const order = await getDoc(COL_ORDERS, orderId).catch(() => null);
  if (!order) return null;
  if (order.status === 'pending' && order.expires_at && Date.now() > new Date(order.expires_at).getTime()) {
    order.status = 'expired';
    await updateDoc(COL_ORDERS, orderId, { status: 'expired', updated_at: now() }).catch(() => {});
    try { broadcast('paymentUpdated', { orderId, status: 'expired' }); } catch {}
  }
  return order;
}

const IS_VERCEL = !!process.env.VERCEL;

async function submitPaymentProof(orderId, screenshotUrl, extra) {
  const order = await getPaymentOrder(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'expired') throw Object.assign(new Error('Order expired'), { status: 400 });
  if (order.status === 'verified') throw Object.assign(new Error('Order already verified'), { status: 400 });

  // Duplicate request lock
  if (verifyingOrders.has(orderId)) throw Object.assign(new Error('Verification already in progress'), { status: 409 });
  verifyingOrders.add(orderId);
  setTimeout(() => verifyingOrders.delete(orderId), VERIFY_LOCK_TIMEOUT_MS);

  // Store screenshot + UTR — set to pending, worker picks it up
  try {
    await updateDoc(COL_ORDERS, orderId, {
      status: 'pending',
      verification_status: 'pending',
      screenshot_url: screenshotUrl,
      utr: extra?.userEnteredUtr || null,
      updated_at: now(),
    });
  } catch (dbErr) {
    log('Failed to update order ' + orderId + ': ' + dbErr.message);
    verifyingOrders.delete(orderId);
    throw Object.assign(new Error('Failed to save payment proof. Please try again.'), { status: 500 });
  }

  // Persist screenshot + UTR to upi_payments for admin visibility
  try {
    const pendingRegId = extra?.pendingRegId || order.pending_reg_id;
    if (pendingRegId) {
      const existingPayments = await runQuery(COL_UPI_PAYMENTS, [
        { field: 'pending_reg_id', op: 'EQUAL', value: pendingRegId },
      ], { limit: 5 });
      for (const p of existingPayments) {
        await updateDoc(COL_UPI_PAYMENTS, p.id, {
          screenshot_url: screenshotUrl,
          utr: extra?.userEnteredUtr || p.utr,
          verification_locked: false,
        }).catch(() => {});
      }
    } else if (order.user_id) {
      const existingPayments = await runQuery(COL_UPI_PAYMENTS, [
        { field: 'user_id', op: 'EQUAL', value: order.user_id },
      ], { limit: 5 });
      for (const p of existingPayments) {
        await updateDoc(COL_UPI_PAYMENTS, p.id, {
          screenshot_url: screenshotUrl,
          utr: extra?.userEnteredUtr || p.utr,
          verification_locked: false,
        }).catch(() => {});
      }
    }
  } catch (e) { log('Failed to save screenshot/UTR to upi_payments: ' + e.message); }

  // Enqueue for background verification
  pendingVerificationQueue.add(orderId);
  if (!verificationWorkerRunning) runVerificationWorker();

  log('[QUEUE_STARTED] order ' + orderId + ' enqueued');
  log('Payment enqueued for background verification: ' + orderId);

  // Return immediately — frontend gets final status via SSE push + polling
  return {
    orderId, paymentId: orderId,
    status: 'pending',
    verificationStatus: 'pending',
    verificationScore: 0,
    reasons: [],
    matchedAmount: false, matchedReceiver: false, matchedUtr: false,
    matchedDate: false, userUtrMatched: false,
    userEnteredUtr: extra?.userEnteredUtr || null,
    userUpiMatched: false,
    userEnteredUpi: extra?.userEnteredUpi || null,
    fraudScore: 0, checks: [],
  };
}

// ── Background Verification Worker ──
// Picks up orders from the queue, runs verification, updates DB, broadcasts SSE.
async function runVerificationWorker() {
  verificationWorkerRunning = true;
  log('Verification worker started');

  while (pendingVerificationQueue.size > 0) {
    const orderId = pendingVerificationQueue.values().next().value;
    pendingVerificationQueue.delete(orderId);

    try {
      const order = await getDoc(COL_ORDERS, orderId);
      if (!order) { log('Worker: order not found ' + orderId); continue; }
      if (order.status !== 'pending') {
        log('Worker: order ' + orderId + ' status=' + order.status + ' not pending, skipping');
        continue;
      }
      if (!order.screenshot_url) {
        log('Worker: order ' + orderId + ' has no screenshot, manual_review');
        await updateDoc(COL_ORDERS, orderId, { status: 'manual_review', verification_status: 'manual_review', rejection_reasons: ['No screenshot provided'], updated_at: now() }).catch(() => {});
        continue;
      }

      log('Worker: processing order ' + orderId + ' type=' + order.type + ' amount=' + order.amount);
      const v = await Promise.race([
        runOfficerVerificationForWorker(order, order.screenshot_url, order.user_id || null, order.utr || null, null),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), IS_VERCEL ? 25000 : 30000)),
      ]);
      log('Worker: officer result — status=' + v.status + ' score=' + (v.verificationScore || 0) + ' checks=' + JSON.stringify(v.checks || []));

      const isVerified = v.status === 'verified';
      const finalStatus = isVerified ? 'verified' : (v.status === 'rejected' ? 'rejected' : 'manual_review');

      log('[STATUS_CHANGED] payment_sessions -> ' + finalStatus + ' for order ' + orderId);
      const dbResult = await updateDoc(COL_ORDERS, orderId, {
        status: finalStatus, verification_status: v.status,
        verification_score: v.verificationScore || 0, ocr_result: v.ocrData || null,
        rejection_reasons: v.reasons || [], updated_at: now(),
      });
      if (!dbResult) log('[ERROR_OCCURRED] COL_ORDERS update returned falsy for ' + orderId);
      log('[DATABASE_UPDATED] payment_sessions updated for ' + orderId);

      if (isVerified) {
        log('Worker: approved — executing post-approval for ' + orderId);
        await executeVerifiedOrder(order, v, { userId: order.user_id, pendingRegId: order.pending_reg_id, userEnteredUtr: order.utr, userEnteredUpi: null })
          .catch(e => log('Worker: post-approval exec err: ' + e.message));
      }

      // Update upi_payments status
      try {
        const searchField = order.pending_reg_id ? 'pending_reg_id' : 'user_id';
        const searchValue = order.pending_reg_id || order.user_id;
        if (searchValue) {
          const ups = await runQuery(COL_UPI_PAYMENTS, [
            { field: searchField, op: 'EQUAL', value: searchValue },
          ], { limit: 5 });
          for (const p of ups) {
            await updateDoc(COL_UPI_PAYMENTS, p.id, {
              status: finalStatus, verification_locked: false,
              ocr_result: v.ocrData || null, final_score: v.verificationScore || 0,
              fraud_score: v.fraudScore || 0, rejection_reasons: v.reasons || [],
              verified_at: now(), verification_completed_at: now(),
            }).catch(() => {});
          }
        }
      } catch (upiErr) { log('Worker: upi_payments update failed: ' + (upiErr.message || upiErr)); }

      // Broadcast SSE for real-time frontend update
      try {
        broadcast('paymentUpdated', { orderId, status: finalStatus, type: order.type || 'unknown' });
        log('[NOTIFICATION_SENT] SSE paymentUpdated for ' + orderId + ' status=' + finalStatus);
      } catch {}

      log('[PROCESS_COMPLETED] Worker finished ' + orderId + ' status=' + finalStatus + ' score=' + (v.verificationScore || 0));
    } catch (e) {
      log('[ERROR_OCCURRED] Worker failed for ' + orderId + ': ' + e.message);
      try {
        await updateDoc(COL_ORDERS, orderId, { status: 'manual_review', verification_status: 'manual_review', rejection_reasons: ['Auto-verification failed: ' + e.message], updated_at: now() }).catch(() => {});
        broadcast('paymentUpdated', { orderId, status: 'manual_review' }).catch(() => {});
        log('[STATUS_CHANGED] payment_sessions -> manual_review for ' + orderId + ' (fallback)');
        log('[NOTIFICATION_SENT] SSE paymentUpdated manual_review for ' + orderId);
      } catch {}
    }
    verifyingOrders.delete(orderId);
    await new Promise(r => setTimeout(r, 100));
  }

  verificationWorkerRunning = false;
  log('Verification worker idle');
}

// Cleanup on process exit
process.once('exit', () => { verifyingOrders.clear(); pendingVerificationQueue.clear(); });
process.once('SIGINT', () => { verifyingOrders.clear(); pendingVerificationQueue.clear(); process.exit(); });
process.once('SIGTERM', () => { verifyingOrders.clear(); pendingVerificationQueue.clear(); process.exit(); });

async function executeVerifiedOrder(order, verificationResult, extra) {
  const T = makeTimer();
  const type = order.type;
  const amount = Number(order.amount);
  const orderId = order.id;
  const completedAt = now();

  if (type === 'registration') {
    T.mark('executeVerifiedOrder:start');
    const pendingRegId = extra?.pendingRegId || order.pending_reg_id;
    if (!pendingRegId) {
      await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['No registration session linked'], updated_at: now() });
      return;
    }
    const pendingReg = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pendingReg) {
      await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['Registration session expired'], updated_at: now() });
      return;
    }

    const newUserId = crypto.randomUUID();
    let referredByUserId = null;
    let referredByCode = null;
    const refCode = pendingReg.referral_code;
    if (refCode) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
      if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode.toUpperCase(); }
    }

    const userName = pendingReg.name || '';
    const userEmail = pendingReg.email || '';
    const userPhone = pendingReg.phone || '';
    if (!userName || !userEmail || !userPhone) {
      await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['Invalid registration data'], updated_at: now() });
      return;
    }

    const userPkg = getReferrerPackage(pendingReg) || getPackageByReferral(pendingReg.referral_code) || String(amount);

    await writeDoc(COL_USERS, newUserId, {
      id: newUserId, email: userEmail, name: userName, phone: userPhone,
      password_hash: pendingReg.password_hash, referral_code: randomString(8),
      referred_by: referredByCode, account_status: 'active', payment_status: 'success',
      approved: true, active: true, membership_paid: true,
      membership_type: userPkg,
      joined_date: completedAt, approved_date: completedAt,
    });

    await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amount });
    await addDoc(COL_WALLET_TX, {
      user_id: newUserId, type: 'deposit', amount,
      description: 'Registration payment (verified)', reference_id: orderId, balance_after: amount,
    });

    if (referredByUserId) {
      await atomicCreditWallet(referredByUserId, amount * 0.1, orderId, 'Referral bonus for ' + newUserId, 'referral_bonus');
      const referrerDoc = await getDoc(COL_USERS, referredByUserId);
      if (referrerDoc) {
        const currentCount = (referrerDoc.referrals_count || 0) + 1;
        const limitReached = currentCount >= MAX_REFERRALS;
        const updates = {
          referrals_count: currentCount,
          total_referral_count: (referrerDoc.total_referral_count || 0) + 1,
          referral_limit_reached: limitReached,
          referral_active: !limitReached,
          is_qualified: limitReached,
        };
        await updateDoc(COL_USERS, referredByUserId, updates);
        if (limitReached) {
          try {
            await addDoc('notifications', { receiverId: referredByUserId, title: 'Referral Limit Reached', message: 'Your referral link has reached the maximum of ' + MAX_REFERRALS + ' successful registrations and has been deactivated.', type: 'referral_limit_reached', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' });
          } catch {}
          try {
            await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: 'system', details: { referralCode: referredByCode, referralCount: currentCount }, created_at: completedAt });
          } catch {}
        }
      }
    }

    try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}

    await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Welcome! Your registration payment of ₹' + amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' }).catch(() => {});
    try {
      await addDoc('audit_logs', { action: 'auto_approve_registration', target_id: orderId, target_type: 'payment_order', admin_id: 'system', details: { userId: newUserId, amount, verificationScore: verificationResult.verificationScore }, created_at: completedAt });
    } catch {}

    await addDoc(COL_UPI_PAYMENTS, {
      utr: verificationResult.ocrData?.extractedUtr || orderId,
      upi_id: ADMIN_UPI_ID,
      amount, amount_option: String(amount), payment_type: 'registration',
      screenshot_url: order.screenshot_url,
      status: 'verified',
      ocr_result: verificationResult.ocrData || null,
      final_score: verificationResult.verificationScore || 0,
      fraud_score: verificationResult.fraudScore || 0,
      user_id: newUserId,
      pending_reg_id: pendingRegId,
      payment_date: completedAt,
      verified_at: completedAt,
      verification_locked: false,
      verification_completed_at: completedAt,
      verification_duration: VERIFY_TIMEOUT_MS,
    }).catch(() => {});
    T.mark('executeVerifiedOrder:registration');
  } else if (type === 'topup') {
    const userId = order.user_id;
    if (!userId) {
      await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['User not identified'], updated_at: now() });
      return;
    }
    const userDoc = await lookupUser(userId);
    if (!userDoc) {
      await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['User account not found'], updated_at: now() });
      return;
    }

    await atomicCreditWallet(userId, amount, orderId, 'Topup via verified payment');
    const topupId = (await addDoc(COL_TOPUPS, {
      user_id: userId, amount, utr: verificationResult.ocrData?.extractedUtr || orderId,
      screenshot_url: order.screenshot_url, status: 'approved', verified_at: completedAt,
    })).id;

    const referredByCode = userDoc.referred_by || null;
    if (referredByCode) {
      try {
        const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
        const referrer = refUsers.length ? refUsers[0] : null;
        if (referrer) {
          const sponsorTopups = await runQuery(COL_TOPUPS, [
            { field: 'user_id', op: 'EQUAL', value: referrer.id },
            { field: 'status', op: 'EQUAL', value: 'approved' },
          ], { limit: 1 });
          const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';
          await addDoc(COL_TOPUP_INCOME, {
            user_id: referrer.id, from_user_id: userId, topup_id: topupId,
            amount, level: 1, status: incomeStatus,
          });
          const currentCount = referrer.topup_referral_qualified_count || 0;
          const newCount = currentCount + 1;
          await updateDoc(COL_USERS, referrer.id, {
            topup_referral_qualified_count: newCount,
            topup_referral_qualified: (referrer.referrals_count || 0) + newCount >= MAX_REFERRALS,
          });
          if (userDoc.referred_by_status !== 'approved') {
            await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
          }
        }
      } catch (e) { log('Topup referral failed: ' + e.message); }
    }

    if (userDoc.topup_referral_qualified && !userDoc.sponsor_topup_completed) {
      try {
        await updateDoc(COL_USERS, userId, { account_status: 'inactive', inactive_reason: 'Sponsor Claim Pending Admin Approval', sponsor_topup_completed: true, sponsor_awaiting_credit: true });
        const lockedIncome = await runQuery(COL_TOPUP_INCOME, [
          { field: 'user_id', op: 'EQUAL', value: userId },
          { field: 'status', op: 'EQUAL', value: 'locked' },
        ], { limit: 100 });
        for (const inc of lockedIncome) await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'eligible' });
      } catch (e) { log('Sponsor topup unlock failed: ' + e.message); }
    }

    await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Your topup of ₹' + amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' }).catch(() => {});
    try {
      await addDoc('audit_logs', { action: 'auto_approve_topup', target_id: orderId, target_type: 'payment_order', admin_id: 'system', details: { userId, amount, topupId, verificationScore: verificationResult.verificationScore }, created_at: completedAt });
    } catch {}

    await addDoc(COL_UPI_PAYMENTS, {
      utr: verificationResult.ocrData?.extractedUtr || orderId,
      upi_id: ADMIN_UPI_ID,
      amount, amount_option: String(amount), payment_type: 'topup',
      screenshot_url: order.screenshot_url,
      status: 'verified',
      ocr_result: verificationResult.ocrData || null,
      final_score: verificationResult.verificationScore || 0,
      fraud_score: verificationResult.fraudScore || 0,
      user_id: userId,
      payment_date: completedAt,
      verified_at: completedAt,
      verification_locked: false,
      verification_completed_at: completedAt,
      verification_duration: VERIFY_TIMEOUT_MS,
    }).catch(() => {});
    T.mark('executeVerifiedOrder:topup');
  }
  T.mark('executeVerifiedOrder:end');
  T.summary();
}

async function retryPaymentOrder(orderId) {
  const order = await getDoc(COL_ORDERS, orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'pending' || order.status === 'expired') {
    const newExpiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();
    await updateDoc(COL_ORDERS, orderId, {
      status: 'pending',
      expires_at: newExpiresAt,
      updated_at: now(),
    });
    return { orderId, status: 'pending', expiresAt: newExpiresAt };
  }
  if (order.verification_status === 'rejected' || order.verification_status === 'manual_review') {
    const newExpiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();
    await updateDoc(COL_ORDERS, orderId, {
      status: 'pending',
      verification_status: null,
      verification_score: null,
      ocr_result: null,
      rejection_reasons: [],
      screenshot_url: null,
      expires_at: newExpiresAt,
      updated_at: now(),
    });
    return { orderId, status: 'pending', expiresAt: newExpiresAt };
  }
  throw Object.assign(new Error('Order cannot be retried'), { status: 400 });
}

module.exports = {
  createPaymentOrder,
  getPaymentOrder,
  submitPaymentProof,
  retryPaymentOrder,
  executeVerifiedOrder,
  ORDER_TTL_MS,
  VERIFY_TIMEOUT_MS,
};
