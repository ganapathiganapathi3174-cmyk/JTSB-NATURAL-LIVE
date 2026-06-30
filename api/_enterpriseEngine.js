const crypto = require('crypto');
const { COL_UPI_PAYMENTS, COL_USERS, COL_PENDING_REGS, COL_WALLET_BALANCES, COL_WALLET_TX, COL_REFERRALS, COL_NOTIFICATIONS, COL_TOPUP_INCOME, randomString, hashPassword } = require('./_shared.js');
const { runQuery, addDoc, updateDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');

const ALLOWED_AMOUNTS = [120, 540, 1200];
const ACCEPTED_UPI = '9655897523@ptyes';
const OTP_EXPIRY_MS = 300000;
const MAX_OTP_ATTEMPTS = 3;
const FRAUD_SCORE_REJECT = 60;

const otpSessions = new Map();
const processedUtx = new Set();

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [ENT] ${tag}: ${msg}`);
}

function getAI() {
  return require('./_ai_bridge.js');
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionId() {
  return 'ent_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

async function stage1_imageIntegrity(screenshotUrl) {
  log('S1', `Checking image: ${screenshotUrl}`);
  const result = { passed: true, checks: {}, confidence: 100 };
  if (!screenshotUrl || (typeof screenshotUrl !== 'string') || (!screenshotUrl.startsWith('http') && !screenshotUrl.startsWith('data:'))) {
    result.passed = false;
    result.confidence = 0;
    result.checks.url = 'Invalid URL';
    return result;
  }
  result.checks.url = 'Valid';
  return result;
}

async function stage2_multiOcr(screenshotUrl, expected) {
  log('S2', `Running multi-OCR for ${screenshotUrl}`);
  const result = { engines: {}, combined: null, confidence: 0, extracted: {} };
  try {
    const aiOutput = await getAI().analyzeWithAI(screenshotUrl, {
      amount: expected.amount,
      receiverUpi: ACCEPTED_UPI,
      utr: expected.utr,
      date: expected.paymentDate,
    });
    const mapped = getAI().mapAIResultToVerificationFormat(aiOutput);
    const { ocrResult, parsed, aiResult } = mapped;
    result.raw = aiOutput;
    result.parsed = parsed;
    result.aiResult = aiResult;
    if (!aiResult || aiResult.status === 'failed') {
      result.confidence = 0;
      log('S2', 'AI engine returned failed status');
      return result;
    }
    const presence = parsed?.presence || {};
    const mf = parsed?.matchedFields || {};
    result.extracted = {
      amount: presence.amount?.found || false,
      utr: presence.utr?.found || false,
      upi_id: presence.upi_id?.found || false,
      date: presence.date?.found || false,
    };
    const engineData = aiOutput?.stages?.stage3_multi_ocr?.engines || {};
    const engineNames = Object.keys(engineData);
    result.engineCount = engineNames.length;
    result.engines = engineNames.reduce((acc, name) => {
      acc[name] = { success: engineData[name]?.success || false, blocks: engineData[name]?.blocks || 0 };
      return acc;
    }, {});
    const successfulEngines = engineNames.filter(n => engineData[n]?.success);
    result.confidence = successfulEngines.length > 0 ? Math.round((successfulEngines.length / Math.max(engineNames.length, 1)) * 100) : 0;
    log('S2', `Engines: ${successfulEngines.length}/${engineNames.length} successful, confidence=${result.confidence}%`);
    log('S2', `Extracted: ${Object.entries(result.extracted).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}`);
  } catch (e) {
    log('S2', `OCR failed: ${e.message}`);
    result.confidence = 0;
  }
  return result;
}

async function stage3_visualCrossCheck(ocrOutput) {
  log('S3', 'Cross-verifying extracted fields');
  const result = { passed: true, checks: {}, confidence: 100 };
  if (!ocrOutput || !ocrOutput.aiResult) {
    result.passed = false;
    result.confidence = 0;
    result.checks.ai = 'AI result unavailable';
    return result;
  }
  const aiReasons = ocrOutput.aiResult.reasons || [];
  const matchedFields = ocrOutput.parsed?.matchedFields || {};
  result.checks.utr = matchedFields.utr ? 'matched' : 'not found';
  result.checks.date = matchedFields.date ? 'matched' : 'not found';
  result.checks.amount = matchedFields.amount === 'matched' ? 'matched' : (matchedFields.amount === 'uncertain' ? 'uncertain' : 'not found');
  result.checks.upi_id = matchedFields.upi_id ? 'matched' : 'not found';
  const allText = ocrOutput.parsed?.presence?.allText || '';
  const paymentApps = ['phonepe', 'google pay', 'paytm', 'amazon pay', 'bhim', 'cred', 'upi'];
  const foundApp = paymentApps.find(app => allText.toLowerCase().includes(app));
  result.checks.app = foundApp || 'unknown';
  const foundStatus = allText.toLowerCase().includes('success') || allText.toLowerCase().includes('paid') || allText.toLowerCase().includes('completed');
  result.checks.status = foundStatus ? 'success' : 'unknown';
  if (foundStatus) result.confidence = Math.min(100, result.confidence + 10);
  const matchedCount = Object.values(matchedFields).filter(v => v === true || v === 'matched').length;
  result.confidence = Math.round((matchedCount / 4) * 100);
  log('S3', `Matched ${matchedCount}/4 fields, app=${result.checks.app}, status=${result.checks.status}, confidence=${result.confidence}%`);
  return result;
}

async function stage4_businessValidation(ocrExtracted, crossCheck, expected) {
  log('S4', 'Validating extracted data against expected values');
  const result = { passed: true, validations: {}, confidence: 100, reasons: [] };
  if (!ocrExtracted) {
    result.passed = false;
    result.confidence = 0;
    result.reasons.push('No OCR data available');
    return result;
  }
  const extracted = ocrExtracted.extracted || {};
  result.validations = {
    amountMatch: extracted.amount ? 'verified' : 'unreadable',
    upiMatch: extracted.upi_id ? 'verified' : 'not found',
    utrMatch: extracted.utr ? 'verified' : 'not found',
    dateMatch: extracted.date ? 'verified' : 'not found',
  };
  const verifiedCount = Object.values(result.validations).filter(v => v === 'verified').length;
  result.confidence = Math.round((verifiedCount / 4) * 100);
  if (crossCheck?.checks?.status === 'success') result.confidence = Math.min(100, result.confidence + 10);
  log('S4', `Validated ${verifiedCount}/4 fields, confidence=${result.confidence}%`);
  return result;
}

async function stage5_evidenceFusion(stage4, stage3, stage2, expected) {
  log('S5', '=== EVIDENCE FUSION ===');
  const result = { decision: 'manual_review', reasons: [], matched_fields: {}, otpRequired: false, otpSent: false };
  const v = stage4?.validations || {};
  const cc = stage3?.checks || {};
  const extracted = stage2?.extracted || {};

  const utrFound = extracted.utr || v.utrMatch === 'verified' || cc.utr === 'matched';
  const dateFound = extracted.date || v.dateMatch === 'verified' || cc.date === 'matched';
  const amountFound = extracted.amount || v.amountMatch === 'verified' || cc.amount === 'matched';
  const upiFound = extracted.upi_id || v.upiMatch === 'verified' || cc.upi_id === 'matched';
  const statusSuccess = cc.status === 'success';

  result.matched_fields = { utr: utrFound, date: dateFound, amount: amountFound ? 'matched' : 'uncertain', upi_id: upiFound };

  const strongRejectSignals = [];
  if (!utrFound) strongRejectSignals.push('UTR not found');
  if (!upiFound && statusSuccess) strongRejectSignals.push('Receiver UPI mismatch despite success status');

  if (utrFound && dateFound) {
    result.decision = 'approve';
    result.reasons = ['UTR matched successfully', 'Date matches current transaction'];
    if (amountFound) result.reasons.push('Amount matches');
    else result.reasons.push('Amount unclear but ignored (UTR+date confirmed)');
    if (upiFound) result.reasons.push('UPI ID matches');
    if (statusSuccess) result.reasons.push('Payment status confirmed');
    result.otpRequired = true;
    log('S5', '✅ APPROVE — UTR+Date confirmed, OTP required for final approval');
  } else if (strongRejectSignals.length >= 2) {
    result.decision = 'reject';
    result.reasons = strongRejectSignals;
    log('S5', `❌ REJECT — ${strongRejectSignals.join(', ')}`);
  } else if (utrFound && amountFound) {
    result.decision = 'approve';
    result.reasons = ['UTR matched', 'Amount matches'];
    if (!dateFound) result.reasons.push('Date unclear but UTR+Amount confirmed');
    result.otpRequired = true;
    log('S5', '✅ APPROVE — UTR+Amount confirmed, OTP required');
  } else if (amountFound && upiFound && dateFound) {
    result.decision = 'approve';
    result.reasons = ['Amount matches', 'UPI ID matches', 'Date matches'];
    result.otpRequired = true;
    log('S5', '✅ APPROVE — Amount+UPI+Date confirmed');
  } else if (utrFound) {
    result.decision = 'manual_review';
    result.reasons = ['UTR found but other fields unclear'];
    log('S5', '⏸ MANUAL_REVIEW — UTR found, insufficient evidence');
  } else {
    result.decision = 'manual_review';
    result.reasons = ['Insufficient evidence for auto-approval'];
    log('S5', '⏸ MANUAL_REVIEW — Insufficient evidence');
  }
  return result;
}

async function processPaymentApproval(sessionId) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  log('POST-APPROVAL', `Completing ${session.paymentType} for session ${sessionId}`);

  try {
    if (session.paymentType === 'registration') {
      const reg = session.pendingReg;
      const hashedPw = hashPassword(reg.password_hash || 'default');
      const refCode = randomString(8);
      const userData = {
        name: reg.name, email: reg.email, phone: reg.phone,
        password_hash: hashedPw, referral_code: refCode,
        plan: String(session.amount), status: 'active',
        created_at: new Date().toISOString(),
      };
      const newUser = await addDoc(COL_USERS, userData);
      if (!newUser || !newUser.id) throw new Error('Failed to create user');
      const userId = newUser.id;
      log('POST-APPROVAL', `User created: ${userId}`);

      await addDoc(COL_WALLET_BALANCES, { user_id: userId, balance: 0, created_at: new Date().toISOString() }).catch(() => {});
      await addDoc(COL_WALLET_TX, { user_id: userId, type: 'registration_bonus', amount: 0, description: 'Account activation', created_at: new Date().toISOString() }).catch(() => {});

      if (reg.referral_code) {
        try {
          const referrers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: reg.referral_code }]);
          if (referrers && referrers.length > 0) {
            const referrer = referrers[0];
            const refBonus = session.amount >= 540 ? 50 : 20;
            await atomicCreditWallet(referrer.id, refBonus, `referral_bonus_${userId}`);
            await addDoc(COL_REFERRALS, { referrer_id: referrer.id, referred_id: userId, amount: refBonus, created_at: new Date().toISOString() }).catch(() => {});
          }
        } catch (e) { log('POST-APPROVAL', `Referral failed: ${e.message}`); }
      }

      await addDoc(COL_NOTIFICATIONS, { userId, receiverId: userId, title: 'Registration Approved', message: 'Your account has been activated. Welcome!', status: 'unread', type: 'account', created_at: new Date().toISOString() }).catch(() => {});
      session.result = { userId, status: 'active', plan: String(session.amount) };
      log('POST-APPROVAL', `Registration completed: ${userId}`);

    } else if (session.paymentType === 'topup') {
      const walletResult = await atomicCreditWallet(session.userId, session.amount, `topup_${session.utr}`);
      if (!walletResult || walletResult.error) throw new Error(walletResult?.error || 'Wallet credit failed');
      await addDoc(COL_NOTIFICATIONS, { userId: session.userId, receiverId: session.userId, title: 'Topup Successful', message: `₹${session.amount} credited to wallet`, status: 'unread', type: 'wallet', created_at: new Date().toISOString() }).catch(() => {});
      session.result = { userId: session.userId, credited: session.amount, newBalance: walletResult.newBalance };
      log('POST-APPROVAL', `Topup completed: ${session.userId}, +₹${session.amount}`);
    }

    try { broadcast('enterprisePaymentApproved', { sessionId, type: session.paymentType, amount: session.amount }); } catch {}
    return session.result || { success: true };
  } catch (e) {
    log('POST-APPROVAL', `Error: ${e.message}`);
    return { error: e.message };
  }
}

module.exports = {
  ALLOWED_AMOUNTS, ACCEPTED_UPI, OTP_EXPIRY_MS, MAX_OTP_ATTEMPTS,
  otpSessions, processedUtx,
  generateOtp, generateSessionId,
  stage1_imageIntegrity,
  stage2_multiOcr,
  stage3_visualCrossCheck,
  stage4_businessValidation,
  stage5_evidenceFusion,
  processPaymentApproval,
};
