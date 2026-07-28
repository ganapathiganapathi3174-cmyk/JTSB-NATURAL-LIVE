let Tesseract = null;
try { Tesseract = require('tesseract.js'); } catch (_) {}
const log = require('./logger').OCR;

const DEFAULT_OCR_BUDGET_MS = 3000;

function wordConfidence(data) {
  const words = (data.words || []).filter(w => (w.text || '').trim().length > 0);
  if (words.length === 0) return 0;
  return words.reduce((s, w) => s + (w.confidence || 0), 0) / words.length;
}

async function run(strategies, budgetMs) {
  const t0 = Date.now();
  const budget = budgetMs || DEFAULT_OCR_BUDGET_MS;

  if (!Tesseract) {
    log.error('', 'Tesseract.js not available');
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: false, duration: Date.now() - t0 };
  }

  const toRun = (Array.isArray(strategies) ? strategies : []).filter(s => s.buf);
  if (toRun.length === 0) {
    return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: true, duration: Date.now() - t0 };
  }

  const results = [];
  let worker = null;

  try {
    const workerT0 = Date.now();
    worker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
    const workerMs = Date.now() - workerT0;
    log.info('', 'Worker created in ' + workerMs + 'ms (budget=' + budget + 'ms)');

    if (workerMs > budget * 0.5) {
      log.error('', 'Worker creation took ' + workerMs + 'ms (>' + Math.round(budget * 0.5) + 'ms), skipping OCR');
      return { results: [], bestResult: null, bestStrategy: null, consensus: null, engineAvailable: true, duration: Date.now() - t0, error: 'worker_create_slow' };
    }

    for (const strat of toRun) {
      const remaining = budget - (Date.now() - t0);
      if (remaining < 500) {
        log.info('', 'Budget exhausted after ' + (Date.now() - t0) + 'ms, skipping remaining strategies');
        break;
      }

      const stratT0 = Date.now();
      try {
        const stratTimeout = Math.min(remaining, 2500);
        log.info('', strat.name + ': ' + strat.buf.length + ' bytes, timeout=' + stratTimeout + 'ms');
        let stratTimeoutId;
        const data = await Promise.race([
          worker.recognize(strat.buf),
          new Promise((_, reject) => { stratTimeoutId = setTimeout(() => reject(new Error('STRAT_TIMEOUT')), stratTimeout); }),
        ]);
        clearTimeout(stratTimeoutId);
        const avgConf = wordConfidence(data);
        const text = (data.text || '').trim();
        results.push({
          strategy: strat.name,
          text,
          confidence: Math.round(avgConf * 100) / 100,
          medianConfidence: 0,
          wordCount: (data.words || []).length,
          words: (data.words || []).map(w => ({ text: w.text, confidence: w.confidence || 0, bbox: w.bbox || null })),
        });
        log.info('', strat.name + ': ' + text.length + ' chars, conf=' + Math.round(avgConf) + '% (' + (Date.now() - stratT0) + 'ms)');
        if (avgConf >= 60) {
          log.info('', 'Confidence ' + Math.round(avgConf) + '% >= 60 — early exit');
          break;
        }
      } catch (e) {
        clearTimeout(stratTimeoutId);
        log.error('', strat.name + ' failed: ' + e.message + ' (' + (Date.now() - stratT0) + 'ms)');
      }
    }
  } catch (e) {
    log.error('', 'Worker error: ' + e.message);
  } finally {
    try { if (worker) await worker.terminate(); } catch (_) {}
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
  log.info('', 'OCR complete: ' + results.length + ' results, best=' + best.text.length + ' chars (' + (Date.now() - t0) + 'ms/' + budget + 'ms budget)');

  return { results, bestResult: best, bestStrategy: best.strategy, consensus: null, engineAvailable: true, duration: Date.now() - t0 };
}

module.exports = { run };
