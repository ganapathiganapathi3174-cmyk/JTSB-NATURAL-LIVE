const { runQuery, conditionalUpdateDoc } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS } = require('../api/_shared.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const { paymentId } = req.body || {};
    if (!paymentId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'paymentId required' }));
      return;
    }

    const affected = await conditionalUpdateDoc(
      COL_UPI_PAYMENTS,
      paymentId,
      [],
      {
        ocr_attempted: 0,
        ocr_retries: 0,
        ocr_result: null,
        verification_result: null,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }
    );

    if (affected > 0) {
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, message: 'OCR re-queued for processing' }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Payment not found' }));
    }
  } catch (err) {
    console.error('[RERUN OCR] Error:', err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
