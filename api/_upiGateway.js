const crypto = require('crypto');

const MERCHANT_NAME = 'JTSB Natural';
const UPI_ID = 'jayarajj126-3@okicici';
const MOBILE_NUMBER = '9655897523';
const DEFAULT_TIMEOUT_MINUTES = 10;

const UPI_APPS = {
  GOOGLE_PAY: { scheme: 'tez', pkg: 'com.google.android.apps.nbu.paisa.user' },
  PHONE_PE: { scheme: 'phonepe', pkg: 'com.phonepe.app' },
  PAYTM: { scheme: 'paytmmp', pkg: 'net.one97.paytm' },
  BHIM: { scheme: 'bhim', pkg: 'in.org.npci.upiapp' },
  AMAZON_PAY: { scheme: 'amazonpay', pkg: 'in.amazon.mShop.android.shopping' },
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [UPI-GATEWAY] [${tag}] ${msg}`);
}

function generateOrderId() {
  return 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function upiEncode(val, keepAt) {
  var s = encodeURIComponent(String(val)).replace(/%20/g, '%20');
  if (keepAt) s = s.replace(/%40/g, '@');
  return s;
}

function generateUPIIntentUrl(amount) {
  const params = [
    'pa=' + upiEncode(UPI_ID, true),
    'pn=' + upiEncode(MERCHANT_NAME),
    'am=' + upiEncode(amount.toFixed(2)),
    'cu=' + upiEncode('INR'),
  ];
  return 'upi://pay?' + params.join('&');
}

function generateUPIIntentForApp(amount, appScheme) {
  const upiUri = generateUPIIntentUrl(amount);
  if (appScheme === 'tez') {
    return 'tez://upi/pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'phonepe') {
    return 'phonepe://pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'paytmmp') {
    return 'paytmmp://pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'bhim') {
    return 'bhim://upi/pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'amazonpay') {
    return 'amazonpay://upi/pay?' + upiUri.split('?')[1];
  }
  return upiUri;
}

function generateMobileUPIIntentUrl(amount) {
  const params = [
    'pa=' + upiEncode(MOBILE_NUMBER + '@upi', true),
    'pn=' + upiEncode(MERCHANT_NAME),
    'am=' + upiEncode(amount.toFixed(2)),
    'cu=' + upiEncode('INR'),
  ];
  return 'upi://pay?' + params.join('&');
}

function generateMobileUPIIntentForApp(amount, appScheme) {
  const upiUri = generateMobileUPIIntentUrl(amount);
  if (appScheme === 'tez') {
    return 'tez://upi/pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'phonepe') {
    return 'phonepe://pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'paytmmp') {
    return 'paytmmp://pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'bhim') {
    return 'bhim://upi/pay?' + upiUri.split('?')[1];
  }
  if (appScheme === 'amazonpay') {
    return 'amazonpay://upi/pay?' + upiUri.split('?')[1];
  }
  return upiUri;
}

function getMobileUPIDeeplinks(amount) {
  const baseUri = generateMobileUPIIntentUrl(amount);
  const apps = {};
  for (const [name, config] of Object.entries(UPI_APPS)) {
    apps[name] = {
      intent: generateMobileUPIIntentForApp(amount, config.scheme),
      packageName: config.pkg,
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    };
  }
  return { baseUri, apps, mobileNumber: MOBILE_NUMBER, upiId: UPI_ID, merchantName: MERCHANT_NAME };
}

function getUPIDeeplinks(amount) {
  const baseUri = generateUPIIntentUrl(amount);
  const apps = {};
  for (const [name, config] of Object.entries(UPI_APPS)) {
    apps[name] = {
      intent: generateUPIIntentForApp(amount, config.scheme),
      packageName: config.pkg,
      name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    };
  }
  return { baseUri, apps, upiId: UPI_ID, merchantName: MERCHANT_NAME };
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
  const deeplinks = getUPIDeeplinks(amount);
  log('MOCK', `Order created: id=${orderId}, amount=${amount}`);
  return {
    gatewayOrderId: orderId,
    amount,
    currency: 'INR',
    status: 'created',
    upiIntentUrl: deeplinks.baseUri,
    deeplinks,
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
  getUPIDeeplinks,
  UPI_ID,
  MOBILE_NUMBER,
  MERCHANT_NAME,
  UPI_APPS,
  DEFAULT_TIMEOUT_MINUTES,
};

