const { analyzeImageIntegrity } = require('./_imageIntegrity.js');
const { analyzeWithAI } = require('./_aiVision.js');
const { runVoting, mergeWithExisting } = require('./_votingEngine.js');
const { validateBusinessRules } = require('./_businessRules.js');
const { detectFraud } = require('./_fraudDetection.js');
const { makeDecision } = require('./_decisionEngine.js');
const { fetchBufferFromURL } = require('./_pipeline_bridge.js');
const { ADMIN_UPI_ID, ALLOWED_PACKAGE_AMOUNTS } = require('./_shared.js');

function log(msg) {
  console.log(`[AI-PIPELINE] ${msg}`);
}

async function runPipeline({
  imageUrl,
  expectedAmount,
  expectedUpiId,
  expectedUtr,
  expectedDate,
  existingHashes,
  existingUtrs,
  allowedAmounts,
}) {
  const tStart = Date.now();
  const pipelineId = Math.random().toString(36).substring(2, 10);
  log(`[${pipelineId}] Starting AI verification pipeline`);

  const result = {
    pipelineId,
    status: 'failed',
    decision: 'MANUAL_REVIEW',
    confidence: 0,
    fraudScore: 0,
    imageScore: 0,
    visionConfidence: 0,
    ocrConfidence: 0,
    matchedFields: {},
    reasons: [],
    imageIntegrity: null,
    visionAnalysis: null,
    ocrResults: [],
    votingResult: null,
    businessRules: null,
    fraudDetection: null,
    decisionResult: null,
    duration: 0,
    error: null,
  };

  try {
    const imageBuffer = await fetchBufferFromURL(imageUrl);
    log(`[${pipelineId}] Image fetched: ${(imageBuffer.length / 1024).toFixed(1)}KB`);

    const imageIntegrity = await analyzeImageIntegrity(imageBuffer, imageUrl);
    result.imageIntegrity = imageIntegrity;
    result.imageScore = imageIntegrity.imageScore;
    log(`[${pipelineId}] Stage 1 - Image Integrity: score=${imageIntegrity.imageScore}, edited=${imageIntegrity.isEdited}`);

    const visionResult = await analyzeWithAI(imageBuffer, imageUrl);
    result.visionAnalysis = visionResult;
    result.visionConfidence = visionResult.confidence;
    log(`[${pipelineId}] Stage 2 - AI Vision: confidence=${visionResult.confidence}, available=${visionResult.visionAvailable}`);

    const ocrResults = await runMultiOCR(imageBuffer, imageUrl);
    result.ocrResults = ocrResults;
    log(`[${pipelineId}] Stage 3 - Multi-OCR: ${ocrResults.length} engines executed`);

    let votingResult = runVoting(ocrResults, visionResult);
    votingResult = mergeWithExisting(votingResult, {
      amount: expectedAmount,
      utr: expectedUtr,
      upi_id: expectedUpiId,
    });
    result.votingResult = votingResult;
    result.ocrConfidence = votingResult.overallConfidence;
    log(`[${pipelineId}] Stage 4 - Voting: ${votingResult.fieldCount} fields, confidence=${votingResult.overallConfidence}%`);

    const businessRules = validateBusinessRules(votingResult, {
      amount: expectedAmount,
      upiId: expectedUpiId,
      utr: expectedUtr,
      date: expectedDate,
      allowedAmounts: allowedAmounts || ALLOWED_PACKAGE_AMOUNTS,
    });
    result.businessRules = businessRules;
    log(`[${pipelineId}] Stage 5 - Business Rules: ${businessRules.overallPassed ? 'PASSED' : 'FAILED'}`);

    const fraudResult = await detectFraud(imageBuffer, votingResult, {
      existingHashes: existingHashes || [],
      existingUtrs: existingUtrs || [],
    });
    result.fraudDetection = fraudResult;
    result.fraudScore = fraudResult.score;
    log(`[${pipelineId}] Stage 6 - Fraud Detection: score=${fraudResult.score}, risk=${fraudResult.riskLevel}`);

    const decisionResult = await makeDecision(result);
    result.decisionResult = decisionResult;
    result.decision = decisionResult.decision;
    result.confidence = decisionResult.score;
    result.matchedFields = decisionResult.matchedFields;
    result.reasons = decisionResult.reasons;
    result.status = decisionResult.autoApproved
      ? 'verified'
      : decisionResult.autoRejected
        ? 'rejected'
        : 'manual_review';

    log(`[${pipelineId}] Stage 7 - Decision: ${decisionResult.decision}, confidence=${decisionResult.score}%`);
  } catch (err) {
    log(`[${pipelineId}] Pipeline error: ${err.message}`);
    result.error = err.message;
    result.reasons.push(`Pipeline error: ${err.message}`);
  }

  result.duration = Date.now() - tStart;
  log(`[${pipelineId}] Pipeline complete: ${result.status}, duration=${result.duration}ms`);
  return result;
}

async function runMultiOCR(imageBuffer, imageUrl) {
  const results = [];
  const Tesseract = require('tesseract.js');

  try {
    log('Running Tesseract.js OCR');
    const tResult = await Tesseract.recognize(imageBuffer, 'eng', {
      logger: () => {},
    });
    const tesseractData = parseTesseractResult(tResult);
    if (tesseractData) results.push(tesseractData);
    log(`Tesseract: ${tesseractData ? 'OK' : 'FAILED'}`);
  } catch (err) {
    log(`Tesseract error: ${err.message}`);
  }

  const Jimp = require('jimp');
  try {
    const img = await Jimp.read(imageBuffer);
    const buf = await img.contrast(0.1).normalize().getBufferAsync(Jimp.MIME_JPEG);
    const tResult2 = await Tesseract.recognize(buf, 'eng', { logger: () => {} });
    const enhancedData = parseTesseractResult(tResult2);
    if (enhancedData) {
      enhancedData.source = 'tesseract-enhanced';
      results.push(enhancedData);
    }
    log(`Tesseract Enhanced: ${enhancedData ? 'OK' : 'FAILED'}`);
  } catch (err) {
    log(`Tesseract Enhanced error: ${err.message}`);
  }

  return results;
}

function parseTesseractResult(tResult) {
  try {
    const { data } = tResult;
    if (!data || !data.text || data.text.trim().length < 5) return null;

    const text = data.text;
    const words = data.words || [];
    const confidence = data.confidence || 0;

    const blockConfidences = words.map(w => w.confidence).filter(c => c > 0);
    const avgConfidence = blockConfidences.length > 0
      ? Math.round(blockConfidences.reduce((s, c) => s + c, 0) / blockConfidences.length * 10) / 10
      : 0;

    const source = data.source ? `tesseract-${data.source}` : 'tesseract';

    return {
      source,
      text,
      confidence: avgConfidence,
      words: words.map(w => ({
        text: w.text,
        confidence: w.confidence,
        bbox: w.bbox,
      })),
      amount: extractField(text, 'amount'),
      utr: extractField(text, 'utr'),
      upi: extractField(text, 'upi'),
      date: extractField(text, 'date'),
      time: extractField(text, 'time'),
      status: extractField(text, 'status'),
      bank: extractField(text, 'bank'),
      appName: extractField(text, 'appName'),
    };
  } catch {
    return null;
  }
}

function extractField(text, field) {
  if (!text) return null;

  const patterns = {
    amount: [
      /(?:₹|rs\.?\s*|inr\s*)\s*([\d,]+\.?\d{0,2})/i,
      /(?:amount|amt|total|paid)\s*:?\s*₹?\s*([\d,]+\.?\d{0,2})/i,
      /\b(\d{3,}\.?\d{0,2})\b/,
    ],
    utr: [
      /(?:utr|neft\s*utr|upi\s*ref|transaction\s*(?:id|no|number)|txn\s*(?:id|no)?)\s*:?\s*([A-Z0-9]{10,})/i,
      /(?:bank\s*ref|rrn|reference\s*(?:no|number)?)\s*:?\s*([A-Z0-9]{10,})/i,
      /\b(\d{12,22})\b/,
    ],
    upi: [
      /([\w.\-]+@[\w.]+)/i,
    ],
    date: [
      /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i,
      /(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})/,
      /(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})/,
    ],
    time: [
      /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:AM|PM|am|pm)?/,
    ],
    status: [
      /(SUCCESS|SUCCESSFUL|COMPLETED|PAID|FAILED|REJECTED|PENDING|PROCESSING)/i,
    ],
    bank: [
      /(HDFC|ICICI|SBI|AXIS|KOTAK|YES\s*BANK|PNB|CANARA|BOB|UNION\s*BANK|IDBI|INDUSIND|FEDERAL|RBL|BANDHAN|HSBC|CITI|IDFC)/i,
    ],
    appName: [
      /(Google\s*Pay|GPay|PhonePe|Paytm|BHIM|Amazon\s*Pay|CRED|WhatsApp|MobiKwik|Freecharge|JioPay|Airtel)/i,
    ],
  };

  const fieldPatterns = patterns[field];
  if (!fieldPatterns) return null;

  for (const pat of fieldPatterns) {
    const m = text.match(pat);
    if (m) {
      const value = m[0].trim();
      return { value, confidence: 80, source: 'tesseract' };
    }
  }

  return null;
}

module.exports = { runPipeline };
