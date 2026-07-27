let Tesseract = null;
try { Tesseract = require('tesseract.js'); } catch (_) {}
const C = require('./config');
const log = require('./logger').OCR;

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
    log.error('', 'Tesseract.js not available — engine not loaded');
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: false, duration: Date.now() - t0 };
  }

  const stratArr = Array.isArray(strategies) && strategies.length > 0
    ? strategies
    : [{ name: 'default', buf: null }];

  const toRun = stratArr.filter(s => s.buf);
  if (toRun.length === 0) {
    log.error('', 'No strategies with image buffers to process');
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: true, duration: Date.now() - t0 };
  }

  const results = [];
  let worker = null;

  try {
    log.info('', 'Creating shared Tesseract worker (lang=eng)...');
    const workerT0 = Date.now();
    worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
    log.info('', 'Worker created in ' + (Date.now() - workerT0) + 'ms');

    for (const strat of toRun) {
      const stratT0 = Date.now();
      try {
        log.info('', 'Running OCR on strategy: ' + strat.name + ' (' + strat.buf.length + ' bytes)...');
        const data = await Promise.race([
          worker.recognize(strat.buf),
          new Promise((_, reject) => setTimeout(() => reject(new Error('TESSERACT_SINGLE_TIMEOUT')), C.OCR_ENGINE_TIMEOUT_MS)),
        ]);
        const avgConf = wordConfidence(data);
        const medConf = medianConfidence(data);
        const text = (data.text || '').trim();
        results.push({
          strategy: strat.name,
          text,
          confidence: Math.round(avgConf * 100) / 100,
          medianConfidence: Math.round(medConf * 100) / 100,
          wordCount: (data.words || []).length,
          words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence || 0, bbox: w.bbox || null })),
        });
        log.info('', strat.name + ': ' + text.length + ' chars, conf=' + Math.round(avgConf) + '% (' + (Date.now() - stratT0) + 'ms)');
        if (avgConf >= 60) {
          log.info('', 'Confidence ' + Math.round(avgConf) + '% >= 60 — accepting result, skipping remaining strategies');
          break;
        }
      } catch (e) {
        log.error('', strat.name + ' failed: ' + e.message + ' (' + (Date.now() - stratT0) + 'ms)');
      }
    }
  } catch (e) {
    log.error('', 'Worker creation failed: ' + e.message);
  } finally {
    try { if (worker) await worker.terminate(); } catch (_) {}
  }

  if (results.length === 0) {
    log.error('', 'OCR produced 0 results from ' + toRun.length + ' strategies');
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
