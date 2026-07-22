const { runPipeline } = require('../api/_aiPipeline.js');
const { runQuery } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID } = require('../api/_shared.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const { paymentId, imageUrl, amount, upiId, utr } = req.body || {};
    if (!paymentId || !imageUrl) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing paymentId or imageUrl' }));
      return;
    }

    const existingPayments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 100 });
    const existingHashes = existingPayments
      .filter(p => p.screenshot_hash)
      .map(p => p.screenshot_hash);
    const existingUtrs = existingPayments
      .filter(p => p.utr)
      .map(p => p.utr.toUpperCase().replace(/\s+/g, ''));

    const pipelineResult = await runPipeline({
      imageUrl,
      expectedAmount: amount ? parseFloat(amount) : null,
      expectedUpiId: upiId || ADMIN_UPI_ID,
      expectedUtr: utr || null,
      expectedDate: new Date().toISOString().split('T')[0],
      existingHashes,
      existingUtrs,
    });

    res.writeHead(200);
    res.end(JSON.stringify({
      success: true,
      paymentId,
      ...pipelineResult,
    }));
  } catch (err) {
    console.error('[runAIVerification] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
