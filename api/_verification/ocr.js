const C = require('./config');

let workerRef = null;

async function getWorker() {
  if (workerRef) return workerRef;
  const { createWorker } = require('tesseract.js');
  const w = await createWorker('eng', 1, { logger: () => {} });
  workerRef = w;
  return w;
}

async function read(buf, ms) {
  const w = await getWorker();
  if (!w) return { text: '', confidence: 0 };
  const r = await w.recognize(buf);
  return {
    text: (r.data.text || '').trim(),
    confidence: r.data.confidence || 0,
  };
}

module.exports = { read, getWorker };