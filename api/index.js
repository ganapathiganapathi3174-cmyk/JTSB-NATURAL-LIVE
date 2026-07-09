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

const { requireAdmin } = (() => {
  try { return require('./_auth.js'); } catch (e) { console.error('[INDEX] _auth.js failed: ' + e.message); return { requireAdmin: (fn) => fn }; }
})();
let metrics = {};
try { metrics = require('./_metrics.js'); } catch (e) { console.error('[INDEX] _metrics.js failed: ' + e.message); }
let initSystemUsers = async () => {};
try { const sys = require('./_systemInit.js'); initSystemUsers = sys.initSystemUsers || (async () => {}); } catch (e) { console.error('[INDEX] _systemInit.js failed: ' + e.message); }

// Initialize system users on first cold start (idempotent — skips if already exist)
initSystemUsers().catch(err => {
  console.error('[SYSTEM-INIT] Startup initialization error: ' + err.message);
});

// Lazy module loader: require() is deferred until first request to this path.
// Each require() still uses a hardcoded string literal so Vercel's static
// analyzer includes the file in the Lambda deployment bundle.
// If a module fails to load, only its endpoint returns 500 — not the whole API.
const handlerModules = {};
const lazy = (name, modulePath) => {
  return (req, res) => {
    if (!handlerModules[name]) {
      try {
        let mod = require(modulePath);
        if (typeof mod === 'function') handlerModules[name] = mod;
        else if (mod && typeof mod.handler === 'function') handlerModules[name] = mod.handler;
        else if (mod && typeof mod.default === 'function') handlerModules[name] = mod.default;
        else throw new Error('unexpected export type: ' + typeof mod);
        console.error('[INDEX] Loaded: ' + name);
      } catch (e) {
        console.error('[INDEX] FAILED: ' + name + ' (' + modulePath + '): ' + e.message);
        handlerModules[name] = (rq, rs) => { rs.writeHead(500); rs.end(JSON.stringify({ error: name + ' load failed', detail: e.message })); };
      }
    }
    return handlerModules[name](req, res);
  };
};

// Override lazy with requireAdmin wrapper for admin-endpoints
const _requireAdmin = requireAdmin;
const adminEndpoints = [
  'getUPIPayments','getUPIDashboardStats','processPendingPayments','deleteUPIPayment',
  'approveUPIPayment','rejectUPIPayment','restoreUPIPayment','getVerificationLogs',
  'adminDeleteRecord','supabaseProxy','getAdminDashboardData','cleanupDemoData',
  'approvePendingRegistration','bulkDeleteUsers','getRecentActivity','updateUserStatus',
  'getQueueStatus','rerunOcr','rerunVerification','getReports','getAuditLogs',
  'getCompanionStatus','getAdminSponsorTransfers','getPendingPaymentsQueue',
];

const handlerMap = {
  adminLogin: lazy('adminLogin', '../handlers/adminLogin.js'),
  preRegister: lazy('preRegister', '../handlers/preRegister.js'),
  createTopupSessionHttp: lazy('createTopupSessionHttp', '../handlers/createTopupSessionHttp.js'),
  createPaymentOrder: lazy('createPaymentOrder', '../handlers/createPaymentOrder.js'),
  submitPaymentProof: lazy('submitPaymentProof', '../handlers/submitPaymentProof.js'),
  getPaymentOrderStatus: lazy('getPaymentOrderStatus', '../handlers/getPaymentOrderStatus.js'),
  retryPaymentOrder: lazy('retryPaymentOrder', '../handlers/retryPaymentOrder.js'),
  verifyUPIPayment: lazy('verifyUPIPayment', '../handlers/verifyUPIPayment.js'),
  uploadScreenshot: lazy('uploadScreenshot', '../handlers/uploadScreenshot.js'),
  getHealthStatus: lazy('getHealthStatus', '../handlers/getHealthStatus.js'),
  createPaymentSession: lazy('createPaymentSession', '../handlers/createPaymentSession.js'),
  paymentConfirm: lazy('paymentConfirm', '../handlers/paymentConfirm.js'),
  createSmsSession: lazy('createSmsSession', '../handlers/createSmsSession.js'),
  smsPaymentConfirm: lazy('smsPaymentConfirm', '../handlers/smsPaymentConfirm.js'),
  enterprisePayment: lazy('enterprisePayment', '../handlers/enterprisePaymentSubmit.js'),
  enterpriseVerifyOtp: lazy('enterpriseVerifyOtp', '../handlers/enterpriseVerifyOtp.js'),
  enterpriseResendOtp: lazy('enterpriseResendOtp', '../handlers/enterpriseResendOtp.js'),
  pipelinePayment: lazy('pipelinePayment', '../handlers/pipelinePaymentSubmit.js'),
  pipelineVerifyOtp: lazy('pipelineVerifyOtp', '../handlers/pipelineVerifyOtp.js'),
  pipelineResendOtp: lazy('pipelineResendOtp', '../handlers/pipelineResendOtp.js'),
  createUPIOrder: lazy('createUPIOrder', '../handlers/createUPIOrder.js'),
  getUPIOrderStatus: lazy('getUPIOrderStatus', '../handlers/getUPIOrderStatus.js'),
  webhookUPIConfirm: lazy('webhookUPIConfirm', '../handlers/webhookUPIConfirm.js'),
  retryUPIOrder: lazy('retryUPIOrder', '../handlers/retryUPIOrder.js'),
  companionPayment: lazy('companionPayment', '../handlers/companionPayment.js'),
  getSponsorMarketplace: lazy('getSponsorMarketplace', '../handlers/getSponsorMarketplace.js'),
  createSponsorTransfer: lazy('createSponsorTransfer', '../handlers/createSponsorTransfer.js'),
  getSponsorRequests: lazy('getSponsorRequests', '../handlers/getSponsorRequests.js'),
  handleSponsorTransfer: lazy('handleSponsorTransfer', '../handlers/handleSponsorTransfer.js'),
  getUserSponsorInfo: lazy('getUserSponsorInfo', '../handlers/getUserSponsorInfo.js'),
  adminLogout: lazy('adminLogout', '../handlers/adminLogout.js'),
  // Admin-wrapped — auth check happens at request time
  getUPIPayments: _requireAdmin(lazy('getUPIPayments', '../handlers/getUPIPayments.js')),
  getUPIDashboardStats: _requireAdmin(lazy('getUPIDashboardStats', '../handlers/getUPIDashboardStats.js')),
  processPendingPayments: _requireAdmin(lazy('processPendingPayments', '../handlers/processPendingPayments.js')),
  deleteUPIPayment: _requireAdmin(lazy('deleteUPIPayment', '../handlers/deleteUPIPayment.js')),
  approveUPIPayment: _requireAdmin(lazy('approveUPIPayment', '../handlers/approveUPIPayment.js')),
  rejectUPIPayment: _requireAdmin(lazy('rejectUPIPayment', '../handlers/rejectUPIPayment.js')),
  restoreUPIPayment: _requireAdmin(lazy('restoreUPIPayment', '../handlers/restoreUPIPayment.js')),
  getVerificationLogs: _requireAdmin(lazy('getVerificationLogs', '../handlers/getVerificationLogs.js')),
  adminDeleteRecord: _requireAdmin(lazy('adminDeleteRecord', '../handlers/adminDeleteRecord.js')),
  supabaseProxy: _requireAdmin(lazy('supabaseProxy', '../handlers/supabaseProxy.js')),
  getAdminDashboardData: _requireAdmin(lazy('getAdminDashboardData', '../handlers/getAdminDashboardData.js')),
  cleanupDemoData: _requireAdmin(lazy('cleanupDemoData', '../handlers/cleanupDemoData.js')),
  approvePendingRegistration: _requireAdmin(lazy('approvePendingRegistration', '../handlers/approvePendingRegistration.js')),
  bulkDeleteUsers: _requireAdmin(lazy('bulkDeleteUsers', '../handlers/bulkDeleteUsers.js')),
  getRecentActivity: _requireAdmin(lazy('getRecentActivity', '../handlers/getRecentActivity.js')),
  updateUserStatus: _requireAdmin(lazy('updateUserStatus', '../handlers/updateUserStatus.js')),
  getQueueStatus: _requireAdmin(lazy('getQueueStatus', '../handlers/getQueueStatus.js')),
  rerunOcr: _requireAdmin(lazy('rerunOcr', '../handlers/rerunOcr.js')),
  rerunVerification: _requireAdmin(lazy('rerunVerification', '../handlers/rerunVerification.js')),
  getReports: _requireAdmin(lazy('getReports', '../handlers/getReports.js')),
  getAuditLogs: _requireAdmin(lazy('getAuditLogs', '../handlers/getAuditLogs.js')),
  getCompanionStatus: _requireAdmin(lazy('getCompanionStatus', '../handlers/getCompanionStatus.js')),
  getAdminSponsorTransfers: _requireAdmin(lazy('getAdminSponsorTransfers', '../handlers/getAdminSponsorTransfers.js')),
  getPendingPaymentsQueue: _requireAdmin(lazy('getPendingPaymentsQueue', '../handlers/getPendingPaymentsQueue.js')),
};

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');

  // SSE dashboard — long-lived connection, bypass normal handler pipeline
  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    const sseHandler = require('../handlers/sseDashboard.js');
    return sseHandler(req, res);
  }
  const handler = handlerMap[path];

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
