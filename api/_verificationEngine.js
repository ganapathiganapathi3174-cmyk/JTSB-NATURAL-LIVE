const { COL_UPI_PAYMENTS } = require('./_shared.js');
const { runQuery } = require('./_supabase.js');
const metrics = require('./_metrics.js');

function getAI() {
  return require('./_ai_bridge.js');
}

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [ENGINE] ' + msg);
}

async function runVerification(payment) {
  const paymentId = payment.id;
  const amountNum = Number(payment.amount) || 0;
  const expectedUpiId = (payment.upi_id || '').toLowerCase().trim();
  const expectedUtr = (payment.utr || '').toUpperCase().trim();
  const startTime = Date.now();

  const report = {
    paymentId,
    status: 'manual_review',
    reasons: [],
    verificationScore: 0,
    verificationDuration: 0,
    autoVerified: false,
    manualReviewRequired: true,
    ocrData: null,
    aiResult: null,
    // Backward-compat fields for processPendingPayments
    fraudScore: 0,
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
  };

  try {
    log('=== Verify payment ' + paymentId + ' ===');
    log('Amount=' + amountNum + ', UPI=' + expectedUpiId + ', UTR=' + (expectedUtr ? expectedUtr.substring(0, 6) + '****' : '—'));

    // PHASE 0: SCREENSHOT CHECK
    if (!payment.screenshot_url) {
      log('No screenshot uploaded');
      report.status = 'manual_review';
      report.reasons.push('No screenshot uploaded');
      report.manualReviewRequired = true;
      report.verificationDuration = Date.now() - startTime;
      return report;
    }

    // PHASE 1: AI ENGINE
    log('Running AI Engine...');
    let aiOutput = null;
    let lastAiError = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        log('Attempt ' + attempt + '/2...');
        aiOutput = await getAI().analyzeWithAI(payment.screenshot_url, {
          amount: amountNum,
          receiverUpi: expectedUpiId,
          utr: expectedUtr,
          date: payment.payment_date,
        });
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

    const mapped = getAI().mapAIResultToVerificationFormat(aiOutput);
    const { ocrResult, parsed, aiResult } = mapped;
    report.ocrData = ocrResult;
    report.aiResult = aiResult;

    const aiSuccess = aiResult && aiResult.status !== 'failed' && !aiOutput.error;
    metrics.trackOCR(aiSuccess);

    if (!aiSuccess) {
      log('AI Engine failed');
      report.status = 'manual_review';
      report.reasons.push('AI engine could not analyze screenshot');
      report.manualReviewRequired = true;
      report.verificationDuration = Date.now() - startTime;
      return report;
    }

    // Populate backward-compat fields from AI output
    const presence = parsed?.presence || {};
    const mf = parsed?.matchedFields || {};
    report.matchedAmount = presence.amount?.found || false;
    report.matchedReceiver = presence.upi_id?.found || false;
    report.matchedUtr = presence.utr?.found || false;
    report.matchedDate = presence.date?.found || false;

    // Backward-compat ocrData fields for processPendingPayments
    if (report.ocrData) {
      report.ocrData.ocrText = '';
      report.ocrData.confidence = 0;
      report.ocrData.extractedAmount = presence.amount?.found ? String(amountNum) : null;
      report.ocrData.extractedUtr = presence.utr?.found ? expectedUtr : null;
      report.ocrData.extractedReceiverUpi = presence.upi_id?.found ? expectedUpiId : null;
      report.ocrData.extractedSenderUpi = null;
      report.ocrData.extractedDate = presence.date?.found ? (presence.date?.expected || null) : null;
      report.ocrData.extractedTime = null;
      report.ocrData.extractedStatus = null;
      report.ocrData.extractedBankName = null;
      report.ocrData.extractedTxnId = null;
      report.ocrData.wordCount = 0;
      report.ocrData.ambiguous = false;
    }

    log('AI: ' + aiResult.status + ', reasons=' + aiResult.reasons.join('; '));

    // PHASE 2: DUPLICATE CHECK (DB-side)
    const screenshotHash = aiOutput.stages.stage1_opencv?.perceptualHash || '';
    const recentPayments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 500 }).catch(() => []);
    const dupReasons = [];

    if (expectedUtr) {
      const dupUtr = recentPayments.filter(d =>
        d.id !== paymentId && d.utr && d.utr.toUpperCase() === expectedUtr && d.status !== 'rejected'
      );
      if (dupUtr.length > 0) {
        dupReasons.push('Duplicate UTR — payment ' + dupUtr[0].id);
      }
    }
    if (screenshotHash) {
      const dupHash = recentPayments.filter(d =>
        d.id !== paymentId && d.screenshot_hash === screenshotHash && d.status !== 'rejected'
      );
      if (dupHash.length > 0) {
        dupReasons.push('Same screenshot as payment ' + dupHash[0].id);
      }
    }

    // PHASE 3: FINAL DECISION
    let finalStatus = aiResult.status;
    let finalReasons = [...aiResult.reasons];

    if (dupReasons.length > 0) {
      finalStatus = 'rejected';
      finalReasons = ['Duplicate payment detected'].concat(dupReasons);
    }

    report.status = finalStatus;
    report.reasons = finalReasons;
    report.autoVerified = finalStatus === 'approved' || finalStatus === 'rejected';
    report.manualReviewRequired = finalStatus === 'manual_review';
    report.verificationScore = finalStatus === 'approved' ? 100 : (finalStatus === 'rejected' ? 0 : 50);
    report.fraudScore = dupReasons.length > 0 ? 80 : 0;
    report.verificationDuration = Date.now() - startTime;

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
