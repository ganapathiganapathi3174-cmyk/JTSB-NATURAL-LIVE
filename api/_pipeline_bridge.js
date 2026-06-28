// ⚠️ DEPRECATED — Superseded by _ai_bridge.js (8-stage AI engine pipeline).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const PYTHON_PATH = 'C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT_PATH = path.join(__dirname, '_pipeline.py');

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

async function analyzeWithPipeline(imageUrl) {
  let tempPath = null;
  try {
    const rawBuf = await fetchBufferFromURL(imageUrl);
    const ext = guessExtension(rawBuf);
    const tempDir = os.tmpdir();
    const tempName = 'pipeline_' + crypto.randomBytes(8).toString('hex') + ext;
    tempPath = path.join(tempDir, tempName);
    fs.writeFileSync(tempPath, rawBuf);

    const result = await runPythonScript(tempPath);
    return result;
  } catch (e) {
    return {
      error: 'Pipeline analysis failed: ' + e.message,
      imageValidation: { passed: false, grade: 'poor', issues: [e.message] },
      layout: { regions: {}, horizontalSeparators: [], detected: false },
      ocr: { blocks: [], engineStats: {}, primaryEngine: 'none', fallbackUsed: false },
      fields: {},
      fieldsNormalized: {},
      pipelineLog: [],
      earlyExit: true,
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
      env: { ...process.env, PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True', PYTHONIOENCODING: 'utf-8' },
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

function mapToVerificationFormat(pipelineOutput) {
  const fallback = {
    ocrResult: {
      ocrAvailable: false,
      ocrText: '',
      confidence: 0,
      imageHash: '',
      wordData: [],
      dimensions: { width: 0, height: 0 },
      error: 'Pipeline did not return usable results',
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
      issues: ['Pipeline returned no data'],
    },
    parsed: null,
  };

  if (!pipelineOutput || pipelineOutput.error) {
    return { ...fallback, error: pipelineOutput ? pipelineOutput.error : 'No output from pipeline' };
  }

  const iv = pipelineOutput.imageValidation || {};
  const ocr = pipelineOutput.ocr || {};
  const fields = pipelineOutput.fieldsNormalized || pipelineOutput.fields || {};

  const allBlocks = ocr.blocks || [];
  const allText = allBlocks.map(b => b.text).join('\n');

  const isBlurred = (iv.blurScore || 0) < 50;
  const isCropped = !!iv.isCropped;
  const isTampered = iv.tamperScore >= 40;
  const perceptualHash = iv.perceptualHash || '';

  const issues = [];
  if (isBlurred) issues.push('Blurry screenshot (score=' + iv.blurScore + ')');
  if (isCropped) issues.push('Cropped screenshot detected');
  if (isTampered) issues.push('Tampering detected (score=' + iv.tamperScore + ')');
  if (iv.issues) issues.push(...iv.issues.filter(i => !i.includes('Blurry') && !i.includes('Cropped') && !i.includes('Tamper')));

  const passed = issues.length === 0 && iv.passed !== false;
  const overallGrade = iv.grade || 'good';

  const avgConfidence = allBlocks.length > 0
    ? Math.round(allBlocks.reduce((s, b) => s + b.confidence, 0) / allBlocks.length * 100) / 100
    : 0;

  return {
    ocrResult: {
      ocrAvailable: allBlocks.length > 0,
      ocrText: allText,
      confidence: avgConfidence,
      imageHash: perceptualHash || crypto.createHash('sha256').update(allText).digest('hex'),
      wordData: allBlocks.map(b => ({
        text: b.text,
        confidence: b.confidence,
        bbox: b.bbox,
      })),
      dimensions: { width: (iv.resolution || {}).width || 0, height: (iv.resolution || {}).height || 0 },
      error: null,
      rawFields: fields,
      layout: pipelineOutput.layout || {},
      allBlocks: allBlocks,
    },
    visualValidation: {
      isScreenshot: !iv.issues || iv.issues.length < 3,
      isTampered,
      isBlurred,
      isCropped,
      perceptualHash,
      blurScore: iv.blurScore || 0,
      tamperScore: iv.tamperScore || 0,
      issues: iv.issues || [],
    },
    imageQuality: {
      passed,
      overallGrade,
      issues,
      blurScore: iv.blurScore || 0,
      cropRatio: iv.cropRatio || 1.0,
      elaScore: iv.elaScore || 0,
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
      extractedBankName: fields.bank ? fields.bank.value : null,
      extractedTxnId: fields.googleTxnId ? fields.googleTxnId.value : null,
      receiverName: fields.receiverName ? fields.receiverName.value : null,
      senderName: fields.senderName ? fields.senderName.value : null,
      confidence: computeParsedConfidence(fields),
      wordCount: allText.split(/\s+/).length,
      fieldCount: Object.values(fields).filter(f => f && f.value).length,
      ambiguous: false,
      parserError: allBlocks.length === 0,
      parserErrorDetail: allBlocks.length === 0 ? 'No text extracted from screenshot' : null,
      appName: fields.appName ? fields.appName.value : null,
      ocrConfidence: avgConfidence,
    },
  };
}

function computeParsedConfidence(fields) {
  let score = 0;
  const weights = { amount: 20, utr: 20, receiverUpi: 15, date: 10, status: 10, time: 5, bank: 5, senderUpi: 5, receiverName: 3, senderName: 3, googleTxnId: 4 };
  for (const [field, weight] of Object.entries(weights)) {
    if (fields[field] && fields[field].value) score += weight;
  }
  return Math.min(100, score);
}

module.exports = { analyzeWithPipeline, mapToVerificationFormat, fetchBufferFromURL };
