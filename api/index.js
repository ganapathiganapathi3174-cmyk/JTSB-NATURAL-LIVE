// Stage 1: add _auth.js + _health endpoint
const { requireAdmin } = (() => {
  try { return require('./_auth.js'); } catch (e) { return { requireAdmin: (fn) => fn }; }
})();

const healthHandler = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ status: 'ok', stage: 1 }));
};

const handlerMap = {
  getHealthStatus: healthHandler,
};

module.exports = async (req, res) => {
  const url = req.url.split('?')[0];
  const path = url.replace(/^\/api\//, '').replace(/^\//, '');
  const handler = handlerMap[path];
  if (!handler) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  await handler(req, res).catch(err => {
    res.writeHead(500);
    res.end(JSON.stringify({ error: err.message }));
  });
};
