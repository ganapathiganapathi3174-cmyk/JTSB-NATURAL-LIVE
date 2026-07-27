let Tesseract = null;
try { Tesseract = require('tesseract.js'); } catch (_) {}
const C = require('./config');
const log = require('./logger').OCR;

async function runTesseractWorker(buffer, lang) {
  let worker = null;
  try {
    worker = await Tesseract.createWorker(lang || 'eng', 1, {
      logger: () => {},
    });
    const result = await Promise.race([
      worker.recognize(buffer),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TESSERACT_TIMEOUT')), C.OCR_ENGINE_TIMEOUT_MS)),
    ]);
    return result.data;
  } finally {
    try { if (worker) await worker.terminate(); } catch (_) {}
  }
}

function wordConfidence(data) {
  const words = (data.words || []).filter(w => (w.text || '').trim().length > 0);
  if (words.length === 0) return 0;
  return words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length;
}

function medianConfidence(data) {
  const words = (data.words || []).map(w => w.confidence || 0).sort((a, b) => a - b);
  if (words.length === 0) return 0;
  const mid = Math.floor(words.length / 2);
  return words.length % 2 !== 0 ? words[mid] : (words[mid - 1] + words[mid]) / 2;
}

function majorityVote(results) {
  const fieldPatterns = {
    amount: /(?:RS|INR|₹)\s*[:.]?\s*[\d,]+\.?\d{0,2}/i,
    utr: /(?:UPI\s*(?:REF|REFERENCE|TXN|TRXN)?)\s*(?:No|ID|REF)?\.?\s*:?\s*[A-Z0-9]{10,}/i,
    receiver_upi: /[\w.\-]+@[\w.]+/,
    status: /\b(?:SUCCESS|SUCCESSFUL|COMPLETED|PAID|CREDITED|DEBITED|FAILED|PENDING)\b/i,
    date: /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
    time: /\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/i,
  };
  const votes = {};
  for (const key of Object.keys(fieldPatterns)) votes[key] = [];
  for (const r of results) {
    const text = r.text || '';
    for (const [key, pat] of Object.entries(fieldPatterns)) {
      if (pat.test(text)) votes[key].push(true);
      else votes[key].push(false);
    }
  }
  const consensus = {};
  const n = results.length || 1;
  for (const [key, arr] of Object.entries(votes)) {
    const trueCount = arr.filter(Boolean).length;
    consensus[key] = { present: trueCount >= Math.ceil(n * 0.5), agreement: Math.round((trueCount / n) * 100), votes: trueCount + '/' + n };
  }
  return consensus;
}

async function run(strategies) {
  const t0 = Date.now();
  if (!Tesseract) {
    log.error('', 'Tesseract.js not available');
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: false, duration: Date.now() - t0 };
  }
  const results = [];
  const stratArr = Array.isArray(strategies) && strategies.length > 0
    ? strategies
    : [{ name: 'default', buf: null }];

  const maxStrategies = 2;
  const toRun = stratArr.filter(s => s.buf).slice(0, maxStrategies);

  for (const strat of toRun) {
    try {
      const data = await runTesseractWorker(strat.buf);
      const avgConf = wordConfidence(data);
      const medConf = medianConfidence(data);
      results.push({
        strategy: strat.name,
        text: (data.text || '').trim(),
        confidence: Math.round(avgConf * 100) / 100,
        medianConfidence: Math.round(medConf * 100) / 100,
        wordCount: (data.words || []).length,
        words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence || 0, bbox: w.bbox || null })),
      });
      log.info('', strat.name + ': ' + (data.text || '').length + ' chars, conf=' + Math.round(avgConf) + '%');
      if (avgConf >= 60 && results.length >= 1) break;
    } catch (e) {
      log.error('', strat.name + ' failed: ' + e.message);
    }
  }

  if (results.length === 0) {
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: true, duration: Date.now() - t0 };
  }

  results.sort((a, b) => {
    const scoreA = a.confidence * 0.6 + a.text.length * 0.01 + a.wordCount * 0.3;
    const scoreB = b.confidence * 0.6 + b.text.length * 0.01 + b.wordCount * 0.3;
    return scoreB - scoreA;
  });

  const best = results[0];
  const consensus = majorityVote(results.filter(r => r.text.length > 5));

  log.info('', 'Best: ' + best.strategy + ' (' + best.text.length + ' chars, ' + Math.round(best.confidence) + '%)');
  log.info('', 'Multi-engine OCR complete: ' + results.length + ' strategies (' + (Date.now() - t0) + 'ms)');

  return { results, bestResult: best, bestStrategy: best.strategy, consensus, engineAvailable: true, duration: Date.now() - t0 };
}

module.exports = { run };
