const fs = require('fs');
const p = require('path');
try {
  const envPath = p.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(l => {
      const m = l.match(/^\s*([^#=]+)=(.*)/);
      if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
    });
  }
} catch (_) {}

const { requireAdmin } = require('./_auth.js');
const metrics = require('./_metrics.js');
const { initSystemUsers } = require('./_systemInit.js');
initSystemUsers().catch(err => console.error('[SYSTEM-INIT] Error: ' + err.message));

const rateLimitStore = new Map();
function rateLimit(key, max = 60, windowMs = 60000) {
  const now = Date.now();
  const e = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > e.resetAt) { e.count = 0; e.resetAt = now + windowMs; }
  e.count++;
  rateLimitStore.set(key, e);
  if (e.count > max) return { limited: true, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  return { limited: false };
}

// Lazy-load handlers on first request
const cache = {};
function load(name, path) {
  return (req, res) => {
    if (!cache[name]) {
      try {
        let m = require(path);
        if (typeof m === 'function') cache[name] = m;
        else if (m && typeof m.handler === 'function') cache[name] = m.handler;
        else if (m && typeof m.default === 'function') cache[name] = m.default;
        else { cache[name] = (r, s) => { s.writeHead(500); s.end(JSON.stringify({ error: name + ' invalid export' })); }; }
      } catch (e) {
        cache[name] = (r, s) => { s.writeHead(500); s.end(JSON.stringify({ error: name + ' load failed', detail: e.message })); };
      }
    }
    return cache[name](req, res);
  };
}

const map = {
  // Public endpoints
  adminLogin: load('adminLogin', '../handlers/adminLogin.js'),
  preRegister: load('preRegister', '../handlers/preRegister.js'),
  getHealthStatus: load('getHealthStatus', '../handlers/getHealthStatus.js'),
  getSponsorMarketplace: load('getSponsorMarketplace', '../handlers/getSponsorMarketplace.js'),
  createSponsorTransfer: load('createSponsorTransfer', '../handlers/createSponsorTransfer.js'),
  getSponsorRequests: load('getSponsorRequests', '../handlers/getSponsorRequests.js'),
  handleSponsorTransfer: load('handleSponsorTransfer', '../handlers/handleSponsorTransfer.js'),
  getUserSponsorInfo: load('getUserSponsorInfo', '../handlers/getUserSponsorInfo.js'),
  createTopupSessionHttp: load('createTopupSessionHttp', '../handlers/createTopupSessionHttp.js'),
  createPaymentOrder: load('createPaymentOrder', '../handlers/createPaymentOrder.js'),
  submitPaymentProof: load('submitPaymentProof', '../handlers/submitPaymentProof.js'),
  getPaymentOrderStatus: load('getPaymentOrderStatus', '../handlers/getPaymentOrderStatus.js'),
  retryPaymentOrder: load('retryPaymentOrder', '../handlers/retryPaymentOrder.js'),
  verifyUPIPayment: load('verifyUPIPayment', '../handlers/verifyUPIPayment.js'),
  uploadScreenshot: load('uploadScreenshot', '../handlers/uploadScreenshot.js'),
  createPaymentSession: load('createPaymentSession', '../handlers/createPaymentSession.js'),
  paymentConfirm: load('paymentConfirm', '../handlers/paymentConfirm.js'),
  createSmsSession: load('createSmsSession', '../handlers/createSmsSession.js'),
  smsPaymentConfirm: load('smsPaymentConfirm', '../handlers/smsPaymentConfirm.js'),
  enterprisePayment: load('enterprisePayment', '../handlers/enterprisePaymentSubmit.js'),
  enterpriseVerifyOtp: load('enterpriseVerifyOtp', '../handlers/enterpriseVerifyOtp.js'),
  enterpriseResendOtp: load('enterpriseResendOtp', '../handlers/enterpriseResendOtp.js'),
  pipelinePayment: load('pipelinePayment', '../handlers/pipelinePaymentSubmit.js'),
  pipelineVerifyOtp: load('pipelineVerifyOtp', '../handlers/pipelineVerifyOtp.js'),
  pipelineResendOtp: load('pipelineResendOtp', '../handlers/pipelineResendOtp.js'),
  createUPIOrder: load('createUPIOrder', '../handlers/createUPIOrder.js'),
  getUPIOrderStatus: load('getUPIOrderStatus', '../handlers/getUPIOrderStatus.js'),
  webhookUPIConfirm: load('webhookUPIConfirm', '../handlers/webhookUPIConfirm.js'),
  retryUPIOrder: load('retryUPIOrder', '../handlers/retryUPIOrder.js'),
  companionPayment: load('companionPayment', '../handlers/companionPayment.js'),
  adminLogout: load('adminLogout', '../handlers/adminLogout.js'),
  // Admin endpoints
  getUPIPayments: requireAdmin(load('getUPIPayments', '../handlers/getUPIPayments.js')),
  getUPIDashboardStats: requireAdmin(load('getUPIDashboardStats', '../handlers/getUPIDashboardStats.js')),
  processPendingPayments: requireAdmin(load('processPendingPayments', '../handlers/processPendingPayments.js')),
  deleteUPIPayment: requireAdmin(load('deleteUPIPayment', '../handlers/deleteUPIPayment.js')),
  approveUPIPayment: requireAdmin(load('approveUPIPayment', '../handlers/approveUPIPayment.js')),
  rejectUPIPayment: requireAdmin(load('rejectUPIPayment', '../handlers/rejectUPIPayment.js')),
  restoreUPIPayment: requireAdmin(load('restoreUPIPayment', '../handlers/restoreUPIPayment.js')),
  getVerificationLogs: requireAdmin(load('getVerificationLogs', '../handlers/getVerificationLogs.js')),
  adminDeleteRecord: requireAdmin(load('adminDeleteRecord', '../handlers/adminDeleteRecord.js')),
  supabaseProxy: requireAdmin(load('supabaseProxy', '../handlers/supabaseProxy.js')),
  getAdminDashboardData: requireAdmin(load('getAdminDashboardData', '../handlers/getAdminDashboardData.js')),
  cleanupDemoData: requireAdmin(load('cleanupDemoData', '../handlers/cleanupDemoData.js')),
  approvePendingRegistration: requireAdmin(load('approvePendingRegistration', '../handlers/approvePendingRegistration.js')),
  bulkDeleteUsers: requireAdmin(load('bulkDeleteUsers', '../handlers/bulkDeleteUsers.js')),
  getRecentActivity: requireAdmin(load('getRecentActivity', '../handlers/getRecentActivity.js')),
  updateUserStatus: requireAdmin(load('updateUserStatus', '../handlers/updateUserStatus.js')),
  getQueueStatus: requireAdmin(load('getQueueStatus', '../handlers/getQueueStatus.js')),
  rerunOcr: requireAdmin(load('rerunOcr', '../handlers/rerunOcr.js')),
  rerunVerification: requireAdmin(load('rerunVerification', '../handlers/rerunVerification.js')),
  getReports: requireAdmin(load('getReports', '../handlers/getReports.js')),
  getAuditLogs: requireAdmin(load('getAuditLogs', '../handlers/getAuditLogs.js')),
  getCompanionStatus: requireAdmin(load('getCompanionStatus', '../handlers/getCompanionStatus.js')),
  getAdminSponsorTransfers: requireAdmin(load('getAdminSponsorTransfers', '../handlers/getAdminSponsorTransfers.js')),
  getPendingPaymentsQueue: requireAdmin(load('getPendingPaymentsQueue', '../handlers/getPendingPaymentsQueue.js')),
};

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');

  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    try {
      const h = require('../handlers/sseDashboard.js');
      return h(req, res);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'SSE handler load failed', detail: e.message }));
      return;
    }
  }

  const handler = map[path];
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
      req.on('end', () => { try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; } resolve(); });
      req.on('error', reject);
    });
  }

  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.writeHead(504);
      res.end(JSON.stringify({ error: 'Request timed out' }));
    }
  }, 30000);
  const origEnd = res.end.bind(res);
  res.end = function (...a) { clearTimeout(timeout); return origEnd(...a); };
  const origWH = res.writeHead.bind(res);
  res.writeHead = function (code, ...a) { clearTimeout(timeout); metrics.trackAPICall(path, req.method, code); return origWH(code, ...a); };

  await handler(req, res).catch(err => {
    clearTimeout(timeout);
    console.error('[API] Path=' + path + ' Error=' + (err?.message || err));
    metrics.trackAPICall(path, req.method, 500);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err?.message || 'Internal server error', path }));
    }
  });
};
