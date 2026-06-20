const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_SESSIONS,
  COL_RAZORPAY_ORDERS, COL_PROCESSED_PAYMENTS, COL_WALLET_BALANCES, COL_WALLET_TX,
  MAX_REFERRALS, randomString, hashPassword, getProjectId, crypto
} = require('./_shared.js');
const { getDocument, deleteDocument, runQuery, writeDoc, updateDoc, addDoc } = require('./_firestoreRest.js');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) return res.status(500).json({ error: 'Webhook secret not configured' });
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(req.body)).digest();
    if (Buffer.from(signature, 'hex').length !== Buffer.from(expectedSignature).length || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature))) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = req.body.event;
    if (event !== 'payment.captured' && event !== 'order.paid') return res.status(200).json({ status: 'ignored', event });
    const payment = req.body.payload?.payment?.entity;
    if (!payment) return res.status(200).json({ status: 'ignored', reason: 'no payment entity' });
    const razorpayPaymentId = payment.id;
    const orderId = payment.order_id;
    if (!orderId) return res.status(200).json({ status: 'ignored', reason: 'no order_id' });
    const projectId = getProjectId();

    const existingPayment = await getDocument(projectId, COL_PROCESSED_PAYMENTS, razorpayPaymentId);
    if (existingPayment) return res.status(200).json({ status: 'already_processed', paymentId: razorpayPaymentId });

    let sessionId = null, userId = null, paymentType = null, pendingRegId = null, userEmail = null;
    const orderData = await getDocument(projectId, COL_RAZORPAY_ORDERS, orderId);
    if (orderData) {
      sessionId = orderData.sessionId; userId = orderData.userId;
      paymentType = orderData.paymentType; pendingRegId = orderData.pendingRegId;
      userEmail = orderData.userEmail;
    }
    const notes = payment.notes || {};
    sessionId = sessionId || notes.sessionId || payment.receipt || null;
    userId = userId || notes.userId || null;
    paymentType = paymentType || notes.paymentType || 'registration';
    pendingRegId = pendingRegId || notes.pendingRegId || null;
    userEmail = userEmail || notes.email || null;
    if (!sessionId && !pendingRegId && paymentType === 'registration') return res.status(200).json({ status: 'ignored', reason: 'no session/reg' });
    const amountRupees = payment.amount / 100;
    if (!['captured', 'paid'].includes(payment.status)) return res.status(200).json({ status: 'ignored', reason: 'status:' + payment.status });

    if (paymentType === 'registration') {
      if (!pendingRegId) return res.status(200).json({ status: 'ignored', reason: 'no pendingRegId' });
      const pendingReg = await getDocument(projectId, COL_PENDING_REGS, pendingRegId);
      if (!pendingReg) return res.status(200).json({ status: 'ignored', reason: 'pending_reg not found' });
      const userId = 'U' + randomString(16);
      let referredBy = null;
      const refCode = pendingReg.referralCode;
      if (refCode) {
        const referralUsers = await runQuery(projectId, COL_USERS, [{ field: { fieldPath: 'referral_code' }, op: 'EQUAL', value: { stringValue: refCode } }], 1);
        if (referralUsers.length) referredBy = referralUsers[0].id;
      }
      const userData = {
        userId, email: pendingReg.email, name: pendingReg.name || '',
        phone: pendingReg.phone || '', password: pendingReg.password,
        referral_code: randomString(8), referred_by: referredBy || null,
        role: 'user', isNewUser: false, needsPasswordChange: false,
        status: 'approved', account_status: 'active', paymentAmount: amountRupees, paymentId: razorpayPaymentId,
        payment_status: 'success', approved: true, active: true, membershipPaid: true,
        created_at: new Date().toISOString(),
      };
      await writeDoc(projectId, COL_USERS, userId, userData, [{ type: 'serverTimestamp', fieldPath: 'createdAt' }]);
      await writeDoc(projectId, COL_WALLET_BALANCES, userId, { balance: 0, totalDeposited: amountRupees }, [{ type: 'serverTimestamp', fieldPath: 'createdAt' }]);
      await addDoc(projectId, COL_WALLET_TX, { userId, type: 'deposit', amount: amountRupees, description: 'Registration payment', paymentId: razorpayPaymentId, balance: amountRupees });
      if (referredBy) {
        const sponsorWallet = await getDocument(projectId, COL_WALLET_BALANCES, referredBy);
        if (sponsorWallet) {
          const refAmount = amountRupees * 0.1;
          await writeDoc(projectId, COL_WALLET_BALANCES, referredBy, { balance: (sponsorWallet.balance || 0) + refAmount, totalDeposited: (sponsorWallet.totalDeposited || 0) }, [{ type: 'increment', fieldPath: 'balance', value: refAmount }]);
          await addDoc(projectId, COL_WALLET_TX, { userId: referredBy, type: 'referral_bonus', amount: refAmount, description: 'Referral bonus for ' + userId, relatedUserId: userId, balance: (sponsorWallet.balance || 0) + refAmount });
        }
      }
      await deleteDocument(projectId, COL_PENDING_REGS, pendingRegId);
      await updateDoc(projectId, COL_RAZORPAY_ORDERS, orderId, { status: 'completed', completedAt: new Date().toISOString() });
      await writeDoc(projectId, COL_PROCESSED_PAYMENTS, razorpayPaymentId, { type: 'registration', userId, amount: amountRupees, email: pendingReg.email }, [{ type: 'serverTimestamp', fieldPath: 'processedAt' }]);
      return res.status(200).json({ status: 'success', userId });
    }

    if (paymentType === 'topup') {
      if (!sessionId) return res.status(200).json({ status: 'ignored', reason: 'no sessionId' });
      if (!userId) return res.status(200).json({ status: 'ignored', reason: 'no userId' });
      const session = await getDocument(projectId, COL_SESSIONS, sessionId);
      if (session && session.type !== 'topup') return res.status(200).json({ status: 'ignored', reason: 'invalid session' });
      const wallet = await getDocument(projectId, COL_WALLET_BALANCES, userId) || { balance: 0, totalDeposited: 0 };
      const newBalance = (wallet.balance || 0) + amountRupees;
      const newTotalDeposited = (wallet.totalDeposited || 0) + amountRupees;
      await writeDoc(projectId, COL_WALLET_BALANCES, userId, { balance: newBalance, totalDeposited: newTotalDeposited }, [{ type: 'increment', fieldPath: 'balance', value: amountRupees }]);
      await addDoc(projectId, COL_WALLET_TX, { userId, type: 'deposit', amount: amountRupees, description: 'Topup via payment', paymentId: razorpayPaymentId, balance: newBalance });
      if (session) await updateDoc(projectId, COL_SESSIONS, sessionId, { status: 'completed', completedAt: new Date().toISOString(), paymentId: razorpayPaymentId, amount: amountRupees });
      await updateDoc(projectId, COL_RAZORPAY_ORDERS, orderId, { status: 'completed', completedAt: new Date().toISOString() });
      await writeDoc(projectId, COL_PROCESSED_PAYMENTS, razorpayPaymentId, { type: 'topup', userId, amount: amountRupees, sessionId }, [{ type: 'serverTimestamp', fieldPath: 'processedAt' }]);
      return res.status(200).json({ status: 'success', balance: newBalance });
    }

    return res.status(200).json({ status: 'ignored', reason: 'unknown paymentType:' + paymentType });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
