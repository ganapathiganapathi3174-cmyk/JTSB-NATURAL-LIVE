const log = require('./logger').AUDIT;

function createEntry(order, result, pipelineData) {
  const ocr = result.ocrData || {};
  const vm = (pipelineData.validationMap) || {};

  const entry = {
    timestamp: new Date().toISOString(),
    engineVersion: '5.1.0',

    // Payment Type & Screenshot
    paymentType: result.paymentType || order.type || 'unknown',
    originalScreenshot: order.screenshot_url || null,

    // Extracted OCR Fields
    extractedAmount: ocr.amount || null,
    selectedPackage: result.selectedPackage || order.amount || null,
    receiverName: ocr.receiverName || null,
    receiverUpi: ocr.receiverUpi || null,
    transactionId: ocr.transactionId || null,
    utr: ocr.utr || null,
    paymentDate: ocr.date || null,
    paymentTime: ocr.time || null,

    // Validation Results
    duplicateCheckResult: pipelineData.duplicateFound ? 'DUPLICATE_FOUND' : 'NO_DUPLICATE',
    fraudDetectionResult: (pipelineData.fraudFlags && pipelineData.fraudFlags.length > 0) ? 'FRAUD_FLAGS: ' + pipelineData.fraudFlags.join('; ') : 'NO_FRAUD',
    businessValidationResult: pipelineData.businessValidationResult || 'UNKNOWN',

    // Confidence & Decision
    confidenceScore: pipelineData.ocrConfidence || 0,
    finalDecision: result.status || 'unknown',
    exactReason: (result.reasons && result.reasons.length > 0) ? result.reasons.join(' | ') : 'No reasons recorded',

    // Metadata
    finalScore: result.verificationScore || 0,
    autoVerified: result.autoVerified || false,
    manualReviewRequired: result.manualReviewRequired || false,
    verificationDuration: result.verificationDuration || 0,
    fraudScore: result.fraudScore || 0,
    screenshotHash: result.screenshotHash || '',
    userId: order.user_id || null,
    paymentId: order.id || null,
  };

  log.info('Audit entry: ' + (order.id || 'unknown') + ' -> ' + entry.finalDecision + ' (conf=' + entry.confidenceScore + ')');
  return entry;
}

module.exports = { createEntry };