import { collection, doc, addDoc, getDoc, getDocs, query, where, updateDoc, setDoc, runTransaction, onSnapshot, orderBy } from 'firebase/firestore';
import { getDb } from '../firebase/config.js';
import { checkRateLimit } from '../utils/rateLimiter.js';

const COL_CLAIMS = 'topup_claims';
const COL_WALLET = 'wallet_balances';
const COL_WALLET_TX = 'wallet_transactions';
const COL_USERS = 'users_new';

const PLAN_AMOUNTS = { Starter: 120, Silver: 500, Gold: 1000, Premium: 2000 };
const EXPECTED_UPI = 'jayarajj126-3@okicici';

function now() {
  return new Date().toISOString();
}

function log(step, data) {
  console.log(`[CLAIM:${step}]`, JSON.stringify(data));
}

export const ClaimEngine = {

  async submitClaim(userId, userName, userEmail, amount, transactionId, screenshotData) {
    log('SUBMIT_START', { userId, amount, transactionId: transactionId ? transactionId.substring(0, 8) + '...' : '(empty)' });

    const amt = Number(amount) || 0;
    if (amt <= 0) throw new Error('Invalid amount');
    if (!transactionId || !transactionId.trim()) throw new Error('Transaction ID is required');

    const { compressImage } = await import('./firebase-db.js');
    let compressed = screenshotData;
    if (screenshotData && screenshotData.length > 300000) {
      try {
        compressed = await compressImage(screenshotData);
        log('IMAGE_COMPRESSED', { original: screenshotData.length, compressed: compressed?.length || 0 });
      } catch (e) {
        log('IMAGE_COMPRESS_FAIL', { error: e.message });
      }
    }

    const db = getDb();
    const docRef = await addDoc(collection(db, COL_CLAIMS), {
      userId,
      userName: userName || '',
      userEmail: userEmail || '',
      amount: amt,
      transactionId: transactionId.trim(),
      screenshotData: compressed || screenshotData || '',
      status: 'pending',
      review_status: 'pending',
      auto_approved: false,
      auto_rejected: false,
      wallet_credited: false,
      verification_details: [],
      rejection_reason: '',
      created_at: now(),
    });

    log('CLAIM_CREATED', { claimId: docRef.id, amount: amt });
    return { id: docRef.id, status: 'pending', needsReview: true, approved: false, rejected: false, reason: '' };
  },

  async verifyClaim(claimId) {
    log('VERIFY_START', { claimId });
    const db = getDb();
    const ref = doc(db, COL_CLAIMS, claimId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Claim not found');

    const claim = { id: snap.id, ...snap.data() };
    if (claim.status !== 'pending') {
      log('VERIFY_SKIP', { reason: 'Already ' + claim.status });
      return { approved: claim.status === 'approved', rejected: claim.status === 'rejected', needsReview: claim.review_status === 'needs_review' };
    }

    const checks = [];
    const failures = [];

    function fail(check, reason) {
      checks.push({ check, passed: false, reason });
      failures.push(reason);
      log('CHECK_FAIL', { check, reason });
    }
    function pass(check) {
      checks.push({ check, passed: true });
      log('CHECK_PASS', { check });
    }

    const rl = checkRateLimit('claim:' + claim.userId, 5, 60000);
    if (!rl.allowed) {
      fail('Rate Limit', `Too many attempts. Retry after ${rl.retryAfter}s`);
      await updateDoc(ref, {
        status: 'rejected', review_status: 'rejected', auto_rejected: true,
        rejection_reason: 'Rate limit: ' + rl.retryAfter + 's', verification_details: checks,
      });
      return { approved: false, rejected: true, needsReview: false, reason: 'Rate limited', checks };
    }
    pass('Rate Limit');

    // Amount matches plan
    const validAmounts = Object.values(PLAN_AMOUNTS);
    if (validAmounts.includes(claim.amount)) {
      pass('Amount');
    } else {
      fail('Amount', `₹${claim.amount} does not match any plan`);
    }

    // UTR uniqueness
    const txId = (claim.transactionId || '').trim();
    if (!txId) {
      fail('Transaction ID', 'Missing transaction ID');
    } else {
      const dupQ = query(collection(db, COL_CLAIMS), where('transactionId', '==', txId));
      const dupSnap = await getDocs(dupQ);
      const isDup = dupSnap.docs.some(d => d.id !== claimId && (d.data().status === 'approved' || d.data().status === 'pending' || d.data().review_status === 'needs_review'));
      if (isDup) {
        fail('Unique Transaction ID', 'Duplicate transaction ID');
      } else {
        pass('Unique Transaction ID');
      }
    }

    // User exists
    const userSnap = await getDoc(doc(db, COL_USERS, claim.userId));
    if (!userSnap.exists()) {
      fail('User Account', 'User not found');
    } else {
      pass('User Account');
    }

    const approved = failures.length === 0;
    const hasClearRejection = failures.some(f => f.includes('Duplicate') || f.includes('Invalid'));

    if (approved) {
      log('VERIFY_APPROVED', { claimId });
      await updateDoc(ref, {
        status: 'approved', review_status: 'approved', auto_approved: true, auto_rejected: false,
        verification_details: checks, approved_at: now(),
      });
      await this._creditWallet(claim.userId, claim.amount, claimId, 'Top-up claim approved');
      await updateDoc(ref, { wallet_credited: true, wallet_credited_at: now() });
      await this._sendNotification(claim.userId, 'claim_approved', `Your ₹${claim.amount} top-up claim has been approved and credited to your wallet.`);
      return { approved: true, rejected: false, needsReview: false, checks };
    }

    if (hasClearRejection) {
      log('VERIFY_REJECTED', { claimId, failures: failures.join('; ') });
      await updateDoc(ref, {
        status: 'rejected', review_status: 'rejected', auto_rejected: true, auto_approved: false,
        rejection_reason: failures.join('; '), verification_details: checks, rejected_at: now(),
      });
      await this._sendNotification(claim.userId, 'claim_rejected', `Your top-up claim was rejected: ${failures.join('; ')}`);
      return { approved: false, rejected: true, needsReview: false, reason: failures.join('; '), checks };
    }

    log('VERIFY_NEEDS_REVIEW', { claimId, failures: failures.join('; ') });
    await updateDoc(ref, {
      status: 'manual_review', review_status: 'needs_review', auto_approved: false, auto_rejected: false,
      rejection_reason: failures.join('; '), verification_details: checks,
    });
    await this._sendNotification(claim.userId, 'claim_pending_review', `Your top-up claim needs admin review: ${failures.join('; ')}`);
    return { approved: false, rejected: false, needsReview: true, reason: failures.join('; '), checks };
  },

  async approveClaim(claimId, adminId) {
    log('ADMIN_APPROVE', { claimId, adminId });
    const db = getDb();
    const ref = doc(db, COL_CLAIMS, claimId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Claim not found');
    const claim = snap.data();
    if (claim.wallet_credited) throw new Error('Wallet already credited for this claim');

    await updateDoc(ref, {
      status: 'approved', review_status: 'approved', reviewed_by: adminId, approved_at: now(),
    });
    await this._creditWallet(claim.userId, claim.amount, claimId, 'Top-up claim admin-approved');
    await updateDoc(ref, { wallet_credited: true, wallet_credited_at: now() });
    await this._sendNotification(claim.userId, 'claim_approved', `Your ₹${claim.amount} top-up claim has been approved by admin and credited to your wallet.`);
    return { success: true };
  },

  async rejectClaim(claimId, adminId, reason) {
    log('ADMIN_REJECT', { claimId, adminId, reason });
    const db = getDb();
    const ref = doc(db, COL_CLAIMS, claimId);
    await updateDoc(ref, {
      status: 'rejected', review_status: 'rejected', reviewed_by: adminId,
      rejection_reason: reason || 'Rejected by admin', rejected_at: now(),
    });
    const snap = await getDoc(ref);
    const claim = snap.data();
    await this._sendNotification(claim.userId, 'claim_rejected', `Your top-up claim was rejected by admin: ${reason || 'No reason provided'}`);
    return { success: true };
  },

  subscribeToClaims(userId, callback) {
    const db = getDb();
    const q = query(collection(db, COL_CLAIMS), where('userId', '==', userId), orderBy('created_at', 'desc'));
    return onSnapshot(q, (snap) => {
      const claims = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(claims);
    }, (err) => {
      log('SUBSCRIBE_ERROR', { error: err.message });
    });
  },

  subscribeToAllClaims(callback) {
    const db = getDb();
    const q = query(collection(db, COL_CLAIMS), orderBy('created_at', 'desc'));
    return onSnapshot(q, (snap) => {
      const claims = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(claims);
    }, (err) => {
      log('SUBSCRIBE_ERROR', { error: err.message });
    });
  },

  async _creditWallet(userId, amount, reference, description) {
    const db = getDb();
    const walletRef = doc(db, COL_WALLET, userId);

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
      description: description || 'Top-up claim credit',
      createdAt: now(),
    });
    log('WALLET_CREDITED', { userId, amount, reference });
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

  async getClaimById(claimId) {
    const db = getDb();
    const snap = await getDoc(doc(db, COL_CLAIMS, claimId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  },
};
