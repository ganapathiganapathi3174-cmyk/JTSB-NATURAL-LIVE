const { submitPaymentProof, retryPaymentOrder, getPaymentOrder } = require('../api/_paymentOrderManager.js');
const { updateDoc, runQuery } = require('../api/_supabase.js');
const { COL_ORDERS, COL_UPI_PAYMENTS } = require('../api/_shared.js');
const r2 = require('../api/_r2.js');
const { broadcast } = require('../api/_sse.js');

const UPLOAD_TIMEOUT_MS = 4000;
const INLINE_VERIFY_BUDGET_MS = 4000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + '_TIMEOUT')), ms)),
  ]);
}

function now() { return new Date().toISOString(); }

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [SUBMIT-PROOF] ' + msg);
}

async function uploadBase64Image(base64DataUrl) {
  if (!base64DataUrl || !base64DataUrl.startsWith('data:')) {
    return base64DataUrl;
  }
  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return base64DataUrl;

  const mimeType = matches[1];
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error('Image too large (max 10MB)');
  }

  const key = 'payments/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;

  const r2Result = await r2.uploadFile(key, buffer, mimeType);
  if (r2Result && r2Result.url) {
    return r2Result.url;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      const { data, error } = await supabase.storage.from('payments').upload(key, buffer, {
        contentType: mimeType, upsert: false,
      });
      if (!error) {
        const { data: urlData } = supabase.storage.from('payments').getPublicUrl(key);
        return urlData.publicUrl;
      }
    } catch (e) { console.warn('[SUBMIT-PROOF] Supabase upload failed:', e.message); }
  }

  return base64DataUrl;
}

async function storeProofAndVerify(orderId, uploadedUrl, utr, upiId) {
  const t0 = Date.now();
  log('Background verify started for ' + orderId);

  try {
    let result;
    try {
      result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null, userEnteredUpi: upiId });
    } catch (verifyErr) {
      if (verifyErr.message === 'Order expired' || verifyErr.message === 'Order not found') {
        log('Order expired/not-found, retrying for ' + orderId);
        await retryPaymentOrder(orderId);
        result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null, userEnteredUpi: upiId });
      } else {
        throw verifyErr;
      }
    }
    log('Background verify done for ' + orderId + ': status=' + result.status + ' score=' + (result.verificationScore || 0) + ' (' + (Date.now() - t0) + 'ms)');
    return result;
  } catch (err) {
    log('Background verify FAILED for ' + orderId + ': ' + err.message + ' (' + (Date.now() - t0) + 'ms)');
    // Mark as manual_review on failure
    try {
      await updateDoc(COL_ORDERS, orderId, {
        status: 'manual_review',
        verification_status: 'manual_review',
        rejection_reasons: ['Background verification failed: ' + err.message],
        updated_at: now(),
      });
      try { broadcast('paymentUpdated', { orderId, status: 'manual_review' }); } catch {}
    } catch (_) {}
    return { status: 'manual_review', orderId };
  }
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

  try {
    const { orderId, screenshot, utr, upiId } = req.body || {};
    if (!orderId) { sendJSON(400, { error: 'orderId is required' }); return; }
    if (!screenshot) { sendJSON(400, { error: 'screenshot is required' }); return; }
    if (!upiId) { sendJSON(400, { error: 'UPI ID is required' }); return; }

    // ── PHASE 1: Fast response — store screenshot, return immediately ──
    const t0 = Date.now();

    // Upload with 4s timeout
    let uploadedUrl;
    try {
      uploadedUrl = await withTimeout(uploadBase64Image(screenshot), UPLOAD_TIMEOUT_MS, 'upload');
    } catch (uploadErr) {
      log('Upload failed/timed out for ' + orderId + ': ' + uploadErr.message);
      // If upload failed, store base64 directly — verification engine will use raw screenshot
      uploadedUrl = screenshot;
    }
    log('Upload done for ' + orderId + ': ' + (Date.now() - t0) + 'ms, url=' + (uploadedUrl ? uploadedUrl.substring(0, 60) + '...' : 'base64'));

    // Re-activate expired orders
    let order = await getPaymentOrder(orderId);
    if (!order) { sendJSON(404, { error: 'Order not found' }); return; }
    if (order.status === 'expired') {
      log('Re-activating expired order ' + orderId);
      const newExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await updateDoc(COL_ORDERS, orderId, {
        status: 'pending', verification_status: null, verification_score: null,
        ocr_result: null, rejection_reasons: [], screenshot_url: null,
        expires_at: newExpiresAt, updated_at: now(),
      }).catch(() => {});
    }
    if (order.status === 'verified') {
      sendJSON(200, { orderId, status: 'verified', message: 'Order already verified' });
      return;
    }

    // Store screenshot on order + upi_payments
    await updateDoc(COL_ORDERS, orderId, {
      status: 'pending',
      verification_status: 'pending',
      screenshot_url: uploadedUrl,
      utr: utr || null,
      updated_at: now(),
    }).catch(e => log('DB update failed: ' + e.message));

    // Update upi_payments
    try {
      const searchField = order.pending_reg_id ? 'pending_reg_id' : 'user_id';
      const searchValue = order.pending_reg_id || order.user_id;
      if (searchValue) {
        const ups = await runQuery(COL_UPI_PAYMENTS, [
          { field: searchField, op: 'EQUAL', value: searchValue },
        ], { limit: 5 });
        for (const p of ups) {
          await updateDoc(COL_UPI_PAYMENTS, p.id, {
            screenshot_url: uploadedUrl, utr: utr || p.utr, verification_locked: false,
          }).catch(() => {});
        }
      }
    } catch (e) { log('upi_payments update failed: ' + e.message); }

    try { broadcast('paymentUpdated', { orderId, status: 'pending' }); } catch {}

    const storeTime = Date.now() - t0;
    log('Proof stored for ' + orderId + ' in ' + storeTime + 'ms — returning processing immediately');

    // Return "processing" immediately — frontend polls for result
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

    // ── PHASE 2: Background verification — fire and forget ──
    storeProofAndVerify(orderId, uploadedUrl, utr, upiId).catch(e => {
      log('Background verify unhandled error: ' + e.message);
    });

  } catch (err) {
    console.error('[SUBMIT-PROOF] Error:', err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};
