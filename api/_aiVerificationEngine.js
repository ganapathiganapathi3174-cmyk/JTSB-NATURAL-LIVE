const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { Jimp } = require('jimp');
const { analyzeImageQuality } = require('./_imageQuality.js');
const { parseOCRText } = require('./_ocrParser.js');
const { runQuery } = require('./_supabase.js');
const { COL_UPI_PAYMENTS, ADMIN_UPI_ID } = require('./_shared.js');
const metrics = require('./_metrics.js');

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.log('[AI-VERIFY] Tesseract.js not available: ' + e.message);
}

const OCR_THRESHOLD = 50;
const ALLOWED_DATE_WINDOW_DAYS = 3;
const MAX_AMOUNT_DIFF_PERCENT = 5;
const MIN_IMAGE_SIZE = 30000;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const MIN_RESOLUTION = 200;
const VERIFY_TIMEOUT_MS = 120000;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [AI-VERIFY] ' + msg);
}

function fetchBufferFromURL(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
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
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching screenshot')); });
  });
}

function runTesseractOCR(imageBuffer) {
  return new Promise(async (resolve, reject) => {
    let worker = null;
    try {
      worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress) {
            if (Math.round(m.progress * 10) % 2 === 0) {
              log('Recognition progress: ' + Math.round(m.progress * 100) + '%');
            }
          }
        }
      });
      const { data } = await worker.recognize(imageBuffer);
      resolve(data);
    } catch (e) {
      reject(e);
    } finally {
      if (worker) {
        try { await worker.terminate(); } catch (_) {}
      }
    }
  });
}

function preprocessForOCR(buffer) {
  return new Promise(async (resolve) => {
    let image;
    try {
      image = await Jimp.read(buffer);
    } catch (e) {
      log('Could not parse image: ' + e.message);
      resolve(buffer);
      return;
    }
    try {
      image.greyscale();
      image.contrast(0.3);
      const targetWidth = 2000;
      if (image.bitmap.width > targetWidth * 1.1) {
        image.resize(targetWidth, Jimp.AUTO);
      } else if (image.bitmap.width < 600) {
        image.resize(1200, Jimp.AUTO);
      }
      const buf = await image.getBuffer('image/png');
      resolve(buf);
    } catch (e) {
      log('Preprocessing failed: ' + e.message);
      resolve(buffer);
    }
  });
}

function validateUtrFormat(utr) {
  if (!utr) return false;
  const clean = utr.replace(/\s+/g, '').toUpperCase();
  if (clean.length < 10 || clean.length > 30) return false;
  if (!/^[A-Z0-9]+$/.test(clean)) return false;
  return true;
}

function isAllowedTimeWindow(dateStr) {
  if (!dateStr) return false;
  try {
    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) return false;
    const now = new Date();
    const diffDays = Math.abs((now - parsed) / (1000 * 60 * 60 * 24));
    return diffDays <= ALLOWED_DATE_WINDOW_DAYS;
  } catch (e) {
    return false;
  }
}

function isAllowedTimeOfDay(timeStr) {
  if (!timeStr) return true;
  try {
    const parts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm))?/);
    if (!parts) return true;
    let hour = parseInt(parts[1]);
    const minute = parseInt(parts[2]);
    const ampm = parts[4] ? parts[4].toUpperCase() : null;
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour >= 12) hour = 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
    const now = new Date();
    const paymentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
    const diffHours = Math.abs((now - paymentTime) / (1000 * 60 * 60));
    return diffHours <= 72;
  } catch (e) {
    return true;
  }
}

function matchesAmount(ocrAmount, expectedAmount) {
  if (ocrAmount === null || ocrAmount === undefined) return false;
  const diff = Math.abs(Number(ocrAmount) - Number(expectedAmount));
  const percentDiff = Number(expectedAmount) > 0 ? (diff / Number(expectedAmount)) * 100 : 100;
  return percentDiff <= MAX_AMOUNT_DIFF_PERCENT;
}

function matchesUpiId(extractedUpi, expectedUpi) {
  if (!extractedUpi || !expectedUpi) return false;
  const cleanExtracted = extractedUpi.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  const cleanExpected = expectedUpi.toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  if (cleanExtracted === cleanExpected) return true;
  const handleA = cleanExtracted.split('@')[0];
  const handleB = cleanExpected.split('@')[0];
  if (handleA && handleB && handleA === handleB) return true;
  if (cleanExpected.includes(cleanExtracted) || cleanExtracted.includes(cleanExpected)) return true;
  return false;
}

function matchesPaymentStatus(extractedStatus) {
  if (!extractedStatus) return false;
  const upper = extractedStatus.toUpperCase().trim();
  const successWords = ['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'DONE', 'CREDITED'];
  for (const word of successWords) {
    if (upper.includes(word)) return true;
  }
  return false;
}

async function checkDuplicateUtr(utr, excludeOrderId) {
  if (!utr) return { isDuplicate: false };
  try {
    const cleanUtr = utr.toUpperCase().trim();
    const payments = await runQuery(COL_UPI_PAYMENTS, [], { limit: 1000 });
    const dup = payments.find(p =>
      p.utr && p.utr.toUpperCase().trim() === cleanUtr &&
      p.status !== 'rejected' &&
      p.id !== excludeOrderId
    );
    if (dup) return { isDuplicate: true, existingPayment: dup.id };
    return { isDuplicate: false };
  } catch (e) {
    log('Duplicate check error: ' + e.message);
    return { isDuplicate: false, error: e.message };
  }
}

async function runAiVerification(order, screenshotUrl) {
  const startTime = Date.now();
  const expectedAmount = Number(order.amount) || 0;
  const expectedUpi = order.expected_upi_id || ADMIN_UPI_ID;
  const orderId = order.id;
  const type = order.type || 'unknown';

  log('=== AI Verification for ' + orderId + ' ===');
  log('Type=' + type + ', Amount=' + expectedAmount + ', ExpectedUPI=' + expectedUpi);

  const result = {
    status: 'pending_review',
    verificationScore: 0,
    verificationDuration: 0,
    autoVerified: false,
    manualReviewRequired: true,
    reasons: [],
    checks: [],
    ocrData: null,
    imageQuality: null,
    matchedAmount: false,
    matchedReceiver: false,
    matchedUtr: false,
    matchedDate: false,
    matchedStatus: false,
    fraudScore: 0,
    duplicateUtrDetected: false,
  };

  try {
    if (!screenshotUrl) {
      result.reasons.push('No screenshot provided');
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    log('Fetching screenshot...');
    let rawBuf;
    try {
      rawBuf = await fetchBufferFromURL(screenshotUrl);
    } catch (e) {
      result.reasons.push('Could not fetch screenshot: ' + e.message);
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    if (rawBuf.length < MIN_IMAGE_SIZE) {
      result.reasons.push('Screenshot too small (' + rawBuf.length + ' bytes)');
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    if (rawBuf.length > MAX_IMAGE_SIZE) {
      result.reasons.push('Screenshot too large (' + (rawBuf.length / 1024 / 1024).toFixed(1) + 'MB)');
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    log('Screenshot fetched: ' + rawBuf.length + ' bytes');

    // PHASE 1: IMAGE QUALITY ANALYSIS
    log('Analyzing image quality...');
    let imageQuality;
    try {
      imageQuality = await analyzeImageQuality(rawBuf);
    } catch (e) {
      log('Image quality analysis failed: ' + e.message);
      imageQuality = { passed: true, overallGrade: 'unknown', issues: [], warnings: [], blurScore: 0, cropRatio: 1.0, lowResolution: false, darkScore: 0, glareScore: 0, compressionScore: 0, dimensions: { width: 0, height: 0 } };
    }
    result.imageQuality = imageQuality;
    result.checks.push({
      name: 'image_quality',
      passed: imageQuality.passed,
      details: { grade: imageQuality.overallGrade, blurScore: imageQuality.blurScore, cropRatio: imageQuality.cropRatio, issues: imageQuality.issues, warnings: imageQuality.warnings },
    });

    if (!imageQuality.passed) {
      const criticalIssues = imageQuality.issues.filter(i =>
        i.includes('blur') || i.includes('dark') || i.includes('cropped') || i.includes('poor') || i.includes('Resolution')
      );
      if (criticalIssues.length > 0) {
        result.reasons.push('Image quality issues: ' + criticalIssues.join(', '));
      }
    }

    if (imageQuality.lowResolution) {
      result.reasons.push('Low resolution screenshot (' + (imageQuality.dimensions?.width || '?') + 'x' + (imageQuality.dimensions?.height || '?') + ')');
    }

    if (imageQuality.cropRatio < 0.5) {
      result.reasons.push('Screenshot appears cropped');
    }

    // PHASE 2: OCR TEXT EXTRACTION
    log('Running OCR...');
    if (!Tesseract) {
      result.reasons.push('OCR engine not available');
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    let ocrText = '';
    let ocrConfidence = 0;
    try {
      const processedBuf = await preprocessForOCR(rawBuf);
      log('Running Tesseract OCR...');
      const data = await runTesseractOCR(processedBuf);
      ocrText = data.text || '';
      const wordConfidences = (data.words || []).map(w => w.confidence || 0);
      ocrConfidence = wordConfidences.length > 0
        ? wordConfidences.reduce((s, c) => s + c, 0) / wordConfidences.length
        : 0;
      ocrConfidence = Math.round(ocrConfidence * 100) / 100;
      log('OCR complete: ' + ocrText.length + ' chars @ ' + ocrConfidence + '%');
    } catch (e) {
      log('OCR failed: ' + e.message);
      result.reasons.push('OCR processing failed: ' + e.message);
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    if (ocrText.trim().length < 5) {
      result.reasons.push('No readable text found in screenshot');
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    result.checks.push({
      name: 'ocr_completed',
      passed: true,
      details: { charCount: ocrText.length, confidence: ocrConfidence },
    });

    // PHASE 3: PARSE OCR TEXT
    log('Parsing OCR text...');
    const parsed = parseOCRText(ocrText);

    if (parsed.parserError) {
      log('Parser error: ' + (parsed.parserErrorDetail || 'unknown'));
      result.reasons.push('Could not parse payment details: ' + (parsed.parserErrorDetail || 'unknown'));
      result.verificationDuration = Date.now() - startTime;
      return result;
    }

    const ocrData = {
      rawText: parsed.rawText || ocrText,
      extractedAmount: parsed.extractedAmount,
      extractedUtr: parsed.extractedUtr,
      extractedReceiverUpi: parsed.extractedReceiverUpi,
      extractedSenderUpi: parsed.extractedSenderUpi,
      extractedDate: parsed.extractedDate,
      extractedTime: parsed.extractedTime,
      extractedStatus: parsed.extractedStatus,
      extractedBankName: parsed.extractedBankName,
      extractedTxnId: parsed.extractedTxnId,
      receiverName: parsed.receiverName,
      senderName: parsed.senderName,
      confidence: parsed.confidence || ocrConfidence,
      wordCount: parsed.wordCount,
      fieldCount: parsed.fieldCount,
    };
    result.ocrData = ocrData;
    log('Parsed: Amount=' + ocrData.extractedAmount + ', UTR=' + ocrData.extractedUtr + ', UPI=' + ocrData.extractedReceiverUpi + ', Date=' + ocrData.extractedDate + ', Status=' + ocrData.extractedStatus + ', App=' + ocrData.extractedBankName);

    // PHASE 4: VALIDATION CHECKS
    log('Running validation checks...');

    // Check 1: OCR Confidence
    const ocrConfidencePass = parsed.confidence >= OCR_THRESHOLD || ocrConfidence >= OCR_THRESHOLD;
    result.checks.push({
      name: 'ocr_confidence',
      passed: ocrConfidencePass,
      details: { confidence: parsed.confidence, threshold: OCR_THRESHOLD },
    });
    if (!ocrConfidencePass) {
      result.reasons.push('OCR confidence too low (' + Math.max(parsed.confidence, ocrConfidence) + '%, threshold ' + OCR_THRESHOLD + '%)');
    }

    // Check 2: Amount Match
    const amountMatch = matchesAmount(ocrData.extractedAmount, expectedAmount);
    result.matchedAmount = amountMatch;
    result.checks.push({
      name: 'amount_match',
      passed: amountMatch,
      details: { extracted: ocrData.extractedAmount, expected: expectedAmount },
    });
    if (!amountMatch) {
      result.reasons.push('Amount mismatch: extracted=' + ocrData.extractedAmount + ', expected=' + expectedAmount);
    }

    // Check 3: UPI Match
    const upiMatch = matchesUpiId(ocrData.extractedReceiverUpi, expectedUpi);
    result.matchedReceiver = upiMatch;
    result.checks.push({
      name: 'upi_match',
      passed: upiMatch,
      details: { extracted: ocrData.extractedReceiverUpi, expected: expectedUpi },
    });
    if (!upiMatch) {
      result.reasons.push('Receiver UPI mismatch: extracted=' + ocrData.extractedReceiverUpi + ', expected=' + expectedUpi);
    }

    // Check 4: UTR Valid Format
    const utrValid = validateUtrFormat(ocrData.extractedUtr);
    result.matchedUtr = utrValid;
    result.checks.push({
      name: 'utr_format',
      passed: utrValid,
      details: { extracted: ocrData.extractedUtr },
    });
    if (!utrValid) {
      result.reasons.push('Invalid UTR format: ' + ocrData.extractedUtr);
    }

    // Check 5: UTR Duplicate
    let utrDuplicate = { isDuplicate: false };
    if (utrValid && ocrData.extractedUtr) {
      utrDuplicate = await checkDuplicateUtr(ocrData.extractedUtr, orderId);
    }
    result.duplicateUtrDetected = utrDuplicate.isDuplicate;
    result.checks.push({
      name: 'utr_duplicate',
      passed: !utrDuplicate.isDuplicate,
      details: { extracted: ocrData.extractedUtr, isDuplicate: utrDuplicate.isDuplicate },
    });
    if (utrDuplicate.isDuplicate) {
      result.reasons.push('Duplicate UTR detected: ' + ocrData.extractedUtr + ' (existing payment: ' + utrDuplicate.existingPayment + ')');
    }

    // Check 6: Payment Status
    const statusMatch = matchesPaymentStatus(ocrData.extractedStatus);
    result.matchedStatus = statusMatch;
    result.checks.push({
      name: 'payment_status',
      passed: statusMatch,
      details: { extracted: ocrData.extractedStatus },
    });
    if (!statusMatch) {
      result.reasons.push('Payment status not SUCCESS: ' + ocrData.extractedStatus);
    }

    // Check 7: Date Validation
    const dateValid = isAllowedTimeWindow(ocrData.extractedDate);
    result.matchedDate = dateValid;
    result.checks.push({
      name: 'date_validation',
      passed: dateValid,
      details: { extracted: ocrData.extractedDate, windowDays: ALLOWED_DATE_WINDOW_DAYS },
    });
    if (!dateValid) {
      result.reasons.push('Date outside allowed window: ' + ocrData.extractedDate);
    }

    // Check 8: Time Validation
    const timeValid = isAllowedTimeOfDay(ocrData.extractedTime);
    result.checks.push({
      name: 'time_validation',
      passed: timeValid,
      details: { extracted: ocrData.extractedTime },
    });
    if (!timeValid) {
      result.reasons.push('Invalid time: ' + ocrData.extractedTime);
    }

    // Check 9: Image Integrity (non-cropped, non-blurred)
    const imageIntegrityPass = imageQuality.passed && imageQuality.cropRatio >= 0.5;
    result.checks.push({
      name: 'image_integrity',
      passed: imageIntegrityPass,
      details: { cropRatio: imageQuality.cropRatio, blurScore: imageQuality.blurScore },
    });

    // PHASE 5: FRAUD SCORING
    log('Calculating fraud score...');
    let fraudScore = 0;
    if (utrDuplicate.isDuplicate) fraudScore += 40;
    if (!amountMatch) fraudScore += 15;
    if (!upiMatch) fraudScore += 15;
    if (!statusMatch) fraudScore += 10;
    if (imageQuality.blurScore > 80) fraudScore += 10;
    if (imageQuality.cropRatio < 0.5) fraudScore += 10;
    if (!utrValid) fraudScore += 10;
    if (!dateValid) fraudScore += 5;
    if (imageQuality.darkScore > 80) fraudScore += 5;
    if (imageQuality.glareScore > 60) fraudScore += 5;
    fraudScore = Math.min(fraudScore, 100);
    result.fraudScore = fraudScore;

    // PHASE 6: DECISION ENGINE
    log('Making decision...');
    const requiredChecks = [amountMatch, upiMatch, statusMatch, utrValid, !utrDuplicate.isDuplicate, ocrConfidencePass, dateValid, imageIntegrityPass];
    const allRequiredPass = requiredChecks.every(Boolean);

    let finalStatus;
    let autoVerified = false;
    let score = 0;

    if (allRequiredPass) {
      finalStatus = 'verified';
      autoVerified = true;
      score = 100;
      result.reasons = ['All verification checks passed'];
      log('DECISION: VERIFIED — All checks passed');
    } else {
      const rejectTriggers = [];
      if (!amountMatch) rejectTriggers.push('amount_mismatch');
      if (!upiMatch) rejectTriggers.push('upi_mismatch');
      if (utrDuplicate.isDuplicate) rejectTriggers.push('duplicate_utr');
      if (!statusMatch && ocrData.extractedStatus && ocrData.extractedStatus.toUpperCase().includes('FAIL')) rejectTriggers.push('failed_payment');

      if (rejectTriggers.length >= 2) {
        finalStatus = 'rejected';
        autoVerified = true;
        score = 0;
        log('DECISION: REJECTED — ' + rejectTriggers.join(', '));
      } else if (rejectTriggers.length === 1 && !amountMatch) {
        finalStatus = 'rejected';
        autoVerified = true;
        score = 5;
        log('DECISION: REJECTED — Amount mismatch');
      } else if (!ocrConfidencePass && !amountMatch) {
        finalStatus = 'rejected';
        autoVerified = true;
        score = 5;
        log('DECISION: REJECTED — Low OCR confidence + amount mismatch');
      } else {
        finalStatus = 'pending_review';
        autoVerified = false;
        score = Math.round((requiredChecks.filter(Boolean).length / requiredChecks.length) * 100);
        log('DECISION: PENDING REVIEW — ' + result.reasons.join('; '));
      }
    }

    result.status = finalStatus;
    result.verificationScore = score;
    result.autoVerified = autoVerified;
    result.manualReviewRequired = !autoVerified;
    result.verificationDuration = Date.now() - startTime;

    metrics.trackOCR(autoVerified);

    log('Verification complete: ' + finalStatus + ' score=' + score + ' duration=' + result.verificationDuration + 'ms');

  } catch (e) {
    log('Verification error: ' + e.message);
    result.status = 'pending_review';
    result.reasons = ['Verification error: ' + e.message];
    result.manualReviewRequired = true;
    result.verificationDuration = Date.now() - startTime;
  }

  return result;
}

module.exports = { runAiVerification, VERIFY_TIMEOUT_MS };
