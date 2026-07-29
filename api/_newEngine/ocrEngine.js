const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const C = require('./config.js');
const bridge = require('./bridge.js');
const { fetchBufferFromURL } = require('./imageValidator.js');

let tesseractWorker = null;

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  const Tesseract = require('tesseract.js');
  tesseractWorker = await Tesseract.createWorker(C.TESSERACT_LANG, C.TESSERACT_CONFIG, { logger: () => {} });
  return tesseractWorker;
}

async function runTesseract(imagePath) {
  const t0 = Date.now();
  try {
    const worker = await getTesseractWorker();
    const { data } = await worker.recognize(imagePath);
    return {
      success: true, engine: 'tesseract', blocks: [],
      raw: data.text || '', confidence: data.confidence || 0,
      duration: Date.now() - t0, error: null,
    };
  } catch (e) {
    return { success: false, engine: 'tesseract', blocks: [], raw: '', confidence: 0, duration: Date.now() - t0, error: e.message };
  }
}

function guessExtension(buf) {
  if (!buf || buf.length < 4) return '.jpg';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  return '.jpg';
}

async function runAllEngines(screenshotUrl, screenshotBuf) {
  const result = {
    engines: {}, combinedText: '', engineCount: 0,
    avgConfidence: 0, rawText: '',
  };

  let buf = screenshotBuf;
  if (!buf && screenshotUrl) {
    try {
      const mod = screenshotUrl.startsWith('https') ? require('https') : require('http');
      buf = await new Promise((resolve, reject) => {
        const req = mod.get(screenshotUrl, { timeout: 30000 }, (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error('HTTP ' + res.statusCode)); return; }
          const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c)));
        });
        req.on('error', reject); req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
      });
    } catch (e) {
      result.engines.fetch = { success: false, error: e.message };
      return result;
    }
  }

  if (!buf) { result.engines.fetch = { success: false, error: 'No image buffer' }; return result; }

  const ext = guessExtension(buf);
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, 'ocr_' + crypto.randomBytes(8).toString('hex') + ext);
  try { fs.writeFileSync(tempPath, buf); } catch (e) { result.engines.save = { success: false, error: e.message }; return result; }

  const promises = [];

  promises.push(
    runTesseract(tempPath).then(r => { result.engines.tesseract = r; return r; })
  );

  const pyAvailable = bridge.detectPython();
  if (pyAvailable) {
    promises.push(
      bridge.runPaddleOCR(tempPath, C.OCR_TIMEOUT_MS).then(r => { result.engines.paddleocr = r; return r; })
    );
    promises.push(
      bridge.runEasyOCR(tempPath, C.OCR_TIMEOUT_MS).then(r => { result.engines.easyocr = r; return r; })
    );
  }

  await Promise.allSettled(promises);

  try { fs.unlinkSync(tempPath); } catch {}

  const allTexts = [];
  let totalConf = 0;
  let confCount = 0;

  for (const [name, eng] of Object.entries(result.engines)) {
    if (eng.success) {
      const text = eng.raw || (eng.blocks || []).map(b => b.text || '').join(' ');
      allTexts.push(text);
      if (eng.confidence) { totalConf += eng.confidence; confCount++; }
    }
  }

  result.engineCount = Object.values(result.engines).filter(e => e.success).length;
  result.combinedText = allTexts.join('\n');
  result.rawText = result.combinedText;
  result.avgConfidence = confCount > 0 ? Math.round(totalConf / confCount) : 0;

  return result;
}

getTesseractWorker().then(() => {
  console.log('[OCR] Tesseract.js worker warmed up');
}).catch(e => {
  console.warn('[OCR] Tesseract.js warmup failed (deferred): ' + e.message);
});

module.exports = { runAllEngines, runTesseract, getTesseractWorker };
