const C = require('./config.js');

let worker = null;

async function getWorker() {
  if (worker) return worker;
  const Tesseract = require('tesseract.js');
  worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
  return worker;
}

async function extractText(image) {
  const w = await getWorker();
  const { data } = await w.recognize(image.buffer);
  return {
    raw: data.text || '',
    confidence: data.confidence || 0,
    blocks: data.blocks || [],
    lines: data.lines || [],
    words: data.words || [],
  };
}

async function ocr(image, retries) {
  const maxAttempts = 1 + (retries || C.MAX_OCR_RETRIES);
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await extractText(image);
      if (result.raw.trim().length > 10) return result;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { raw: '', confidence: 0, blocks: [], lines: [], words: [] };
}

module.exports = { ocr, extractText };
