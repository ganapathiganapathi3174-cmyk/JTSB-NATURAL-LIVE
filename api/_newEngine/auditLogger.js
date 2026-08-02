const { COL_VERIFICATION_LOGS } = require('../_shared.js');
const { addDocFiltered } = require('../_supabase.js');

// Columns the audit record writes that only exist after the migration 0004
// (verification_logs additions) is applied. addDocFiltered probes each and
// strips any that the live table lacks, so a pending migration never aborts
// the whole audit INSERT.
const VERIFICATION_LOG_OPTIONAL_COLS = [
  'confidence', 'reasons', 'matched_fields', 'extracted_fields', 'checks',
  'fraud_score', 'fraud_flags', 'ocr_engines', 'duplicate_check',
  'decision_factors', 'stages', 'duration_ms',
];

async function recordAudit(paymentId, result) {
  try {
    await addDocFiltered(COL_VERIFICATION_LOGS, {
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
    }, VERIFICATION_LOG_OPTIONAL_COLS);
    return true;
  } catch {
    return false;
  }
}

module.exports = { recordAudit };
