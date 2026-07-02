const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_UPI_PAYMENTS, MAX_REFERRALS, randomString, COL_TOPUP_INCOME,
} = require('./_shared.js');
const { runQuery, addDoc, writeDoc, updateDoc, getDoc, deleteDoc, atomicCreditWallet } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');
const gateway = require('./_upiGateway.js');
const crypto = require('crypto');

const ORDER_TTL_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_DURATION_MS = 30 * 60 * 1000;
const pendingOrders = new Map();
const COL_ORDERS = 'payment_sessions';

const ORDER_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [ORDER-MGR] [${tag}] ${msg}`);
}

function now() { return new Date().toISOString(); }

function createOrderInMemory(orderData) {
  pendingOrders.set(orderData.id, { ...orderData, _updatedAt: Date.now() });
  if (orderData.expiresAt) {
    setTimeout(() => {
      const existing = pendingOrders.get(orderData.id);
      if (existing && (existing.status === ORDER_STATUS.PENDING || existing.status === ORDER_STATUS.PROCESSING)) {
        existing.status = ORDER_STATUS.EXPIRED;
        pendingOrders.set(orderData.id, existing);
        log('EXPIRE', `Order ${orderData.id} expired (in-memory timeout)`);
        broadcast('paymentUpdated', { orderId: orderData.id, status: ORDER_STATUS.EXPIRED });
      }
    }, new Date(orderData.expiresAt).getTime() - Date.now());
  }
}

async function lookupUser(userId) {
  try { const u = await getDoc(COL_USERS, userId); if (u) return u; } catch {}
  const found = await runQuery(COL_USERS, [{ field: 'email', op: 'EQUAL', value: userId }], { limit: 1 });
  if (found.length) return found[0];
  return null;
}

async function createUPIOrder(type, amount, userId, pendingRegId, plan) {
  const description = type === 'registration' ? 'Registration Payment' : 'Wallet Top-up';
  const customerInfo = {};
  if (type === 'registration' && pendingRegId) {
    const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pending) throw Object.assign(new Error('Pending registration not found'), { status: 404 });
    customerInfo.email = pending.email;
    customerInfo.name = pending.name;
    customerInfo.phone = pending.phone;
  } else if (type === 'topup' && userId) {
    const user = await lookupUser(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    customerInfo.email = user.email;
  } else {
    throw Object.assign(new Error('Valid userId or pendingRegId required'), { status: 400 });
  }

  const gatewayResult = await gateway.createOrder(amount, description, customerInfo);
  const orderId = gatewayResult.gatewayOrderId;
  const expiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();

  const orderData = {
    id: orderId,
    gateway_order_id: gatewayResult.razorpayOrderId || orderId,
    type,
    amount,
    status: ORDER_STATUS.PENDING,
    user_id: userId || null,
    pending_reg_id: pendingRegId || null,
    upi_intent_url: gatewayResult.upiIntentUrl || null,
    transaction_ref: null,
    description,
    customer_info: customerInfo,
    created_at: now(),
    updated_at: now(),
    expires_at: expiresAt,
    razorpay_key_id: gatewayResult.razorpayKeyId || null,
  };

  try {
    await addDoc(COL_ORDERS, {
      sessionId: orderId, user_id: orderData.user_id, type: orderData.type,
      amount: orderData.amount, status: ORDER_STATUS.PENDING.toLowerCase(),
      expires_at: expiresAt,
    });
  } catch (e) {
    log('DB', 'Failed to save order to DB: ' + e.message);
  }
  createOrderInMemory(orderData);
  pendingOrders.set('_extra_' + orderId, { upiIntentUrl: gatewayResult.upiIntentUrl, gatewayOrderId: orderData.gateway_order_id, razorpayKeyId: gatewayResult.razorpayKeyId });

  log('CREATE', `Order ${orderId}: type=${type}, amount=${amount}, status=PENDING, expires=${expiresAt}`);

  try {
    broadcast('paymentCreated', { orderId, type, amount, status: ORDER_STATUS.PENDING });
  } catch {}

  return {
    orderId,
    amount,
    type,
    status: ORDER_STATUS.PENDING,
    upiIntentUrl: gatewayResult.upiIntentUrl,
    deeplinks: gatewayResult.deeplinks || null,
    razorpayKeyId: gatewayResult.razorpayKeyId || null,
    expiresAt,
    description,
  };
}

async function processWebhook(gatewayOrderId, transactionRef, status, signature, rawBody) {
  await gateway.verifyWebhook(gatewayOrderId, signature, rawBody);

  let order = pendingOrders.get(gatewayOrderId);
  if (!order) {
    const sess = await getDoc(COL_ORDERS, gatewayOrderId).catch(() => null);
    const memExtra = pendingOrders.get('_extra_' + gatewayOrderId) || {};
    if (sess) order = { id: sess.sessionId || sess.id, type: sess.type, amount: sess.amount, user_id: sess.user_id, pending_reg_id: sess.pending_reg_id, status: sess.status, upi_intent_url: memExtra.upiIntentUrl, transaction_ref: memExtra.transactionRef, created_at: sess.created_at || sess.createdAt, expires_at: sess.expires_at || sess.expiresAt };
  }
  if (!order) {
    log('WEBHOOK', `Order ${gatewayOrderId} not found`);
    const upiPayments = await runQuery(COL_UPI_PAYMENTS, [{ field: 'utr', op: 'EQUAL', value: gatewayOrderId }], { limit: 1 });
    if (upiPayments.length) {
      order = { id: gatewayOrderId, type: upiPayments[0].payment_type, amount: upiPayments[0].amount, user_id: upiPayments[0].user_id, pending_reg_id: upiPayments[0].pending_reg_id, status: 'PENDING' };
    }
  }
  if (!order) throw Object.assign(new Error('Order not found: ' + gatewayOrderId), { status: 404 });

  const currentStatus = order.status || 'PENDING';
  if (currentStatus === ORDER_STATUS.SUCCESS) {
    log('WEBHOOK', `Duplicate webhook for ${gatewayOrderId}, already SUCCESS`);
    return { idempotent: true, status: ORDER_STATUS.SUCCESS };
  }
  if (currentStatus === ORDER_STATUS.EXPIRED || currentStatus === ORDER_STATUS.CANCELLED) {
    log('WEBHOOK', `Webhook for expired/cancelled order ${gatewayOrderId}: ${currentStatus}`);
    const memExtra = pendingOrders.get('_extra_' + gatewayOrderId) || {};
    pendingOrders.set('_extra_' + gatewayOrderId, { ...memExtra, transactionRef, webhookStatus: status, receivedAt: now() });
    const memOrder = pendingOrders.get(gatewayOrderId);
    if (memOrder) { memOrder.status = currentStatus; pendingOrders.set(gatewayOrderId, memOrder); }
    return { status: currentStatus, note: 'Order was already ' + currentStatus };
  }

  const newStatus = (status === 'captured' || status === 'paid' || status === 'success') ? ORDER_STATUS.SUCCESS
    : (status === 'failed' || status === 'cancelled') ? ORDER_STATUS.FAILED
    : ORDER_STATUS.FAILED;

  const memExtra = pendingOrders.get('_extra_' + gatewayOrderId) || {};
  pendingOrders.set('_extra_' + gatewayOrderId, { ...memExtra, transactionRef, webhookStatus: status, receivedAt: now() });

  try { await updateDoc(COL_ORDERS, gatewayOrderId, { status: newStatus.toLowerCase() }).catch(() => {}); } catch {}

  const memOrder = pendingOrders.get(gatewayOrderId);
  if (memOrder) { memOrder.status = newStatus; memOrder.transaction_ref = transactionRef; pendingOrders.set(gatewayOrderId, memOrder); }

  log('WEBHOOK', `Order ${gatewayOrderId}: ${currentStatus} → ${newStatus}, ref=${transactionRef}`);

  if (newStatus === ORDER_STATUS.SUCCESS) {
    try {
      await executePostPayment(order, transactionRef);
    } catch (e) {
      log('APPROVE', `Post-payment execution failed for ${gatewayOrderId}: ${e.message}`);
    }
  }

  try {
    broadcast('paymentUpdated', { orderId: gatewayOrderId, type: order.type, amount: order.amount, status: newStatus, transactionRef });
  } catch {}

  return { status: newStatus, orderId: gatewayOrderId, transactionRef };
}

async function executePostPayment(order, transactionRef) {
  const orderType = order.type || 'registration';
  const amount = Number(order.amount);

  if (orderType === 'registration') {
    const pendingRegId = order.pending_reg_id;
    if (!pendingRegId) throw new Error('No pending registration ID for order ' + order.id);
    const pending = await getDoc(COL_PENDING_REGS, pendingRegId);
    if (!pending) throw new Error('Pending registration not found or already processed');
    const newUserId = crypto.randomUUID();
    const refCode = pending.referral_code;
    let referredByUserId = null;
    let referredByCode = null;
    if (refCode) {
      const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
      if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode.toUpperCase(); }
    }
    await writeDoc(COL_USERS, newUserId, {
      id: newUserId, email: pending.email || '', name: pending.name || '',
      phone: pending.phone || '', password_hash: pending.password_hash,
      referral_code: randomString(8), referred_by: referredByCode,
      account_status: 'active', payment_status: 'success',
      approved: true, active: true, membership_paid: true,
      joined_date: now(), approved_date: now(),
      plan: order.plan || amount,
    });
    await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amount });
    await addDoc(COL_WALLET_TX, {
      user_id: newUserId, type: 'deposit', amount,
      description: 'Registration payment (UPI auto-confirm)',
      reference_id: transactionRef || order.id, balance_after: amount,
    });
    if (referredByUserId) {
      await atomicCreditWallet(referredByUserId, amount * 0.1, transactionRef || order.id, 'Referral bonus for ' + newUserId, 'referral_bonus');
    }
    try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}
    try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Your registration payment of ₹' + amount + ' has been confirmed.', type: 'payment_approved', status: 'unread', createdAt: now(), senderId: 'system', senderName: 'System' }); } catch {}
    try { await addDoc('audit_logs', { action: 'auto_approve_registration', target_id: transactionRef || order.id, target_type: 'upi_order', admin_id: 'system', details: { userId: newUserId, orderId: order.id, amount }, created_at: now() }); } catch (e) { log('AUDIT', 'Audit log failed: ' + e.message); }
    log('APPROVE', `Registration approved: userId=${newUserId}, amount=${amount}`);
    try { broadcast('paymentApproved', { userId: newUserId, amount, type: 'registration', orderId: order.id }); } catch {}
  } else {
    const userId = order.user_id;
    if (!userId) throw new Error('No user ID for topup order ' + order.id);
    const user = await getDoc(COL_USERS, userId);
    if (!user) throw new Error('User not found');
    await atomicCreditWallet(userId, amount, transactionRef || order.id, 'Topup via UPI auto-confirm');
    const topupId = (await addDoc(COL_TOPUPS, { user_id: userId, amount, utr: transactionRef || order.id, screenshot_url: null, status: 'approved', verified_at: now() })).id;
    const referredByCode = user.referred_by || null;
    if (referredByCode) {
      try {
        const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
        const referrer = refUsers.length ? refUsers[0] : null;
        if (referrer) {
          const sponsorTopups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: referrer.id }, { field: 'status', op: 'EQUAL', value: 'approved' }], { limit: 1 });
          const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';
          await addDoc(COL_TOPUP_INCOME, { user_id: referrer.id, from_user_id: userId, topup_id: topupId, amount, level: 1, status: incomeStatus });
          const currentCount = referrer.topup_referral_qualified_count || 0;
          await updateDoc(COL_USERS, referrer.id, { topup_referral_qualified_count: currentCount + 1, topup_referral_qualified: (referrer.referrals_count || 0) + currentCount + 1 >= MAX_REFERRALS });
          if (user.referred_by_status !== 'approved') { await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' }); }
        }
      } catch (e) { log('REFERRAL', 'Topup referral processing failed: ' + e.message); }
    }
    try { await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Your topup of ₹' + amount + ' has been confirmed.', type: 'payment_approved', status: 'unread', createdAt: now(), senderId: 'system', senderName: 'System' }); } catch {}
    try { await addDoc('audit_logs', { action: 'auto_approve_topup', target_id: transactionRef || order.id, target_type: 'upi_order', admin_id: 'system', details: { userId, orderId: order.id, amount }, created_at: now() }); } catch {}
    log('APPROVE', `Topup approved: userId=${userId}, amount=${amount}`);
    try { broadcast('paymentApproved', { userId, amount, type: 'topup', orderId: order.id }); } catch {}
  }
}

async function getOrderStatus(orderId) {
  const memOrder = pendingOrders.get(orderId);
  const memExtra = pendingOrders.get('_extra_' + orderId) || {};
  let order = memOrder;
  if (!order) {
    const sess = await getDoc(COL_ORDERS, orderId).catch(() => null);
    if (sess) order = { id: sess.sessionId || sess.id, type: sess.type, amount: sess.amount, user_id: sess.user_id, pending_reg_id: sess.pending_reg_id, status: (sess.status || '').toUpperCase(), created_at: sess.created_at || sess.createdAt, expires_at: sess.expires_at || sess.expiresAt };
  }
  if (order) {
    const status = order.status;
    if ((status === ORDER_STATUS.PENDING || status === ORDER_STATUS.PROCESSING) && order.expires_at) {
      if (Date.now() > new Date(order.expires_at).getTime()) {
        order.status = ORDER_STATUS.EXPIRED;
        pendingOrders.set(orderId, order);
        log('EXPIRE', `Order ${orderId} expired (checked during poll)`);
        broadcast('paymentUpdated', { orderId, status: ORDER_STATUS.EXPIRED });
      }
    }
  }
  if (!order) return null;
  return {
    orderId: order.id,
    type: order.type,
    amount: Number(order.amount),
    status: order.status,
    transactionRef: memExtra.transactionRef || null,
    upiIntentUrl: memExtra.upiIntentUrl || null,
    createdAt: order.created_at || order.createdAt,
    expiresAt: order.expires_at || order.expiresAt,
  };
}

async function expireStaleOrders() {
  const cutoff = new Date(Date.now() - ORDER_TTL_MS).toISOString();
  const nowMs = Date.now();
  for (const [id, order] of pendingOrders.entries()) {
    if (id.startsWith('_extra_')) continue;
    if (order.expiresAt && nowMs > new Date(order.expiresAt).getTime()) {
      if (order.status === ORDER_STATUS.PENDING || order.status === ORDER_STATUS.PROCESSING) {
        order.status = ORDER_STATUS.EXPIRED;
        pendingOrders.set(id, order);
        log('EXPIRE', `Stale order ${id} expired (background job)`);
        broadcast('paymentUpdated', { orderId: id, status: ORDER_STATUS.EXPIRED });
      }
    }
  }
}

setInterval(expireStaleOrders, 60000);

module.exports = {
  createUPIOrder,
  processWebhook,
  getOrderStatus,
  expireStaleOrders,
  ORDER_STATUS,
  pendingOrders,
};
