const path = require('path');
const fs = require('fs');
const engine = require('../_newEngine/index.js');

const buf = fs.readFileSync(path.join(__dirname, 'synthetic_screenshot.png'));
const order = { id: 'ORD-TRACE-1', type: 'registration', amount: 120, pending_reg_id: 'reg-test' };

const t0 = Date.now();
engine.run(order, null, null, null, null, buf).then(res => {
  console.log('=== V7 ENGINE TRACE (local) ===');
  console.log('status:', res.status);
  console.log('confidence:', res.confidence);
  console.log('ocrConfidence:', res.ocrConfidence, 'ocrEngines:', res.ocrEngines);
  console.log('extractedFields:', JSON.stringify(res.extractedFields, null, 2));
  console.log('normalizedFields:', JSON.stringify(res.normalizedFields, null, 2));
  console.log('matchResults:', JSON.stringify(res.matchResults, null, 2));
  console.log('reasons:', res.reasons);
  console.log('fraudScore:', res.fraudScore, 'fraudFlags:', res.fraudFlags);
  console.log('duplicateCheck:', res.duplicateCheck);
  console.log('decisionFactors:', JSON.stringify(res.decisionFactors, null, 2));
  console.log('riskScore:', res.riskScore, 'riskLevel:', res.riskLevel);
  console.log('stages:', JSON.stringify(res.stages, null, 2));
  console.log('durationMs:', res.durationMs);
  console.log('OCR RAW (first 500):');
  console.log((res.ocrData && res.ocrData.raw || '').substring(0, 500));
  console.log('=== total wall: ' + (Date.now() - t0) + 'ms ===');
}).catch(e => {
  console.error('ENGINE ERROR:', e.message, e.stack);
  process.exit(1);
});
