const crypto = require('crypto');
const { submitPaymentProof } = require('../api/_paymentOrderManager.js');
const { runQuery } = require('../api/_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID } = require('../api/_shared.js');
const { broadcast } = require('../api/_sse.js');
const r2 = require('../api/_r2.js');

const ACCEPTED_STATUSES = ['SUCCESS', 'SUCCESSFUL', 'CREDITED', 'PAID', 'DEBIT_SUCCESS', 'COMPLETED'];
const ALLOWED_AMOUNTS = [1, 120, 500, 1000];

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [FAST-VERIFY] ' + msg);
}

function normalizeUpi(u) {
  return (u || '').toLowerCase().replace(/\s/g, '').trim();
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const nowIST = new Date(now.getTime() + 5.5 * 3600000);
  const todayStr = nowIST.toISOString().slice(0, 10);
  if (dateStr === todayStr) return true;
  const yesterdayIST = new Date(nowIST.getTime() - 86400000);
  if (dateStr === yesterdayIST.toISOString().slice(0, 10)) return true;
  return false;
}

function isWithinOneHour(timeStr) {
  if (!timeStr) return false;
  const now = new Date();
  const nowIST = new Date(now.getTime() + 5.5 * 3600000);
  const parts = timeStr.match(/(\d{1,2})[:\s](\d{2})/);
  if (!parts) return false;
  let h = parseInt(parts[1], 10);
  const m = parseInt(parts[2], 10);
  const extractedMs = h * 3600000 + m * 60000;
  const nowMs = nowIST.getHours() * 3600000 + nowIST.getMinutes() * 60000;
  const diff = Math.abs(nowMs - extractedMs);
  return diff <= 3600000;
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
  } catch (_) {}

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
      }
    } catch (_) {}
  }
  return base64DataUrl;
}

async function checkUtrDuplicate(utr, excludeId) {
  if (!utr) return null;
  try {
    const clean = utr.toUpperCase().trim();
    const payments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 2000 });
    const dup = payments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === clean &&
      p.status !== 'rejected' && p.id !== excludeId
    );
    if (dup) return 'UTR already used (payment ' + dup.id + ')';
  } catch (_) {}
  return null;
}

async function fastValidate(order, clientOcr) {
  const t0 = Date.now();
  const checks = [];
  const reasons = [];
  const expectedAmount = Number(order.amount) || 0;
  const extracted = clientOcr.extracted || {};
  const ocrConfidence = clientOcr.confidence || 0;

  log('Validating order=' + order.id + ' expected=' + expectedAmount + ' ocrConf=' + ocrConfidence);

  // Check 1: Amount match
  const extAmount = parseFloat(String(extracted.amount || '').replace(/[^0-9.]/g, ''));
  const amountOk = extAmount > 0 && Math.abs(expectedAmount - extAmount) < 0.01;
  checks.push({ name: 'amount', passed: amountOk, expected: expectedAmount, extracted: extAmount });
  if (!amountOk) reasons.push('Amount mismatch: expected ₹' + expectedAmount + ', got ₹' + extAmount);

  // Check 2: Receiver UPI
  const expectedUpi = normalizeUpi(ADMIN_UPI_ID);
  const extReceiver = normalizeUpi(extracted.receiverUpi || '');
  const receiverOk = extReceiver && (extReceiver === expectedUpi || extReceiver.startsWith(expectedUpi.split('@')[0]));
  checks.push({ name: 'receiver', passed: receiverOk, expected: expectedUpi, extracted: extReceiver });
  if (!receiverOk) reasons.push('Receiver UPI mismatch: expected ' + expectedUpi + ', got ' + (extReceiver || 'none'));

  // Check 3: UTR format
  const extUtr = (extracted.utr || '').trim();
  const utrOk = extUtr.length >= 8 && /^[A-Za-z0-9]+$/.test(extUtr);
  checks.push({ name: 'utr', passed: utrOk, value: extUtr });
  if (!utrOk) reasons.push('Invalid UTR format: "' + extUtr + '"');

  // Check 4: Payment status
  const extStatus = (extracted.paymentStatus || '').toUpperCase();
  const statusOk = ACCEPTED_STATUSES.includes(extStatus);
  checks.push({ name: 'status', passed: statusOk, value: extStatus });
  if (!statusOk) reasons.push('Payment status "' + extStatus + '" is not SUCCESS');

  // Check 5: Date check
  const extDate = extracted.date || '';
  const dateOk = isToday(extDate);
  checks.push({ name: 'date', passed: dateOk, value: extDate });
  if (!dateOk && extDate) reasons.push('Payment date ' + extDate + ' is not today/yesterday');

  // Check 6: Time check
  const extTime = extracted.time || '';
  const timeOk = isWithinOneHour(extTime);
  checks.push({ name: 'time', passed: timeOk, value: extTime });

  // Check 7: OCR confidence
  const confOk = ocrConfidence >= 50;
  checks.push({ name: 'confidence', passed: confOk, value: ocrConfidence });

  // Check 8: Raw text basic sanity
  const rawText = (clientOcr.rawText || '').toLowerCase();
  const hasPaymentKeywords = rawText.includes('paid') || rawText.includes('sent') || rawText.includes('debited') || rawText.includes('success') || rawText.includes('upi');
  checks.push({ name: 'text_sanity', passed: hasPaymentKeywords });

  // Decision: require amount + receiver to pass; everything else can be softer
  const mandatoryPassed = amountOk && receiverOk;
  const failedChecks = checks.filter(c => !c.passed).map(c => c.name);

  let decision, confidence;
  if (mandatoryPassed && failedChecks.length <= 1) {
    decision = 'verified';
    confidence = Math.min(99, 70 + ocrConfidence * 0.2);
    reasons.length = 0;
    reasons.push('All checks passed');
  } else if (!amountOk || !receiverOk) {
    decision = 'manual_review';
    confidence = Math.max(0, 50 - failedChecks.length * 10);
  } else {
    decision = 'manual_review';
    confidence = Math.max(10, 60 - failedChecks.length * 5);
  }

  const duration = Date.now() - t0;
  log('Decision: ' + decision + ' score=' + confidence + ' failed=' + failedChecks.join(',') + ' time=' + duration + 'ms');

  return {
    status: decision,
    verificationScore: Math.round(confidence * 10) / 10,
    verificationDuration: duration,
    autoVerified: decision === 'verified',
    manualReviewRequired: decision === 'manual_review',
    reasons,
    checks,
    ocrData: {
      rawText: clientOcr.rawText || '',
      extractedAmount: extracted.amount || '',
      extractedUtr: extracted.utr || '',
      extractedReceiverName: extracted.receiverUpi || '',
      extractedSenderVpa: extracted.senderUpi || '',
      extractedDate: extracted.date || '',
      extractedTime: extracted.time || '',
      extractedPaymentStatus: extracted.paymentStatus || '',
      confidence: ocrConfidence,
      source: 'client_ocr',
    },
    matchedAmount: amountOk,
    matchedReceiver: receiverOk,
    matchedUtr: utrOk,
    matchedDate: dateOk,
    matchedStatus: statusOk,
    fraudScore: 0,
    fraudFlags: [],
    duplicateUtrDetected: false,
  };
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
    if (!clientOcr) { sendJSON(400, { error: 'clientOcr data required (run client OCR first)' }); return; }

    // Upload screenshot
    let screenshotUrl = screenshot;
    try {
      screenshotUrl = await uploadBase64Image(screenshot);
    } catch (e) {
      log('Upload failed: ' + e.message + ' (continuing with base64)');
    }

    // Get order from DB
    const { getDoc } = require('../api/_supabase.js');
    const { COL_ORDERS } = require('../api/_shared.js');
    const order = await getDoc(COL_ORDERS, orderId);
    if (!order) { sendJSON(404, { error: 'Order not found' }); return; }
    if (order.status === 'expired') { sendJSON(400, { error: 'Order expired' }); return; }
    if (order.status === 'verified') { sendJSON(400, { error: 'Order already verified' }); return; }

    // Fast validation with client OCR data
    const validation = await fastValidate(order, clientOcr);

    // Check UTR duplicate (async)
    const extUtr = clientOcr.extracted?.utr || utr;
    const utrDup = await checkUtrDuplicate(extUtr, orderId);
    if (utrDup) {
      validation.status = 'manual_review';
      validation.checks.push({ name: 'utr_duplicate', passed: false });
      validation.reasons.push(utrDup);
      validation.duplicateUtrDetected = true;
    }

    // Update order in DB
    const { updateDoc } = require('../api/_supabase.js');
    await updateDoc(COL_ORDERS, orderId, {
      status: validation.status === 'verified' ? 'verified' : validation.status,
      verification_status: validation.status,
      verification_score: validation.verificationScore,
      ocr_result: validation.ocrData,
      rejection_reasons: validation.reasons,
      updated_at: new Date().toISOString(),
    }).catch(e => log('Order update failed: ' + e.message));

    // If approved, execute the order (create user, credit wallet, etc.)
    const { executeVerifiedOrder } = require('../api/_paymentOrderManager.js');
    if (validation.status === 'verified') {
      log('Auto-approved order ' + orderId + ', executing post-approval');
      try {
        await executeVerifiedOrder(order, validation, {
          userId: order.user_id,
          pendingRegId: order.pending_reg_id,
          userEnteredUtr: utr || null,
        });
      } catch (e) {
        log('Post-approval failed: ' + e.message);
      }
    }

    // Update upi_payments
    try {
      const searchField = order.pending_reg_id ? 'pending_reg_id' : 'user_id';
      const searchValue = order.pending_reg_id || order.user_id;
      if (searchValue) {
        const ups = await runQuery(COL_UPI_PAYMENTS, [
          { field: searchField, op: 'EQUAL', value: searchValue },
        ], { limit: 5 });
        for (const p of ups) {
          await require('../api/_supabase.js').updateDoc(COL_UPI_PAYMENTS, p.id, {
            status: validation.status === 'verified' ? 'verified' : validation.status,
            screenshot_url: screenshotUrl,
            utr: extUtr || p.utr,
            ocr_result: validation.ocrData,
            final_score: validation.verificationScore,
            verification_locked: false,
            verified_at: new Date().toISOString(),
            verification_completed_at: new Date().toISOString(),
          }).catch(() => {});
        }
      }
    } catch (e) {
      log('upi_payments update failed: ' + e.message);
    }

    // Broadcast SSE
    try {
      broadcast('paymentUpdated', { orderId, status: validation.status, type: order.type || 'unknown' });
    } catch (_) {}

    sendJSON(200, {
      orderId,
      status: validation.status,
      verificationScore: validation.verificationScore,
      verificationStatus: validation.status,
      autoVerified: validation.autoVerified,
      reasons: validation.reasons,
      checks: validation.checks,
      ocrData: validation.ocrData,
      matchedAmount: validation.matchedAmount,
      matchedReceiver: validation.matchedReceiver,
      matchedUtr: validation.matchedUtr,
      matchedDate: validation.matchedDate,
      matchedStatus: validation.matchedStatus,
      fraudScore: validation.fraudScore,
      userEnteredUtr: utr || null,
      message: validation.status === 'verified'
        ? 'Payment verified successfully!'
        : validation.status === 'rejected'
          ? 'Payment verification failed'
          : 'Payment submitted for manual review',
    });
  } catch (err) {
    log('Error: ' + err.message);
    sendJSON(err.status || 500, { error: 'Internal server error' });
  }
};
