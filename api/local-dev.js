const http = require('http');
const turso = require('../_turso.js');
const queue = require('../_queue.js');
const health = require('../_health.js');
const cleanup = require('../_cleanup.js');

// Initialize on startup
turso.ensureBackupTables().catch(err => console.warn('[TURSO] Init warning:', err.message));
queue.ensureQueueTables().then(() => queue.recoverPending()).catch(err => console.warn('[QUEUE] Init warning:', err.message));
health.startHealthChecks();
cleanup.startDailyTasks();

function wrapHandler(handler) {
  return (req, res) => {
    let responded = false;
    const json = (data, status = 200) => {
      if (responded) return;
      responded = true;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    res.status = (code) => ({ json: (data) => json(data, code) });
    res.json = (data) => json(data);
    const result = handler(req, res);
    if (result && typeof result.catch === 'function') {
      result.catch((err) => {
        console.error('[HANDLER ERROR]', err?.message || err);
        json({ error: err?.message || 'Internal server error' }, 500);
      });
    }
  };
}

const handlers = {
  preRegister: require('../handlers/preRegister.js'),
  createTopupSessionHttp: require('../handlers/createTopupSessionHttp.js'),
  verifyUPIPayment: require('../handlers/verifyUPIPayment.js'),
  uploadScreenshot: require('../handlers/uploadScreenshot.js'),
  getUPIPayments: require('../handlers/getUPIPayments.js'),
  getUPIDashboardStats: require('../handlers/getUPIDashboardStats.js'),
  processPendingPayments: require('../handlers/processPendingPayments.js'),
  deleteUPIPayment: require('../handlers/deleteUPIPayment.js'),
  approveUPIPayment: require('../handlers/approveUPIPayment.js'),
  rejectUPIPayment: require('../handlers/rejectUPIPayment.js'),
  getVerificationLogs: require('../handlers/getVerificationLogs.js'),
  adminDeleteRecord: require('../handlers/adminDeleteRecord.js'),
  getHealthStatus: require('../handlers/getHealthStatus.js'),
};

const routeMap = {};
for (const [name, handler] of Object.entries(handlers)) {
  routeMap['POST /' + name] = wrapHandler(handler);
  routeMap['POST /api/' + name] = wrapHandler(handler);
  routeMap['GET /' + name] = wrapHandler(handler);
  routeMap['GET /api/' + name] = wrapHandler(handler);
}

const server = http.createServer((req, res) => {
  try {
  const url = req.url.split('?')[0];
  const key = req.method + ' ' + url;
  const handler = routeMap[key];

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found: ' + key }));
    return;
  }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
    handler(req, res);
  });
  req.on('error', (err) => { res.writeHead(502); res.end(JSON.stringify({ error: 'Request error' })); });
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: 'Server error' }));
  }
});

process.on('uncaughtException', (err) => { console.error('UNCAUGHT', err); });
process.on('unhandledRejection', (err) => { console.error('UNHANDLED', err); });

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('API server running on http://localhost:' + PORT);
});
