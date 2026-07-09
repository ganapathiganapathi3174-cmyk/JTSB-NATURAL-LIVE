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

// Helper: try to require a module, return error-handler on failure (with logging)
function tryRequire(name, modulePath) {
  try {
    const mod = require(modulePath);
    if (typeof mod === 'function') return mod;
    if (mod && typeof mod.handler === 'function') return mod.handler;
    if (mod && typeof mod.default === 'function') return mod.default;
    console.error('[INDEX] ' + name + ' exports unexpected type: ' + typeof mod);
  } catch (e) {
    console.error('[INDEX] FAILED: ' + name + ' (' + modulePath + '): ' + e.message);
  }
  // Return error-handler on failure
  return (req, res) => { res.writeHead(500); res.end(JSON.stringify({ error: name + ' failed to load' })); };
}

// IMPORTANT: Each require() uses a hardcoded string literal so Vercel's static
// analyzer can include all handler files in the Lambda deployment bundle
const handlers = {
  adminLogin: tryRequire('adminLogin', '../handlers/adminLogin.js'),
  preRegister: tryRequire('preRegister', '../handlers/preRegister.js'),
  createTopupSessionHttp: tryRequire('createTopupSessionHttp', '../handlers/createTopupSessionHttp.js'),
  createPaymentOrder: tryRequire('createPaymentOrder', '../handlers/createPaymentOrder.js'),
  submitPaymentProof: tryRequire('submitPaymentProof', '../handlers/submitPaymentProof.js'),
  getPaymentOrderStatus: tryRequire('getPaymentOrderStatus', '../handlers/getPaymentOrderStatus.js'),
  retryPaymentOrder: tryRequire('retryPaymentOrder', '../handlers/retryPaymentOrder.js'),
  verifyUPIPayment: tryRequire('verifyUPIPayment', '../handlers/verifyUPIPayment.js'),
  uploadScreenshot: tryRequire('uploadScreenshot', '../handlers/uploadScreenshot.js'),
  getHealthStatus: tryRequire('getHealthStatus', '../handlers/getHealthStatus.js'),
  createPaymentSession: tryRequire('createPaymentSession', '../handlers/createPaymentSession.js'),
  paymentConfirm: tryRequire('paymentConfirm', '../handlers/paymentConfirm.js'),
  createSmsSession: tryRequire('createSmsSession', '../handlers/createSmsSession.js'),
  smsPaymentConfirm: tryRequire('smsPaymentConfirm', '../handlers/smsPaymentConfirm.js'),
  enterprisePayment: tryRequire('enterprisePayment', '../handlers/enterprisePaymentSubmit.js'),
  enterpriseVerifyOtp: tryRequire('enterpriseVerifyOtp', '../handlers/enterpriseVerifyOtp.js'),
  enterpriseResendOtp: tryRequire('enterpriseResendOtp', '../handlers/enterpriseResendOtp.js'),
  pipelinePayment: tryRequire('pipelinePayment', '../handlers/pipelinePaymentSubmit.js'),
  pipelineVerifyOtp: tryRequire('pipelineVerifyOtp', '../handlers/pipelineVerifyOtp.js'),
  pipelineResendOtp: tryRequire('pipelineResendOtp', '../handlers/pipelineResendOtp.js'),
  createUPIOrder: tryRequire('createUPIOrder', '../handlers/createUPIOrder.js'),
  getUPIOrderStatus: tryRequire('getUPIOrderStatus', '../handlers/getUPIOrderStatus.js'),
  webhookUPIConfirm: tryRequire('webhookUPIConfirm', '../handlers/webhookUPIConfirm.js'),
  retryUPIOrder: tryRequire('retryUPIOrder', '../handlers/retryUPIOrder.js'),
  companionPayment: tryRequire('companionPayment', '../handlers/companionPayment.js'),
  getSponsorMarketplace: tryRequire('getSponsorMarketplace', '../handlers/getSponsorMarketplace.js'),
  createSponsorTransfer: tryRequire('createSponsorTransfer', '../handlers/createSponsorTransfer.js'),
  getSponsorRequests: tryRequire('getSponsorRequests', '../handlers/getSponsorRequests.js'),
  handleSponsorTransfer: tryRequire('handleSponsorTransfer', '../handlers/handleSponsorTransfer.js'),
  getUserSponsorInfo: tryRequire('getUserSponsorInfo', '../handlers/getUserSponsorInfo.js'),
  adminLogout: tryRequire('adminLogout', '../handlers/adminLogout.js'),
};
// Admin-wrapped handlers (need auth)
const adminHandlers = {
  getUPIPayments: requireAdmin(tryRequire('getUPIPayments', '../handlers/getUPIPayments.js')),
  getUPIDashboardStats: requireAdmin(tryRequire('getUPIDashboardStats', '../handlers/getUPIDashboardStats.js')),
  processPendingPayments: requireAdmin(tryRequire('processPendingPayments', '../handlers/processPendingPayments.js')),
  deleteUPIPayment: requireAdmin(tryRequire('deleteUPIPayment', '../handlers/deleteUPIPayment.js')),
  approveUPIPayment: requireAdmin(tryRequire('approveUPIPayment', '../handlers/approveUPIPayment.js')),
  rejectUPIPayment: requireAdmin(tryRequire('rejectUPIPayment', '../handlers/rejectUPIPayment.js')),
  restoreUPIPayment: requireAdmin(tryRequire('restoreUPIPayment', '../handlers/restoreUPIPayment.js')),
  getVerificationLogs: requireAdmin(tryRequire('getVerificationLogs', '../handlers/getVerificationLogs.js')),
  adminDeleteRecord: requireAdmin(tryRequire('adminDeleteRecord', '../handlers/adminDeleteRecord.js')),
  supabaseProxy: requireAdmin(tryRequire('supabaseProxy', '../handlers/supabaseProxy.js')),
  getAdminDashboardData: requireAdmin(tryRequire('getAdminDashboardData', '../handlers/getAdminDashboardData.js')),
  cleanupDemoData: requireAdmin(tryRequire('cleanupDemoData', '../handlers/cleanupDemoData.js')),
  approvePendingRegistration: requireAdmin(tryRequire('approvePendingRegistration', '../handlers/approvePendingRegistration.js')),
  bulkDeleteUsers: requireAdmin(tryRequire('bulkDeleteUsers', '../handlers/bulkDeleteUsers.js')),
  getRecentActivity: requireAdmin(tryRequire('getRecentActivity', '../handlers/getRecentActivity.js')),
  updateUserStatus: requireAdmin(tryRequire('updateUserStatus', '../handlers/updateUserStatus.js')),
  getQueueStatus: requireAdmin(tryRequire('getQueueStatus', '../handlers/getQueueStatus.js')),
  rerunOcr: requireAdmin(tryRequire('rerunOcr', '../handlers/rerunOcr.js')),
  rerunVerification: requireAdmin(tryRequire('rerunVerification', '../handlers/rerunVerification.js')),
  getReports: requireAdmin(tryRequire('getReports', '../handlers/getReports.js')),
  getAuditLogs: requireAdmin(tryRequire('getAuditLogs', '../handlers/getAuditLogs.js')),
  getCompanionStatus: requireAdmin(tryRequire('getCompanionStatus', '../handlers/getCompanionStatus.js')),
  getAdminSponsorTransfers: requireAdmin(tryRequire('getAdminSponsorTransfers', '../handlers/getAdminSponsorTransfers.js')),
  getPendingPaymentsQueue: requireAdmin(tryRequire('getPendingPaymentsQueue', '../handlers/getPendingPaymentsQueue.js')),
};
Object.assign(handlers, adminHandlers);
console.error('[INDEX] All ' + Object.keys(handlers).length + ' handlers loaded');

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
