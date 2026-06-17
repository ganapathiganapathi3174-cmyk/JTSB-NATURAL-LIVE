import { collection, doc, addDoc, getDoc, getDocs, query, where, updateDoc, setDoc, runTransaction } from 'firebase/firestore';
import { getDb } from '../firebase/config.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const COL_WALLET = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_TOPUPS = 'topups_new';
const COL_USERS = 'users_new';

export const PLAN_AMOUNTS = { Starter: 120, Silver: 500, Gold: 1000, Premium: 2000 };
const EXPECTED_UPI = 'jayarajj126-3@okicici';
const EXPECTED_PAYMENT_AMOUNT = 120;

function now() {
  return new Date().toISOString();
}

function log(step, data) {
  console.log(`[AUTO_APPROVAL:${step}]`, JSON.stringify(data));
}

function isWithinToday(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const today = new Date();
  return d.toDateString() === today.toDateString();
}

function normalizeUtr(val) {
  if (!val) return '';
  return val.toString().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export const FirebaseAutoApproval = {
  async verifyAndProcessTopup(topupId, userId, topupData) {
    log('TOPUP_START', { topupId, userId, amount: topupData.amount, transactionId: topupData.transactionId });
    const db = getDb();
    const topupRef = doc(db, COL_TOPUPS, topupId);
    const checks = [];
    const hardFailures = [];

    function fail(check, reason, hard = true) {
      checks.push({ check, passed: false, reason });
      if (hard) hardFailures.push(reason);
      log('CHECK_FAIL', { check, reason, hard });
    }

    function pass(check) {
      checks.push({ check, passed: true });
      log('CHECK_PASS', { check });
    }

    function skip(check, reason) {
      checks.push({ check, passed: null, reason });
      log('CHECK_SKIP', { check, reason });
    }

    const userSnap = await getDoc(doc(db, COL_USERS, userId));
    if (!userSnap.exists()) {
      log('TOPUP_FAIL', { reason: 'User not found' });
      await updateDoc(topupRef, { status: 'rejected', rejectedAt: now(), auto_rejected: true, review_status: 'rejected', rejection_reason: 'User not found', adminId: 'auto', verification_details: checks });
      await this._sendNotification(userId, 'topup_rejected', 'Auto-rejected: User not found.');
      return { approved: false, rejected: true, reason: 'User not found', checks };
    }
    const user = { id: userSnap.id, ...userSnap.data() };
    log('USER_FOUND', { name: user.name, account_status: user.account_status, payment_status: user.payment_status });

    // 1. Rate limit
    const rl = checkRateLimit('topup:' + userId, 3, 60000);
    if (!rl.allowed) {
      log('RATE_LIMIT', { retryAfter: rl.retryAfter });
      fail('Rate Limit', `Too many attempts. Retry after ${rl.retryAfter}s`);
      await updateDoc(topupRef, { status: 'rejected', rejectedAt: now(), auto_rejected: true, review_status: 'rejected', rejection_reason: 'Rate limit: ' + rl.retryAfter + 's', adminId: 'auto', verification_details: checks });
      await this._sendNotification(userId, 'topup_rejected', 'Auto-rejected: Too many submissions.');
      return { approved: false, rejected: true, reason: 'Rate limited', checks };
    }
    pass('Rate Limit');

    // 2. Rapid submission check
    const recentQ = query(collection(db, COL_TOPUPS), where('userId', '==', userId), where('createdAt', '>=', new Date(Date.now() - 60000).toISOString()));
    const recentSnap = await getDocs(recentQ);
    if (recentSnap.size > 2) {
      log('RAPID_SUBMISSION', { count: recentSnap.size });
      fail('Rapid Submission', `More than 2 submissions in 60s (count: ${recentSnap.size})`);
      await updateDoc(topupRef, { status: 'rejected', rejectedAt: now(), auto_rejected: true, review_status: 'rejected', rejection_reason: 'Multiple rapid submissions', adminId: 'auto', verification_details: checks });
      await this._sendNotification(userId, 'topup_rejected', 'Auto-rejected: Multiple rapid submissions.');
      return { approved: false, rejected: true, reason: 'Rapid submission', checks };
    }
    pass('Rapid Submission');

    // 3. Amount check
    const amount = Number(topupData.amount) || 0;
    log('AMOUNT_CHECK', { submitted: amount, validPlans: Object.values(PLAN_AMOUNTS) });
    if (amount <= 0) {
      fail('Amount', 'Invalid amount: ' + amount, true);
    } else {
      const validPlans = Object.values(PLAN_AMOUNTS);
      if (validPlans.includes(amount)) {
        pass('Amount');
      } else {
        fail('Amount', `₹${amount} does not match any plan (${validPlans.join(', ')})`, true);
      }
    }

    // 4. Transaction ID uniqueness
    const txId = (topupData.transactionId || '').trim();
    log('TXID_CHECK', { txId: txId || '(empty)' });
    if (!txId) {
      fail('Transaction ID', 'Missing transaction ID', true);
    } else {
      const dupQ = query(collection(db, COL_TOPUPS), where('transactionId', '==', txId));
      const dupSnap = await getDocs(dupQ);
      const isDup = dupSnap.docs.some(d => d.id !== topupId);
      if (isDup) {
        log('TXID_DUPLICATE', { txId });
        fail('Unique Transaction ID', 'Duplicate transaction ID', true);
      } else {
        pass('Unique Transaction ID');
      }
    }

    // 5. User active
    log('USER_STATUS_CHECK', { account_status: user.account_status });
    if (user.account_status !== 'active') {
      fail('User Active', 'Account is ' + user.account_status, true);
    } else {
      pass('User Active');
    }

    // 6. Payment approved
    log('PAYMENT_STATUS_CHECK', { payment_status: user.payment_status });
    if (user.payment_status !== 'approved') {
      fail('Payment Status', 'Payment status: ' + user.payment_status, true);
    } else {
      pass('Payment Status');
    }

    // 7. UPI verification — requires OCR for exact match
    const hasScreenshot = !!(topupData.screenshotData || topupData.screenshot_url);
    if (hasScreenshot) {
      fail('UPI Verification', 'Screenshot provided but UPI verification requires OCR — cannot auto-approve without OCR data', true);
    } else {
      fail('UPI Verification', 'No screenshot available for UPI check', true);
    }

    // 8. Date validation — must be today
    const submittedAt = topupData.createdAt || now();
    if (submittedAt && isWithinToday(submittedAt)) {
      pass('Submission Date (Today)');
    } else {
      fail('Submission Date', 'Screenshot was not uploaded today', true);
    }

    const approved = hardFailures.length === 0;
    log('TOPUP_DECISION', { approved, hardFailures: hardFailures.join('; '), totalChecks: checks.length });

    if (approved) {
      log('TOPUP_APPROVED', { topupId, userId, amount });
      await updateDoc(topupRef, {
        status: 'approved',
        approvedAt: now(),
        adminId: 'auto',
        auto_approved: true,
        review_status: 'approved',
        approval_reason: 'All checks passed',
        verification_details: checks,
      });
      await this._creditWallet(userId, amount, topupId, 'Topup auto-approved');
      await FirebaseTopupReferralProcess(topupId);
      await this._sendNotification(userId, 'topup_approved', `Your topup of ₹${amount} has been auto-approved!`);
      const validationAudit = {
        upi: { label: 'Admin UPI Validation', passed: false, reason: 'Screenshot provided but UPI verification requires OCR', expected: EXPECTED_UPI, actual: hasScreenshot ? 'Screenshot (no OCR data)' : 'No screenshot' },
        utr: { label: 'UTR Validation', passed: !!(topupData.transactionId && !checks.find(c => c.check === 'Unique Transaction ID' && !c.passed)), userEntered: topupData.transactionId || 'N/A', ocrDetected: 'N/A (no OCR)' },
        duplicateUtr: { label: 'Unique Transaction ID', passed: !!(topupData.transactionId && !checks.find(c => c.check === 'Unique Transaction ID' && !c.passed)), expected: 'No duplicate', actual: checks.find(c => c.check === 'Unique Transaction ID' && !c.passed) ? 'Duplicate transaction ID' : 'No duplicate' },
        amount: { label: 'Amount Validation', passed: validPlans.includes(amount), expected: `One of ${validPlans.join(', ')}`, actual: `₹${amount}` },
        date: { label: 'Date Validation', passed: !!(topupData.createdAt && isWithinToday(topupData.createdAt)), expected: 'Today', actual: topupData.createdAt || 'Not provided' },
      };
      return { approved: true, rejected: false, needsReview: false, checks, validationAudit };
    }

    const rejectionReason = hardFailures.join('; ');
    const validPlans = Object.values(PLAN_AMOUNTS);
    const validationAudit = {
      upi: { label: 'Admin UPI Validation', passed: false, reason: 'Screenshot provided but UPI verification requires OCR', expected: EXPECTED_UPI, actual: hasScreenshot ? 'Screenshot (no OCR data)' : 'No screenshot' },
      utr: { label: 'UTR Validation', passed: !!(topupData.transactionId && !checks.find(c => c.check === 'Unique Transaction ID' && !c.passed)), userEntered: topupData.transactionId || 'N/A', ocrDetected: 'N/A (no OCR)' },
      duplicateUtr: { label: 'Unique Transaction ID', passed: !!(topupData.transactionId && !checks.find(c => c.check === 'Unique Transaction ID' && !c.passed)), expected: 'No duplicate', actual: checks.find(c => c.check === 'Unique Transaction ID' && !c.passed) ? 'Duplicate transaction ID' : 'No duplicate' },
      amount: { label: 'Amount Validation', passed: validPlans.includes(amount), expected: `One of ${validPlans.join(', ')}`, actual: `₹${amount}` },
      date: { label: 'Date Validation', passed: !!(topupData.createdAt && isWithinToday(topupData.createdAt)), expected: 'Today', actual: topupData.createdAt || 'Not provided' },
    };
    log('TOPUP_REJECTED', { topupId, userId, reason: rejectionReason });
    await updateDoc(topupRef, {
      status: 'rejected',
      rejectedAt: now(),
      adminId: 'auto',
      auto_rejected: true,
      review_status: 'rejected',
      rejection_reason: rejectionReason,
      verification_details: checks,
    });
    await this._sendNotification(userId, 'topup_rejected', `Your topup was auto-rejected: ${rejectionReason}`);
    return { approved: false, rejected: true, needsReview: false, reason: rejectionReason, checks, validationAudit };
  },

  async verifyAndProcessPayment(userId, paymentData) {
    log('PAYMENT_START', { userId, utr: paymentData.utr, amount: paymentData.amount, date: paymentData.date });
    const db = getDb();
    const userRef = doc(db, COL_USERS, userId);
    const checks = [];
    const hardFailures = [];

    function fail(check, reason, hard = true) {
      checks.push({ check, passed: false, reason });
      if (hard) hardFailures.push(reason);
      log('PAYMENT_CHECK_FAIL', { check, reason, hard });
    }

    function pass(check) {
      checks.push({ check, passed: true });
      log('PAYMENT_CHECK_PASS', { check });
    }

    function skip(check, reason) {
      checks.push({ check, passed: null, reason });
      log('PAYMENT_CHECK_SKIP', { check, reason });
    }

    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      log('PAYMENT_FAIL', { reason: 'User not found after creation' });
      return { approved: false, rejected: true, reason: 'User not found', checks };
    }
    const user = { id: userSnap.id, ...userSnap.data() };
    log('PAYMENT_USER', { name: user.name, email: user.email });

    // 1. Rate limit
    const rl = checkRateLimit('payment:' + userId, 3, 60000);
    if (!rl.allowed) {
      fail('Rate Limit', `Too many attempts. Retry after ${rl.retryAfter}s`);
      await updateDoc(userRef, { auto_approved: false, auto_rejected: true, review_status: 'rejected', validation_status: 'rejected', failure_reasons: hardFailures, validation_details: checks });
      return { approved: false, rejected: true, reason: 'Rate limited', checks };
    }
    pass('Rate Limit');

    // 2. Amount check
    const amount = Number(paymentData.amount) || 0;
    log('PAYMENT_AMOUNT', { expected: EXPECTED_PAYMENT_AMOUNT, submitted: amount });
    if (amount !== EXPECTED_PAYMENT_AMOUNT) {
      fail('Amount', `Expected ₹${EXPECTED_PAYMENT_AMOUNT}, got ₹${amount}`, true);
    } else {
      pass('Amount');
    }

    // 3. UTR uniqueness
    const utr = (paymentData.utr || '').trim();
    log('PAYMENT_UTR_CHECK', { utr: utr || '(empty)' });
    if (!utr) {
      fail('UTR', 'Missing UTR', true);
    } else {
      const { FirebaseUser } = await import('./firebase-db.js');
      const dupFound = await FirebaseUser.checkUtrExists(utr, userId);
      if (dupFound) {
        log('PAYMENT_UTR_DUPLICATE', { utr });
        fail('Unique UTR', 'Duplicate UTR', true);
      } else {
        pass('Unique UTR');
      }
    }

    // 4. Date validation — must be today
    const paymentDate = paymentData.date || '';
    log('PAYMENT_DATE', { paymentDate });
    if (paymentDate && isWithinToday(paymentDate)) {
      pass('Payment Date (Today)');
    } else if (paymentDate) {
      fail('Payment Date', `Date ${paymentDate} is not today`, true);
    } else {
      fail('Payment Date', 'No date provided', true);
    }

    // 5. UPI verification — requires OCR for exact match
    const hasScreenshot = !!(paymentData.screenshotData);
    if (hasScreenshot) {
      fail('UPI Verification', 'Screenshot provided but UPI verification requires OCR — cannot auto-approve without OCR data', true);
    } else {
      fail('UPI Verification', 'No screenshot available for UPI check', true);
    }

    // 6. User data validity
    if (!user.name || !user.email || !user.phone) {
      fail('User Data', 'Incomplete user profile', true);
    } else {
      pass('User Data');
    }

    // Decision: no failures = approve, any failure = reject (no pending state)
    const anyFailed = checks.some(c => c.passed === false);
    const approved = !anyFailed;
    log('PAYMENT_DECISION', { approved, anyFailed, totalChecks: checks.length });

    if (approved) {
      log('PAYMENT_APPROVED', { userId });
      const { FirebaseUser } = await import('./firebase-db.js');
      await FirebaseUser.updatePaymentStatus(userId, 'approved');
      await updateDoc(userRef, {
        auto_approved: true,
        auto_rejected: false,
        review_status: 'approved',
        validation_status: 'approved',
        validation_details: checks,
        approval_reason: 'All checks passed (client-side)',
        approved_at: now(),
        approved_by: 'auto',
        admin_approval_status: 'APPROVED',
        is_active: true,
      });
      const { getDoc } = await import('firebase/firestore');
      const db = getDb();
      const postSnap = await getDoc(doc(db, COL_USERS, userId));
      if (postSnap.exists()) {
        const post = postSnap.data();
        console.log('[AUTO APPROVAL DEBUG] post-approval fields:', JSON.stringify({
          userId,
          payment_status: post.payment_status,
          account_status: post.account_status,
          status: post.status,
          admin_approval_status: post.admin_approval_status,
          is_active: post.is_active,
          auto_approved: post.auto_approved,
          approved_at: post.approved_at,
        }));
      }
      await this._sendNotification(userId, 'payment_approved', 'Your ₹120 payment has been auto-approved! You can now log in.');
      const validationAudit = {
        upi: { label: 'Admin UPI Validation', passed: false, reason: 'Screenshot provided but OCR not available', expected: EXPECTED_UPI, actual: hasScreenshot ? 'Screenshot (OCR bypassed)' : 'No screenshot' },
        utr: { label: 'UTR Validation', passed: false, reason: 'UTR not cross-validated without OCR', userEntered: utr || 'N/A', ocrDetected: 'N/A (no OCR)' },
        duplicateUtr: { label: 'Duplicate UTR Validation', passed: !!(utr && !checks.find(c => c.check === 'Unique UTR' && !c.passed)), expected: 'Unique UTR', actual: checks.find(c => c.check === 'Unique UTR' && !c.passed) ? 'Duplicate UTR' : 'No duplicate' },
        amount: { label: 'Amount Validation', passed: amount === EXPECTED_PAYMENT_AMOUNT, expected: `₹${EXPECTED_PAYMENT_AMOUNT}`, actual: `₹${amount}` },
        date: { label: 'Date Validation', passed: checks.find(c => c.check.includes('Payment Date') && c.passed === true), expected: 'Today', actual: paymentDate || 'Not provided' },
      };
      return { approved: true, rejected: false, needsReview: false, checks, validationAudit };
    }

    const rejectionReason = hardFailures.join('; ') || 'Validation failed';
    const payAmount = Number(paymentData.amount) || 0;
    const validationAudit = {
      upi: { label: 'Admin UPI Validation', passed: false, reason: 'Screenshot provided but OCR not available', expected: EXPECTED_UPI, actual: hasScreenshot ? 'Screenshot (OCR bypassed)' : 'No screenshot' },
      utr: { label: 'UTR Validation', passed: !!(paymentData.utr && !checks.find(c => c.check === 'Unique UTR' && !c.passed)), userEntered: paymentData.utr || 'N/A', ocrDetected: 'N/A (no OCR)' },
      duplicateUtr: { label: 'Duplicate UTR Validation', passed: !!(paymentData.utr && !checks.find(c => c.check === 'Unique UTR' && !c.passed)), expected: 'Unique UTR', actual: checks.find(c => c.check === 'Unique UTR' && !c.passed) ? 'Duplicate UTR' : 'No duplicate' },
      amount: { label: 'Amount Validation', passed: payAmount === EXPECTED_PAYMENT_AMOUNT, expected: `₹${EXPECTED_PAYMENT_AMOUNT}`, actual: `₹${payAmount}` },
      date: { label: 'Date Validation', passed: !!(paymentData.date && isWithinToday(paymentData.date)), expected: 'Today', actual: paymentData.date || 'Not provided' },
    };
    log('PAYMENT_REJECTED', { userId, failures: rejectionReason });
    await updateDoc(userRef, {
      payment_status: 'rejected',
      auto_approved: false,
      auto_rejected: true,
      review_status: 'rejected',
      validation_status: 'rejected',
      failure_reasons: hardFailures,
      validation_details: checks,
    });
    await this._sendNotification(userId, 'payment_rejected', `Your payment was auto-rejected: ${rejectionReason}`);
    return { approved: false, rejected: true, needsReview: false, reason: rejectionReason, checks, validationAudit };
  },

  async getWalletBalance(userId) {
    const db = getDb();
    const ref = doc(db, COL_WALLET, userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return { balance: 0, userId };
    return { userId: snap.id, ...snap.data() };
  },

  async _creditWallet(userId, amount, reference, description) {
    const db = getDb();
    const walletRef = doc(db, COL_WALLET, userId);

    // Dedup: check if this reference was already credited
    const txQuery = query(
      collection(db, COL_WALLET_TX),
      where('reference', '==', reference),
      where('type', '==', 'credit')
    );
    const existingTx = await getDocs(txQuery);
    if (!existingTx.empty) {
      log('WALLET_DEDUP', { reference, reason: 'Transaction already credited' });
      return;
    }

    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(walletRef);
        const currentBalance = snap.exists() ? (snap.data().balance || 0) : 0;
        transaction.set(walletRef, {
          userId,
          balance: currentBalance + amount,
          updatedAt: now(),
          createdAt: snap.exists() ? snap.data().createdAt : now(),
        }, { merge: true });
      });
    } catch (e) {
      log('WALLET_TX_FALLBACK', { error: e.message });
      const snap = await getDoc(walletRef);
      const currentBalance = snap.exists() ? (snap.data().balance || 0) : 0;
      await setDoc(walletRef, {
        userId,
        balance: currentBalance + amount,
        updatedAt: now(),
        createdAt: snap.exists() ? snap.data().createdAt : now(),
      }, { merge: true });
    }
    await addDoc(collection(db, COL_WALLET_TX), {
      userId,
      type: 'credit',
      amount,
      reference,
      description: description || 'Topup credit',
      createdAt: now(),
    });
    log('WALLET_CREDITED', { userId, amount, reference, newBalance: 'check wallet_balances collection' });
  },

  async _sendNotification(userId, type, message) {
    try {
      const { FirebaseNotification } = await import('./firebase-db.js');
      await FirebaseNotification.send({
        receiverId: userId,
        type,
        message,
        senderId: 'system',
        senderName: 'System',
      });
      log('NOTIFICATION_SENT', { userId, type });
    } catch (e) {
      log('NOTIFICATION_FAILED', { error: e.message });
    }
  },
};

async function FirebaseTopupReferralProcess(topupId) {
  try {
    const { FirebaseTopup, FirebaseTopupReferral } = await import('./firebase-db.js');
    const topup = await FirebaseTopup.findById(topupId);
    if (topup) {
      await FirebaseTopupReferral.processTopupReferral(topup);
      log('REFERRAL_PROCESSED', { topupId });
    }
  } catch (e) {
    log('REFERRAL_FAILED', { error: e.message });
  }
}
