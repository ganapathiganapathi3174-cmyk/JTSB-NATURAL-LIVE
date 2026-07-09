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

// Helper: wrap a handler in an error handler if it's falsy
function guard(name, mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.handler === 'function') return mod.handler;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (!mod) { console.error('[INDEX] ' + name + ' is null/falsy'); return (req, res) => { res.writeHead(500); res.end(JSON.stringify({ error: name + ' is null' })); }; }
  console.error('[INDEX] ' + name + ' unexpected type: ' + typeof mod);
  return (req, res) => { res.writeHead(500); res.end(JSON.stringify({ error: name + ' invalid type' })); };
}

// IMPORTANT: Each require() is a TOP-LEVEL call with a hardcoded string literal.
// Vercel's static analyzer uses this to include handler files in the Lambda bundle.
// Any single require() failure is caught individually so the rest still work.

let _adminLogin, _preRegister, _createTopupSessionHttp, _createPaymentOrder, _submitPaymentProof;
let _getPaymentOrderStatus, _retryPaymentOrder, _verifyUPIPayment, _uploadScreenshot;
let _getUPIPayments, _getUPIDashboardStats, _processPendingPayments, _deleteUPIPayment;
let _approveUPIPayment, _rejectUPIPayment, _restoreUPIPayment, _getVerificationLogs;
let _adminDeleteRecord, _getHealthStatus, _supabaseProxy, _getAdminDashboardData;
let _cleanupDemoData, _approvePendingRegistration, _bulkDeleteUsers, _getRecentActivity;
let _updateUserStatus, _createPaymentSession, _paymentConfirm, _createSmsSession;
let _smsPaymentConfirm, _getQueueStatus, _rerunOcr, _rerunVerification, _getReports;
let _getAuditLogs, _adminLogout, _enterprisePayment, _enterpriseVerifyOtp, _enterpriseResendOtp;
let _pipelinePayment, _pipelineVerifyOtp, _pipelineResendOtp, _createUPIOrder;
let _getUPIOrderStatus, _webhookUPIConfirm, _retryUPIOrder, _companionPayment;
let _getCompanionStatus, _getSponsorMarketplace, _createSponsorTransfer, _getSponsorRequests;
let _handleSponsorTransfer, _getUserSponsorInfo, _getAdminSponsorTransfers, _getPendingPaymentsQueue;

try { _adminLogin = require('../handlers/adminLogin.js'); } catch (e) { console.error('[INDEX] adminLogin FAILED: ' + e.message); }
try { _preRegister = require('../handlers/preRegister.js'); } catch (e) { console.error('[INDEX] preRegister FAILED: ' + e.message); }
try { _createTopupSessionHttp = require('../handlers/createTopupSessionHttp.js'); } catch (e) { console.error('[INDEX] createTopupSessionHttp FAILED: ' + e.message); }
try { _createPaymentOrder = require('../handlers/createPaymentOrder.js'); } catch (e) { console.error('[INDEX] createPaymentOrder FAILED: ' + e.message); }
try { _submitPaymentProof = require('../handlers/submitPaymentProof.js'); } catch (e) { console.error('[INDEX] submitPaymentProof FAILED: ' + e.message); }
try { _getPaymentOrderStatus = require('../handlers/getPaymentOrderStatus.js'); } catch (e) { console.error('[INDEX] getPaymentOrderStatus FAILED: ' + e.message); }
try { _retryPaymentOrder = require('../handlers/retryPaymentOrder.js'); } catch (e) { console.error('[INDEX] retryPaymentOrder FAILED: ' + e.message); }
try { _verifyUPIPayment = require('../handlers/verifyUPIPayment.js'); } catch (e) { console.error('[INDEX] verifyUPIPayment FAILED: ' + e.message); }
try { _uploadScreenshot = require('../handlers/uploadScreenshot.js'); } catch (e) { console.error('[INDEX] uploadScreenshot FAILED: ' + e.message); }
try { _getHealthStatus = require('../handlers/getHealthStatus.js'); } catch (e) { console.error('[INDEX] getHealthStatus FAILED: ' + e.message); }
try { _createPaymentSession = require('../handlers/createPaymentSession.js'); } catch (e) { console.error('[INDEX] createPaymentSession FAILED: ' + e.message); }
try { _paymentConfirm = require('../handlers/paymentConfirm.js'); } catch (e) { console.error('[INDEX] paymentConfirm FAILED: ' + e.message); }
try { _createSmsSession = require('../handlers/createSmsSession.js'); } catch (e) { console.error('[INDEX] createSmsSession FAILED: ' + e.message); }
try { _smsPaymentConfirm = require('../handlers/smsPaymentConfirm.js'); } catch (e) { console.error('[INDEX] smsPaymentConfirm FAILED: ' + e.message); }
try { _enterprisePayment = require('../handlers/enterprisePaymentSubmit.js'); } catch (e) { console.error('[INDEX] enterprisePayment FAILED: ' + e.message); }
try { _enterpriseVerifyOtp = require('../handlers/enterpriseVerifyOtp.js'); } catch (e) { console.error('[INDEX] enterpriseVerifyOtp FAILED: ' + e.message); }
try { _enterpriseResendOtp = require('../handlers/enterpriseResendOtp.js'); } catch (e) { console.error('[INDEX] enterpriseResendOtp FAILED: ' + e.message); }
try { _pipelinePayment = require('../handlers/pipelinePaymentSubmit.js'); } catch (e) { console.error('[INDEX] pipelinePayment FAILED: ' + e.message); }
try { _pipelineVerifyOtp = require('../handlers/pipelineVerifyOtp.js'); } catch (e) { console.error('[INDEX] pipelineVerifyOtp FAILED: ' + e.message); }
try { _pipelineResendOtp = require('../handlers/pipelineResendOtp.js'); } catch (e) { console.error('[INDEX] pipelineResendOtp FAILED: ' + e.message); }
try { _createUPIOrder = require('../handlers/createUPIOrder.js'); } catch (e) { console.error('[INDEX] createUPIOrder FAILED: ' + e.message); }
try { _getUPIOrderStatus = require('../handlers/getUPIOrderStatus.js'); } catch (e) { console.error('[INDEX] getUPIOrderStatus FAILED: ' + e.message); }
try { _webhookUPIConfirm = require('../handlers/webhookUPIConfirm.js'); } catch (e) { console.error('[INDEX] webhookUPIConfirm FAILED: ' + e.message); }
try { _retryUPIOrder = require('../handlers/retryUPIOrder.js'); } catch (e) { console.error('[INDEX] retryUPIOrder FAILED: ' + e.message); }
try { _companionPayment = require('../handlers/companionPayment.js'); } catch (e) { console.error('[INDEX] companionPayment FAILED: ' + e.message); }
try { _getSponsorMarketplace = require('../handlers/getSponsorMarketplace.js'); } catch (e) { console.error('[INDEX] getSponsorMarketplace FAILED: ' + e.message); }
try { _createSponsorTransfer = require('../handlers/createSponsorTransfer.js'); } catch (e) { console.error('[INDEX] createSponsorTransfer FAILED: ' + e.message); }
try { _getSponsorRequests = require('../handlers/getSponsorRequests.js'); } catch (e) { console.error('[INDEX] getSponsorRequests FAILED: ' + e.message); }
try { _handleSponsorTransfer = require('../handlers/handleSponsorTransfer.js'); } catch (e) { console.error('[INDEX] handleSponsorTransfer FAILED: ' + e.message); }
try { _getUserSponsorInfo = require('../handlers/getUserSponsorInfo.js'); } catch (e) { console.error('[INDEX] getUserSponsorInfo FAILED: ' + e.message); }
try { _adminLogout = require('../handlers/adminLogout.js'); } catch (e) { console.error('[INDEX] adminLogout FAILED: ' + e.message); }
// Admin handlers
try { _getUPIPayments = require('../handlers/getUPIPayments.js'); } catch (e) { console.error('[INDEX] getUPIPayments FAILED: ' + e.message); }
try { _getUPIDashboardStats = require('../handlers/getUPIDashboardStats.js'); } catch (e) { console.error('[INDEX] getUPIDashboardStats FAILED: ' + e.message); }
try { _processPendingPayments = require('../handlers/processPendingPayments.js'); } catch (e) { console.error('[INDEX] processPendingPayments FAILED: ' + e.message); }
try { _deleteUPIPayment = require('../handlers/deleteUPIPayment.js'); } catch (e) { console.error('[INDEX] deleteUPIPayment FAILED: ' + e.message); }
try { _approveUPIPayment = require('../handlers/approveUPIPayment.js'); } catch (e) { console.error('[INDEX] approveUPIPayment FAILED: ' + e.message); }
try { _rejectUPIPayment = require('../handlers/rejectUPIPayment.js'); } catch (e) { console.error('[INDEX] rejectUPIPayment FAILED: ' + e.message); }
try { _restoreUPIPayment = require('../handlers/restoreUPIPayment.js'); } catch (e) { console.error('[INDEX] restoreUPIPayment FAILED: ' + e.message); }
try { _getVerificationLogs = require('../handlers/getVerificationLogs.js'); } catch (e) { console.error('[INDEX] getVerificationLogs FAILED: ' + e.message); }
try { _adminDeleteRecord = require('../handlers/adminDeleteRecord.js'); } catch (e) { console.error('[INDEX] adminDeleteRecord FAILED: ' + e.message); }
try { _supabaseProxy = require('../handlers/supabaseProxy.js'); } catch (e) { console.error('[INDEX] supabaseProxy FAILED: ' + e.message); }
try { _getAdminDashboardData = require('../handlers/getAdminDashboardData.js'); } catch (e) { console.error('[INDEX] getAdminDashboardData FAILED: ' + e.message); }
try { _cleanupDemoData = require('../handlers/cleanupDemoData.js'); } catch (e) { console.error('[INDEX] cleanupDemoData FAILED: ' + e.message); }
try { _approvePendingRegistration = require('../handlers/approvePendingRegistration.js'); } catch (e) { console.error('[INDEX] approvePendingRegistration FAILED: ' + e.message); }
try { _bulkDeleteUsers = require('../handlers/bulkDeleteUsers.js'); } catch (e) { console.error('[INDEX] bulkDeleteUsers FAILED: ' + e.message); }
try { _getRecentActivity = require('../handlers/getRecentActivity.js'); } catch (e) { console.error('[INDEX] getRecentActivity FAILED: ' + e.message); }
try { _updateUserStatus = require('../handlers/updateUserStatus.js'); } catch (e) { console.error('[INDEX] updateUserStatus FAILED: ' + e.message); }
try { _getQueueStatus = require('../handlers/getQueueStatus.js'); } catch (e) { console.error('[INDEX] getQueueStatus FAILED: ' + e.message); }
try { _rerunOcr = require('../handlers/rerunOcr.js'); } catch (e) { console.error('[INDEX] rerunOcr FAILED: ' + e.message); }
try { _rerunVerification = require('../handlers/rerunVerification.js'); } catch (e) { console.error('[INDEX] rerunVerification FAILED: ' + e.message); }
try { _getReports = require('../handlers/getReports.js'); } catch (e) { console.error('[INDEX] getReports FAILED: ' + e.message); }
try { _getAuditLogs = require('../handlers/getAuditLogs.js'); } catch (e) { console.error('[INDEX] getAuditLogs FAILED: ' + e.message); }
try { _getCompanionStatus = require('../handlers/getCompanionStatus.js'); } catch (e) { console.error('[INDEX] getCompanionStatus FAILED: ' + e.message); }
try { _getAdminSponsorTransfers = require('../handlers/getAdminSponsorTransfers.js'); } catch (e) { console.error('[INDEX] getAdminSponsorTransfers FAILED: ' + e.message); }
try { _getPendingPaymentsQueue = require('../handlers/getPendingPaymentsQueue.js'); } catch (e) { console.error('[INDEX] getPendingPaymentsQueue FAILED: ' + e.message); }

const handlers = {
  adminLogin: guard('adminLogin', _adminLogin),
  preRegister: guard('preRegister', _preRegister),
  createTopupSessionHttp: guard('createTopupSessionHttp', _createTopupSessionHttp),
  createPaymentOrder: guard('createPaymentOrder', _createPaymentOrder),
  submitPaymentProof: guard('submitPaymentProof', _submitPaymentProof),
  getPaymentOrderStatus: guard('getPaymentOrderStatus', _getPaymentOrderStatus),
  retryPaymentOrder: guard('retryPaymentOrder', _retryPaymentOrder),
  verifyUPIPayment: guard('verifyUPIPayment', _verifyUPIPayment),
  uploadScreenshot: guard('uploadScreenshot', _uploadScreenshot),
  getHealthStatus: guard('getHealthStatus', _getHealthStatus),
  createPaymentSession: guard('createPaymentSession', _createPaymentSession),
  paymentConfirm: guard('paymentConfirm', _paymentConfirm),
  createSmsSession: guard('createSmsSession', _createSmsSession),
  smsPaymentConfirm: guard('smsPaymentConfirm', _smsPaymentConfirm),
  enterprisePayment: guard('enterprisePayment', _enterprisePayment),
  enterpriseVerifyOtp: guard('enterpriseVerifyOtp', _enterpriseVerifyOtp),
  enterpriseResendOtp: guard('enterpriseResendOtp', _enterpriseResendOtp),
  pipelinePayment: guard('pipelinePayment', _pipelinePayment),
  pipelineVerifyOtp: guard('pipelineVerifyOtp', _pipelineVerifyOtp),
  pipelineResendOtp: guard('pipelineResendOtp', _pipelineResendOtp),
  createUPIOrder: guard('createUPIOrder', _createUPIOrder),
  getUPIOrderStatus: guard('getUPIOrderStatus', _getUPIOrderStatus),
  webhookUPIConfirm: guard('webhookUPIConfirm', _webhookUPIConfirm),
  retryUPIOrder: guard('retryUPIOrder', _retryUPIOrder),
  companionPayment: guard('companionPayment', _companionPayment),
  getSponsorMarketplace: guard('getSponsorMarketplace', _getSponsorMarketplace),
  createSponsorTransfer: guard('createSponsorTransfer', _createSponsorTransfer),
  getSponsorRequests: guard('getSponsorRequests', _getSponsorRequests),
  handleSponsorTransfer: guard('handleSponsorTransfer', _handleSponsorTransfer),
  getUserSponsorInfo: guard('getUserSponsorInfo', _getUserSponsorInfo),
  adminLogout: guard('adminLogout', _adminLogout),
  // Admin-wrapped handlers (need auth)
  getUPIPayments: requireAdmin(guard('getUPIPayments', _getUPIPayments)),
  getUPIDashboardStats: requireAdmin(guard('getUPIDashboardStats', _getUPIDashboardStats)),
  processPendingPayments: requireAdmin(guard('processPendingPayments', _processPendingPayments)),
  deleteUPIPayment: requireAdmin(guard('deleteUPIPayment', _deleteUPIPayment)),
  approveUPIPayment: requireAdmin(guard('approveUPIPayment', _approveUPIPayment)),
  rejectUPIPayment: requireAdmin(guard('rejectUPIPayment', _rejectUPIPayment)),
  restoreUPIPayment: requireAdmin(guard('restoreUPIPayment', _restoreUPIPayment)),
  getVerificationLogs: requireAdmin(guard('getVerificationLogs', _getVerificationLogs)),
  adminDeleteRecord: requireAdmin(guard('adminDeleteRecord', _adminDeleteRecord)),
  supabaseProxy: requireAdmin(guard('supabaseProxy', _supabaseProxy)),
  getAdminDashboardData: requireAdmin(guard('getAdminDashboardData', _getAdminDashboardData)),
  cleanupDemoData: requireAdmin(guard('cleanupDemoData', _cleanupDemoData)),
  approvePendingRegistration: requireAdmin(guard('approvePendingRegistration', _approvePendingRegistration)),
  bulkDeleteUsers: requireAdmin(guard('bulkDeleteUsers', _bulkDeleteUsers)),
  getRecentActivity: requireAdmin(guard('getRecentActivity', _getRecentActivity)),
  updateUserStatus: requireAdmin(guard('updateUserStatus', _updateUserStatus)),
  getQueueStatus: requireAdmin(guard('getQueueStatus', _getQueueStatus)),
  rerunOcr: requireAdmin(guard('rerunOcr', _rerunOcr)),
  rerunVerification: requireAdmin(guard('rerunVerification', _rerunVerification)),
  getReports: requireAdmin(guard('getReports', _getReports)),
  getAuditLogs: requireAdmin(guard('getAuditLogs', _getAuditLogs)),
  getCompanionStatus: requireAdmin(guard('getCompanionStatus', _getCompanionStatus)),
  getAdminSponsorTransfers: requireAdmin(guard('getAdminSponsorTransfers', _getAdminSponsorTransfers)),
  getPendingPaymentsQueue: requireAdmin(guard('getPendingPaymentsQueue', _getPendingPaymentsQueue)),
};
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
