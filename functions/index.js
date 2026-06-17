const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();

const PAYMENT_AMOUNT = Number(functions.config().payment?.amount) || 120;
const CODE_EXPIRY_MINUTES = 10;

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) {
    s += chars.charAt(bytes[i] % chars.length);
  }
  return s;
}

function generateSessionId() {
  return 'PAY-' + randomString(8);
}

function generateVerificationCode() {
  return 'JTSB-' + randomString(6);
}

exports.razorpayWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const webhookSecret = functions.config().razorpay?.webhook_secret;
    if (!webhookSecret) {
      functions.logger.error('Razorpay webhook secret not configured');
      res.status(500).json({ error: 'Webhook secret not configured' });
      return;
    }

    const signature = req.headers['x-razorpay-signature'];
    if (!signature) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest();

    const sigBuffer = Buffer.from(signature, 'hex');
    const expBuffer = Buffer.from(expectedSignature);
    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body.event;
    functions.logger.info('Razorpay webhook event:', event);

    if (event !== 'payment.captured' && event !== 'order.paid') {
      res.status(200).json({ status: 'ignored', event });
      return;
    }

    const payment = req.body.payload?.payment?.entity;
    if (!payment) {
      res.status(200).json({ status: 'ignored', reason: 'no payment entity' });
      return;
    }

    const amountPaise = payment.amount;
    const amountRupees = amountPaise / 100;
    if (amountRupees !== PAYMENT_AMOUNT) {
      functions.logger.warn(`Amount mismatch: ${amountRupees} !== ${PAYMENT_AMOUNT}`);
      res.status(200).json({ status: 'ignored', reason: 'wrong amount' });
      return;
    }

    const status = payment.status;
    const acceptedStatuses = ['captured', 'paid'];
    if (!acceptedStatuses.includes(status)) {
      functions.logger.warn(`Payment status not accepted: ${status}`);
      res.status(200).json({ status: 'ignored', reason: `status: ${status}` });
      return;
    }

    const orderId = payment.order_id;
    if (!orderId) {
      res.status(200).json({ status: 'ignored', reason: 'no order_id' });
      return;
    }

    let sessionId = null;
    let userId = null;
    let paymentType = null;

    const orderDoc = await db.collection('razorpay_orders').doc(orderId).get();
    if (orderDoc.exists) {
      const orderData = orderDoc.data();
      sessionId = orderData.sessionId;
      userId = orderData.userId;
      paymentType = orderData.paymentType;
    } else {
      const notes = payment.notes || {};
      sessionId = notes.sessionId || payment.receipt || null;
      userId = notes.userId || null;
      paymentType = notes.paymentType || 'registration';
      if (!sessionId) {
        functions.logger.warn(`No sessionId found for order ${orderId}`);
        res.status(200).json({ status: 'ignored', reason: 'no sessionId in notes/receipt' });
        return;
      }
      const sessionDoc = await db.collection('payment_sessions').doc(sessionId).get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        userId = userId || sessionData.userId || null;
        paymentType = paymentType || sessionData.type || 'registration';
      }
    }

    if (!sessionId) {
      functions.logger.warn(`Could not resolve session for order ${orderId}`);
      res.status(200).json({ status: 'ignored', reason: 'no session resolved' });
      return;
    }

    const existingCodeDoc = await db.collection('verification_codes')
      .where('sessionId', '==', sessionId)
      .where('type', '==', paymentType)
      .limit(1)
      .get();

    if (!existingCodeDoc.empty) {
      functions.logger.warn(`Code already exists for session: ${sessionId}`);
      res.status(200).json({ status: 'already_processed' });
      return;
    }

    const verificationCode = generateVerificationCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000);

    const codeData = {
      code: verificationCode,
      sessionId,
      userId,
      type: paymentType,
      amount: amountRupees,
      paymentId: payment.id,
      orderId,
      status: 'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      used: false,
    };

    await db.collection('verification_codes').doc(verificationCode).set(codeData);

    await db.collection('payment_sessions').doc(sessionId).update({
      status: 'completed',
      razorpayPaymentId: payment.id,
      razorpayOrderId: orderId,
      verificationCode,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('razorpay_orders').doc(orderId).update({
      verified: true,
      verificationCode,
    });

    functions.logger.info(`Payment verified. Code: ${verificationCode}, User: ${userId}, Type: ${paymentType}`);

    res.status(200).json({ status: 'success', verificationCode });
  } catch (err) {
    functions.logger.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

exports.createPaymentSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const userId = context.auth.uid;
  const { paymentType, amount } = data;

  if (!paymentType || !['registration', 'topup'].includes(paymentType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid payment type');
  }

  const payAmount = amount || PAYMENT_AMOUNT;
  const sessionId = generateSessionId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  const sessionData = {
    sessionId,
    userId,
    type: paymentType,
    amount: payAmount,
    status: 'created',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
  };

  const razorpayKeyId = functions.config().razorpay?.key_id;
  const razorpayKeySecret = functions.config().razorpay?.key_secret;

  let razorpayOrderId = null;
  if (razorpayKeyId && razorpayKeySecret) {
    try {
      const Razorpay = require('razorpay');
      const instance = new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret });
      const order = await instance.orders.create({
        amount: payAmount * 100,
        currency: 'INR',
        receipt: sessionId,
        notes: { userId, sessionId, paymentType },
      });
      razorpayOrderId = order.id;

      await db.collection('razorpay_orders').doc(order.id).set({
        sessionId,
        userId,
        paymentType,
        amount: payAmount,
        status: 'created',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      sessionData.razorpayOrderId = order.id;
    } catch (err) {
      functions.logger.error('Razorpay order creation failed:', err);
    }
  }

  await db.collection('payment_sessions').doc(sessionId).set(sessionData);

  return {
    sessionId,
    razorpayOrderId,
    razorpayKeyId,
    amount: payAmount,
    expiresAt: expiresAt.toISOString(),
  };
});

exports.checkSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const { sessionId } = data;
  if (!sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing sessionId');
  }

  const doc = await db.collection('payment_sessions').doc(sessionId).get();
  if (!doc.exists) {
    throw new functions.https.HttpsError('not-found', 'Session not found');
  }

  return doc.data();
});

exports.verifyCode = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
  }

  const userId = context.auth.uid;
  const { code } = data;

  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing verification code');
  }

  const codeDoc = await db.collection('verification_codes').doc(code.toUpperCase().trim()).get();
  if (!codeDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Invalid verification code');
  }

  const codeData = codeDoc.data();

  if (codeData.userId !== userId) {
    throw new functions.https.HttpsError('permission-denied', 'This code does not belong to you');
  }

  if (codeData.status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', 'Code has already been used or expired');
  }

  if (codeData.used) {
    throw new functions.https.HttpsError('failed-precondition', 'Code has already been used');
  }

  const now = new Date();
  if (codeData.expiresAt && new Date(codeData.expiresAt) < now) {
    throw new functions.https.HttpsError('deadline-exceeded', 'Verification code has expired');
  }

  await db.collection('verification_codes').doc(code.toUpperCase().trim()).update({
    status: 'used',
    used: true,
    usedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const sessionDoc = await db.collection('payment_sessions').doc(codeData.sessionId).get();
  if (sessionDoc.exists) {
    await db.collection('payment_sessions').doc(codeData.sessionId).update({
      status: 'verified',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  return {
    verified: true,
    type: codeData.type,
    amount: codeData.amount,
    sessionId: codeData.sessionId,
  };
});
