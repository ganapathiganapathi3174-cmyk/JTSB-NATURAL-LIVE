// SSE connection manager
const clients = new Set();

function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('data: {"type":"connected"}\n\n');
  const client = { id: Date.now(), res };
  clients.add(client);
  req.on('close', () => clients.delete(client));
  return client;
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.res.write(msg); } catch { clients.delete(client); }
  }
}

function getClientCount() { return clients.size; }

module.exports = { addClient, broadcast, getClientCount };
