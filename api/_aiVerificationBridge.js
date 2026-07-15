const https = require('https');
const http = require('http');
const { URL } = require('url');

const PYTHON_VERIFIER_URL = process.env.PYTHON_VERIFIER_URL || 'http://127.0.0.1:5050';
const VERIFY_TIMEOUT_MS = parseInt(process.env.AI_VERIFY_TIMEOUT_MS || '25000', 10);

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [AI-BRIDGE] ' + msg);
}

let pythonAvailable = false;
let lastHealthCheck = 0;

async function checkHealth() {
  const now = Date.now();
  if (now - lastHealthCheck < 30000) return pythonAvailable;
  lastHealthCheck = now;
  try {
    await httpRequest('GET', PYTHON_VERIFIER_URL + '/health');
    pythonAvailable = true;
    log('Python verifier is AVAILABLE at ' + PYTHON_VERIFIER_URL);
  } catch (e) {
    pythonAvailable = false;
    log('Python verifier is NOT available: ' + e.message);
  }
  return pythonAvailable;
}

function httpRequest(method, url, bodyData) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const body = bodyData ? JSON.stringify(bodyData) : null;
    const options = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      timeout: VERIFY_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON from Python verifier: ' + raw.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Python verifier timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function runAIVerification({ screenshotUrl, expectedAmount, expectedReceiverUpi, orderId, createdAt, userEnteredUtr, userEnteredUpi }) {
  const t0 = Date.now();

  const available = await checkHealth();
  if (!available) {
    log('Python verifier unavailable — returning manual review fallback');
    return createFallbackResult('Python AI verifier not available — please try again later');
  }

  try {
    const payload = {
      screenshot_url: screenshotUrl,
      expected_amount: expectedAmount,
      expected_receiver_upi: expectedReceiverUpi || 'jayarajj126-3@okicici',
      expected_receiver_name: 'JEYARAJ ALAG',
      order_id: orderId || '',
      created_at: createdAt || '',
      user_entered_utr: userEnteredUtr || '',
      user_entered_upi: userEnteredUpi || '',
    };

    log('Calling Python verifier for order ' + orderId + '...');
    const pythonResult = await httpRequest('POST', PYTHON_VERIFIER_URL + '/verify', payload);
    const elapsed = Date.now() - t0;
    log('Python verifier returned: decision=' + pythonResult.decision + ', confidence=' + pythonResult.confidence + '%, time=' + elapsed + 'ms');

    return mapToEngineFormat(pythonResult, elapsed);
  } catch (e) {
    log('Python verifier error: ' + e.message);
    return createFallbackResult('AI verification error: ' + e.message);
  }
}

function mapToEngineFormat(pythonResult, elapsedMs) {
  const extracted = pythonResult.extracted || {};
  const checks = pythonResult.checks || {};
  const fraud = pythonResult.fraud || {};

  const allChecksPassed = Object.values(checks).every(v => v === true);
  const hasManualReviewFlags = !allChecksPassed && pythonResult.decision === 'MANUAL_REVIEW';

  return {
    status: pythonResult.decision === 'AUTO_APPROVE' ? 'verified' : (pythonResult.decision === 'AUTO_REJECT' ? 'rejected' : 'pending'),
    verificationScore: pythonResult.confidence || 0,
    verificationDuration: pythonResult.processing_time_ms || elapsedMs,
    autoVerified: pythonResult.decision === 'AUTO_APPROVE',
    manualReviewRequired: hasManualReviewFlags,
    reasons: pythonResult.reasons || [],
    checks: Object.entries(checks).map(([name, passed]) => ({ name, passed })),
    ocrData: {
      rawText: '',
      extractedAmount: extracted.amount,
      extractedUtr: extracted.utr,
      extractedReceiverName: extracted.receiver,
      extractedSenderVpa: extracted.sender_vpa,
      extractedBankName: extracted.bank,
      extractedDate: extracted.date,
      extractedTime: extracted.time,
      extractedPaymentStatus: extracted.status,
      confidence: pythonResult.confidence || 0,
    },
    imageQuality: { passed: true, overallGrade: 'good', issues: [] },
    matchedAmount: checks.amount || false,
    matchedReceiver: checks.receiver || false,
    matchedUtr: checks.utr || false,
    matchedDate: checks.date || false,
    matchedStatus: checks.status || false,
    fraudScore: fraud.score || 0,
    fraudFlags: fraud.flags || [],
    duplicateUtrDetected: false,
    screenshotHash: '',
    textHash: '',
    bankSmsDetected: false,
    bankSmsScore: 0,
    userEnteredUtr: null,
    userUtrMatched: false,
    userEnteredUpi: null,
    userUpiMatched: false,
    allowedAmounts: [120, 500, 1000],
    debug: { aiResult: pythonResult },
    timings: { total: pythonResult.processing_time_ms || elapsedMs },
    _aiVerified: true,
    _decision: pythonResult.decision,
  };
}

function createFallbackResult(reason) {
  return {
    status: 'pending',
    verificationScore: 0,
    verificationDuration: 0,
    autoVerified: false,
    manualReviewRequired: true,
    reasons: [reason],
    checks: [],
    ocrData: null,
    imageQuality: null,
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
    matchedStatus: false,
    fraudScore: 0,
    fraudFlags: [],
    duplicateUtrDetected: false,
    screenshotHash: '',
    textHash: '',
    bankSmsDetected: false,
    bankSmsScore: 0,
    userEnteredUtr: null,
    userUtrMatched: false,
    userEnteredUpi: null,
    userUpiMatched: false,
    allowedAmounts: [120, 500, 1000],
    debug: {},
    timings: {},
    _aiVerified: false,
    _decision: 'MANUAL_REVIEW',
  };
}

module.exports = {
  runAIVerification,
  checkHealth,
  PYTHON_VERIFIER_URL,
  VERIFY_TIMEOUT_MS,
};
