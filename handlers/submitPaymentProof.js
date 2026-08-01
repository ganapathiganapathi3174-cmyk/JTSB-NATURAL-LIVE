const { updateDoc } = require('../api/_supabase.js');
const { COL_ORDERS } = require('../api/_shared.js');
const r2 = require('../api/_r2.js');

function now() { return new Date().toISOString(); }

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [SUBMIT-PROOF] ' + msg);
}

function parseBase64(screenshot) {
  if (!screenshot || !screenshot.startsWith('data:')) return null;
  const matches = screenshot.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  return { mimeType: matches[1], ext: matches[1] === 'image/png' ? 'png' : 'jpg', buffer: Buffer.from(matches[2], 'base64') };
}

module.exports = async (req, res) => {
  const sendJSON = (statusCode, payload) => {
    if (res.headersSent) return;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { sendJSON(405, { error: 'Method not allowed' }); return; }

  const t0 = Date.now();

  try {
    const { orderId, screenshot, utr, upiId } = req.body || {};
    if (!orderId) { sendJSON(400, { error: 'orderId is required' }); return; }
    if (!screenshot) { sendJSON(400, { error: 'screenshot is required' }); return; }
    if (!upiId) { sendJSON(400, { error: 'UPI ID is required' }); return; }

    log('orderId=' + orderId + ' screenshot_len=' + (screenshot ? screenshot.length : 0));

    const parsed = parseBase64(screenshot);
    if (!parsed || !parsed.buffer || parsed.buffer.length < 1) { sendJSON(400, { error: 'Invalid screenshot image' }); return; }
    if (parsed.buffer.length > 10 * 1024 * 1024) { sendJSON(400, { error: 'Screenshot must be under 10MB' }); return; }

    // ── Phase 1: Store the screenshot SYNCHRONOUSLY (R2 preferred, data-URL fallback) ──
    // This must complete before we respond, so the status-poll request can verify it.
    let screenshotUrl = screenshot;
    let r2TimeoutId;
    try {
      const key = 'payments/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + parsed.ext;
      const r2Result = await Promise.race([
        r2.uploadFile(key, parsed.buffer, parsed.mimeType),
        new Promise((_, reject) => { r2TimeoutId = setTimeout(() => reject(new Error('R2_TIMEOUT')), 3000); }),
      ]);
      clearTimeout(r2TimeoutId);
      if (r2Result && r2Result.url) screenshotUrl = r2Result.url;
      log('Screenshot stored (' + (screenshotUrl === screenshot ? 'data-URL fallback' : 'R2') + ') in ' + (Date.now() - t0) + 'ms');
    } catch (e) {
      clearTimeout(r2TimeoutId);
      log('R2 upload failed (using data-URL fallback): ' + e.message);
    }

    // Persist the screenshot URL on the order so the poll (getPaymentOrderStatus)
    // can find and verify it.
    await updateDoc(COL_ORDERS, orderId, {
      screenshot_url: screenshotUrl,
      verification_status: 'pending',
      updated_at: now(),
    }).catch(e => log('Persist screenshot_url failed: ' + e.message));

    // ── Phase 2: Respond immediately. Verification is driven synchronously by the
    // frontend's status poll, because fire-and-forget background work after the
    // response is NOT reliable on serverless functions. ──
    sendJSON(200, {
      orderId,
      paymentId: orderId,
      status: 'processing',
      verificationStatus: 'pending',
      verificationScore: 0,
      reasons: [],
      matchedAmount: false, matchedReceiver: false, matchedUtr: false, matchedDate: false,
      userUtrMatched: false, userEnteredUtr: utr || null,
      userUpiMatched: false, userEnteredUpi: upiId || null,
      fraudScore: 0, checks: [],
      message: 'Payment screenshot received. Verifying...',
    });

  } catch (err) {
    console.error('[SUBMIT-PROOF] Error:', err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};
