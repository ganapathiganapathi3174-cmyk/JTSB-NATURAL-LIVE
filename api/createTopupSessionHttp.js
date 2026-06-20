const { COL_SESSIONS, COL_RAZORPAY_ORDERS, randomString, getProjectId } = require('./_shared.js');
const { writeDoc } = require('./_firestoreRest.js');
const Razorpay = require('razorpay');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-razorpay-signature');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { userId, amount } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!amount || amount < 1) return res.status(400).json({ error: 'Valid amount is required' });
    const projectId = getProjectId();
    const sessionId = 'TOPUP-' + randomString(8);
    const razorpayKeyId = process.env.VITE_RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
    let razorpayOrderId = null;
    if (razorpayKeyId && razorpayKeySecret) {
      try {
        const instance = new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret });
        const order = await instance.orders.create({
          amount: Number(amount) * 100, currency: 'INR', receipt: sessionId,
          notes: { userId, sessionId, paymentType: 'topup' },
        });
        razorpayOrderId = order.id;
        await writeDoc(projectId, COL_RAZORPAY_ORDERS, order.id, {
          sessionId, userId, paymentType: 'topup', amount: Number(amount), status: 'created',
        });
      } catch (err) {
        return res.status(500).json({ error: 'Failed to create payment order' });
      }
    }
    await writeDoc(projectId, COL_SESSIONS, sessionId, {
      sessionId, userId, type: 'topup', amount: Number(amount), status: 'created',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    return res.status(200).json({ sessionId, razorpayOrderId, razorpayKeyId, amount: Number(amount) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
