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

// Rate limiter
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

// Load all handlers at top level so Vercel's static analyzer includes them.
// Each is wrapped in try/catch so one failure doesn't crash the whole module.
function safeHandler(name, fn) {
  if (typeof fn === 'function') return fn;
  if (fn && typeof fn.handler === 'function') return fn.handler;
  if (fn && typeof fn.default === 'function') return fn.default;
  console.error('[INDEX] ' + name + ' invalid export: ' + typeof fn);
  return (r, s) => { s.writeHead(500); s.end(JSON.stringify({ error: name + ' invalid' })); };
}

let handlers = {};
try { handlers.adminLogin = safeHandler('adminLogin', require('../handlers/adminLogin.js')); } catch (e) { handlers.adminLogin = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'adminLogin load failed',detail:e.message})); }; }
try { handlers.preRegister = safeHandler('preRegister', require('../handlers/preRegister.js')); } catch (e) { handlers.preRegister = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'preRegister load failed',detail:e.message})); }; }
try { handlers.getHealthStatus = safeHandler('getHealthStatus', require('../handlers/getHealthStatus.js')); } catch (e) { handlers.getHealthStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getHealthStatus load failed',detail:e.message})); }; }
try { handlers.getSponsorMarketplace = safeHandler('getSponsorMarketplace', require('../handlers/getSponsorMarketplace.js')); } catch (e) { handlers.getSponsorMarketplace = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getSponsorMarketplace load failed',detail:e.message})); }; }
try { handlers.createSponsorTransfer = safeHandler('createSponsorTransfer', require('../handlers/createSponsorTransfer.js')); } catch (e) { handlers.createSponsorTransfer = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createSponsorTransfer load failed',detail:e.message})); }; }
try { handlers.getSponsorRequests = safeHandler('getSponsorRequests', require('../handlers/getSponsorRequests.js')); } catch (e) { handlers.getSponsorRequests = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getSponsorRequests load failed',detail:e.message})); }; }
try { handlers.handleSponsorTransfer = safeHandler('handleSponsorTransfer', require('../handlers/handleSponsorTransfer.js')); } catch (e) { handlers.handleSponsorTransfer = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'handleSponsorTransfer load failed',detail:e.message})); }; }
try { handlers.getUserSponsorInfo = safeHandler('getUserSponsorInfo', require('../handlers/getUserSponsorInfo.js')); } catch (e) { handlers.getUserSponsorInfo = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getUserSponsorInfo load failed',detail:e.message})); }; }
try { handlers.createTopupSessionHttp = safeHandler('createTopupSessionHttp', require('../handlers/createTopupSessionHttp.js')); } catch (e) { handlers.createTopupSessionHttp = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createTopupSessionHttp load failed',detail:e.message})); }; }
try { handlers.createPaymentOrder = safeHandler('createPaymentOrder', require('../handlers/createPaymentOrder.js')); } catch (e) { handlers.createPaymentOrder = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createPaymentOrder load failed',detail:e.message})); }; }
try { handlers.submitPaymentProof = safeHandler('submitPaymentProof', require('../handlers/submitPaymentProof.js')); } catch (e) { handlers.submitPaymentProof = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'submitPaymentProof load failed',detail:e.message})); }; }
try { handlers.getPaymentOrderStatus = safeHandler('getPaymentOrderStatus', require('../handlers/getPaymentOrderStatus.js')); } catch (e) { handlers.getPaymentOrderStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getPaymentOrderStatus load failed',detail:e.message})); }; }
try { handlers.retryPaymentOrder = safeHandler('retryPaymentOrder', require('../handlers/retryPaymentOrder.js')); } catch (e) { handlers.retryPaymentOrder = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'retryPaymentOrder load failed',detail:e.message})); }; }
try { handlers.verifyUPIPayment = safeHandler('verifyUPIPayment', require('../handlers/verifyUPIPayment.js')); } catch (e) { handlers.verifyUPIPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'verifyUPIPayment load failed',detail:e.message})); }; }
try { handlers.uploadScreenshot = safeHandler('uploadScreenshot', require('../handlers/uploadScreenshot.js')); } catch (e) { handlers.uploadScreenshot = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'uploadScreenshot load failed',detail:e.message})); }; }
try { handlers.createPaymentSession = safeHandler('createPaymentSession', require('../handlers/createPaymentSession.js')); } catch (e) { handlers.createPaymentSession = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createPaymentSession load failed',detail:e.message})); }; }
try { handlers.paymentConfirm = safeHandler('paymentConfirm', require('../handlers/paymentConfirm.js')); } catch (e) { handlers.paymentConfirm = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'paymentConfirm load failed',detail:e.message})); }; }
try { handlers.createSmsSession = safeHandler('createSmsSession', require('../handlers/createSmsSession.js')); } catch (e) { handlers.createSmsSession = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createSmsSession load failed',detail:e.message})); }; }
try { handlers.smsPaymentConfirm = safeHandler('smsPaymentConfirm', require('../handlers/smsPaymentConfirm.js')); } catch (e) { handlers.smsPaymentConfirm = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'smsPaymentConfirm load failed',detail:e.message})); }; }
try { handlers.enterprisePayment = safeHandler('enterprisePayment', require('../handlers/enterprisePaymentSubmit.js')); } catch (e) { handlers.enterprisePayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'enterprisePayment load failed',detail:e.message})); }; }
try { handlers.enterpriseVerifyOtp = safeHandler('enterpriseVerifyOtp', require('../handlers/enterpriseVerifyOtp.js')); } catch (e) { handlers.enterpriseVerifyOtp = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'enterpriseVerifyOtp load failed',detail:e.message})); }; }
try { handlers.enterpriseResendOtp = safeHandler('enterpriseResendOtp', require('../handlers/enterpriseResendOtp.js')); } catch (e) { handlers.enterpriseResendOtp = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'enterpriseResendOtp load failed',detail:e.message})); }; }
try { handlers.pipelinePayment = safeHandler('pipelinePayment', require('../handlers/pipelinePaymentSubmit.js')); } catch (e) { handlers.pipelinePayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'pipelinePayment load failed',detail:e.message})); }; }
try { handlers.pipelineVerifyOtp = safeHandler('pipelineVerifyOtp', require('../handlers/pipelineVerifyOtp.js')); } catch (e) { handlers.pipelineVerifyOtp = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'pipelineVerifyOtp load failed',detail:e.message})); }; }
try { handlers.pipelineResendOtp = safeHandler('pipelineResendOtp', require('../handlers/pipelineResendOtp.js')); } catch (e) { handlers.pipelineResendOtp = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'pipelineResendOtp load failed',detail:e.message})); }; }
try { handlers.createUPIOrder = safeHandler('createUPIOrder', require('../handlers/createUPIOrder.js')); } catch (e) { handlers.createUPIOrder = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'createUPIOrder load failed',detail:e.message})); }; }
try { handlers.getUPIOrderStatus = safeHandler('getUPIOrderStatus', require('../handlers/getUPIOrderStatus.js')); } catch (e) { handlers.getUPIOrderStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getUPIOrderStatus load failed',detail:e.message})); }; }
try { handlers.webhookUPIConfirm = safeHandler('webhookUPIConfirm', require('../handlers/webhookUPIConfirm.js')); } catch (e) { handlers.webhookUPIConfirm = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'webhookUPIConfirm load failed',detail:e.message})); }; }
try { handlers.retryUPIOrder = safeHandler('retryUPIOrder', require('../handlers/retryUPIOrder.js')); } catch (e) { handlers.retryUPIOrder = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'retryUPIOrder load failed',detail:e.message})); }; }
try { handlers.companionPayment = safeHandler('companionPayment', require('../handlers/companionPayment.js')); } catch (e) { handlers.companionPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'companionPayment load failed',detail:e.message})); }; }
try { handlers.adminLogout = safeHandler('adminLogout', require('../handlers/adminLogout.js')); } catch (e) { handlers.adminLogout = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'adminLogout load failed',detail:e.message})); }; }
// Admin endpoints
try { handlers.getUPIPayments = requireAdmin(safeHandler('getUPIPayments', require('../handlers/getUPIPayments.js'))); } catch (e) { handlers.getUPIPayments = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getUPIPayments load failed',detail:e.message})); }; }
try { handlers.getUPIDashboardStats = requireAdmin(safeHandler('getUPIDashboardStats', require('../handlers/getUPIDashboardStats.js'))); } catch (e) { handlers.getUPIDashboardStats = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getUPIDashboardStats load failed',detail:e.message})); }; }
try { handlers.processPendingPayments = requireAdmin(safeHandler('processPendingPayments', require('../handlers/processPendingPayments.js'))); } catch (e) { handlers.processPendingPayments = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'processPendingPayments load failed',detail:e.message})); }; }
try { handlers.deleteUPIPayment = requireAdmin(safeHandler('deleteUPIPayment', require('../handlers/deleteUPIPayment.js'))); } catch (e) { handlers.deleteUPIPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'deleteUPIPayment load failed',detail:e.message})); }; }
try { handlers.approveUPIPayment = requireAdmin(safeHandler('approveUPIPayment', require('../handlers/approveUPIPayment.js'))); } catch (e) { handlers.approveUPIPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'approveUPIPayment load failed',detail:e.message})); }; }
try { handlers.rejectUPIPayment = requireAdmin(safeHandler('rejectUPIPayment', require('../handlers/rejectUPIPayment.js'))); } catch (e) { handlers.rejectUPIPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'rejectUPIPayment load failed',detail:e.message})); }; }
try { handlers.restoreUPIPayment = requireAdmin(safeHandler('restoreUPIPayment', require('../handlers/restoreUPIPayment.js'))); } catch (e) { handlers.restoreUPIPayment = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'restoreUPIPayment load failed',detail:e.message})); }; }
try { handlers.getVerificationLogs = requireAdmin(safeHandler('getVerificationLogs', require('../handlers/getVerificationLogs.js'))); } catch (e) { handlers.getVerificationLogs = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getVerificationLogs load failed',detail:e.message})); }; }
try { handlers.adminDeleteRecord = requireAdmin(safeHandler('adminDeleteRecord', require('../handlers/adminDeleteRecord.js'))); } catch (e) { handlers.adminDeleteRecord = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'adminDeleteRecord load failed',detail:e.message})); }; }
try { handlers.supabaseProxy = safeHandler('supabaseProxy', require('../handlers/supabaseProxy.js')); } catch (e) { handlers.supabaseProxy = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'supabaseProxy load failed',detail:e.message})); }; }
try { handlers.getAdminDashboardData = requireAdmin(safeHandler('getAdminDashboardData', require('../handlers/getAdminDashboardData.js'))); } catch (e) { handlers.getAdminDashboardData = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getAdminDashboardData load failed',detail:e.message})); }; }
try { handlers.cleanupDemoData = requireAdmin(safeHandler('cleanupDemoData', require('../handlers/cleanupDemoData.js'))); } catch (e) { handlers.cleanupDemoData = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'cleanupDemoData load failed',detail:e.message})); }; }
try { handlers.approvePendingRegistration = requireAdmin(safeHandler('approvePendingRegistration', require('../handlers/approvePendingRegistration.js'))); } catch (e) { handlers.approvePendingRegistration = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'approvePendingRegistration load failed',detail:e.message})); }; }
try { handlers.bulkDeleteUsers = requireAdmin(safeHandler('bulkDeleteUsers', require('../handlers/bulkDeleteUsers.js'))); } catch (e) { handlers.bulkDeleteUsers = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'bulkDeleteUsers load failed',detail:e.message})); }; }
try { handlers.getRecentActivity = requireAdmin(safeHandler('getRecentActivity', require('../handlers/getRecentActivity.js'))); } catch (e) { handlers.getRecentActivity = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getRecentActivity load failed',detail:e.message})); }; }
try { handlers.updateUserStatus = requireAdmin(safeHandler('updateUserStatus', require('../handlers/updateUserStatus.js'))); } catch (e) { handlers.updateUserStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'updateUserStatus load failed',detail:e.message})); }; }
try { handlers.getQueueStatus = requireAdmin(safeHandler('getQueueStatus', require('../handlers/getQueueStatus.js'))); } catch (e) { handlers.getQueueStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getQueueStatus load failed',detail:e.message})); }; }
try { handlers.rerunOcr = requireAdmin(safeHandler('rerunOcr', require('../handlers/rerunOcr.js'))); } catch (e) { handlers.rerunOcr = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'rerunOcr load failed',detail:e.message})); }; }
try { handlers.rerunVerification = requireAdmin(safeHandler('rerunVerification', require('../handlers/rerunVerification.js'))); } catch (e) { handlers.rerunVerification = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'rerunVerification load failed',detail:e.message})); }; }
try { handlers.getReports = requireAdmin(safeHandler('getReports', require('../handlers/getReports.js'))); } catch (e) { handlers.getReports = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getReports load failed',detail:e.message})); }; }
try { handlers.getAuditLogs = requireAdmin(safeHandler('getAuditLogs', require('../handlers/getAuditLogs.js'))); } catch (e) { handlers.getAuditLogs = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getAuditLogs load failed',detail:e.message})); }; }
try { handlers.getCompanionStatus = requireAdmin(safeHandler('getCompanionStatus', require('../handlers/getCompanionStatus.js'))); } catch (e) { handlers.getCompanionStatus = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getCompanionStatus load failed',detail:e.message})); }; }
try { handlers.getAdminSponsorTransfers = requireAdmin(safeHandler('getAdminSponsorTransfers', require('../handlers/getAdminSponsorTransfers.js'))); } catch (e) { handlers.getAdminSponsorTransfers = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getAdminSponsorTransfers load failed',detail:e.message})); }; }
try { handlers.getPendingPaymentsQueue = requireAdmin(safeHandler('getPendingPaymentsQueue', require('../handlers/getPendingPaymentsQueue.js'))); } catch (e) { handlers.getPendingPaymentsQueue = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'getPendingPaymentsQueue load failed',detail:e.message})); }; }
try { handlers.fixSystemUsers = safeHandler('fixSystemUsers', require('../handlers/fixSystemUsers.js')); } catch (e) { handlers.fixSystemUsers = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'fixSystemUsers load failed',detail:e.message})); }; }

console.error('[INDEX] ' + Object.keys(handlers).length + ' handlers loaded');

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');

  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    try {
      return require('../handlers/sseDashboard.js')(req, res);
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'SSE handler failed', detail: e.message }));
      return;
    }
  }

  const handler = handlers[path];
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
