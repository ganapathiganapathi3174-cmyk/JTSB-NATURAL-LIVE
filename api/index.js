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

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');
  const handler = handlers[path];
  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found: ' + path }));
    return;
  }
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
