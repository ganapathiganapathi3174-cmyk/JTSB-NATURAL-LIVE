const crypto = require('crypto');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  COL_USERS, COL_PENDING_REGS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_REFERRALS, COL_NOTIFICATIONS, COL_TOPUP_INCOME,
  COL_UPI_PAYMENTS, randomString, hashPassword,
  TEST_MODE, TEST_PAYMENT_AMOUNT,
} = require('./_shared.js');
const { runQuery, addDoc, atomicCreditWallet } = require('./_supabase.js');
const { analyzeImageQuality } = require('./_imageQuality.js');
const { analyzeVisualAuthenticity } = require('./_visualAnalysis.js');
const { parseOCRText } = require('./_ocrParser.js');
const { analyzeWithAI, mapAIResultToVerificationFormat } = require('./_ai_bridge.js');
const { broadcast } = require('./_sse.js');

const BASE_AMOUNTS = [120, 540, 1200];
const ALLOWED_AMOUNTS = TEST_MODE ? [...BASE_AMOUNTS, TEST_PAYMENT_AMOUNT] : BASE_AMOUNTS;
const ACCEPTED_UPI = '9655897523@ptyes';
const OTP_EXPIRY_MS = 300000;
const MAX_OTP_ATTEMPTS = 3;
const PYTHON_PATH = 'C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const EASY_OCR_SCRIPT = path.join(__dirname, '_easyOcrRunner.py');

const otpSessions = new Map();
const processedUtx = new Set();

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [PIPELINE] ${tag}: ${msg}`);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateSessionId() {
  return 'pip_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

function fetchBufferFromURL(url) {
  const mod = url.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching ' + url)); });
  });
}

function normalizeUtr(val) {
  if (!val) return '';
  const subs = { 'O': '0', 'I': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6' };
  return val.toUpperCase().trim().split('').map(c => subs[c] || c).join('');
}

function normalizeUpi(val) {
  return (val || '').toLowerCase().trim();
}

function fuzzyInText(text, needle) {
  if (!text || !needle) return false;
  const t = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const n = needle.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.includes(n)) return true;
  if (n.length >= 8 && t.includes(n.slice(0, 8))) return true;
  if (n.length >= 8 && t.includes(n.slice(-8))) return true;
  return false;
}

function runEasyOCR(imagePath) {
  return new Promise((resolve) => {
    execFile(PYTHON_PATH, [EASY_OCR_SCRIPT, imagePath], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({ blocks: [], engine: 'easyocr', success: false, error: err.message, duration: 0 });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        resolve({ blocks: [], engine: 'easyocr', success: false, error: 'Parse error: ' + e.message, duration: 0 });
      }
    });
  });
}

function combineAllText(engines) {
  const lines = [];
  for (const eng of Object.values(engines)) {
    if (!eng || !eng.blocks) continue;
    for (const b of eng.blocks) {
      if (b.text) lines.push(b.text);
    }
  }
  return lines.join('\n');
}

function detectPaymentApp(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const apps = [
    { name: 'PhonePe', keywords: ['phonepe', 'phone pe'] },
    { name: 'Google Pay', keywords: ['google pay', 'gpay', 'googlepay', 'tez'] },
    { name: 'Paytm', keywords: ['paytm'] },
    { name: 'BHIM', keywords: ['bhim', 'bharat interface for money'] },
    { name: 'Amazon Pay', keywords: ['amazon pay', 'amazonpay'] },
    { name: 'CRED', keywords: ['cred'] },
    { name: 'WhatsApp Pay', keywords: ['whatsapp'] },
    { name: 'Mobikwik', keywords: ['mobikwik'] },
    { name: 'Freecharge', keywords: ['freecharge'] },
    { name: 'Airtel Thanks', keywords: ['airtel'] },
    { name: 'Axis Pay', keywords: ['axis pay', 'axis bank'] },
    { name: 'ICICI Pockets', keywords: ['icici pockets', 'pockets'] },
    { name: 'SBI YONO', keywords: ['yono', 'sbi yono'] },
    { name: 'HDFC PayZapp', keywords: ['payzapp', 'hdfc'] },
  ];
  for (const app of apps) {
    if (app.keywords.some(k => t.includes(k))) return app.name;
  }
  return null;
}

function detectPaymentStatus(text) {
  if (!text) return null;
  const t = text.toUpperCase();
  if (/\b(SUCCESS|SUCCESSFUL|COMPLETED|PAID|DONE|CREDITED|TRANSACTION.*SUCCESS)\b/.test(t)) return 'SUCCESS';
  if (/\b(FAILED|REJECTED|DECLINED|CANCELLED|FAIL|UNSUCCESSFUL|REFUNDED|REVERSED|EXPIRED)\b/.test(t)) return 'FAILED';
  if (/\b(PENDING|PROCESSING|INITIATED|IN PROGRESS|AWAITING)\b/.test(t)) return 'PENDING';
  return null;
}

// ── STAGE 1: Image Integrity ──────────────────────────────────────────
async function stage1_imageIntegrity(screenshotUrl) {
  log('S1', `Integrity check: ${screenshotUrl}`);
  const result = {
    passed: true, grade: 'good',
    checks: {}, confidence: 100,
    issues: [], warnings: [],
    dimensions: null,
    blurScore: 0, cropRatio: 1,
    darkScore: 0, glareScore: 0,
    tamperingScore: 0, compressionScore: 0,
    visualAuthenticity: null,
    imageHash: null,
  };

  try {
    const buffer = await fetchBufferFromURL(screenshotUrl);
    result.imageHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const quality = await analyzeImageQuality(buffer);
    const visual = await analyzeVisualAuthenticity(buffer);

    result.dimensions = quality.dimensions;
    result.blurScore = quality.blurScore || 0;
    result.cropRatio = quality.cropRatio || 1;
    result.darkScore = quality.darkScore || 0;
    result.glareScore = quality.glareScore || 0;
    result.compressionScore = quality.compressionScore || 0;

    result.visualAuthenticity = {
      detectedApp: visual.detectedApp,
      appConfidence: visual.appColorConfidence,
      hasUPILogo: visual.hasUPILogo,
      upiLogoConfidence: visual.upiLogoConfidence,
      hasSuccessIndicator: visual.hasSuccessIndicator,
      successIndicatorConfidence: visual.successIndicatorConfidence,
      statusBanner: visual.statusBanner,
      layoutScore: visual.layoutScore,
      tamperingScore: visual.tamperingScore,
      tamperingReasons: visual.tamperingReasons,
      visualScore: visual.confidence,
    };

    if (quality.issues && quality.issues.length > 0) {
      result.issues.push(...quality.issues);
    }
    if (quality.warnings && quality.warnings.length > 0) {
      result.warnings.push(...quality.warnings);
    }
    if (visual.tamperingReasons && visual.tamperingReasons.length > 0) {
      result.warnings.push(...visual.tamperingReasons.map(r => 'Tamper: ' + r));
    }

    result.grade = quality.overallGrade || 'good';
    result.passed = quality.passed !== false;
    result.confidence = quality.overallGrade === 'good' ? 100 : quality.overallGrade === 'fair' ? 70 : 30;

    result.checks = {
      validUrl: 'ok',
      hasDimensions: quality.dimensions && quality.dimensions.width > 0 ? 'ok' : 'fail',
      lowResolution: quality.lowResolution ? 'warn' : 'ok',
      blur: result.blurScore > 80 ? 'warn' : (result.blurScore > 60 ? 'fair' : 'ok'),
      crop: result.cropRatio < 0.6 ? 'warn' : (result.cropRatio < 0.8 ? 'fair' : 'ok'),
      dark: result.darkScore > 70 ? 'warn' : 'ok',
      glare: result.glareScore > 60 ? 'warn' : 'ok',
      compression: result.compressionScore > 70 ? 'warn' : 'ok',
      appDetected: result.visualAuthenticity.detectedApp ? 'ok' : 'info',
      upiLogo: result.visualAuthenticity.hasUPILogo ? 'ok' : 'info',
      successIndicator: result.visualAuthenticity.hasSuccessIndicator ? 'ok' : 'info',
      tampering: result.visualAuthenticity.tamperingScore > 30 ? 'warn' : 'ok',
    };

    log('S1', `Grade=${result.grade}, app=${result.visualAuthenticity.detectedApp || 'unknown'}, blur=${result.blurScore}, crop=${result.cropRatio}, tampering=${result.visualAuthenticity.tamperingScore}`);
  } catch (e) {
    log('S1', `Failed: ${e.message}`);
    result.passed = false;
    result.grade = 'poor';
    result.confidence = 0;
    result.issues.push('Image fetch/analysis error: ' + e.message);
    result.checks.url = e.message;
  }

  return result;
}

// ── STAGE 2: Multi-OCR Extraction ─────────────────────────────────────
async function stage2_multiOcr(screenshotUrl, expected) {
  log('S2', `Multi-OCR (3 engines): ${screenshotUrl}`);
  const result = {
    engines: {}, combinedText: '',
    engineCount: 0, confidence: 0,
    allParsed: [], parsed: null,
    extraction: {},
    raw: {},
  };

  let tempPath = null;

  try {
    const aiPromise = analyzeWithAI(screenshotUrl, {
      amount: expected.amount,
      receiverUpi: ACCEPTED_UPI,
      utr: expected.utr,
      date: expected.paymentDate,
    });

    const buffer = await fetchBufferFromURL(screenshotUrl);
    const ext = '.jpg';
    const tempDir = os.tmpdir();
    const tempName = 'easyocr_' + crypto.randomBytes(8).toString('hex') + ext;
    tempPath = path.join(tempDir, tempName);
    fs.writeFileSync(tempPath, buffer);

    const easyPromise = runEasyOCR(tempPath);

    const [aiRaw, easyRaw] = await Promise.all([aiPromise, easyPromise]);

    const mapped = mapAIResultToVerificationFormat(aiRaw);
    result.raw.ai = aiRaw;
    result.raw.mapped = mapped;

    const aiEngines = {};
    if (aiRaw && aiRaw.stages && aiRaw.stages.stage3_multi_ocr) {
      const stage3 = aiRaw.stages.stage3_multi_ocr;
      for (const [name, data] of Object.entries(stage3.engines || {})) {
        aiEngines[name] = data;
      }
    }

    result.engines = {
      paddleocr: aiEngines.paddleocr || { success: false, blocks: [], error: 'No data' },
      tesseract: aiEngines.tesseract || { success: false, blocks: [], error: 'No data' },
      easyocr: easyRaw || { success: false, blocks: [], error: 'No response' },
    };

    const activeEngines = Object.entries(result.engines).filter(([, e]) => e.success);
    result.engineCount = activeEngines.length;

    result.combinedText = combineAllText(result.engines);
    result.parsed = parseOCRText(result.combinedText);

    const extraction = {
      utr: { found: false, engines: [] },
      amount: { found: false, engines: [] },
      upi_id: { found: false, engines: [] },
      date: { found: false, engines: [] },
    };

    for (const [engName, engData] of Object.entries(result.engines)) {
      if (!engData.success || !engData.blocks) continue;
      const engText = engData.blocks.map(b => b.text).join(' ');
      const engParsed = parseOCRText(engText);

      if (engParsed.extractedUtr && engParsed.extractedUtr.length >= 12) {
        const expectedUtr = normalizeUtr(expected.utr || '');
        const extractedUtr = normalizeUtr(engParsed.extractedUtr);
        const match = expectedUtr && (extractedUtr.includes(expectedUtr) || expectedUtr.includes(extractedUtr));
        if (match) {
          extraction.utr.found = true;
          if (!extraction.utr.engines.includes(engName)) extraction.utr.engines.push(engName);
        }
      }

      if (engParsed.extractedAmount && expected.amount) {
        const diff = Math.abs(engParsed.extractedAmount - Number(expected.amount));
        if (diff <= 1 || diff <= Number(expected.amount) * 0.1) {
          extraction.amount.found = true;
          if (!extraction.amount.engines.includes(engName)) extraction.amount.engines.push(engName);
        }
      }

      if (engParsed.extractedReceiverUpi) {
        const expectedUpi = normalizeUpi(ACCEPTED_UPI);
        const extractedUpi = normalizeUpi(engParsed.extractedReceiverUpi);
        if (extractedUpi.includes(expectedUpi) || expectedUpi.includes(extractedUpi)) {
          extraction.upi_id.found = true;
          if (!extraction.upi_id.engines.includes(engName)) extraction.upi_id.engines.push(engName);
        }
      }

      if (engParsed.extractedDate && expected.paymentDate) {
        const expDate = String(expected.paymentDate).slice(0, 10);
        const extractedDate = engParsed.extractedDate;
        const dayDiff = Math.abs(new Date(extractedDate) - new Date(expDate)) / 86400000;
        if (dayDiff <= 1) {
          extraction.date.found = true;
          if (!extraction.date.engines.includes(engName)) extraction.date.engines.push(engName);
        }
      }

      result.allParsed.push({ engine: engName, parsed: engParsed });
    }

    if (result.parsed && result.parsed.extractedUtr && expected.utr) {
      const expectedUtr = normalizeUtr(expected.utr);
      const extractedUtr = normalizeUtr(result.parsed.extractedUtr);
      if (extractedUtr.includes(expectedUtr) || expectedUtr.includes(extractedUtr)) {
        extraction.utr.found = true;
      }
    }

    if (result.parsed && result.parsed.extractedAmount && expected.amount) {
      const diff = Math.abs(result.parsed.extractedAmount - Number(expected.amount));
      if (diff <= 1 || diff <= Number(expected.amount) * 0.1) {
        extraction.amount.found = true;
      }
    }

    if (result.parsed && result.parsed.extractedReceiverUpi) {
      const expectedUpi = normalizeUpi(ACCEPTED_UPI);
      const extractedUpi = normalizeUpi(result.parsed.extractedReceiverUpi);
      if (extractedUpi.includes(expectedUpi) || expectedUpi.includes(extractedUpi)) {
        extraction.upi_id.found = true;
      }
    }

    if (result.parsed && result.parsed.extractedDate && expected.paymentDate) {
      const expDate = String(expected.paymentDate).slice(0, 10);
      const dayDiff = Math.abs(new Date(result.parsed.extractedDate) - new Date(expDate)) / 86400000;
      if (dayDiff <= 1) {
        extraction.date.found = true;
      }
    }

    result.extraction = extraction;
    result.confidence = result.engineCount >= 2 ? 100 : (result.engineCount === 1 ? 60 : 0);

    log('S2', `Engines: ${result.engineCount}/3, UTR=${extraction.utr.found}, Amt=${extraction.amount.found}, UPI=${extraction.upi_id.found}, Date=${extraction.date.found}`);
  } catch (e) {
    log('S2', `Failed: ${e.message}`);
    result.engineCount = 0;
    result.confidence = 0;
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }

  return result;
}

// ── STAGE 3: Visual AI Cross Check ────────────────────────────────────
async function stage3_visualCrossCheck(stage2) {
  log('S3', 'Cross-checking extracted data');
  const result = {
    passed: true, confidence: 100,
    checks: {},
    detectedApp: null,
    detectedStatus: null,
    matchedFields: {},
  };

  try {
    const combinedText = stage2.combinedText || '';
    const parsed = stage2.parsed;
    const extraction = stage2.extraction || {};

    result.detectedApp = detectPaymentApp(combinedText) || (parsed ? parsed.extractedBankName : null);
    result.detectedStatus = detectPaymentStatus(combinedText);

    result.matchedFields = {
      utr: extraction.utr ? extraction.utr.found || false : false,
      amount: extraction.amount ? (extraction.amount.found ? 'matched' : 'uncertain') : 'uncertain',
      upi_id: extraction.upi_id ? extraction.upi_id.found || false : false,
      date: extraction.date ? extraction.date.found || false : false,
    };

    const matchedCount = [
      result.matchedFields.utr,
      result.matchedFields.upi_id,
      result.matchedFields.date,
    ].filter(Boolean).length;

    result.checks = {
      app: result.detectedApp || 'unknown',
      status: result.detectedStatus || 'unknown',
      utrFound: result.matchedFields.utr,
      amountFound: result.matchedFields.amount !== 'uncertain',
      upiFound: result.matchedFields.upi_id,
      dateFound: result.matchedFields.date,
    };

    result.confidence = Math.round((matchedCount / 4) * 100);
    result.passed = result.engineCount > 0 || stage2.engineCount > 0;

    log('S3', `App=${result.detectedApp || 'unknown'}, Status=${result.detectedStatus || 'unknown'}, Matched=${matchedCount}/4, Confidence=${result.confidence}%`);
  } catch (e) {
    log('S3', `Failed: ${e.message}`);
    result.passed = false;
    result.confidence = 0;
  }

  return result;
}

// ── STAGE 4: Business Validation ──────────────────────────────────────
async function stage4_businessValidation(stage2, stage3, expected, imageHash) {
  log('S4', 'Business validation');
  const result = {
    passed: true, confidence: 100,
    validations: {}, reasons: [],
    duplicateCheck: null,
  };

  try {
    const extraction = stage2.extraction || {};
    const cc = stage3.checks || {};

    result.validations = {
      amountMatch: extraction.amount && extraction.amount.found ? 'verified' : 'unreadable',
      upiMatch: extraction.upi_id && extraction.upi_id.found ? 'verified' : 'not_found',
      utrMatch: extraction.utr && extraction.utr.found ? 'verified' : 'not_found',
      dateMatch: extraction.date && extraction.date.found ? 'verified' : 'not_found',
      statusCheck: cc.status === 'SUCCESS' ? 'verified' : (cc.status !== 'unknown' ? cc.status : 'unreadable'),
    };

    const verifiedCount = Object.values(result.validations).filter(v => v === 'verified').length;
    result.confidence = Math.round((verifiedCount / 5) * 100);

    if (imageHash) {
      try {
        const dupHash = await runQuery(COL_UPI_PAYMENTS, [
          { field: 'screenshot_hash', op: 'EQUAL', value: imageHash },
          { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
        ], { limit: 1 });
        if (dupHash && dupHash.length > 0) {
          result.duplicateCheck = 'DUPLICATE_SCREENSHOT';
          result.reasons.push('Screenshot already exists in system');
          result.validations.screenshotUnique = 'duplicate';
        } else {
          result.validations.screenshotUnique = 'unique';
        }
      } catch (e) {
        result.validations.screenshotUnique = 'unchecked';
      }
    }

    if (expected.utr) {
      try {
        const dupUtr = await runQuery(COL_UPI_PAYMENTS, [
          { field: 'utr', op: 'EQUAL', value: expected.utr },
          { field: 'status', op: 'NOT_EQUAL', value: 'rejected' },
        ], { limit: 1 });
        if (dupUtr && dupUtr.length > 0) {
          result.duplicateCheck = 'DUPLICATE_UTR';
          result.reasons.push('UTR already exists in system');
          result.validations.utrUnique = 'duplicate';
        } else {
          result.validations.utrUnique = 'unique';
        }
      } catch (e) {
        result.validations.utrUnique = 'unchecked';
      }
    }

    log('S4', `Verified ${verifiedCount}/5, dup=${result.duplicateCheck || 'none'}, confidence=${result.confidence}%`);
  } catch (e) {
    log('S4', `Failed: ${e.message}`);
    result.passed = false;
    result.confidence = 0;
  }

  return result;
}

// ── STAGE 5: Evidence Fusion ──────────────────────────────────────────
async function stage5_evidenceFusion(stage4, stage3, stage2, stage1, expected) {
  log('S5', '=== EVIDENCE FUSION ===');
  const result = {
    decision: 'manual_review',
    reasons: [],
    matched_fields: {},
    otpRequired: false,
    fraudFlags: [],
    score: 0,
  };

  const v = stage4?.validations || {};
  const cc = stage3?.checks || {};
  const extraction = stage2?.extraction || {};

  const utrFound = extraction.utr?.found || v.utrMatch === 'verified';
  const dateFound = extraction.date?.found || v.dateMatch === 'verified';
  const amountFound = extraction.amount?.found || v.amountMatch === 'verified';
  const upiFound = extraction.upi_id?.found || v.upiMatch === 'verified';
  const statusSuccess = cc.status === 'SUCCESS';
  const isDuplicate = stage4?.duplicateCheck === 'DUPLICATE_UTR' || stage4?.duplicateCheck === 'DUPLICATE_SCREENSHOT';
  const imageBad = stage1?.grade === 'poor';

  const statusMatch = v.statusCheck === 'verified';
  const confirmedFail = v.statusCheck === 'FAILED' || v.statusCheck === 'fail' || v.statusCheck === 'PENDING';

  result.matched_fields = {
    utr: utrFound,
    date: dateFound,
    amount: amountFound ? 'matched' : 'uncertain',
    upi_id: upiFound,
  };

  const strongRejectSignals = [];

  if (isDuplicate) {
    strongRejectSignals.push('Duplicate transaction detected');
  }
  if (confirmedFail) {
    strongRejectSignals.push('Payment status indicates failure');
  }
  if (!utrFound && stage2?.engineCount >= 2 && stage2?.combinedText?.length > 50) {
    const allText = stage2.combinedText || '';
    const utrsFound = allText.match(/\b(\d{12,22})\b/g);
    if (utrsFound && utrsFound.length > 0) {
      const expectedUtrNorm = normalizeUtr(expected.utr || '');
      const differentUtrs = utrsFound.filter(u => {
        const norm = normalizeUtr(u);
        return norm !== expectedUtrNorm && !norm.includes(expectedUtrNorm) && !expectedUtrNorm.includes(norm);
      });
      if (differentUtrs.length > 0 && !expectedUtrNorm) {
        strongRejectSignals.push('Different transaction UTR found');
      }
      if (differentUtrs.length > 0 && expectedUtrNorm && differentUtrs.some(u => normalizeUtr(u) !== expectedUtrNorm)) {
        strongRejectSignals.push('Confirmed wrong UTR — belongs to different transaction');
      }
    } else {
      strongRejectSignals.push('No UTR found despite successful OCR');
    }
  }
  if (!upiFound && stage2?.engineCount >= 2 && statusSuccess) {
    strongRejectSignals.push('Receiver UPI not found despite success status');
  }

  // ── Rule 1: UTR + Date match → unconditional APPROVE ──
  if (utrFound && dateFound) {
    result.decision = 'approve';
    result.reasons = ['UTR matched successfully', 'Date matches current transaction'];
    if (amountFound) result.reasons.push('Amount matches');
    else result.reasons.push('Amount unclear but ignored (UTR+date confirmed)');
    if (upiFound) result.reasons.push('UPI ID matches');
    if (statusSuccess) result.reasons.push('Payment status confirmed');
    result.otpRequired = true;
    log('S5', 'APPROVE — UTR+Date confirmed, OTP required');
  }

  // ── Rule 2: UTR + Amount match → APPROVE ──
  else if (!result.otpRequired && utrFound && amountFound) {
    result.decision = 'approve';
    result.reasons = ['UTR matched', 'Amount matches'];
    if (upiFound) result.reasons.push('UPI ID matches');
    if (!dateFound) result.reasons.push('Date unclear but UTR+Amount confirmed');
    result.otpRequired = true;
    log('S5', 'APPROVE — UTR+Amount confirmed, OTP required');
  }

  // ── Rule 3: Amount + UPI + Date match → APPROVE ──
  else if (!result.otpRequired && amountFound && upiFound && dateFound) {
    result.decision = 'approve';
    result.reasons = ['Amount matches', 'UPI ID matches', 'Date matches'];
    result.otpRequired = true;
    log('S5', 'APPROVE — Amount+UPI+Date confirmed');
  }

  // ── Rule 4: 2+ strong reject signals → REJECT ──
  else if (strongRejectSignals.length >= 2) {
    result.decision = 'reject';
    result.reasons = strongRejectSignals;
    result.fraudFlags = strongRejectSignals;
    log('S5', 'REJECT — ' + strongRejectSignals.join(', '));
  }

  // ── Rule 5: UTR found alone → MANUAL_REVIEW ──
  else if (utrFound) {
    result.decision = 'manual_review';
    result.reasons = ['UTR found but date not confirmed'];
    if (!amountFound) result.reasons.push('Amount unclear');
    if (!upiFound) result.reasons.push('UPI ID unclear');
    log('S5', 'MANUAL_REVIEW — UTR found, insufficient evidence');
  }

  // ── Rule 6: OCR worked but no values → depends ──
  else if (stage2?.engineCount >= 1 && stage2?.combinedText?.length > 30 && !imageBad) {
    if (strongRejectSignals.length >= 1) {
      result.decision = 'reject';
      result.reasons = strongRejectSignals;
      result.fraudFlags = strongRejectSignals;
      log('S5', 'REJECT — OCR worked but confirmed wrong transaction');
    } else {
      result.decision = 'manual_review';
      result.reasons = ['OCR completed but expected values not found'];
      if (stage2?.engineCount < 2) result.reasons.push('Only 1 OCR engine succeeded');
      log('S5', 'MANUAL_REVIEW — OCR completed, values not found');
    }
  }

  // ── Rule 7: OCR failed / image poor → MANUAL_REVIEW (never reject) ──
  else {
    result.decision = 'manual_review';
    result.reasons = [];
    if (imageBad) result.reasons.push('Poor image quality');
    if (!stage2 || stage2.engineCount === 0) result.reasons.push('All OCR engines failed');
    if (result.reasons.length === 0) result.reasons.push('Insufficient evidence for decision');
    log('S5', 'MANUAL_REVIEW — ' + result.reasons.join(', '));
  }

  return result;
}

// ── Full Pipeline Runner ──────────────────────────────────────────────
async function runFullPipeline(session) {
  log('PIPELINE', `Running pipeline for session ${session.sessionId}`);
  const expected = {
    amount: session.amount,
    utr: (session.utr || '').toUpperCase().trim(),
    paymentDate: session.paymentDate || new Date().toISOString().split('T')[0],
  };

  const s1 = await stage1_imageIntegrity(session.screenshotUrl);
  session.stages.stage1 = s1;

  const s2 = await stage2_multiOcr(session.screenshotUrl, expected);
  session.stages.stage2 = s2;

  const s3 = await stage3_visualCrossCheck(s2);
  session.stages.stage3 = s3;

  const s4 = await stage4_businessValidation(s2, s3, expected, s1.imageHash);
  session.stages.stage4 = s4;

  const s5 = await stage5_evidenceFusion(s4, s3, s2, s1, expected);
  session.stages.stage5 = s5;

  session.decision = s5.decision;
  session.reasons = s5.reasons;
  session.matchedFields = s5.matched_fields;
  session.score = s5.score;
  session.imageHash = s1.imageHash;
  session.ocrEngineCount = s2.engineCount || 0;
  session.ocrConfidence = s2.confidence || 0;
  session.visualConfidence = s3.confidence || 0;
  session.validationConfidence = s4.confidence || 0;

  log('PIPELINE', `Decision: ${s5.decision}, reasons: ${s5.reasons.join('; ')}`);
  return s5;
}

// ── OTP Management ────────────────────────────────────────────────────
function createOtpSession(session) {
  const otp = generateOtp();
  session.otp = otp;
  session.otpExpiresAt = Date.now() + OTP_EXPIRY_MS;
  session.otpAttempts = 0;
  session.otpVerified = false;
  session.status = 'otp_sent';
  otpSessions.set(session.sessionId, session);
  log('OTP', `OTP *** generated for session ${session.sessionId}`);
  return otp;
}

async function verifyOtp(sessionId, otp) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found or expired' };
  if (session.otpVerified) return { error: 'OTP already verified' };
  if (Date.now() > session.otpExpiresAt) {
    session.status = 'otp_expired';
    otpSessions.set(sessionId, session);
    return { error: 'OTP expired' };
  }
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) {
    session.status = 'otp_blocked';
    otpSessions.set(sessionId, session);
    return { error: 'Maximum OTP attempts exceeded' };
  }

  session.otpAttempts++;
  if (session.otp !== otp) {
    otpSessions.set(sessionId, session);
    const remaining = MAX_OTP_ATTEMPTS - session.otpAttempts;
    return { error: `Invalid OTP. ${remaining} attempt(s) remaining.` };
  }

  session.otpVerified = true;
  session.status = 'approved';
  session.verifiedAt = Date.now();
  otpSessions.set(sessionId, session);
  return { success: true, session };
}

async function resendOtp(sessionId) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  if (session.otpVerified) return { error: 'OTP already verified' };
  if (session.otpAttempts >= MAX_OTP_ATTEMPTS) return { error: 'Maximum OTP attempts exceeded' };
  if (session.status !== 'otp_sent') return { error: 'Session not in OTP waiting state' };

  const now = Date.now();
  if (session.otpExpiresAt && now < session.otpExpiresAt && session.otpExpiresAt - now > 240000) {
    return { error: 'OTP still valid. Wait before requesting a new one.' };
  }

  const otp = generateOtp();
  session.otp = otp;
  session.otpExpiresAt = Date.now() + OTP_EXPIRY_MS;
  otpSessions.set(sessionId, session);
  log('OTP', `Resent OTP *** for session ${sessionId}`);
  return { success: true, otpExpiresAt: session.otpExpiresAt };
}

// ── Post-Approval ─────────────────────────────────────────────────────
async function processPaymentApproval(sessionId) {
  const session = otpSessions.get(sessionId);
  if (!session) return { error: 'Session not found' };
  if (!session.otpVerified) return { error: 'OTP not verified' };
  log('POST-APPROVAL', `Completing ${session.paymentType} for session ${sessionId}`);

  try {
    if (session.paymentType === 'registration') {
      const reg = session.pendingReg;
      const hashedPw = hashPassword(reg.password_hash || 'default');
      const refCode = randomString(8);
      const userData = {
        name: reg.name, email: reg.email, phone: reg.phone,
        password_hash: hashedPw, referral_code: refCode,
        plan: String(session.amount), status: 'active',
        created_at: new Date().toISOString(),
      };
      const newUser = await addDoc(COL_USERS, userData);
      if (!newUser || !newUser.id) throw new Error('Failed to create user');
      const userId = newUser.id;
      log('POST-APPROVAL', `User created: ${userId}`);

      await addDoc(COL_WALLET_BALANCES, { user_id: userId, balance: 0, created_at: new Date().toISOString() }).catch(() => {});
      await addDoc(COL_WALLET_TX, { user_id: userId, type: 'registration_bonus', amount: 0, description: 'Account activation', created_at: new Date().toISOString() }).catch(() => {});

      if (reg.referral_code) {
        try {
          const referrers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: reg.referral_code }]);
          if (referrers && referrers.length > 0) {
            const referrer = referrers[0];
            const refBonus = session.amount >= 540 ? 50 : 20;
            await atomicCreditWallet(referrer.id, refBonus, `referral_bonus_${userId}`);
            await addDoc(COL_REFERRALS, { referrer_id: referrer.id, referred_id: userId, amount: refBonus, created_at: new Date().toISOString() }).catch(() => {});
          }
        } catch (e) { log('POST-APPROVAL', `Referral failed: ${e.message}`); }
      }

      await addDoc(COL_NOTIFICATIONS, { userId, receiverId: userId, title: 'Registration Approved', message: 'Your account has been activated. Welcome!', status: 'unread', type: 'account', created_at: new Date().toISOString() }).catch(() => {});
      session.result = { userId, status: 'active', plan: String(session.amount) };
      log('POST-APPROVAL', `Registration completed: ${userId}`);

    } else if (session.paymentType === 'topup') {
      const walletResult = await atomicCreditWallet(session.userId, session.amount, `topup_${session.utr}`);
      if (!walletResult || walletResult.error) throw new Error(walletResult?.error || 'Wallet credit failed');
      await addDoc(COL_NOTIFICATIONS, { userId: session.userId, receiverId: session.userId, title: 'Topup Successful', message: `₹${session.amount} credited to wallet`, status: 'unread', type: 'wallet', created_at: new Date().toISOString() }).catch(() => {});
      session.result = { userId: session.userId, credited: session.amount, newBalance: walletResult.newBalance };
      log('POST-APPROVAL', `Topup completed: ${session.userId}, +₹${session.amount}`);
    }

    try { broadcast('pipelinePaymentApproved', { sessionId, type: session.paymentType, amount: session.amount }); } catch {}
    return session.result || { success: true };
  } catch (e) {
    log('POST-APPROVAL', `Error: ${e.message}`);
    return { error: e.message };
  }
}

module.exports = {
  ALLOWED_AMOUNTS, ACCEPTED_UPI, OTP_EXPIRY_MS, MAX_OTP_ATTEMPTS,
  otpSessions, processedUtx,
  generateOtp, generateSessionId,
  stage1_imageIntegrity,
  stage2_multiOcr,
  stage3_visualCrossCheck,
  stage4_businessValidation,
  stage5_evidenceFusion,
  runFullPipeline,
  createOtpSession,
  verifyOtp,
  resendOtp,
  processPaymentApproval,
};
