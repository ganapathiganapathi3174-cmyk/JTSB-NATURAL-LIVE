const crypto = require('crypto');

const MERCHANT_NAME = 'JTSB Natural';
const UPI_ID = 'jayarajj126-3@okicici';

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [UPI-GATEWAY] [${tag}] ${msg}`);
}

function generateOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateUPIIntentUrl(orderId, amount, description) {
  const params = new URLSearchParams({
    pa: UPI_ID,
    pn: MERCHANT_NAME,
    am: amount.toFixed(2),
    tr: orderId,
    tn: (description || 'Payment').substring(0, 30),
    cu: 'INR',
  });
  return 'upi://pay?' + params.toString();
}

const razorpayConfigured = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function createRazorpayOrder(amount, orderId, description, customerInfo) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: orderId,
      notes: { description: (description || '').substring(0, 100) },
    }),
  });
  if (!res.ok) throw new Error('Razorpay order creation failed: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  log('RAZORPAY', `Order created: id=${data.id}, amount=${amount}`);
  return {
    gatewayOrderId: data.id,
    amount: data.amount / 100,
    currency: data.currency,
    status: data.status,
    upiIntentUrl: null,
    razorpayOrderId: data.id,
    razorpayKeyId: keyId,
  };
}

async function createMockOrder(amount, orderId, description) {
  const upiIntentUrl = generateUPIIntentUrl(orderId, amount, description);
  log('MOCK', `Order created: id=${orderId}, amount=${amount}, upi=${upiIntentUrl}`);
  return {
    gatewayOrderId: orderId,
    amount,
    currency: 'INR',
    status: 'created',
    upiIntentUrl,
  };
}

async function createOrder(amount, description, customerInfo) {
  const orderId = generateOrderId();
  if (razorpayConfigured) {
    return createRazorpayOrder(amount, orderId, description, customerInfo);
  }
  return createMockOrder(amount, orderId, description);
}

async function verifyWebhook(gatewayOrderId, signature, rawBody) {
  if (razorpayConfigured) {
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const expected = crypto.createHmac('sha256', keySecret).update(rawBody).digest('hex');
    const match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!match) throw new Error('Invalid webhook signature');
    log('WEBHOOK', `Signature verified for order ${gatewayOrderId}`);
    return true;
  }
  if (gatewayOrderId && signature === 'mock-webhook-secret') return true;
  if (gatewayOrderId) return true;
  throw new Error('Invalid webhook signature');
}

async function getOrderStatusFromGateway(gatewayOrderId) {
  if (razorpayConfigured) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const auth = Buffer.from(keyId + ':' + keySecret).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/orders/' + gatewayOrderId, {
      headers: { 'Authorization': 'Basic ' + auth },
    });
    if (!res.ok) throw new Error('Failed to fetch order status: ' + res.status);
    const data = await res.json();
    return { status: data.status, amount: data.amount / 100 };
  }
  return null;
}

module.exports = {
  createOrder,
  verifyWebhook,
  getOrderStatusFromGateway,
  generateUPIIntentUrl,
  generateOrderId,
  UPI_ID,
  MERCHANT_NAME,
};
