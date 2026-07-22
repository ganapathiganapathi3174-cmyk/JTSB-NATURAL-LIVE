/**
 * E2E Tests for AI Pipeline + Upgrade Request System
 * 
 * Usage: node api/tests/test_upgrade_pipeline.js
 * 
 * Tests:
 * 1. AI Pipeline module existence
 * 2. Image integrity analysis
 * 3. Business rules validation
 * 4. Fraud detection
 * 5. Decision engine
 * 6. Voting engine
 * 7. Upgrade request handlers existence
 */

const path = require('path');
const fs = require('fs');

const API_DIR = path.join(__dirname, '..');
const HANDLERS_DIR = path.join(__dirname, '..', '..', 'handlers');

let passed = 0;
let failed = 0;
let warnings = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// === Module 1: AI Pipeline Modules ===
console.log('\n=== AI Pipeline Module Tests ===');

test('_imageIntegrity.js exports analyzeImageIntegrity', () => {
  const mod = require(path.join(API_DIR, '_imageIntegrity.js'));
  assert(typeof mod.analyzeImageIntegrity === 'function', 'analyzeImageIntegrity should be a function');
});

test('_aiVision.js exports analyzeWithAI', () => {
  const mod = require(path.join(API_DIR, '_aiVision.js'));
  assert(typeof mod.analyzeWithAI === 'function', 'analyzeWithAI should be a function');
});

test('_votingEngine.js exports runVoting and mergeWithExisting', () => {
  const mod = require(path.join(API_DIR, '_votingEngine.js'));
  assert(typeof mod.runVoting === 'function', 'runVoting should be a function');
  assert(typeof mod.mergeWithExisting === 'function', 'mergeWithExisting should be a function');
});

test('_businessRules.js exports validateBusinessRules', () => {
  const mod = require(path.join(API_DIR, '_businessRules.js'));
  assert(typeof mod.validateBusinessRules === 'function', 'validateBusinessRules should be a function');
});

test('_fraudDetection.js exports detectFraud', () => {
  const mod = require(path.join(API_DIR, '_fraudDetection.js'));
  assert(typeof mod.detectFraud === 'function', 'detectFraud should be a function');
});

test('_decisionEngine.js exports makeDecision', () => {
  const mod = require(path.join(API_DIR, '_decisionEngine.js'));
  assert(typeof mod.makeDecision === 'function', 'makeDecision should be a function');
});

test('_aiPipeline.js exports runPipeline', () => {
  const mod = require(path.join(API_DIR, '_aiPipeline.js'));
  assert(typeof mod.runPipeline === 'function', 'runPipeline should be a function');
});

// === Module 2: Voting Engine Logic Tests ===
console.log('\n=== Voting Engine Logic Tests ===');

test('runVoting returns correct structure', () => {
  const { runVoting } = require(path.join(API_DIR, '_votingEngine.js'));
  const result = runVoting([], null);
  assert(typeof result === 'object', 'result should be object');
  assert(typeof result.overallConfidence === 'number', 'should have overallConfidence');
  assert(Array.isArray(result.conflicts), 'conflicts should be array');
});

test('runVoting resolves majority vote', () => {
  const { runVoting } = require(path.join(API_DIR, '_votingEngine.js'));
  const ocrResults = [
    { source: 'tesseract', amount: { value: '500', confidence: 80 }, status: { value: 'SUCCESS', confidence: 90 } },
    { source: 'tesseract-enhanced', amount: { value: '500', confidence: 85 }, status: { value: 'SUCCESS', confidence: 95 } },
  ];
  const result = runVoting(ocrResults, null);
  assert(result.amount.value === '500', `amount should be 500 got ${result.amount.value}`);
  assert(result.amount.agreed === true, 'amount should be agreed');
  assert(result.overallConfidence > 0, 'confidence should be > 0');
});

test('voting engine handles no OCR results gracefully', () => {
  const { runVoting } = require(path.join(API_DIR, '_votingEngine.js'));
  const result = runVoting([], null);
  assert(result.amount.value === null, 'amount should be null when no OCR');
  assert(result.overallConfidence === 0, 'confidence should be 0');
});

// === Module 3: Business Rules Tests ===
console.log('\n=== Business Rules Tests ===');

test('validateBusinessRules returns correct structure', () => {
  const { validateBusinessRules } = require(path.join(API_DIR, '_businessRules.js'));
  const result = validateBusinessRules({}, {});
  assert(typeof result.passed === 'boolean', 'should have passed');
  assert(typeof result.overallPassed === 'boolean', 'should have overallPassed');
  assert(Array.isArray(result.blockingIssues), 'should have blockingIssues');
  assert(Array.isArray(result.allChecks), 'should have allChecks');
});

test('validateBusinessRules amount check passes on exact match', () => {
  const { validateBusinessRules } = require(path.join(API_DIR, '_businessRules.js'));
  const votedResult = {
    amount: { value: '500', confidence: 90, agreed: true },
    upi: { value: 'jayarajj126-3@okicici', confidence: 85 },
    date: { value: new Date().toISOString().split('T')[0], confidence: 80 },
    status: { value: 'SUCCESS', confidence: 90 },
    time: { value: '12:30', confidence: 70 },
  };
  const result = validateBusinessRules(votedResult, {
    amount: 500,
    upiId: 'jayarajj126-3@okicici',
    allowedAmounts: [120, 500, 1000],
  });
  assert(result.amountCheck.passed === true, `amount check should pass got ${result.amountCheck.passed}: ${result.amountCheck.detail}`);
});

test('validateBusinessRules UPI check is case-insensitive', () => {
  const { validateBusinessRules } = require(path.join(API_DIR, '_businessRules.js'));
  const votedResult = {
    amount: { value: '500', confidence: 90 },
    upi: { value: 'JAYARAJJ126-3@OKICICI', confidence: 85 },
    date: { value: new Date().toISOString().split('T')[0], confidence: 80 },
    status: { value: 'SUCCESS', confidence: 90 },
  };
  const result = validateBusinessRules(votedResult, {
    amount: 500,
    upiId: 'jayarajj126-3@okicici',
  });
  assert(result.upiCheck.passed === true, `UPI check should pass got ${result.upiCheck.passed}: ${result.upiCheck.detail}`);
});

// === Module 4: Fraud Detection Tests ===
console.log('\n=== Fraud Detection Tests ===');

testAsync('detectFraud returns correct structure', async () => {
  const { detectFraud } = require(path.join(API_DIR, '_fraudDetection.js'));
  const testBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  const result = await detectFraud(testBuffer, {}, {});
  assert(typeof result.score === 'number', 'should have score');
  assert(typeof result.riskLevel === 'string', 'should have riskLevel');
  assert(Array.isArray(result.flags), 'should have flags');
  assert(typeof result.checks === 'object', 'should have checks');
});

testAsync('detectFraud flags small images', async () => {
  const { detectFraud } = require(path.join(API_DIR, '_fraudDetection.js'));
  const tinyBuffer = Buffer.from([0xFF, 0xD8, 0xFF]);
  const result = await detectFraud(tinyBuffer, {}, {});
  assert(result.score > 0, 'small image should have fraud score > 0');
});

testAsync('detectFraud detects known bad UTR patterns', async () => {
  const { detectFraud } = require(path.join(API_DIR, '_fraudDetection.js'));
  const testBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
  const votedResult = {
    utr: { value: '1111111111', confidence: 80 },
  };
  const result = await detectFraud(testBuffer, votedResult, {});
  assert(result.flags.includes('suspicious_utr_pattern') || result.score > 0,
    `should flag repeated UTR pattern flags=${result.flags.join(',')}`);
});

// === Module 5: Decision Engine Tests ===
console.log('\n=== Decision Engine Tests ===');

test('makeDecision MANUAL_REVIEW when no data', async () => {
  const { makeDecision } = require(path.join(API_DIR, '_decisionEngine.js'));
  const result = await makeDecision({
    imageIntegrity: { imageScore: 0, isEdited: false },
    visionAnalysis: { confidence: 0, visionAvailable: false },
    votingResult: { overallConfidence: 0, fieldCount: 0, conflicts: [], amount: {}, utr: {}, upi: {}, date: {}, time: {}, status: {} },
    businessRules: {
      overallPassed: false, passed: false, blockingIssues: ['No data'],
      allChecks: [],
      amountCheck: { passed: false, detail: 'No data' },
      upiCheck: { passed: false, detail: 'No data' },
      utrCheck: { passed: false, detail: 'No data' },
      dateCheck: { passed: false, detail: 'No data' },
      timeCheck: { passed: false, detail: 'No data' },
      statusCheck: { passed: false, detail: 'No data' },
    },
    fraudDetection: { score: 0, riskLevel: 'SAFE', flags: [] },
  });
  assert(result.decision === 'MANUAL_REVIEW', `should be MANUAL_REVIEW got ${result.decision}`);
  assert(result.needsManualReview === true, 'should need manual review');
});

test('makeDecision AUTO_APPROVE when all checks pass', async () => {
  const { makeDecision } = require(path.join(API_DIR, '_decisionEngine.js'));
  const result = await makeDecision({
    imageIntegrity: { imageScore: 95, isEdited: false, qualityScore: 90, blurScore: 50, noiseScore: 5, brightness: 120, contrast: 50, elaScore: 5, checks: {} },
    visionAnalysis: { confidence: 95, visionAvailable: true },
    votingResult: {
      overallConfidence: 95, fieldCount: 5, conflicts: [],
      amount: { value: '500', confidence: 90, agreed: true },
      utr: { value: 'ABC123', confidence: 90, agreed: true },
      upi: { value: 'test@upi', confidence: 90, agreed: true },
      date: { value: '2026-07-22', confidence: 90, agreed: true },
      time: { value: '12:30', confidence: 90, agreed: true },
      status: { value: 'SUCCESS', confidence: 90, agreed: true },
    },
    businessRules: {
      overallPassed: true, passed: true, blockingIssues: [],
      allChecks: [{ name: 'amount', passed: true }, { name: 'upi', passed: true }, { name: 'utr', passed: true }, { name: 'date', passed: true }, { name: 'time', passed: true }, { name: 'status', passed: true }],
      amountCheck: { passed: true, expected: 500, extracted: '500', detail: 'Match' },
      upiCheck: { passed: true, expected: 'test@upi', extracted: 'test@upi', detail: 'Match' },
      utrCheck: { passed: true, detail: 'Match' },
      dateCheck: { passed: true, detail: 'Match' },
      timeCheck: { passed: true, detail: 'Match' },
      statusCheck: { passed: true, detail: 'Match' },
    },
    fraudDetection: { score: 5, riskLevel: 'SAFE', flags: [] },
  });
  assert(result.decision === 'AUTO_APPROVE', `should be AUTO_APPROVE got ${result.decision} score=${result.score}`);
  assert(result.autoApproved === true, 'should be auto approved');
});

// === Module 6: Upgrade Request Handler Tests ===
console.log('\n=== Upgrade Request Handler Tests ===');

test('createUpgradeRequest handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'createUpgradeRequest.js');
  assert(fs.existsSync(handlerPath), 'createUpgradeRequest.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

test('getUpgradeRequests handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'getUpgradeRequests.js');
  assert(fs.existsSync(handlerPath), 'getUpgradeRequests.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

test('approveUpgradeRequest handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'approveUpgradeRequest.js');
  assert(fs.existsSync(handlerPath), 'approveUpgradeRequest.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

test('rejectUpgradeRequest handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'rejectUpgradeRequest.js');
  assert(fs.existsSync(handlerPath), 'rejectUpgradeRequest.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

test('getUserUpgradeStatus handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'getUserUpgradeStatus.js');
  assert(fs.existsSync(handlerPath), 'getUserUpgradeStatus.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

test('runAIVerification handler file exists', () => {
  const handlerPath = path.join(HANDLERS_DIR, 'runAIVerification.js');
  assert(fs.existsSync(handlerPath), 'runAIVerification.js should exist');
  assert(typeof require(handlerPath) === 'function', 'should export a function');
});

// === Module 7: Frontend Component Tests ===
console.log('\n=== Frontend Component Tests ===');

test('UpgradeModal component file exists', () => {
  const componentPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'UpgradeModal.jsx');
  assert(fs.existsSync(componentPath), 'UpgradeModal.jsx should exist');
});

test('AdminUpgradeRequestsPage page file exists', () => {
  const pagePath = path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'AdminUpgradeRequestsPage.jsx');
  assert(fs.existsSync(pagePath), 'AdminUpgradeRequestsPage.jsx should exist');
});

// === Module 8: Schema Tests ===
console.log('\n=== Schema Tests ===');

test('Schema has upgrade_requests table', () => {
  const schemaPath = path.join(__dirname, '..', '..', 'supabase-schema.sql');
  const content = fs.readFileSync(schemaPath, 'utf8');
  assert(content.includes('upgrade_requests'), 'schema should contain upgrade_requests table');
  assert(content.includes('payment_ai_logs'), 'schema should contain payment_ai_logs table');
});

// === Module 9: Route Registration Tests ===
console.log('\n=== Route Registration Tests ===');

test('index.js has new handler registrations', () => {
  const indexPath = path.join(API_DIR, 'index.js');
  const content = fs.readFileSync(indexPath, 'utf8');
  assert(content.includes('runAIVerification'), 'index.js should register runAIVerification');
  assert(content.includes('createUpgradeRequest'), 'index.js should register createUpgradeRequest');
  assert(content.includes('getUpgradeRequests'), 'index.js should register getUpgradeRequests');
  assert(content.includes('approveUpgradeRequest'), 'index.js should register approveUpgradeRequest');
  assert(content.includes('rejectUpgradeRequest'), 'index.js should register rejectUpgradeRequest');
  assert(content.includes('getUserUpgradeStatus'), 'index.js should register getUserUpgradeStatus');
});

test('local-dev.js has new handler configs', () => {
  const devPath = path.join(API_DIR, 'local-dev.js');
  const content = fs.readFileSync(devPath, 'utf8');
  assert(content.includes('runAIVerification'), 'local-dev.js should have runAIVerification');
  assert(content.includes('createUpgradeRequest'), 'local-dev.js should have createUpgradeRequest');
  assert(content.includes('getUpgradeRequests'), 'local-dev.js should have getUpgradeRequests');
  assert(content.includes('approveUpgradeRequest'), 'local-dev.js should have approveUpgradeRequest');
  assert(content.includes('rejectUpgradeRequest'), 'local-dev.js should have rejectUpgradeRequest');
  assert(content.includes('getUserUpgradeStatus'), 'local-dev.js should have getUserUpgradeStatus');
});

test('App.jsx has upgrade requests route', () => {
  const appPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'App.jsx');
  const content = fs.readFileSync(appPath, 'utf8');
  assert(content.includes('AdminUpgradeRequestsPage'), 'App.jsx should import AdminUpgradeRequestsPage');
  assert(content.includes('/fb-admin/upgrade-requests'), 'App.jsx should have upgrade-requests route');
});

test('AdminSidebar has upgrade requests nav item', () => {
  const sidebarPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'AdminSidebar.jsx');
  const content = fs.readFileSync(sidebarPath, 'utf8');
  assert(content.includes('upgrade-requests'), 'sidebar should have upgrade-requests link');
});

// === Summary ===
console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${warnings} warnings ===`);

if (failed > 0) {
  process.exit(1);
}
