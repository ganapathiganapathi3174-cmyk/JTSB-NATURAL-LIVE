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
  const logTiming = (stage) => console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [submitPaymentProof TIMING] ' + stage + ' at +' + (Date.now() - reqStart) + 'ms');
  function bottleneckCheck(stage, elapsedMs) {
    if (elapsedMs > 3000) console.log(`[submitPaymentProof BOTTLENECK] ⚠️ Stage "${stage}" took ${elapsedMs}ms (exceeds 3s threshold)`);
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  logTiming('Request Received');

  try {
    const { orderId, screenshot, utr } = req.body || {};
    if (!orderId) { res.writeHead(400); res.end(JSON.stringify({ error: 'orderId is required' })); logTiming('Response Sent (missing orderId)'); return; }
    if (!screenshot) { res.writeHead(400); res.end(JSON.stringify({ error: 'screenshot is required' })); logTiming('Response Sent (missing screenshot)'); return; }
    logTiming('Order Validation');

    const uploadedUrl = await uploadBase64Image(screenshot);
    const uploadMs = Date.now() - reqStart - (Date.now() - reqStart - (Date.now() - reqStart));
    bottleneckCheck('Image Upload', Date.now() - reqStart - (reqStart));
    logTiming('Image Load');

    const result = await submitPaymentProof(orderId, uploadedUrl, { userEnteredUtr: utr || null });
    bottleneckCheck('Verification Pipeline', Date.now() - reqStart);
    logTiming('Response Sent');

    const totalMs = Date.now() - reqStart;
    bottleneckCheck('Total', totalMs);
    logTiming('Response Sent (total=' + totalMs + 'ms)');
    res.writeHead(200); res.end(JSON.stringify({
      ...result,
      message: result.status === 'verified'
        ? 'Payment verified successfully'
        : result.status === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for manual review',
    }));
  } catch (err) {
    const totalMs = Date.now() - reqStart;
    console.error(`[submitPaymentProof ERROR] at +${totalMs}ms:`);
    console.error(err.stack || err.message);
    bottleneckCheck('Error path', totalMs);
    if (!res.headersSent) {
      const status = err.status || 500;
      const devMsg = process.env.NODE_ENV !== 'production' ? err.message : 'Verification failed';
      res.writeHead(status); res.end(JSON.stringify({ error: devMsg }));
    }
    logTiming('Response Sent (error=' + (err.message || '') + ')');
  }
};
