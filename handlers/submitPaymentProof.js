const { submitPaymentProof, retryPaymentOrder, getPaymentOrder } = require('../api/_paymentOrderManager.js');
const { updateDoc, runQuery } = require('../api/_supabase.js');
const { COL_ORDERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const r2 = require('../api/_r2.js');
const { broadcast } = require('../api/_sse.js');

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

    log('orderId=' + orderId + ' screenshot_len=' + (screenshot ? screenshot.length : 0) + ' (' + (Date.now() - t0) + 'ms validation)');

    // ── PHASE 1: Return "processing" IMMEDIATELY — zero blocking ops ──
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

    log('Response sent in ' + (Date.now() - t0) + 'ms — starting background work');

    // ── PHASE 2: Everything else is fire-and-forget ──
    storeAndVerify(orderId, screenshot, utr, upiId).catch(e => {
      log('Background error for ' + orderId + ': ' + e.message);
    });

  } catch (err) {
    console.error('[SUBMIT-PROOF] Error:', err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};

async function storeAndVerify(orderId, screenshot, utr, upiId) {
  const bt0 = Date.now();

  // Step 1: Upload to R2 with 4s timeout
  let uploadedUrl = screenshot;
  try {
    const parsed = parseBase64(screenshot);
    if (parsed && parsed.buffer.length <= 10 * 1024 * 1024) {
      const key = 'payments/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + parsed.ext;
      const r2Result = await Promise.race([
        r2.uploadFile(key, parsed.buffer, parsed.mimeType),
        new Promise((_, reject) => setTimeout(() => reject(new Error('R2_TIMEOUT')), 4000)),
      ]);
      if (r2Result && r2Result.url) uploadedUrl = r2Result.url;
      log('R2 upload done: ' + (Date.now() - bt0) + 'ms, url=' + (uploadedUrl || '').substring(0, 60));
    }
  } catch (e) { log('R2 upload failed (using base64): ' + e.message); }

  // Step 2: Get order + handle expiry — all with 5s combined timeout
  const dbT0 = Date.now();
  try {
    await Promise.race([
      (async () => {
        let order = await getPaymentOrder(orderId);
        if (!order) { log('Order not found: ' + orderId); return; }
        if (order.status === 'expired') {
          log('Re-activating expired order ' + orderId);
          const newExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
          await updateDoc(COL_ORDERS, orderId, {
            status: 'pending', verification_status: null, verification_score: null,
            ocr_result: null, rejection_reasons: [], screenshot_url: null,
            expires_at: newExpiresAt, updated_at: now(),
          }).catch(() => {});
        }
        if (order.status === 'verified') { log('Already verified: ' + orderId); return; }

        // Store screenshot + trigger verification
        await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null, userEnteredUpi: upiId || null });
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('DB_TIMEOUT')), 5000)),
    ]);
  } catch (e) {
    log('Background store/verify failed for ' + orderId + ': ' + e.message);
    // Try to mark as manual_review so admin can handle
    try {
      await updateDoc(COL_ORDERS, orderId, {
        status: 'manual_review',
        verification_status: 'manual_review',
        rejection_reasons: ['Background processing failed: ' + e.message],
        updated_at: now(),
      });
      broadcast('paymentUpdated', { orderId, status: 'manual_review' }).catch(() => {});
    } catch (_) {}
  }

  log('Background work done for ' + orderId + ': ' + (Date.now() - bt0) + 'ms total');
}
