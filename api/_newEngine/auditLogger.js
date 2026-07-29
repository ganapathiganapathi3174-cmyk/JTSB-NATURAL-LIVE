const { COL_VERIFICATION_LOGS } = require('../_shared.js');
const { addDoc } = require('../_supabase.js');

async function recordAudit(paymentId, result) {
  try {
    await addDoc(COL_VERIFICATION_LOGS, {
      payment_id: paymentId,
      status: result.status,
      confidence: result.confidence || 0,
      reasons: result.reasons || [],
      matched_fields: result.matchedFields || {},
      extracted_fields: result.extractedFields || {},
      checks: result.checks || {},
      fraud_score: result.fraudScore || 0,
      fraud_flags: result.fraudFlags || [],
      ocr_engines: result.ocrEngines || 0,
      ocr_confidence: result.ocrConfidence || 0,
      duplicate_check: result.duplicateCheck || null,
      decision_factors: result.decisionFactors || {},
      stages: result.stages || {},
      duration_ms: result.durationMs || 0,
      created_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { recordAudit };
