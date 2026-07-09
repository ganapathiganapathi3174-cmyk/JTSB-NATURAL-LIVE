const fs = require('fs');
const p = require('path');
// Load .env.local as fallback for Vercel deployments with missing env vars
try {
  const envPath = p.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
      const m = l.match(/^\s*([^#=]+)=(.*)/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim();
      }
    });
  }
} catch (_) {}

const { requireAdmin } = require('./_auth.js');
const metrics = require('./_metrics.js');
const { initSystemUsers } = require('./_systemInit.js');

// Initialize system users on first cold start (idempotent — skips if already exist)
initSystemUsers().catch(err => {
  console.error('[SYSTEM-INIT] Startup initialization error: ' + err.message);
});

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

// Wrap handler require with error intercept — log+store error, return error-handler function
function safeRequire(path) {
  try {
    const mod = require(path);
    if (typeof mod === 'function') return mod;
    // Handler might export { handler } or default
    if (mod && typeof mod.handler === 'function') return mod.handler;
    if (mod && typeof mod.default === 'function') return mod.default;
    console.error('[SAFE-REQUIRE] ' + path + ' exports unexpected type: ' + typeof mod);
    return (req, res) => { res.writeHead(500); res.end(JSON.stringify({ error: 'Handler invalid' })); };
  } catch (e) {
    console.error('[SAFE-REQUIRE] FAILED to load ' + path + ': ' + e.message);
    console.error('[SAFE-REQUIRE] Stack: ' + e.stack.split('\n').slice(0, 3).join('\n'));
    return (req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Handler load failed: ' + path, detail: e.message }));
    };
  }
}

const handlerPaths = {
  adminLogin: '../handlers/adminLogin.js',
  preRegister: '../handlers/preRegister.js',
  createTopupSessionHttp: '../handlers/createTopupSessionHttp.js',
  createPaymentOrder: '../handlers/createPaymentOrder.js',
  submitPaymentProof: '../handlers/submitPaymentProof.js',
  getPaymentOrderStatus: '../handlers/getPaymentOrderStatus.js',
  retryPaymentOrder: '../handlers/retryPaymentOrder.js',
  verifyUPIPayment: '../handlers/verifyUPIPayment.js',
  uploadScreenshot: '../handlers/uploadScreenshot.js',
  getUPIPayments: '../handlers/getUPIPayments.js',
  getUPIDashboardStats: '../handlers/getUPIDashboardStats.js',
  processPendingPayments: '../handlers/processPendingPayments.js',
  deleteUPIPayment: '../handlers/deleteUPIPayment.js',
  approveUPIPayment: '../handlers/approveUPIPayment.js',
  rejectUPIPayment: '../handlers/rejectUPIPayment.js',
  restoreUPIPayment: '../handlers/restoreUPIPayment.js',
  getVerificationLogs: '../handlers/getVerificationLogs.js',
  adminDeleteRecord: '../handlers/adminDeleteRecord.js',
  getHealthStatus: '../handlers/getHealthStatus.js',
  supabaseProxy: '../handlers/supabaseProxy.js',
  getAdminDashboardData: '../handlers/getAdminDashboardData.js',
  cleanupDemoData: '../handlers/cleanupDemoData.js',
  approvePendingRegistration: '../handlers/approvePendingRegistration.js',
  bulkDeleteUsers: '../handlers/bulkDeleteUsers.js',
  getRecentActivity: '../handlers/getRecentActivity.js',
  updateUserStatus: '../handlers/updateUserStatus.js',
  createPaymentSession: '../handlers/createPaymentSession.js',
  paymentConfirm: '../handlers/paymentConfirm.js',
  createSmsSession: '../handlers/createSmsSession.js',
  smsPaymentConfirm: '../handlers/smsPaymentConfirm.js',
  getQueueStatus: '../handlers/getQueueStatus.js',
  rerunOcr: '../handlers/rerunOcr.js',
  rerunVerification: '../handlers/rerunVerification.js',
  getReports: '../handlers/getReports.js',
  getAuditLogs: '../handlers/getAuditLogs.js',
  adminLogout: '../handlers/adminLogout.js',
  enterprisePayment: '../handlers/enterprisePaymentSubmit.js',
  enterpriseVerifyOtp: '../handlers/enterpriseVerifyOtp.js',
  enterpriseResendOtp: '../handlers/enterpriseResendOtp.js',
  pipelinePayment: '../handlers/pipelinePaymentSubmit.js',
  pipelineVerifyOtp: '../handlers/pipelineVerifyOtp.js',
  pipelineResendOtp: '../handlers/pipelineResendOtp.js',
  createUPIOrder: '../handlers/createUPIOrder.js',
  getUPIOrderStatus: '../handlers/getUPIOrderStatus.js',
  webhookUPIConfirm: '../handlers/webhookUPIConfirm.js',
  retryUPIOrder: '../handlers/retryUPIOrder.js',
  companionPayment: '../handlers/companionPayment.js',
  getCompanionStatus: '../handlers/getCompanionStatus.js',
  getSponsorMarketplace: '../handlers/getSponsorMarketplace.js',
  createSponsorTransfer: '../handlers/createSponsorTransfer.js',
  getSponsorRequests: '../handlers/getSponsorRequests.js',
  handleSponsorTransfer: '../handlers/handleSponsorTransfer.js',
  getUserSponsorInfo: '../handlers/getUserSponsorInfo.js',
  getAdminSponsorTransfers: '../handlers/getAdminSponsorTransfers.js',
  getPendingPaymentsQueue: '../handlers/getPendingPaymentsQueue.js',
};
const handlers = {};
// Admin-required endpoints
const adminPaths = new Set([
  'getUPIPayments','getUPIDashboardStats','processPendingPayments','deleteUPIPayment',
  'approveUPIPayment','rejectUPIPayment','restoreUPIPayment','getVerificationLogs',
  'adminDeleteRecord','supabaseProxy','getAdminDashboardData','cleanupDemoData',
  'approvePendingRegistration','bulkDeleteUsers','getRecentActivity','updateUserStatus',
  'getQueueStatus','rerunOcr','rerunVerification','getReports','getAuditLogs',
  'getCompanionStatus','getAdminSponsorTransfers','getPendingPaymentsQueue',
]);
for (const [name, path] of Object.entries(handlerPaths)) {
  const mod = safeRequire(path);
  handlers[name] = adminPaths.has(name) ? requireAdmin(mod) : mod;
}
console.error('[API-INDEX] All ' + Object.keys(handlers).length + ' handlers loaded (' + Object.keys(handlerPaths).length + ' paths)');

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
    const errMsg = err?.message || 'Unknown error';
    const errStack = err?.stack?.split('\n').slice(0,4).join('\n') || '';
    console.error('[API ERROR] Path=' + path + ' Error=' + errMsg);
    console.error('[API ERROR] Stack=' + errStack);
    metrics.trackAPICall(path, req.method, 500);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: errMsg, path }));
    }
  });
};
