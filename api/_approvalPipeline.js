// ─────────────────────────────────────────────────────────────
// SINGLE APPROVAL PIPELINE  (api/_approvalPipeline.js)
//
// This is the ONLY place business-side approval effects live:
//   - registration → create user, wallet, referral bonus, audit
//   - topup       → credit wallet, topups row, referral income, audit
//
// Both the auto-approval path (order manager / pending processor)
// and the admin-approval path (approveUPIPayment handler) go
// through here, so there is no duplicated approval logic anywhere.
//
// executeVerifiedOrder(orderLike, verificationResult, extra)
//   → core side-effects; idempotent by design when re-run.
//
// approvePayment(paymentId, extra)
//   → atomic claim (conditionalUpdateDoc) then core; used by the
//     admin handler; returns { idempotent: true } on duplicate.
// ─────────────────────────────────────────────────────────────

const {
  randomString, crypto, MAX_REFERRALS, COL_TOPUP_INCOME,
  isSystemReferralCode, getReferrerPackage, getPackageByReferral,
} = require('./_shared.js');
const { getDoc, runQuery, writeDoc, updateDoc, addDoc, deleteDoc, conditionalUpdateDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const cycleEngine = require('./_cycleEngine.js');

const COL_UPI_PAYMENTS = 'upi_payments';
const COL_USERS = 'users';
const COL_WALLET_BALANCES = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_TOPUPS = 'topups';
const COL_PENDING_REGS = 'pending_registrations';
const RECEIVER_UPI = 'jayarajj126-3@okicici';

function now() { return new Date().toISOString(); }
function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [APPROVE] ' + msg);
}

function validateRegistrationData(pendingReg) {
  const userName = (pendingReg.name || '').trim();
  const userEmail = (pendingReg.email || '').trim();
  const userPhone = (pendingReg.phone || '').trim();
  const bad = v => !v || ['unknown', 'undefined', 'null'].includes(v.toLowerCase());
  const missing = [];
  if (bad(userName)) missing.push('name');
  if (bad(userEmail)) missing.push('email');
  if (bad(userPhone)) missing.push('phone');
  return { valid: missing.length === 0, missing, userName, userEmail, userPhone };
}

// Write (or update) the canonical upi_payments record with the
// verified outcome so the admin UI and reports see consistent data.
async function upsertUpiRecord(order, verificationResult, cfg) {
  const utr = verificationResult?.ocrData?.fields?.utr || order.utr || cfg.orderId;
  const record = {
    utr,
    upi_id: RECEIVER_UPI,
    amount: cfg.amount,
    amount_option: String(cfg.amount),
    payment_type: order.payment_type || order.type,
    screenshot_url: order.screenshot_url || null,
    status: cfg.status,
    ocr_result: verificationResult?.ocrData || null,
    final_score: verificationResult?.confidence || 0,
    fraud_score: verificationResult?.fraudScore || 0,
    risk_score: verificationResult?.riskScore || 0,
    utr_hash: verificationResult?.utrHash || null,
    screenshot_hash: verificationResult?.screenshotHash || null,
    user_id: cfg.user_id != null ? cfg.user_id : (order.user_id != null ? order.user_id : null),
    pending_reg_id: cfg.pendingRegId != null ? cfg.pendingRegId : (order.pending_reg_id != null ? order.pending_reg_id : null),
    payment_date: cfg.completedAt,
    verified_at: cfg.completedAt,
    verification_locked: false,
    verification_completed_at: cfg.completedAt,
    verification_duration: verificationResult?.durationMs || 0,
  };
  if (cfg.upiPaymentId) {
    try { await updateDoc(COL_UPI_PAYMENTS, cfg.upiPaymentId, record); } catch (e) { log('UPI_PAYMENTS update failed (non-fatal): ' + e.message); }
  } else {
    await addDoc(COL_UPI_PAYMENTS, record).catch(e => log('UPI_PAYMENTS insert fallback failed: ' + e.message));
  }
}

// ─────────────────────────────────────────────────────────────
// CORE APPROVAL  — registration + topup side-effects
// ─────────────────────────────────────────────────────────────
async function executeVerifiedOrder(order, verificationResult, extra = {}) {
  const type = order.payment_type || order.type;
  const amount = Number(order.amount);
  const orderId = order.id;
  const completedAt = now();
  const adminEmail = extra.adminEmail || 'system';
  const source = extra.source || 'auto';
  const verificationScore = verificationResult?.confidence || 0;

  if (type === 'registration') {
    const pendingRegId = extra.pendingRegId || order.pending_reg_id;
    if (!pendingRegId) throw Object.assign(new Error('No registration session linked'), { code: 'NO_SESSION' });

    const pendingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'EQUAL', value: pendingRegId }]);
    if (!pendingRegs.length) throw Object.assign(new Error('Registration session not found'), { code: 'NO_SESSION' });
    const pendingReg = pendingRegs[0];

    const val = validateRegistrationData(pendingReg);
    if (!val.valid) throw Object.assign(new Error('Invalid registration data: ' + val.missing.join(', ')), { code: 'BAD_DATA' });

    const newUserId = crypto.randomUUID();
    const refCode = pendingReg.referral_code;
    let referredByUserId = null;
    let referredByCode = null;
    if (refCode) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
      if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode.toUpperCase(); }
    }

    const userPkg = getReferrerPackage(pendingReg) || getPackageByReferral(pendingReg.referral_code) || String(amount);

    await writeDoc(COL_USERS, newUserId, {
      id: newUserId, email: val.userEmail, name: val.userName, phone: val.userPhone,
      password_hash: pendingReg.password_hash, referral_code: randomString(8),
      referred_by: referredByCode, account_status: 'active', payment_status: 'success',
      approved: true, active: true, membership_paid: true, membership_type: userPkg,
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
        const isSystemCode = isSystemReferralCode(referredByCode);
        const currentCount = (referrerDoc.referrals_count || 0) + 1;
        const limitReached = !isSystemCode && currentCount >= MAX_REFERRALS;
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
          } catch (e) { log('Referral-limit notification failed: ' + e.message); }
          try {
            await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: adminEmail, details: { referralCode: referredByCode, referralCount: currentCount }, created_at: completedAt });
          } catch (e) { log('Referral-limit audit failed: ' + e.message); }
        }
        try { await cycleEngine.onReferralApproved(referredByUserId, newUserId, referredByCode, adminEmail); } catch (e) { console.error('[approvalPipeline] Cycle engine referral error:', e?.message); }
      }
    }

    try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch (e) { log('Delete pending registration failed: ' + e.message); }

    try {
      await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Welcome! Your registration payment of ₹' + amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' });
    } catch (e) { log('Registration notification failed: ' + e.message); }

    try {
      await addDoc('audit_logs', { action: source === 'admin' ? 'approve_registration_payment' : 'auto_approve_registration', target_id: orderId, target_type: 'payment_order', admin_id: adminEmail, details: { userId: newUserId, amount, referredBy: referredByCode, verificationScore, source }, created_at: completedAt });
    } catch (e) { log('Registration audit failed: ' + e.message); }

    await upsertUpiRecord(order, verificationResult, {
      upiPaymentId: extra.upiPaymentId, orderId, amount, status: 'verified',
      user_id: newUserId, pendingRegId, completedAt,
    });

    try { broadcast('paymentUpdated', { id: orderId, paymentId: extra.upiPaymentId || orderId, status: 'approved', type, userId: newUserId }); } catch (e) { log('Broadcast paymentUpdated failed: ' + e.message); }

    log('registration approved order=' + orderId + ' user=' + newUserId);
    return { status: 'approved', type, userId: newUserId };
  }

  if (type === 'topup') {
    const userId = order.user_id || extra.userId;
    if (!userId) throw Object.assign(new Error('No user linked to this payment'), { code: 'NO_USER' });

    const userDocs = await runQuery(COL_USERS, [{ field: 'id', op: 'EQUAL', value: userId }]);
    if (!userDocs.length) throw Object.assign(new Error('User not found'), { code: 'NO_USER' });
    const userDoc = userDocs[0];

    await atomicCreditWallet(userId, amount, orderId, 'Topup via verified payment');

    const topupId = (await addDoc(COL_TOPUPS, {
      user_id: userId, amount, utr: verificationResult?.ocrData?.fields?.utr || order.utr || orderId,
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
          const topupQualified = (referrer.referrals_count || 0) + newCount >= MAX_REFERRALS;
          await updateDoc(COL_USERS, referrer.id, {
            topup_referral_qualified_count: newCount,
            topup_referral_qualified: topupQualified,
          });
          if (userDoc.referred_by_status !== 'approved') {
            await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
          }
        }
      } catch (e) { log('Topup referral income failed: ' + e.message); }
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

    try { await cycleEngine.onTopupApproved(userId, topupId, amount, adminEmail); } catch (e) { console.error('[approvalPipeline] Cycle engine topup error:', e?.message); }

    try {
      await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Your topup of ₹' + amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' });
    } catch (e) { log('Topup notification failed: ' + e.message); }

    try {
      await addDoc('audit_logs', { action: source === 'admin' ? 'approve_topup_payment' : 'auto_approve_topup', target_id: orderId, target_type: 'payment_order', admin_id: adminEmail, details: { userId, amount, topupId, referredBy: referredByCode, verificationScore, source }, created_at: completedAt });
    } catch (e) { log('Topup audit failed: ' + e.message); }

    await upsertUpiRecord(order, verificationResult, {
      upiPaymentId: extra.upiPaymentId, orderId, amount, status: 'verified',
      user_id: userId, pendingRegId: null, completedAt,
    });

    try { broadcast('paymentUpdated', { id: orderId, paymentId: extra.upiPaymentId || orderId, status: 'approved', type, userId }); } catch (e) { log('Broadcast paymentUpdated failed: ' + e.message); }

    log('topup approved order=' + orderId + ' user=' + userId + ' topup=' + topupId);
    return { status: 'approved', type, userId, topupId };
  }

  throw new Error('Unknown payment type: ' + type);
}

// ─────────────────────────────────────────────────────────────
// ADMIN APPROVAL ENTRY  — atomic claim + core, with rollback
// ─────────────────────────────────────────────────────────────
async function approvePayment(paymentId, extra = {}) {
  const claimed = await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
    { field: 'status', op: 'IN', value: ['pending', 'manual_review', 'pending_review'] },
  ], { status: 'verified', verified_at: now(), verified_by: extra.adminEmail || 'system' });

  if (claimed === 0) {
    const existing = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
    if (existing && existing.length) return { status: existing[0].status, idempotent: true };
    return { status: 'failed' };
  }

  const payments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }]);
  if (!payments.length) {
    await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [], { status: 'failed', rejection_reasons: ['Payment record vanished'] });
    return { status: 'failed' };
  }

  const payment = payments[0];
  try {
    return await executeVerifiedOrder(payment, null, { ...extra, upiPaymentId: paymentId, source: 'admin' });
  } catch (e) {
    // ROLLBACK: revert the claim so the payment can be retried by an admin.
    // Invalid registration data is a definitive rejection; anything else is a
    // transient failure (kept processable by re-claiming after a status reset).
    const revert = e.code === 'BAD_DATA'
      ? { status: 'rejected', rejection_reasons: [e.message], verified_at: now() }
      : { status: 'failed', rejection_reasons: ['Approval failed: ' + e.message], verified_at: now() };
    await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
      { field: 'status', op: 'EQUAL', value: 'verified' },
    ], revert);
    throw e;
  }
}

module.exports = { executeVerifiedOrder, approvePayment };
