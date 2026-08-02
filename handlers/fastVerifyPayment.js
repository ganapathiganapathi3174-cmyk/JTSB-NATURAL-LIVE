const { submitPaymentProof } = require('../api/_paymentOrderManager.js');
const r2 = require('../api/_r2.js');

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [FAST-VERIFY] ' + msg);
}

async function uploadBase64Image(base64DataUrl) {
  if (!base64DataUrl || !base64DataUrl.startsWith('data:')) return base64DataUrl;
  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return base64DataUrl;
  const mimeType = matches[1];
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const buffer = Buffer.from(matches[2], 'base64');
  if (buffer.length > 10 * 1024 * 1024) throw new Error('Image too large (max 10MB)');
  const key = 'payments/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.' + ext;

  try {
    const r2Result = await r2.uploadFile(key, buffer, mimeType);
    if (r2Result && r2Result.url) return r2Result.url;
  } catch (e) { log('R2 upload failed: ' + e.message + ' (falling back)'); }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
      const { error } = await supabase.storage.from('payments').upload(key, buffer, { contentType: mimeType, upsert: false });
      if (!error) {
        const { data: urlData } = supabase.storage.from('payments').getPublicUrl(key);
        return urlData.publicUrl;
      } else {
        log('Supabase storage upload error: ' + error.message);
      }
    } catch (e) { log('Supabase storage upload failed: ' + e.message); }
  }
  return base64DataUrl;
}

module.exports = async (req, res) => {
  const sendJSON = (code, data) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { sendJSON(405, { error: 'Method not allowed' }); return; }

  try {
    const { orderId, screenshot, utr, upiId, clientOcr } = req.body || {};
    if (!orderId) { sendJSON(400, { error: 'orderId required' }); return; }
    if (!screenshot) { sendJSON(400, { error: 'screenshot required' }); return; }

    // Upload screenshot
    let screenshotUrl = screenshot;
    try {
      screenshotUrl = await uploadBase64Image(screenshot);
    } catch (e) {
      log('Upload failed: ' + e.message + ' (continuing with base64)');
    }

    // ⚠️ SECURITY: clientOcr is IGNORED for the decision. All verification runs
    // server-side through the V7 engine. Client OCR fields are never trusted.
    if (clientOcr) {
      log('clientOcr supplied for order ' + orderId + ' but ignored (server-side verification only)');
    }

    // Unified server-side verification path (V7 engine + business rules + fraud).
    // Never trusts client-supplied OCR/UTR/UPI for auto-approval.
    const result = await submitPaymentProof(orderId, screenshotUrl, {
      userEnteredUtr: utr || null,
      userEnteredUpi: upiId || null,
    });

    const status = result.status || 'manual_review';
    sendJSON(200, {
      orderId,
      paymentId: result.paymentId,
      status,
      verificationScore: result.verificationScore,
      verificationStatus: result.verificationStatus || status,
      autoVerified: status === 'verified',
      manualReviewRequired: status === 'manual_review',
      reasons: result.reasons || [],
      checks: result.checks || [],
      ocrData: result.ocrData || null,
      matchedAmount: result.matchedAmount || false,
      matchedReceiver: result.matchedReceiver || false,
      matchedUtr: result.matchedUtr || false,
      matchedDate: result.matchedDate || false,
      matchedStatus: result.matchedStatus || false,
      fraudScore: result.fraudScore || 0,
      userEnteredUtr: utr || null,
      message: status === 'verified'
        ? 'Payment verified successfully!'
        : status === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for manual review',
    });
  } catch (err) {
    log('Error: ' + err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};
