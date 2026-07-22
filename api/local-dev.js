const fs = require('fs');
const p = require('path');
try { fs.readFileSync(p.join(__dirname, '..', '.env.local'), 'utf8').split('\n').forEach(l => { let m = l.match(/^\s*([^#=]+)=(.*)/); if (m) process.env[m[1].trim()] = m[2].trim(); }); } catch (_) {}
const http = require('http');

const DIST = p.join(__dirname, '..', 'frontend', 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json' };
const { requireAdmin } = require('./_auth.js');
const sseDashboard = require('../handlers/sseDashboard.js');

const rateLimitStore = new Map();
function rateLimit(key, maxRequests = 60, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimitStore.set(key, entry);
  if (entry.count > maxRequests) return { limited: true, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { limited: false };
}

// Silence expected dev warnings
const origWarn = console.warn; console.warn = (...a) => { const m = a.join(' '); if (m.includes('not set') || m.includes('unhealthy') || m.includes('Connection failed') || m.includes('[HEALTH]') || m.includes('[TURSO]') || m.includes('[NEON]') || m.includes('[R2]')) return; origWarn(...a); };
const origLog = console.log; console.log = (...a) => { const m = a.join(' '); if (m.includes('[HEALTH]') || m.includes('[TURSO]') || m.includes('[NEON]') || m.includes('[R2]')) return; origLog(...a); };
require('./_turso.js').ensureBackupTables().catch(() => {});
require('./_queue.js').ensureQueueTables().then(() => require('./_queue.js').recoverPending()).catch(() => {});
require('./_health.js').startHealthChecks();
require('./_cleanup.js').startDailyTasks();
require('./_upiPaymentMonitor.js').startMonitor();
// Pre-initialize OCR worker pool so first payment request skips cold start
require('./_bankSmsVerificationEngine.js').initWorkerPool().then(() => {
  console.log('[BANK-SMS] OCR worker pool pre-initialized at startup');
}).catch(() => {});
// Initialize system users on first startup (idempotent — skips if already exist)
require('./_systemInit.js').initSystemUsers().then(created => {
  console.log('[SYSTEM-INIT] Startup initialization complete: ' + created + ' users created');
}).catch(err => {
  console.error('[SYSTEM-INIT] Startup initialization error: ' + err.message);
});

function wrapHandler(handler) {
  return (req, res) => {
    let responded = false;
    const respondSafe = (data, status = 200) => {
      if (responded) return;
      responded = true;
      try {
        if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        console.error('[RESPOND] Failed to send response:', e.message);
      }
    };
    res.status = (code) => ({ json: (data) => respondSafe(data, code) });
    res.json = (data) => respondSafe(data);
    try {
      const result = handler(req, res);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          console.error('[HANDLER ERROR]', err?.message || err);
          if (err?.stack) console.error(err.stack);
          respondSafe({ error: 'Internal server error' }, 500);
        });
      }
    } catch (err) {
      console.error('[HANDLER SYNC ERROR]', err?.message || err);
      if (err?.stack) console.error(err.stack);
      respondSafe({ error: err?.message || 'Internal server error' }, 500);
    }
  };
}

const handlerCfg = [
  ['adminLogin', false, '../handlers/adminLogin.js'],
  ['preRegister', false, '../handlers/preRegister.js'],
  ['createTopupSessionHttp', false, '../handlers/createTopupSessionHttp.js'],
  ['createPaymentOrder', false, '../handlers/createPaymentOrder.js'],
  ['submitPaymentProof', false, '../handlers/submitPaymentProof.js'],
  ['getPaymentOrderStatus', false, '../handlers/getPaymentOrderStatus.js'],
  ['retryPaymentOrder', false, '../handlers/retryPaymentOrder.js'],
  ['verifyUPIPayment', false, '../handlers/verifyUPIPayment.js'],
  ['uploadScreenshot', false, '../handlers/uploadScreenshot.js'],
  ['getUPIPayments', true, '../handlers/getUPIPayments.js'],
  ['getUPIDashboardStats', true, '../handlers/getUPIDashboardStats.js'],
  ['processPendingPayments', true, '../handlers/processPendingPayments.js'],
  ['deleteUPIPayment', true, '../handlers/deleteUPIPayment.js'],
  ['approveUPIPayment', true, '../handlers/approveUPIPayment.js'],
  ['rejectUPIPayment', true, '../handlers/rejectUPIPayment.js'],
  ['restoreUPIPayment', true, '../handlers/restoreUPIPayment.js'],
  ['getVerificationLogs', true, '../handlers/getVerificationLogs.js'],
  ['adminDeleteRecord', true, '../handlers/adminDeleteRecord.js'],
  ['updateReferralStatus', true, '../handlers/updateReferralStatus.js'],
  ['getHealthStatus', false, '../handlers/getHealthStatus.js'],
  ['supabaseProxy', false, '../handlers/supabaseProxy.js'],
  ['getAdminDashboardData', true, '../handlers/getAdminDashboardData.js'],
  ['cleanupDemoData', true, '../handlers/cleanupDemoData.js'],
  ['approvePendingRegistration', true, '../handlers/approvePendingRegistration.js'],
  ['bulkDeleteUsers', true, '../handlers/bulkDeleteUsers.js'],
  ['getRecentActivity', true, '../handlers/getRecentActivity.js'],
  ['updateUserStatus', true, '../handlers/updateUserStatus.js'],
  ['getQueueStatus', true, '../handlers/getQueueStatus.js'],
  ['rerunOcr', true, '../handlers/rerunOcr.js'],
  ['rerunVerification', true, '../handlers/rerunVerification.js'],
  ['getReports', true, '../handlers/getReports.js'],
  ['getAuditLogs', true, '../handlers/getAuditLogs.js'],
  ['adminLogout', false, '../handlers/adminLogout.js'],
  ['createPaymentSession', false, '../handlers/createPaymentSession.js'],
  ['paymentConfirm', false, '../handlers/paymentConfirm.js'],
  ['createSmsSession', false, '../handlers/createSmsSession.js'],
  ['smsPaymentConfirm', false, '../handlers/smsPaymentConfirm.js'],
  ['pipelinePayment', false, '../handlers/pipelinePaymentSubmit.js'],
  ['pipelineVerifyOtp', false, '../handlers/pipelineVerifyOtp.js'],
  ['pipelineResendOtp', false, '../handlers/pipelineResendOtp.js'],
  ['approveSponsor', true, '../handlers/approveSponsor.js'],
  ['rejectSponsor', true, '../handlers/rejectSponsor.js'],
  ['sponsorClaim', false, '../handlers/sponsorClaim.js'],
  ['companionPayment', false, '../handlers/companionPayment.js'],
  ['getCompanionStatus', true, '../handlers/getCompanionStatus.js'],
  ['getSponsorMarketplace', false, '../handlers/getSponsorMarketplace.js'],
  ['createSponsorTransfer', false, '../handlers/createSponsorTransfer.js'],
  ['getSponsorRequests', false, '../handlers/getSponsorRequests.js'],
  ['handleSponsorTransfer', false, '../handlers/handleSponsorTransfer.js'],
  ['getUserSponsorInfo', false, '../handlers/getUserSponsorInfo.js'],
  ['getAdminSponsorTransfers', true, '../handlers/getAdminSponsorTransfers.js'],
  ['getPendingPaymentsQueue', true, '../handlers/getPendingPaymentsQueue.js'],
  ['fixSystemUsers', false, '../handlers/fixSystemUsers.js'],
  ['purgeAllUsers', true, '../handlers/purgeAllUsers.js'],
  ['permanentDeleteUser', true, '../handlers/permanentDeleteUser.js'],
  ['cascadeDeleteUser', true, '../handlers/cascadeDeleteUser.js'],
  // === NEW MODULES: AI Pipeline + Upgrade Requests ===
  ['runAIVerification', false, '../handlers/runAIVerification.js'],
  ['createUpgradeRequest', false, '../handlers/createUpgradeRequest.js'],
  ['getUpgradeRequests', true, '../handlers/getUpgradeRequests.js'],
  ['approveUpgradeRequest', true, '../handlers/approveUpgradeRequest.js'],
  ['rejectUpgradeRequest', true, '../handlers/rejectUpgradeRequest.js'],
  ['getUserUpgradeStatus', false, '../handlers/getUserUpgradeStatus.js'],
];
const handlerModules = {};
const handlers = {};
for (const [name, needsAdmin, filePath] of handlerCfg) {
  handlerModules[name] = filePath;
  Object.defineProperty(handlers, name, {
    get() {
      const mod = require(filePath);
      return needsAdmin ? requireAdmin(mod) : mod;
    },
    enumerable: true,
    configurable: true,
  });
}

const routeMap = {};
for (const [name, handler] of Object.entries(handlers)) {
  if (typeof handler !== 'function') {
    console.error('[ROUTE] WARN: Handler "' + name + '" is not a function, type=' + typeof handler);
    continue;
  }
  const wrapped = wrapHandler(handler);
  routeMap['POST /' + name] = wrapped;
  routeMap['POST /api/' + name] = wrapped;
  routeMap['GET /' + name] = wrapped;
  routeMap['GET /api/' + name] = wrapped;
}
const routeCount = Object.keys(routeMap).length;
if (routeCount !== 128) console.log('[ROUTE] Registered ' + routeCount + ' routes');

const server = http.createServer((req, res) => {
  try {
  // Rate limiting by IP
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const rl = rateLimit(ip, 60, 60000);
  if (rl.limited) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Too many requests. Try again in ' + rl.retryAfter + 's.' }));
    return;
  }

  const url = req.url.split('?')[0];
  const key = req.method + ' ' + url;

  // SSE dashboard endpoint — long-lived connection, bypass handler wrapping and timeout
  if (url === '/api/sse/dashboard' || url === '/sse/dashboard') {
    if (req.method === 'OPTIONS') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end(); return; }
    return sseDashboard(req, res);
  }

  const handler = routeMap[key];

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';");

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (!handler) {
    const ext = p.extname(req.url.split('?')[0]);
    if (ext || req.url === '/' || !req.url.startsWith('/api/')) {
      const filePath = !ext && (req.url === '/' || !req.url.includes('.'))
        ? p.join(DIST, 'index.html')
        : p.join(DIST, req.url.split('?')[0]);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': MIME[p.extname(filePath)] || 'application/octet-stream', 'Cache-Control': p.extname(filePath) === '.html' ? 'no-cache' : 'max-age=31536000' });
        fs.createReadStream(filePath).pipe(res); return;
      }
    }
    console.error('[ROUTE] No handler for key="' + key + '" url="' + req.url + '" method=' + req.method);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Per-request timeout (120 seconds) — OCR pipeline can take 60-90s on cold start
  const REQUEST_TIMEOUT_MS = 120000;
  const abortTimer = setTimeout(() => {
    console.error('[TIMEOUT] Request timed out after ' + REQUEST_TIMEOUT_MS + 'ms: ' + key);
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request timed out' }));
    }
  }, REQUEST_TIMEOUT_MS);
  const origEnd = res.end.bind(res);
  res.end = function (...args) { clearTimeout(abortTimer); return origEnd(...args); };

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
    handler(req, res);
  });
  req.on('error', (err) => { clearTimeout(abortTimer); if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Request error' })); } });
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Server error' }));
  }
});

process.on('uncaughtException', (err) => { console.error('UNCAUGHT', err); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED', err); });

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('API server running on http://localhost:' + PORT);
});
