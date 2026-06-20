const { COL_USERS, COL_PENDING_REGS, COL_RAZORPAY_ORDERS, randomString, hashPassword, getProjectId } = require('./_shared.js');
const { runQuery, writeDoc } = require('./_firestoreRest.js');
const Razorpay = require('razorpay');
const PAYMENT_AMOUNT = Number(process.env.PAYMENT_AMOUNT) || 120;
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-razorpay-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { name, email, phone, password, referralCode } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const projectId = getProjectId();
    const emailLower = email.toLowerCase().trim();
    const existing = await runQuery(projectId, COL_USERS, [{ field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: emailLower } }], 1);
    if (existing.length) return res.status(409).json({ error: 'An account with this email already exists' });
    const pendingRegId = 'REG_' + randomString(12);
    const hashedPw = hashPassword(password);
    await writeDoc(projectId, COL_PENDING_REGS, pendingRegId, {
      email: emailLower, name: name || '', phone: phone || '',
      password: hashedPw, referralCode: referralCode || null,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    const razorpayKeyId = process.env.VITE_RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpayKeyId || !razorpayKeySecret) return res.status(500).json({ error: 'Razorpay not configured' });
    let razorpayOrderId = null;
    try {
      const instance = new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret });
      const order = await instance.orders.create({
        amount: PAYMENT_AMOUNT * 100, currency: 'INR', receipt: pendingRegId,
        notes: { pendingRegId, email: emailLower, name: name || '', phone: phone || '', referralCode: referralCode || '', paymentType: 'registration' },
      });
      razorpayOrderId = order.id;
      await writeDoc(projectId, COL_RAZORPAY_ORDERS, order.id, {
        pendingRegId, userEmail: emailLower, paymentType: 'registration',
        amount: PAYMENT_AMOUNT, status: 'created',
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create payment order' });
    }
    return res.status(200).json({ pendingRegId, razorpayOrderId, razorpayKeyId, amount: PAYMENT_AMOUNT });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
