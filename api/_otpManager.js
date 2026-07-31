const crypto = require('crypto');
const { COL_USERS, COL_PENDING_REGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_REFERRALS, COL_NOTIFICATIONS, COL_TOPUP_INCOME, COL_UPI_PAYMENTS, randomString, hashPassword, TEST_MODE, TEST_PAYMENT_AMOUNT, MAX_REFERRALS } = require('./_shared.js');
const { runQuery, addDoc, getDoc, updateDoc, deleteDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const cycleEngine = require('./_cycleEngine.js');

const BASE_AMOUNTS = [120, 500, 1000];
const ALLOWED_AMOUNTS = TEST_MODE ? [...BASE_AMOUNTS, TEST_PAYMENT_AMOUNT] : BASE_AMOUNTS;
const ACCEPTED_UPI = 'jayarajj126-3@okicici';
const OTP_EXPIRY_MS = 300000;
const MAX_OTP_ATTEMPTS = 3;

const otpSessions = new Map();
const processedUtx = new Set();

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [OTP-MGR] ${msg}`);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

async function verifyOtp(sessionId, otp) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found or expired' };
  if (session.otpVerified) return { error: 'OTP already verified' };
  if (Date.now() > session.otpExpiresAt) {
    session.status = 'otp_expired';
    otpSessions.set(sessionId, session);
    return { error: 'OTP expired' };
  }
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
    session.status = 'otp_blocked';
    otpSessions.set(sessionId, session);
    return { error: 'Maximum OTP attempts exceeded' };
  }

  session.otpAttempts++;
  if (session.otp !== otp) {
    otpSessions.set(sessionId, session);
    const remaining = MAX_OTP_ATTEMPTS - session.otpAttempts;
    return { error: `Invalid OTP. ${remaining} attempt(s) remaining.` };
  }

  session.otpVerified = true;
  session.status = 'approved';
  session.verifiedAt = Date.now();
  otpSessions.set(sessionId, session);
  return { success: true, session };
}

async function resendOtp(sessionId) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  if (session.otpVerified) return { error: 'OTP already verified' };
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) return { error: 'Maximum OTP attempts exceeded. Session blocked.' };
  if (session.status !== 'otp_sent') return { error: 'Session not in OTP waiting state' };

  const now = Date.now();
  if (session.otpExpiresAt && now < session.otpExpiresAt && session.otpExpiresAt - now > 240000) {
    return { error: 'OTP still valid. Wait before requesting a new one.' };
  }

  const otp = generateOtp();
  session.otp = otp;
  session.otpExpiresAt = Date.now() + OTP_EXPIRY_MS;
  otpSessions.set(sessionId, session);
  log(`Resent OTP for session ${sessionId}`);
  return { success: true, otpExpiresAt: session.otpExpiresAt };
}

async function processPaymentApproval(sessionId) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  if (!session.otpVerified) return { error: 'OTP not verified' };
  const completedAt = new Date().toISOString();
  log(`Completing ${session.paymentType} for session ${sessionId}`);

  try {
    if (session.paymentType === 'registration') {
      const reg = session.pendingReg;
      const hashedPw = hashPassword(reg.password_hash || 'default');
      const newUserId = crypto.randomUUID();
      const refCode = randomString(8);

      let referredByUserId = null;
      let referredByCode = null;
      if (reg.referral_code) {
        const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: reg.referral_code.toUpperCase() }], { limit: 1 });
        if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = reg.referral_code.toUpperCase(); }
      }

      await addDoc(COL_USERS, {
        id: newUserId, email: reg.email, name: reg.name, phone: reg.phone,
        password_hash: hashedPw, referral_code: refCode,
        referred_by: referredByCode, account_status: 'active', payment_status: 'success',
        approved: true, active: true, membership_paid: true,
        membership_type: String(session.amount),
        joined_date: completedAt, approved_date: completedAt,
      });

      await addDoc(COL_WALLET_BALANCES, { id: newUserId, balance: 0, total_earned: session.amount });
      await addDoc(COL_WALLET_TX, {
        user_id: newUserId, type: 'deposit', amount: session.amount,
        description: 'Registration payment (verified)', reference_id: session.sessionId, balance_after: session.amount,
      });

      if (referredByUserId) {
        await atomicCreditWallet(referredByUserId, session.amount * 0.1, session.sessionId, 'Referral bonus for ' + newUserId, 'referral_bonus');
        const referrerDoc = await getDoc(COL_USERS, referredByUserId).catch(() => null);
        if (referrerDoc) {
          const currentCount = (referrerDoc.referrals_count || 0) + 1;
          const limitReached = currentCount >= MAX_REFERRALS;
          await updateDoc(COL_USERS, referredByUserId, {
            referrals_count: currentCount,
            total_referral_count: (referrerDoc.total_referral_count || 0) + 1,
            referral_limit_reached: limitReached, referral_active: !limitReached, is_qualified: limitReached,
          });
          if (limitReached) {
            try { await addDoc('notifications', { receiverId: referredByUserId, title: 'Referral Limit Reached', message: 'Your referral link has reached the maximum of ' + MAX_REFERRALS + ' successful registrations.', type: 'referral_limit_reached', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' }); } catch {}
            try { await addDoc('audit_logs', { action: 'referral_limit_reached', target_id: referredByUserId, target_type: 'user', admin_id: 'system', details: { referralCode: referredByCode, referralCount: currentCount }, created_at: completedAt }); } catch {}
          }
          try { await cycleEngine.onReferralApproved(referredByUserId, newUserId, referredByCode, 'system'); } catch (e) { console.error('[otpManager] Cycle engine error:', e?.message); }
        }
      }

      try { await deleteDoc(COL_PENDING_REGS, reg.id); } catch {}

      await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Welcome! Your registration payment of ₹' + session.amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' }).catch(() => {});
      session.result = { userId: newUserId, status: 'active', plan: String(session.amount) };
      log(`Registration completed: ${newUserId}`);

    } else if (session.paymentType === 'topup') {
      const walletResult = await atomicCreditWallet(session.userId, session.amount, session.sessionId, 'Topup via verified payment');
      if (!walletResult || walletResult.error) throw new Error(walletResult?.error || 'Wallet credit failed');

      await addDoc('notifications', { receiverId: session.userId, title: 'Topup Approved', message: 'Your topup of ₹' + session.amount + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: completedAt, senderId: 'system', senderName: 'System' }).catch(() => {});

      if (session.referredByCode) {
        try {
          const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: session.referredByCode }], { limit: 1 });
          const referrer = refUsers.length ? refUsers[0] : null;
          if (referrer) {
            await addDoc(COL_TOPUP_INCOME, {
              user_id: referrer.id, from_user_id: session.userId, amount: session.amount,
              level: 1, status: 'eligible',
            });
          }
        } catch (e) { log('Topup referral failed: ' + e.message); }
      }

      try { await cycleEngine.onTopupApproved(session.userId, session.sessionId, session.amount, 'system'); } catch (e) { console.error('[otpManager] Cycle engine topup error:', e?.message); }

      session.result = { userId: session.userId, credited: session.amount, newBalance: walletResult?.newBalance || session.amount };
      log(`Topup completed: ${session.userId}, +₹${session.amount}`);
    }

    try { broadcast('pipelinePaymentApproved', { sessionId, type: session.paymentType, amount: session.amount }); } catch {}
    return session.result || { success: true };
  } catch (e) {
    log(`Post-approval error: ${e.message}`);
    return { error: e.message };
  }
}

module.exports = {
  ALLOWED_AMOUNTS, ACCEPTED_UPI, OTP_EXPIRY_MS, MAX_OTP_ATTEMPTS,
  otpSessions, processedUtx,
  generateOtp, generateSessionId,
  verifyOtp, resendOtp, processPaymentApproval,
};
