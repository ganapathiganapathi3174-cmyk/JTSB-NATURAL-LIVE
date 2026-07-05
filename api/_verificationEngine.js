const { analyzeScreenshot } = require('./_enhancedOcr.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS } = require('./_shared.js');
const metrics = require('./_metrics.js');

const OCR_THRESHOLD = 60;
const DUPLICATE_UTR_WINDOW_MS = 24 * 60 * 60 * 1000;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [ENGINE] ' + msg);
}

async function analyzeImageIntegrity(imageUrl) {
  try {
    const https = require('https');
    const http = require('http');
    const u = new URL(imageUrl);
    const mod = u.protocol === 'https:' ? https : http;
    const buf = await new Promise((resolve, reject) => {
      mod.get(imageUrl, { timeout: 15000 }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
    const { analyzeImageQuality } = require('./_imageQuality.js');
    const quality = await analyzeImageQuality(buf);
    return { passed: quality.passed, grade: quality.overallGrade, issues: quality.issues, warnings: quality.warnings, blurScore: quality.blurScore, cropRatio: quality.cropRatio, dimensions: quality.dimensions };
  } catch (e) {
    log('Image integrity check failed: ' + e.message);
    return { passed: true, grade: 'unknown', issues: ['Could not analyze image: ' + e.message], warnings: [], blurScore: 0, cropRatio: 1.0, dimensions: { width: 0, height: 0 } };
  }
}

async function runVerification(order, screenshotUrl) {
  const startTime = Date.now();
  const expectedAmount = Number(order.amount || order.expected_amount) || 0;
  const expectedUpi = ((order.expected_upi_id || order.upi_id || '')).toLowerCase().trim();
  const expectedUtr = (order.utr || '').toUpperCase().trim();
  const expectedDate = order.payment_date || order.payment_date || order.created_at || new Date().toISOString().split('T')[0];
  const type = order.type || order.order_type || order.payment_type || 'unknown';
  const orderId = order.id;

  const report = {
    status: 'manual_review',
    reasons: [],
    verificationScore: 0,
    verificationDuration: 0,
    ocrData: null,
    fraudScore: 0,
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
    steps: [],
    imageQuality: null,
  };

  try {
    log('=== Verify order ' + orderId + ' ===');
    log('Type=' + type + ', Amount=' + expectedAmount + ', ExpectedUPI=' + expectedUpi);

    if (!screenshotUrl) {
      report.status = 'manual_review';
      report.reasons.push('No screenshot provided');
      report.verificationDuration = Date.now() - startTime;
      return report;
    }

    // PHASE 1: OCR + AI ANALYSIS
    log('Running OCR/AI analysis...');
    let aiOutput = null;
    let lastAiError = null;
    let ocrResult = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt === 1) {
          const { analyzeWithAI, mapAIResultToVerificationFormat } = require('./_ai_bridge.js');
          aiOutput = await analyzeWithAI(screenshotUrl, {
            amount: expectedAmount,
            receiverUpi: expectedUpi,
            utr: expectedUtr,
            date: expectedDate,
          });
        } else {
          ocrResult = await analyzeScreenshot(screenshotUrl);
        }
        if (aiOutput && !aiOutput.error) {
          lastAiError = null;
          break;
        }
        if (aiOutput && aiOutput.error) {
          lastAiError = new Error(aiOutput.error);
          log('Attempt ' + attempt + ' error: ' + aiOutput.error);
        }
      } catch (e) {
        lastAiError = e;
        log('Attempt ' + attempt + ' failed: ' + e.message);
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }

    if (aiOutput && !aiOutput.error) {
      const { mapAIResultToVerificationFormat } = require('./_ai_bridge.js');
      const mapped = mapAIResultToVerificationFormat(aiOutput);
      ocrResult = mapped.ocrResult;
      report.steps.push({ name: 'ai_analysis', passed: true, engines: ocrResult.engines || [] });
    } else if (ocrResult && ocrResult.ocrAvailable) {
      report.steps.push({ name: 'ocr_fallback', passed: true, confidence: ocrResult.confidence });
    } else {
      report.status = 'manual_review';
      report.reasons.push('AI/OCR engine could not analyze screenshot');
      report.verificationDuration = Date.now() - startTime;
      metrics.trackOCR(false);
      return report;
    }

    const confidence = ocrResult.confidence || 0;
    if (confidence < OCR_THRESHOLD) {
      report.status = 'manual_review';
      report.reasons.push('OCR confidence too low: ' + confidence + '%');
      report.verificationDuration = Date.now() - startTime;
      metrics.trackOCR(false);
      return report;
    }
    metrics.trackOCR(true);

    const presence = aiOutput ? (aiOutput.matched_fields || {}) : {};
    const extractedAmount = presence.amount?.found ? Number(presence.amount?.value || expectedAmount) : null;
    const extractedUtr = presence.utr?.found ? (presence.utr?.value || '') : '';
    const extractedReceiverUpi = presence.upi_id?.found ? (presence.upi_id?.value || '') : '';
    const extractedDate = presence.date?.found ? (presence.date?.value || '') : '';
    const extractedStatus = aiOutput?.stages?.stage7_quality?.paymentStatus || '';

    const matchAmount = extractedAmount !== null && Math.abs(extractedAmount - expectedAmount) < 0.01;
    const matchUtr = extractedUtr && extractedUtr.length >= 12;
    const matchUpi = extractedReceiverUpi && expectedUpi && extractedReceiverUpi.toLowerCase().includes(expectedUpi.split('@')[0] || expectedUpi.toLowerCase());
    const matchStatus = extractedStatus && extractedStatus.toUpperCase().includes('SUCCESS');
    const matchDate = extractedDate ? true : false;

    report.ocrData = {
      ...ocrResult,
      extractedAmount: extractedAmount || null,
      extractedUtr: extractedUtr || null,
      extractedReceiverUpi: extractedReceiverUpi || null,
      extractedSenderUpi: extractedReceiverUpi || null,
      extractedDate: extractedDate || null,
      extractedTime: null,
      extractedStatus: extractedStatus || null,
      extractedBankName: null,
      wordCount: ocrResult.rawTextLen || 0,
      ambiguous: false,
    };
    report.matchedAmount = matchAmount;
    report.matchedReceiver = matchUpi;
    report.matchedUtr = matchUtr;
    report.matchedDate = matchDate;
    report.steps.push({ name: 'amount_match', passed: matchAmount, extracted: extractedAmount, expected: expectedAmount });
    report.steps.push({ name: 'upi_match', passed: matchUpi, extracted: extractedReceiverUpi, expected: expectedUpi });
    report.steps.push({ name: 'utr_match', passed: matchUtr, extracted: extractedUtr ? 'present' : 'missing' });
    report.steps.push({ name: 'status_match', passed: matchStatus, extracted: extractedStatus });

    // PHASE 2: IMAGE INTEGRITY
    log('Checking image integrity...');
    const imageQuality = await analyzeImageIntegrity(screenshotUrl);
    report.imageQuality = imageQuality;
    report.steps.push({ name: 'image_quality', passed: imageQuality.passed, grade: imageQuality.grade, issues: imageQuality.issues });

    if (!imageQuality.passed) {
      const criticalIssues = imageQuality.issues.filter(i => i.includes('blur') || i.includes('dark') || i.includes('cropped') || i.includes('poor'));
      if (criticalIssues.length > 0) {
        report.reasons.push('Image quality issues: ' + criticalIssues.join(', '));
      }
    }

    // PHASE 3: DUPLICATE CHECK
    log('Checking duplicates...');
    let dupReasons = [];
    if (matchUtr) {
      try {
        const recentPayments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 500 });
        const dupUtr = recentPayments.filter(d =>
          d.utr && d.utr.toUpperCase() === extractedUtr.toUpperCase() && d.status !== 'rejected'
        );
        if (dupUtr.length > 0) {
          dupReasons.push('Duplicate UTR detected with payment ' + dupUtr[0].id);
        }
      } catch (e) {
        log('Duplicate check failed: ' + e.message);
      }
    }
    report.steps.push({ name: 'duplicate_check', passed: dupReasons.length === 0, reasons: dupReasons });

    // PHASE 4: RULE-BASED DECISION ENGINE
    const strongRejectSignals = [];
    if (!matchAmount) strongRejectSignals.push('amount_mismatch');
    if (!matchUpi) strongRejectSignals.push('upi_mismatch');
    if (!matchUtr) strongRejectSignals.push('utr_missing');
    if (!matchStatus) strongRejectSignals.push('payment_not_success');
    if (dupReasons.length > 0) strongRejectSignals.push('duplicate_utr');
    if (imageQuality.blurScore > 80) strongRejectSignals.push('image_blurred');
    if (imageQuality.cropRatio < 0.5) strongRejectSignals.push('image_cropped');

    let finalStatus = 'manual_review';
    let finalReasons = [];

    if (matchUtr && matchDate && matchAmount) {
      finalStatus = 'approved';
      finalReasons = ['UTR matched successfully', 'Amount matched successfully', 'Payment status verified'];
    } else if (strongRejectSignals.length >= 2) {
      finalStatus = 'rejected';
      finalReasons = dupReasons.length > 0 ? dupReasons : ['Multiple verification failures: ' + strongRejectSignals.slice(0, 2).join(', ')];
    } else if (strongRejectSignals.length === 1 && strongRejectSignals[0] !== 'amount_mismatch') {
      finalStatus = 'manual_review';
      finalReasons = ['Verification inconclusive: ' + strongRejectSignals.join(', ')];
    } else {
      finalStatus = 'manual_review';
      finalReasons = ['Insufficient verification confidence'];
    }

    report.status = finalStatus;
    report.reasons = finalReasons;
    report.autoVerified = finalStatus === 'approved' || finalStatus === 'rejected';
    report.manualReviewRequired = finalStatus === 'manual_review';
    report.verificationScore = finalStatus === 'approved' ? 100 : (finalStatus === 'rejected' ? 0 : 50);
    report.fraudScore = dupReasons.length > 0 ? 80 : 0;
    report.verificationDuration = Date.now() - startTime;

    if (finalStatus === 'approved') metrics.trackPaymentApproved('auto');
    else if (finalStatus === 'rejected') metrics.trackPaymentRejected('auto');
    else metrics.trackPaymentManualReview();

    log('DECISION: ' + finalStatus.toUpperCase() + ' — ' + finalReasons.join('; '));

  } catch (e) {
    log('Error: ' + e.message);
    report.status = 'manual_review';
    report.reasons = ['Verification error: ' + e.message];
    report.manualReviewRequired = true;
    report.verificationDuration = Date.now() - startTime;
  }

  return report;
}

module.exports = { runVerification };
