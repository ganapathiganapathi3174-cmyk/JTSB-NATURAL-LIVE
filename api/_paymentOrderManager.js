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
const { runBankSmsVerification } = require('./_bankSmsVerificationEngine.js');

const ORDER_TTL_MS = 30 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 180 * 1000;

// In-flight verification tracker — prevents duplicate simultaneous verification of same order
const verifyingOrders = new Set();
const VERIFY_LOCK_TIMEOUT_MS = 180000; // 3 min max lock time

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

  const orderData = {
    id: orderId,
    user_id: userId || null,
    type,
    amount: Number(amount),
    status: 'pending',
    expires_at: expiresAt,
  };

  let saved = null;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(COL_ORDERS).insert(orderData).select('id').single();
  if (!error && data) saved = data;
  else {
    log('Order insert failed, tracking in-memory');
    saved = { id: orderId };
  }

  const finalOrderId = saved.id || orderId;

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
  }).catch(() => {});

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
  const T = makeTimer();
  const order = await getPaymentOrder(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.status === 'expired') throw Object.assign(new Error('Order expired'), { status: 400 });
  if (order.status === 'verified') throw Object.assign(new Error('Order already verified'), { status: 400 });
  if (order.verification_status === 'processing') throw Object.assign(new Error('Verification already in progress'), { status: 409 });

  // Duplicate request lock (in-memory)
  if (verifyingOrders.has(orderId)) throw Object.assign(new Error('Verification already in progress'), { status: 409 });
  verifyingOrders.add(orderId);
  setTimeout(() => verifyingOrders.delete(orderId), VERIFY_LOCK_TIMEOUT_MS);
  T.mark('getPaymentOrder');

  await updateDoc(COL_ORDERS, orderId, {
    status: 'verifying',
    verification_status: 'processing',
    updated_at: now(),
  });
  T.mark('updateOrderVerifying');

  let verificationResult;
  try {
    verificationResult = await Promise.race([
      runBankSmsVerification(order, screenshotUrl, extra?.userId || order.user_id, extra?.userEnteredUtr || null, extra?.userEnteredUpi || null),
      new Promise((_, reject) => setTimeout(() => reject(new Error('VERIFY_TIMEOUT')), IS_VERCEL ? 25000 : 120000)),
    ]);
  } catch (e) {
    if (e.message === 'VERIFY_TIMEOUT') {
      log('OCR timed out — queuing for async processing');
      const currentRetries = Number(order.verification_retries || 0);
      const newRetries = currentRetries + 1;
      const MAX_RETRIES = 2;
      if (newRetries >= MAX_RETRIES) {
        log('Max retries (' + MAX_RETRIES + ') reached — marking order as failed');
        await updateDoc(COL_ORDERS, orderId, {
          status: 'failed', verification_status: 'failed', verification_retries: newRetries,
          rejection_reasons: ['OCR timed out after ' + MAX_RETRIES + ' attempts'],
          updated_at: now(),
        }).catch(() => {});
        T.mark('maxRetriesReached');
        verifyingOrders.delete(orderId);
        return {
          orderId, paymentId: orderId,
          status: 'failed', verificationStatus: 'failed',
          verificationScore: 0, ocrData: null, reasons: ['OCR failed after ' + MAX_RETRIES + ' attempts'],
          matchedAmount: false, matchedReceiver: false, matchedUtr: false,
          matchedDate: false, userUtrMatched: false, userEnteredUtr: extra?.userEnteredUtr || null,
          userUpiMatched: false, userEnteredUpi: extra?.userEnteredUpi || null,
          fraudScore: 0, checks: [],
        };
      }
      await updateDoc(COL_ORDERS, orderId, {
        status: 'queued', verification_status: 'pending', verification_retries: newRetries,
        screenshot_url: screenshotUrl, utr: extra?.userEnteredUtr || null,
        updated_at: now(),
      }).catch(() => {});
      // Save screenshot + UTR on upi_payments so async retry can process it
      try {
        const existingPayments = await runQuery(COL_UPI_PAYMENTS, [
          { field: extra?.pendingRegId ? 'pending_reg_id' : 'order_id', op: 'EQUAL', value: extra?.pendingRegId || orderId },
        ], { limit: 5 });
        for (const p of existingPayments) {
          await updateDoc(COL_UPI_PAYMENTS, p.id, {
            screenshot_url: screenshotUrl,
            utr: extra?.userEnteredUtr || p.utr,
            verification_locked: false,
          }).catch(() => {});
        }
      } catch (e) { log('Failed to save screenshot/UTR to upi_payments: ' + e.message); }
      T.mark('timeoutFallback');
      // Auto-trigger background retry (fire-and-forget)
      process.nextTick(() => {
        try {
          const { processNextPayment } = require('../handlers/processPendingPayments.js');
          processNextPayment().then(r => {
            log('Auto-process: ' + r.processed + ' processed, ' + r.approved + ' approved');
          }).catch(e2 => log('Auto-process error: ' + e2.message));
        } catch (e2) { log('Auto-process load error: ' + e2.message); }
      });
      verifyingOrders.delete(orderId);
      return {
        orderId, paymentId: orderId,
        status: 'pending', verificationStatus: 'pending',
        verificationScore: 0, ocrData: null, reasons: ['Verification queued for async processing'],
        matchedAmount: false, matchedReceiver: false, matchedUtr: false,
        matchedDate: false, userUtrMatched: false, userEnteredUtr: extra?.userEnteredUtr || null,
        userUpiMatched: false, userEnteredUpi: extra?.userEnteredUpi || null,
        fraudScore: 0, checks: [],
      };
    }
    verifyingOrders.delete(orderId);
    throw e;
  }
  T.mark('runBankSmsVerification');

  const isVerified = verificationResult.status === 'verified';
  const finalOrderStatus = isVerified ? 'verified' : 'rejected';

  await updateDoc(COL_ORDERS, orderId, {
    status: finalOrderStatus,
    verification_status: verificationResult.status,
    verification_score: verificationResult.verificationScore || 0,
    screenshot_url: screenshotUrl,
    ocr_result: verificationResult.ocrData || null,
    rejection_reasons: verificationResult.reasons || [],
    final_score: verificationResult.verificationScore || 0,
    fraud_score: verificationResult.fraudScore || 0,
    verified_at: now(),
    verification_completed_at: now(),
    updated_at: now(),
  });
  T.mark('updateOrderResult');

  if (isVerified) {
    await executeVerifiedOrder(order, verificationResult, extra);
    T.mark('executeVerifiedOrder');
  } else {
    const msg = 'Your payment of ₹' + order.amount + ' was rejected. Reasons: ' + (verificationResult.reasons || []).join(', ');
    await addDoc('notifications', {
      receiverId: order.user_id || '',
      title: 'Payment Rejected',
      message: msg,
      type: 'payment_rejected', status: 'unread', created_at: now(),
      senderId: 'system', senderName: 'System',
    }).catch(() => {});
    T.mark('addRejectionNotification');
  }

  try { broadcast('paymentUpdated', { orderId, status: finalOrderStatus, type: order.type }); } catch {}

  let syncedPaymentId = null;
  try {
    let existingPayments = [];
    const searchRegId = extra?.pendingRegId || order.pending_reg_id;
    if (order.type === 'registration' && searchRegId) {
      existingPayments = await runQuery(COL_UPI_PAYMENTS, [
        { field: 'pending_reg_id', op: 'EQUAL', value: searchRegId },
      ], { limit: 10 });
    } else if (order.type === 'topup' && (extra?.userId || order.user_id)) {
      existingPayments = await runQuery(COL_UPI_PAYMENTS, [
        { field: 'user_id', op: 'EQUAL', value: extra?.userId || order.user_id },
      ], { limit: 10 });
    }
    if (existingPayments.length > 0) {
      const target = existingPayments.find(p => p.status === 'pending') || existingPayments[0];
      syncedPaymentId = target.id;
      await updateDoc(COL_UPI_PAYMENTS, target.id, {
        status: finalOrderStatus,
        ocr_result: verificationResult.ocrData || null,
        final_score: verificationResult.verificationScore || 0,
        fraud_score: verificationResult.fraudScore || 0,
        verified_at: finalOrderStatus === 'verified' ? now() : target.verified_at,
        verification_completed_at: now(),
        verification_locked: false,
        rejection_reasons: verificationResult.reasons || [],
      }).catch(() => {});
    }
  } catch (e) { log('Failed to sync payment status: ' + e.message); }
  T.mark('syncPaymentStatus');

  T.summary();
  verifyingOrders.delete(orderId);
  return {
    orderId,
    paymentId: syncedPaymentId || orderId,
    status: finalOrderStatus,
    verificationStatus: verificationResult.status,
    verificationScore: verificationResult.verificationScore,
    ocrData: verificationResult.ocrData,
    reasons: verificationResult.reasons,
    matchedAmount: verificationResult.matchedAmount,
    matchedReceiver: verificationResult.matchedReceiver,
    matchedUtr: verificationResult.matchedUtr,
    matchedDate: verificationResult.matchedDate,
    userUtrMatched: verificationResult.userUtrMatched,
    userEnteredUtr: verificationResult.userEnteredUtr,
    userUpiMatched: verificationResult.userUpiMatched,
    userEnteredUpi: verificationResult.userEnteredUpi,
    fraudScore: verificationResult.fraudScore,
    checks: verificationResult.checks,
  };
}

// Cleanup verifyingOrders on process exit
process.once('exit', () => verifyingOrders.clear());
process.once('SIGINT', () => { verifyingOrders.clear(); process.exit(); });
process.once('SIGTERM', () => { verifyingOrders.clear(); process.exit(); });

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
