const handlers = {
  preRegister: require('./preRegister.js'),
  createTopupSessionHttp: require('./createTopupSessionHttp.js'),
  verifyUPIPayment: require('./verifyUPIPayment.js'),
  uploadScreenshot: require('./uploadScreenshot.js'),
  getUPIPayments: require('./getUPIPayments.js'),
  getUPIDashboardStats: require('./getUPIDashboardStats.js'),
  processPendingPayments: require('./processPendingPayments.js'),
  deleteUPIPayment: require('./deleteUPIPayment.js'),
  approveUPIPayment: require('./approveUPIPayment.js'),
  rejectUPIPayment: require('./rejectUPIPayment.js'),
  getVerificationLogs: require('./getVerificationLogs.js'),
  adminDeleteRecord: require('./adminDeleteRecord.js'),
  getHealthStatus: require('./getHealthStatus.js'),
};

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');
  const handler = handlers[path];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found: ' + path }));
    return;
  }
  // Parse body for POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch { req.body = {}; }
      handler(req, res);
    });
  } else {
    handler(req, res);
  }
};
