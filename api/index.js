const { requireAdmin } = require('./_auth.js');
const metrics = require('./_metrics.js');

// Simple in-memory rate limiter for API
const rateLimitStore = new Map();
function rateLimit(key, maxRequests = 30, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimitStore.set(key, entry);
  if (entry.count > maxRequests) return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { limited: false };
}

const handlers = {
  adminLogin: require('../handlers/adminLogin.js'),
  preRegister: require('../handlers/preRegister.js'),
  createTopupSessionHttp: require('../handlers/createTopupSessionHttp.js'),
  createPaymentOrder: require('../handlers/createPaymentOrder.js'),
  submitPaymentProof: require('../handlers/submitPaymentProof.js'),
  getPaymentOrderStatus: require('../handlers/getPaymentOrderStatus.js'),
  retryPaymentOrder: require('../handlers/retryPaymentOrder.js'),
  verifyUPIPayment: require('../handlers/verifyUPIPayment.js'),
  uploadScreenshot: require('../handlers/uploadScreenshot.js'),
  getUPIPayments: requireAdmin(require('../handlers/getUPIPayments.js')),
  getUPIDashboardStats: requireAdmin(require('../handlers/getUPIDashboardStats.js')),
  processPendingPayments: requireAdmin(require('../handlers/processPendingPayments.js')),
  deleteUPIPayment: requireAdmin(require('../handlers/deleteUPIPayment.js')),
  approveUPIPayment: requireAdmin(require('../handlers/approveUPIPayment.js')),
  rejectUPIPayment: requireAdmin(require('../handlers/rejectUPIPayment.js')),
  restoreUPIPayment: requireAdmin(require('../handlers/restoreUPIPayment.js')),
  getVerificationLogs: requireAdmin(require('../handlers/getVerificationLogs.js')),
  adminDeleteRecord: requireAdmin(require('../handlers/adminDeleteRecord.js')),
  getHealthStatus: require('../handlers/getHealthStatus.js'),
  supabaseProxy: requireAdmin(require('../handlers/supabaseProxy.js')),
  getAdminDashboardData: requireAdmin(require('../handlers/getAdminDashboardData.js')),
  cleanupDemoData: requireAdmin(require('../handlers/cleanupDemoData.js')),
  approvePendingRegistration: requireAdmin(require('../handlers/approvePendingRegistration.js')),
  bulkDeleteUsers: requireAdmin(require('../handlers/bulkDeleteUsers.js')),
  getRecentActivity: requireAdmin(require('../handlers/getRecentActivity.js')),
  updateUserStatus: requireAdmin(require('../handlers/updateUserStatus.js')),
  createPaymentSession: require('../handlers/createPaymentSession.js'),
  paymentConfirm: require('../handlers/paymentConfirm.js'),
  createSmsSession: require('../handlers/createSmsSession.js'),
  smsPaymentConfirm: require('../handlers/smsPaymentConfirm.js'),
  getQueueStatus: requireAdmin(require('../handlers/getQueueStatus.js')),
  rerunOcr: requireAdmin(require('../handlers/rerunOcr.js')),
  rerunVerification: requireAdmin(require('../handlers/rerunVerification.js')),
  getReports: requireAdmin(require('../handlers/getReports.js')),
  getAuditLogs: requireAdmin(require('../handlers/getAuditLogs.js')),
  adminLogout: require('../handlers/adminLogout.js'),
  enterprisePayment: require('../handlers/enterprisePaymentSubmit.js'),
  enterpriseVerifyOtp: require('../handlers/enterpriseVerifyOtp.js'),
  enterpriseResendOtp: require('../handlers/enterpriseResendOtp.js'),
  pipelinePayment: require('../handlers/pipelinePaymentSubmit.js'),
  pipelineVerifyOtp: require('../handlers/pipelineVerifyOtp.js'),
  pipelineResendOtp: require('../handlers/pipelineResendOtp.js'),
  createUPIOrder: require('../handlers/createUPIOrder.js'),
  getUPIOrderStatus: require('../handlers/getUPIOrderStatus.js'),
  webhookUPIConfirm: require('../handlers/webhookUPIConfirm.js'),
  retryUPIOrder: require('../handlers/retryUPIOrder.js'),
  companionPayment: require('../handlers/companionPayment.js'),
  getCompanionStatus: requireAdmin(require('../handlers/getCompanionStatus.js')),
  getSponsorMarketplace: require('../handlers/getSponsorMarketplace.js'),
  createSponsorTransfer: require('../handlers/createSponsorTransfer.js'),
  getSponsorRequests: require('../handlers/getSponsorRequests.js'),
  handleSponsorTransfer: require('../handlers/handleSponsorTransfer.js'),
  getUserSponsorInfo: require('../handlers/getUserSponsorInfo.js'),
  getAdminSponsorTransfers: requireAdmin(require('../handlers/getAdminSponsorTransfers.js')),
  getPendingPaymentsQueue: requireAdmin(require('../handlers/getPendingPaymentsQueue.js')),
};

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');

  // SSE dashboard — long-lived connection, bypass normal handler pipeline
  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    const sseHandler = require('../handlers/sseDashboard.js');
    return sseHandler(req, res);
  }
  const handler = handlers[path];

  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const rl = rateLimit(ip, 60, 60000);
  if (rl.limited) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many requests. Try again in ' + rl.retryAfter + 's.' }));
    return;
  }

  if (!handler) {
    metrics.trackAPICall(path, req.method, 404);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found: ' + path }));
    return;
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let body = '';
    await new Promise((resolve, reject) => {
      req.on('data', c => body += c);
      req.on('end', () => {
        try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
        resolve();
      });
      req.on('error', reject);
    });
  }
  // Per-request timeout (30 seconds) — prevents indefinite hangs
  const REQUEST_TIMEOUT_MS = 30000;
  const abortTimer = setTimeout(() => {
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out' }));
    }
  }, REQUEST_TIMEOUT_MS);
  const origEnd = res.end.bind(res);
  res.end = function (...args) { clearTimeout(abortTimer); return origEnd(...args); };

  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function (statusCode, ...args) {
    clearTimeout(abortTimer);
    metrics.trackAPICall(path, req.method, statusCode);
    return origWriteHead(statusCode, ...args);
  };
  await handler(req, res).catch(err => {
    clearTimeout(abortTimer);
    metrics.trackAPICall(path, req.method, 500);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Internal error' }));
    }
  });
};
