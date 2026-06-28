/**
 * ⚠️ DEPRECATED — Superseded by _ai_bridge.js (calls the full 8-stage AI engine).
 * 
 * PaddleOCR Node.js wrapper.
 * Downloads screenshot → spawns Python PaddleOCR pipeline → returns structured JSON.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const PYTHON_PATH = 'C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT_PATH = path.join(__dirname, '_paddle_ocr.py');

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

async function analyzeWithPaddleOCR(imageUrl) {
  let tempPath = null;
  try {
    const rawBuf = await fetchBufferFromURL(imageUrl);
    const ext = guessExtension(rawBuf);
    const tempDir = os.tmpdir();
    const tempName = 'paddle_' + crypto.randomBytes(8).toString('hex') + ext;
    tempPath = path.join(tempDir, tempName);
    fs.writeFileSync(tempPath, rawBuf);

    const result = await runPythonScript(tempPath);
    return result;
  } catch (e) {
    return {
      error: 'PaddleOCR analysis failed: ' + e.message,
      ocr: { blocks: [], all_text: [], fields: {}, confidence: 0 },
      visualValidation: { isBlurred: false, isTampered: false, isCropped: false, perceptualHash: '', blurScore: 0, tamperScore: 0, issues: [] },
    };
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function runPythonScript(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_PATH, [SCRIPT_PATH, imagePath], {
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Python exited code=' + code + ', stderr=' + stderr.substring(0, 200)));
        return;
      }
      try {
        const output = JSON.parse(stdout);
        resolve(output);
      } catch (e) {
        reject(new Error('Failed to parse Python output: ' + e.message + ', raw=' + stdout.substring(0, 300)));
      }
    });
    child.on('error', reject);
  });
}

function guessExtension(buf) {
  if (!buf || buf.length < 4) return '.jpg';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  return '.jpg';
}

/**
 * Maps the Python pipeline output into the format expected by _verificationEngine.js.
 * Returns { ocrResult, visualValidation, imageQuality } compatible with the existing interface.
 */
function mapToVerificationFormat(pipelineOutput) {
  const fallback = {
    ocrResult: {
      ocrAvailable: false,
      ocrText: '',
      confidence: 0,
      imageHash: '',
      wordData: [],
      dimensions: { width: 0, height: 0 },
      error: 'PaddleOCR pipeline did not return usable results',
    },
    visualValidation: {
      isScreenshot: false,
      isTampered: false,
      isBlurred: false,
      isCropped: false,
      perceptualHash: '',
      blurScore: 0,
      tamperScore: 0,
      issues: [],
    },
    imageQuality: {
      passed: false,
      overallGrade: 'poor',
      issues: ['PaddleOCR returned no data'],
    },
    parsed: null,
  };

  if (!pipelineOutput || pipelineOutput.error) {
    return { ...fallback, error: pipelineOutput ? pipelineOutput.error : 'No output from pipeline' };
  }

  const vv = pipelineOutput.visualValidation || {};
  const ocr = pipelineOutput.ocr || {};
  const fields = ocr.fields || {};

  const ocrAvailable = !pipelineOutput.error && (ocr.blocks || []).length > 0;
  const allText = (ocr.all_text || []).join('\n');

  const imageHash = vv.perceptualHash || crypto.createHash('sha256').update(allText).digest('hex');

  const visualPassed = !vv.isTampered && vv.isScreenshot !== false;
  const blurIssue = vv.isBlurred ? 'Blurry screenshot (score=' + vv.blurScore + ')' : null;
  const cropIssue = vv.isCropped ? 'Cropped screenshot detected' : null;
  const tamperIssue = vv.isTampered ? 'Tampering detected (score=' + vv.tamperScore + ')' : null;
  const screenshotIssue = vv.isScreenshot === false ? 'Not a standard screenshot' : null;
  const issues = [blurIssue, cropIssue, tamperIssue, screenshotIssue].filter(Boolean);
  const passed = issues.length === 0;

  let overallGrade = 'good';
  if (vv.isTampered || vv.isBlurred) overallGrade = 'fair';
  if (issues.length >= 2 || (vv.tamperScore || 0) >= 60) overallGrade = 'poor';

  return {
    ocrResult: {
      ocrAvailable,
      ocrText: allText,
      confidence: ocr.confidence || 0,
      imageHash,
      wordData: (ocr.blocks || []).map(b => ({
        text: b.text,
        confidence: b.confidence,
        bbox: b.bbox,
      })),
      dimensions: { width: 0, height: 0 },
      error: null,
      rawFields: fields,
      layout: ocr.layout || {},
      allBlocks: ocr.blocks || [],
    },
    visualValidation: {
      isScreenshot: vv.isScreenshot !== false,
      isTampered: !!vv.isTampered,
      isBlurred: !!vv.isBlurred,
      isCropped: !!vv.isCropped,
      perceptualHash: vv.perceptualHash || '',
      blurScore: vv.blurScore || 0,
      tamperScore: vv.tamperScore || 0,
      issues: vv.issues || [],
    },
    imageQuality: {
      passed,
      overallGrade,
      issues,
      blurScore: vv.blurScore || 0,
      cropRatio: vv.isCropped ? 0.5 : 1.0,
    },
    parsed: {
      rawText: allText,
      extractedAmount: fields.amount ? parseFloat(fields.amount.value) : null,
      extractedUtr: fields.utr ? fields.utr.value : null,
      extractedReceiverUpi: fields.receiverUpi ? fields.receiverUpi.value : null,
      extractedSenderUpi: fields.senderUpi ? fields.senderUpi.value : null,
      extractedDate: fields.date ? fields.date.value : null,
      extractedTime: fields.time ? fields.time.value : null,
      extractedStatus: fields.status ? fields.status.value : null,
      extractedBankName: fields.bank ? fields.bank.value : (fields.appName ? fields.appName.value : null),
      extractedTxnId: null,
      receiverName: null,
      senderName: null,
      confidence: computeParsedConfidence(fields),
      wordCount: allText.split(/\s+/).length,
      fieldCount: Object.values(fields).filter(f => f && f.value).length,
      ambiguous: false,
      parserError: !ocrAvailable,
      parserErrorDetail: !ocrAvailable ? 'No text extracted from screenshot' : null,
      appName: fields.appName ? fields.appName.value : null,
      ocrConfidence: ocr.confidence || 0,
    },
  };
}

function computeParsedConfidence(fields) {
  let score = 0;
  const weights = { amount: 20, utr: 20, receiverUpi: 15, date: 10, status: 10, time: 5, bank: 5, senderUpi: 5 };
  for (const [field, weight] of Object.entries(weights)) {
    if (fields[field] && fields[field].value) score += weight;
  }
  return Math.min(100, score);
}

module.exports = { analyzeWithPaddleOCR, mapToVerificationFormat, fetchBufferFromURL };
