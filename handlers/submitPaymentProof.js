const { submitPaymentProof } = require('../api/_paymentOrderManager.js');
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
  const reqStart = Date.now();
  const PH = (stage, data) => {
    const elapsed = Date.now() - reqStart;
    const prefix = '[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [submitPaymentProof]';
    if (data !== undefined) {
      console.log(prefix + ' [' + stage + '] +' + elapsed + 'ms', typeof data === 'object' ? JSON.stringify(data).substring(0, 200) : data);
    } else {
      console.log(prefix + ' [' + stage + '] +' + elapsed + 'ms');
    }
    if (elapsed > 3000) console.log(prefix + ' [BOTTLENECK] Stage "' + stage + '" took ' + elapsed + 'ms (exceeds 3s)');
  };
  const sendJSON = (statusCode, payload) => {
    if (res.headersSent) {
      PH('Response Already Sent (skipping)', statusCode);
      return;
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
    PH('Response Sent', { status: statusCode, success: !payload.error });
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { sendJSON(405, { error: 'Method not allowed' }); return; }

  PH('Request Received');

  const PIPELINE_TIMEOUT_MS = 26000;

  async function runPipeline() {
    const { orderId, screenshot, utr } = req.body || {};
    PH('Parsed Body', { hasOrderId: !!orderId, hasScreenshot: !!screenshot, hasUtr: !!utr });
    if (!orderId) { sendJSON(400, { error: 'orderId is required' }); return; }
    if (!screenshot) { sendJSON(400, { error: 'screenshot is required' }); return; }
    PH('Order Validation');

    const uploadedUrl = await uploadBase64Image(screenshot);
    PH('Image Uploaded', { urlLength: (uploadedUrl || '').length, isBase64: uploadedUrl?.startsWith('data:') });

    PH('Calling Verification Pipeline...');
    const result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null });
    PH('Verification Pipeline Complete', { status: result.status, score: result.verificationScore });

    const totalMs = Date.now() - reqStart;
    PH('Total Duration', totalMs + 'ms');
    sendJSON(200, {
      ...result,
      message: result.status === 'verified'
        ? 'Payment verified successfully'
        : 'Payment verification failed',
    });
  }

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Pipeline timed out after ' + (PIPELINE_TIMEOUT_MS / 1000) + 's')), PIPELINE_TIMEOUT_MS)
    );
    await Promise.race([runPipeline(), timeoutPromise]);
  } catch (err) {
    const totalMs = Date.now() - reqStart;
    PH('ERROR', err.message);
    console.error('[submitPaymentProof ERROR STACK]', err.stack || err.message);
    sendJSON(504, { error: 'Verification timed out. Please try again or contact support.' });
  }
};
