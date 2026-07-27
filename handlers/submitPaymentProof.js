const { submitPaymentProof, retryPaymentOrder } = require('../api/_paymentOrderManager.js');
const r2 = require('../api/_r2.js');

function getPublicUrl(key) {
  const bucket = process.env.R2_BUCKET || 'jtsb-payments';
  const domain = process.env.R2_PUBLIC_DOMAIN || `${bucket}.r2.cloudflarestorage.com`;
  return `https://${domain}/${key}`;
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
  if (!buffer[0] === 0xFF && !(buffer[0] === 0x89 && buffer[1] === 0x50)) {
    throw new Error('Invalid image format');
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
    } catch (e) { console.warn('[submitPaymentProof] Supabase upload failed, falling back to base64:', e.message); }
  }

  return base64DataUrl;
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

    const uploadStart = Date.now();
    const uploadedUrl = await uploadBase64Image(screenshot);
    console.log('[submitPaymentProof] Upload: ' + (Date.now() - uploadStart) + 'ms, order=' + orderId);

    const verifyStart = Date.now();
    let result;
    try {
      result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null, userEnteredUpi: upiId });
    } catch (verifyErr) {
      // Auto-retry on expired order — re-activate and try again once
      if (verifyErr.message === 'Order expired' || verifyErr.message === 'Order not found') {
        console.log('[submitPaymentProof] Order expired/not-found, auto-retrying via retryPaymentOrder for ' + orderId);
        try {
          await retryPaymentOrder(orderId);
          result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null, userEnteredUpi: upiId });
        } catch (retryErr) {
          throw retryErr;
        }
      } else {
        throw verifyErr;
      }
    }
    console.log('[submitPaymentProof] Total: ' + (Date.now() - verifyStart) + 'ms, status=' + result.status + ', score=' + (result.verificationScore || 0));

    sendJSON(200, {
      ...result,
      message: result.status === 'verified'
        ? 'Payment verified successfully'
        : result.status === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for verification',
    });
  } catch (err) {
    console.error('[submitPaymentProof] Error:', err.message, err.stack);
    sendJSON(err.status || 500, { error: err.message || 'Internal server error' });
  }
};
