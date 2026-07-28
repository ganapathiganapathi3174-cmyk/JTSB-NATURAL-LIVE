const C = require('./config');
const log = require('./logger').OCR;

let workerPromise = null;
let workerReady = false;

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    try {
      const Tesseract = require('tesseract.js');
      const w = await Tesseract.createWorker('eng', 1, { logger: () => {} });
      workerReady = true;
      log.info('Tesseract.js worker ready');
      return { worker: w, Tesseract };
    } catch (e) {
      workerReady = false;
      log.error('Failed to create Tesseract worker: ' + e.message);
      return null;
    }
  })();
  return workerPromise;
}

async function recognizeStrategy(worker, buf, strategyName) {
  const t0 = Date.now();
  try {
    const result = await worker.recognize(buf);
    const text = (result.data.text || '').trim();
    const confidence = result.data.confidence || 0;
    const words = result.data.words || [];
    log.info('Strategy "' + strategyName + '": ' + text.length + ' chars, conf=' + confidence.toFixed(1) + '%, ' + (Date.now() - t0) + 'ms');
    return { text, confidence, words, strategyName, duration: Date.now() - t0 };
  } catch (e) {
    log.warn('Strategy "' + strategyName + '" failed: ' + e.message);
    return null;
  }
}

async function run(strategies, timeoutMs) {
  const t0 = Date.now();
  if (!strategies || strategies.length === 0) {
    log.error('No strategies provided');
    return { bestResult: null, engineAvailable: false, duration: 0 };
  }

  const wResult = await getWorker();
  if (!wResult || !wResult.worker) {
    log.error('OCR engine not available');
    return { bestResult: null, engineAvailable: false, duration: 0 };
  }

  const { worker } = wResult;
  const results = [];

  for (const strategy of strategies) {
    if (Date.now() - t0 > timeoutMs) break;
    const result = await recognizeStrategy(worker, strategy.buf, strategy.name);
    if (result) results.push(result);
  }

  if (results.length === 0) {
    log.error('All OCR strategies failed');
    return { bestResult: null, engineAvailable: true, duration: Date.now() - t0 };
  }

  results.sort((a, b) => b.confidence - a.confidence);
  const best = results[0];
  log.info('Best: "' + best.strategyName + '" conf=' + best.confidence.toFixed(1) + '% text=' + best.text.length + ' chars (' + (Date.now() - t0) + 'ms)');
  return { bestResult: best, allResults: results, engineAvailable: true, duration: Date.now() - t0 };
}

module.exports = { run, getWorker, recognizeStrategy };