const {
  COL_USERS, COL_PENDING_REGS, COL_UPI_PAYMENTS, COL_ORDERS,
  randomString, ADMIN_UPI_ID,
  getReferrerPackage, getPackageByReferral, validatePackageAmount,
} = require('./_shared.js');
const { runQuery, addDoc, updateDoc, getDoc, getSupabaseClient } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const { verifySession } = require('./_verificationEngine.js');
const { executeVerifiedOrder } = require('./_approvalPipeline.js');

const ORDER_TTL_MS = 30 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 180 * 1000;
const VERIFY_LOCK_TIMEOUT_MS = 180000;

// In-flight verification tracker (in-process only; the 409 lock + the
// atomic status claim are the real serverless-safe concurrency guards)
const verifyingOrders = new Set();

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [ORDER-MGR] ${msg}`);
}
function now() { return new Date().toISOString(); }

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

  const upiPaymentRes = await addDoc(COL_UPI_PAYMENTS, {
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
  }).catch(e => { log('UPI_PAYMENTS insert failed (non-fatal): ' + e.message); return null; });
  const upiPaymentId = upiPaymentRes && upiPaymentRes.id ? upiPaymentRes.id : null;
  if (upiPaymentId) {
    await updateDoc(COL_ORDERS, finalOrderId, { paymentId: upiPaymentId, updated_at: now() }).catch(e => log('Order paymentId update failed (non-fatal): ' + e.message));
  }

  log(`CREATE order=${finalOrderId} type=${type} amount=${amount} expectedUpi=${ADMIN_UPI_ID} upiPaymentId=${upiPaymentId || 'none'}`);

  try { broadcast('paymentCreated', { orderId: finalOrderId, type, amount, status: 'pending' }); } catch {}

  return {
    orderId: finalOrderId,
    type,
    amount: Number(amount),
    expectedUpi: ADMIN_UPI_ID,
    status: 'pending',
    expiresAt,
    upiPaymentId: upiPaymentId,
    pendingRegId: type === 'registration' ? pendingRegId : null,
    userId: userId || paymentPendingRegId,
  };
}

async function getPaymentOrder(orderId) {
  const order = await getDoc(COL_ORDERS, orderId).catch(() => null);
  if (!order) return null;
  if (order.status === 'pending' && order.expires_at && Date.now() > new Date(order.expires_at).getTime()) {
    const createdAt = order.created_at ? new Date(order.created_at).getTime() : 'unknown';
    const expiresAt = new Date(order.expires_at).getTime();
    const diff = Date.now() - expiresAt;
    log('[EXPIRED] order=' + orderId + ' status=pending→expired created_at=' + createdAt + ' expires_at=' + order.expires_at + ' now=' + Date.now() + ' overdue=' + diff + 'ms');
    order.status = 'expired';
    await updateDoc(COL_ORDERS, orderId, { status: 'expired', updated_at: now() }).catch(() => {});
    try { broadcast('paymentUpdated', { orderId, status: 'expired' }); } catch {}
  }
  return order;
}

const IS_VERCEL = !!process.env.VERCEL;

const VERIFY_INLINE_BUDGET_MS = 4500;

async function submitPaymentProof(orderId, screenshotUrl, extra) {
  const t0 = Date.now();

  // ── FAST PATH: Minimal DB check (3s hard timeout) ──
  let order;
  try {
    order = await Promise.race([
      getDoc(COL_ORDERS, orderId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ORDER_FETCH_TIMEOUT')), 3000)),
    ]);
  } catch (e) {
    log('[SUBMIT] Order fetch failed for ' + orderId + ': ' + e.message + ' (' + (Date.now() - t0) + 'ms)');
    throw Object.assign(new Error('Order not found'), { status: 404 });
  }
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });

  // Re-activate expired orders
  if (order.status === 'pending' && order.expires_at && Date.now() > new Date(order.expires_at).getTime()) {
    order.status = 'expired';
  }
  if (order.status === 'expired') {
    log('[EXPIRED] order=' + orderId + ' re-activating');
    const newExpiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();
    await updateDoc(COL_ORDERS, orderId, {
      status: 'pending', verification_status: null, verification_score: null,
      ocr_result: null, rejection_reasons: [], screenshot_url: null,
      expires_at: newExpiresAt, updated_at: now(),
    }).catch(() => {});
    order.status = 'pending';
    order.expires_at = newExpiresAt;
  }

  if (order.status === 'verified') throw Object.assign(new Error('Order already verified'), { status: 400 });

  // Duplicate request lock
  if (verifyingOrders.has(orderId)) throw Object.assign(new Error('Verification already in progress'), { status: 409 });
  verifyingOrders.add(orderId);
  setTimeout(() => verifyingOrders.delete(orderId), VERIFY_LOCK_TIMEOUT_MS);

  log('[SUBMIT] Pre-pipeline DB done: ' + (Date.now() - t0) + 'ms for ' + orderId);

  // ── FAST PATH: single verification facade ──
  try {
    log('[INLINE_VERIFY] order ' + orderId + ' starting (V7)');
    const v = await verifySession(order, screenshotUrl, order.user_id || null, extra?.userEnteredUtr || order.utr || null, extra?.userEnteredUpi || null, null);
    const finalStatus = v.status;
    await Promise.all([
      updateDoc(COL_ORDERS, orderId, {
        status: finalStatus, verification_status: v.status,
        verification_score: v.confidence || 0, ocr_result: v.ocrData || null,
        rejection_reasons: v.reasons || [], updated_at: now(),
      }).catch(e => log('DB update order failed: ' + e.message)),
      (async () => {
        try {
          // Update the canonical upi_payments row for this order (paymentId link).
          const upiId = order.paymentId || order.paymentid;
          if (upiId) {
            await updateDoc(COL_UPI_PAYMENTS, upiId, {
              status: finalStatus, verification_locked: false,
              ocr_result: v.ocrData || null, final_score: v.confidence || 0,
              fraud_score: v.fraudScore || 0, risk_score: v.riskScore || 0,
              utr_hash: v.utrHash || null, screenshot_hash: v.screenshotHash || null,
              rejection_reasons: v.reasons || [],
              verified_at: now(), verification_completed_at: now(),
            }).catch(() => {});
          } else {
            const searchField = order.pending_reg_id ? 'pending_reg_id' : 'user_id';
            const searchValue = order.pending_reg_id || order.user_id;
            if (searchValue) {
              const ups = await runQuery(COL_UPI_PAYMENTS, [
                { field: searchField, op: 'EQUAL', value: searchValue },
              ], { limit: 5 });
              for (const p of ups) {
                await updateDoc(COL_UPI_PAYMENTS, p.id, {
                  status: finalStatus, verification_locked: false,
                  ocr_result: v.ocrData || null, final_score: v.confidence || 0,
                  fraud_score: v.fraudScore || 0, risk_score: v.riskScore || 0,
                  utr_hash: v.utrHash || null, screenshot_hash: v.screenshotHash || null,
                  rejection_reasons: v.reasons || [],
                  verified_at: now(), verification_completed_at: now(),
                }).catch(() => {});
              }
            }
          }
        } catch (_) {}
      })(),
    ]);
    log('[POST_DB] ' + orderId + ' done');
    try { broadcast('paymentUpdated', { orderId, status: finalStatus, type: order.type }); } catch {}
    log('[INLINE_VERIFY] order ' + orderId + ' done: status=' + finalStatus + ' score=' + (v.confidence || 0) + ' total=' + (Date.now() - t0) + 'ms');
    verifyingOrders.delete(orderId);
    const response = {
      orderId, paymentId: order.paymentId || orderId,
      status: finalStatus, verificationStatus: v.status,
      verificationScore: v.confidence || 0, reasons: v.reasons || [],
      matchedAmount: v.matchedAmount, matchedReceiver: v.matchedReceiver,
      matchedUtr: v.matchedUtr, matchedDate: v.matchedDate,
      userUtrMatched: v.userUtrMatched, userUpiMatched: v.userUpiMatched,
      userEnteredUtr: extra?.userEnteredUtr || null,
      userEnteredUpi: extra?.userEnteredUpi || null,
      fraudScore: v.fraudScore || 0, checks: v.checks || [],
      ocrData: v.ocrData || null,
    };
    if (finalStatus === 'verified') {
      // AWAIT the approval so serverless functions can't kill it after return.
      try {
        await executeVerifiedOrder(order, v, {
          userId: order.user_id,
          pendingRegId: order.pending_reg_id,
          upiPaymentId: order.paymentId || null,
          source: 'auto',
        });
      } catch (e) {
        log('Post-approval err: ' + e.message);
        await updateDoc(COL_ORDERS, orderId, { status: 'failed', rejection_reasons: ['Post-approval failed: ' + e.message], updated_at: now() }).catch(() => {});
      }
    }
    return response;
  } catch (ocrErr) {
    log('[INLINE_VERIFY] order ' + orderId + ' failed: ' + ocrErr.message);
    updateDoc(COL_ORDERS, orderId, {
      status: 'manual_review', verification_status: 'manual_review',
      rejection_reasons: ['Verification error: ' + ocrErr.message], updated_at: now(),
    }).catch(() => {});
    try { broadcast('paymentUpdated', { orderId, status: 'manual_review', type: order.type }); } catch {}

    verifyingOrders.delete(orderId);
    return {
      orderId, paymentId: order.paymentId || orderId,
      status: 'manual_review',
      verificationStatus: 'manual_review',
      verificationScore: 0,
      reasons: ['Verification timed out — admin review required'],
      matchedAmount: false, matchedReceiver: false, matchedUtr: false,
      matchedDate: false, userUtrMatched: false,
      userEnteredUtr: extra?.userEnteredUtr || null,
      userUpiMatched: false,
      userEnteredUpi: extra?.userEnteredUpi || null,
      fraudScore: 0, checks: [],
    };
  }
}

// ── Background verification is driven synchronously by the status poll ──
// (see getPaymentOrderStatus). No in-process worker / queue is used — fire
// and forget after a response is not reliable on serverless functions.

// Approval side-effects (user creation / wallet credit / referrals /
// notifications / audit) live in a single shared module.
// executeVerifiedOrder is imported from ./_approvalPipeline.js.

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
