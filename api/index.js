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

// Rate limiter with periodic cleanup to prevent memory leaks
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
// Periodically purge stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}, 300000);

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
const handlerModules = [
  ['adminLogin', '../handlers/adminLogin.js', false],
  ['preRegister', '../handlers/preRegister.js', false],
  ['getHealthStatus', '../handlers/getHealthStatus.js', false],
  ['getSponsorMarketplace', '../handlers/getSponsorMarketplace.js', false],
  ['createSponsorTransfer', '../handlers/createSponsorTransfer.js', false],
  ['getSponsorRequests', '../handlers/getSponsorRequests.js', false],
  ['handleSponsorTransfer', '../handlers/handleSponsorTransfer.js', false],
  ['getUserSponsorInfo', '../handlers/getUserSponsorInfo.js', false],
  ['createTopupSessionHttp', '../handlers/createTopupSessionHttp.js', false],
  ['createPaymentOrder', '../handlers/createPaymentOrder.js', false],
  ['submitPaymentProof', '../handlers/submitPaymentProof.js', false],
  ['fastVerifyPayment', '../handlers/fastVerifyPayment.js', false],
  ['getPaymentOrderStatus', '../handlers/getPaymentOrderStatus.js', false],
  ['retryPaymentOrder', '../handlers/retryPaymentOrder.js', false],
  ['verifyUPIPayment', '../handlers/verifyUPIPayment.js', false],
  ['uploadScreenshot', '../handlers/uploadScreenshot.js', false],
  ['createPaymentSession', '../handlers/createPaymentSession.js', false],
  ['paymentConfirm', '../handlers/paymentConfirm.js', false],
  ['createSmsSession', '../handlers/createSmsSession.js', false],
  ['smsPaymentConfirm', '../handlers/smsPaymentConfirm.js', false],
  ['enterprisePayment', '../handlers/enterprisePaymentSubmit.js', false],
  ['enterpriseVerifyOtp', '../handlers/enterpriseVerifyOtp.js', false],
  ['enterpriseResendOtp', '../handlers/enterpriseResendOtp.js', false],
  ['pipelinePayment', '../handlers/pipelinePaymentSubmit.js', false],
  ['pipelineVerifyOtp', '../handlers/pipelineVerifyOtp.js', false],
  ['pipelineResendOtp', '../handlers/pipelineResendOtp.js', false],
  ['createUPIOrder', '../handlers/createUPIOrder.js', false],
  ['getUPIOrderStatus', '../handlers/getUPIOrderStatus.js', false],
  ['webhookUPIConfirm', '../handlers/webhookUPIConfirm.js', false],
  ['retryUPIOrder', '../handlers/retryUPIOrder.js', false],
  ['companionPayment', '../handlers/companionPayment.js', false],
  ['adminLogout', '../handlers/adminLogout.js', false],
  ['getUPIPayments', '../handlers/getUPIPayments.js', true],
  ['getUPIDashboardStats', '../handlers/getUPIDashboardStats.js', true],
  ['processPendingPayments', '../handlers/processPendingPayments.js', true],
  ['deleteUPIPayment', '../handlers/deleteUPIPayment.js', true],
  ['approveUPIPayment', '../handlers/approveUPIPayment.js', true],
  ['rejectUPIPayment', '../handlers/rejectUPIPayment.js', true],
  ['restoreUPIPayment', '../handlers/restoreUPIPayment.js', true],
  ['getVerificationLogs', '../handlers/getVerificationLogs.js', true],
  ['adminDeleteRecord', '../handlers/adminDeleteRecord.js', true],
  ['supabaseProxy', '../handlers/supabaseProxy.js', true],
  ['getAdminDashboardData', '../handlers/getAdminDashboardData.js', true],
  ['cleanupDemoData', '../handlers/cleanupDemoData.js', true],
  ['approvePendingRegistration', '../handlers/approvePendingRegistration.js', true],
  ['bulkDeleteUsers', '../handlers/bulkDeleteUsers.js', true],
  ['getRecentActivity', '../handlers/getRecentActivity.js', true],
  ['updateUserStatus', '../handlers/updateUserStatus.js', true],
  ['getQueueStatus', '../handlers/getQueueStatus.js', true],
  ['rerunOcr', '../handlers/rerunOcr.js', true],
  ['rerunVerification', '../handlers/rerunVerification.js', true],
  ['getReports', '../handlers/getReports.js', true],
  ['getAuditLogs', '../handlers/getAuditLogs.js', true],
  ['getCompanionStatus', '../handlers/getCompanionStatus.js', true],
  ['getAdminSponsorTransfers', '../handlers/getAdminSponsorTransfers.js', true],
  ['getPendingPaymentsQueue', '../handlers/getPendingPaymentsQueue.js', true],
  ['fixSystemUsers', '../handlers/fixSystemUsers.js', true],
  ['purgeAllUsers', '../handlers/purgeAllUsers.js', true],
  ['permanentDeleteUser', '../handlers/permanentDeleteUser.js', true],
  ['cascadeDeleteUser', '../handlers/cascadeDeleteUser.js', true],
  ['createUpgradeRequest', '../handlers/createUpgradeRequest.js', false],
  ['getUpgradeRequests', '../handlers/getUpgradeRequests.js', true],
  ['approveUpgradeRequest', '../handlers/approveUpgradeRequest.js', true],
  ['rejectUpgradeRequest', '../handlers/rejectUpgradeRequest.js', true],
  ['getUserUpgradeStatus', '../handlers/getUserUpgradeStatus.js', false],
  ['submitUtrVerification', '../handlers/submitUtrVerification.js', false],
  ['sseDashboard', '../handlers/sseDashboard.js', false],
  ['reactivateUser', '../handlers/reactivateUser.js', true],
  ['getCycleDashboard', '../handlers/getCycleDashboard.js', true],
  ['getUserCycleData', '../handlers/getUserCycleData.js', false],
  ['approveSponsor', '../handlers/approveSponsor.js', true],
  ['rejectSponsor', '../handlers/rejectSponsor.js', true],
  ['sponsorClaim', '../handlers/sponsorClaim.js', false],
  ['preRegisterFiles', '../handlers/preRegisterFiles.js', false],
];
for (const [name, modPath, needsAdmin] of handlerModules) {
  try {
    const mod = require(modPath);
    let h = safeHandler(name, mod);
    if (needsAdmin) h = requireAdmin(h);
    handlers[name] = h;
  } catch (e) {
    console.error('[INDEX] Handler load failed: ' + name + ': ' + e.message);
    handlers[name] = (r,s) => { s.writeHead(500); s.end(JSON.stringify({error:'handler_unavailable'})); };
  }
}


console.error('[INDEX] ' + Object.keys(handlers).length + ' handlers loaded');

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');

  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    try {
      return require('../handlers/sseDashboard.js')(req, res);
    } catch (e) {
      console.error('[INDEX] SSE handler error: ' + (e?.message || e));
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'SSE handler failed' }));
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

  const REQ_TIMEOUT_MS = 14000;
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error('[API] HARD TIMEOUT for path=' + path + ' (' + (REQ_TIMEOUT_MS/1000) + 's limit)');
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server processing took too long. Your payment is being reviewed by our team.' }));
    }
  }, REQ_TIMEOUT_MS);
  const origEnd = res.end.bind(res);
  res.end = function (...a) { clearTimeout(timeout); return origEnd(...a); };
  const origWH = res.writeHead.bind(res);
  res.writeHead = function (code, ...a) {
    clearTimeout(timeout);
    metrics.trackAPICall(path, req.method, code);
    // Security headers — injected on every response
    const securityHeaders = {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    if (a.length === 0 || (a.length >= 1 && typeof a[0] === 'number')) {
      const headers = { ...securityHeaders, 'Content-Type': 'application/json' };
      origWH.call(res, code, ...a, headers);
      return;
    }
    if (typeof a[0] === 'object') {
      Object.assign(a[0], securityHeaders);
      if (!a[0]['Content-Type'] && !a[0]['content-type'] && code >= 200 && code < 300 && code !== 204) {
        a[0]['Content-Type'] = 'application/json';
      }
    }
    return origWH(code, ...a);
  };

  await handler(req, res).catch(err => {
    clearTimeout(timeout);
    console.error('[API] Path=' + path + ' Error=' + (err?.message || err));
    metrics.trackAPICall(path, req.method, 500);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', path }));
    }
  });
};
