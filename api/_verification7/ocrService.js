const C = require('./config.js');
const crypto = require('crypto');

let tesseractWorker = null;

async function getTesseractWorker() {
  if (tesseractWorker) return tesseractWorker;
  const Tesseract = require('tesseract.js');
  tesseractWorker = await Tesseract.createWorker(C.TESSERACT_LANG, C.TESSERACT_CONFIG, { logger: () => {} });
  return tesseractWorker;
}

async function runTesseract(imageBuffer) {
  const w = await getTesseractWorker();
  const { data } = await w.recognize(imageBuffer);
  return { engine: 'tesseract', raw: data.text || '', confidence: data.confidence || 0, blocks: data.blocks || [] };
}

async function runPythonBridge(imageUrl) {
  try {
    const bridge = require('../_ai_bridge.js');
    const result = await bridge.analyzeWithAI(imageUrl, {});
    if (!result || result.error) return null;
    const stages = result.stages || {};
    const s3 = stages.stage3_multi_ocr || {};
    const engines = s3.engines || {};
    const paddle = engines.paddle || {};
    const easy = engines.easyocr || {};
    const extracted = result.extracted || {};
    return {
      engine: 'python_bridge',
      raw: JSON.stringify(extracted),
      confidence: result.confidence || 0,
      paddle: paddle.success ? { raw: paddle.text || '', confidence: paddle.confidence || 0 } : null,
      easyocr: easy.success ? { raw: easy.text || '', confidence: easy.confidence || 0 } : null,
    };
  } catch (e) {
    return null;
  }
}

function voteByField(engines) {
  const fields = ['amount', 'utr', 'upi', 'name', 'date', 'time', 'status'];
  const voted = {};
  const details = {};
  for (const field of fields) {
    const values = {};
    for (const e of engines) {
      if (e.fields && e.fields[field] !== null && e.fields[field] !== undefined) {
        const val = String(e.fields[field]).trim();
        if (val) {
          values[val] = (values[val] || 0) + (e.weight || 1);
        }
      }
    }
    const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
    if (entries.length > 0) {
      details[field] = { value: entries[0][0], votes: entries[0][1], total: engines.length, candidates: entries };
      voted[field] = entries[0][0];
    } else {
      details[field] = { value: null, votes: 0, total: engines.length, candidates: [] };
      voted[field] = null;
    }
  }
  return { voted, details };
}

async function extractFieldsFromRaw(raw) {
  const t = raw || '';
  const result = { amount: null, utr: null, upi: null, name: null, date: null, time: null, status: null };
  const num = t.replace(/,/g, '');
  const amt = num.match(/(?:Rs\.?|INR|₹)\s*(\d+[\.\d]*)/i) || t.match(/(\d{3,})\s*(?:rs|inr)/i);
  if (amt) result.amount = parseFloat(amt[1].replace(/[^\d.]/g, ''));
  const codes = t.match(/[A-Z0-9]{12,}/g);
  if (codes) result.utr = codes.sort((a, b) => b.length - a.length)[0];
  const ids = t.match(/[\w.\-]+@[\w.]+/g);
  if (ids) result.upi = ids[0].toLowerCase();
  const names = t.match(/[A-Z]{4,}(?:\s+[A-Z]{2,})+/g);
  if (names) result.name = names[0];
  const dates = t.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (dates) result.date = dates[0];
  const times = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (times) result.time = times[0];
  if (/success|completed|paid|credited/i.test(t)) result.status = 'SUCCESS';
  else if (/failed|declined|rejected/i.test(t)) result.status = 'FAILED';
  else if (/pending|processing/i.test(t)) result.status = 'PENDING';
  return result;
}

async function runMultiEngineOcr(imageBuffer, imageUrl) {
  const engines = [];
  const t0 = Date.now();

  const tessResult = await runTesseract(imageBuffer);
  engines.push({
    name: 'tesseract',
    raw: tessResult.raw,
    confidence: tessResult.confidence,
    fields: await extractFieldsFromRaw(tessResult.raw),
    weight: C.VOTE_WEIGHT_TESSERACT,
  });

  let bridgeResult = null;
  if (C.PYTHON_BRIDGE_AVAILABLE && imageUrl) {
    bridgeResult = await runPythonBridge(imageUrl);
  }

  if (bridgeResult) {
    if (bridgeResult.paddle) {
      engines.push({
        name: 'paddle',
        raw: bridgeResult.paddle.raw,
        confidence: bridgeResult.paddle.confidence,
        fields: await extractFieldsFromRaw(bridgeResult.paddle.raw),
        weight: C.VOTE_WEIGHT_PADDLE,
      });
    }
    if (bridgeResult.easyocr) {
      engines.push({
        name: 'easyocr',
        raw: bridgeResult.easyocr.raw,
        confidence: bridgeResult.easyocr.confidence,
        fields: await extractFieldsFromRaw(bridgeResult.easyocr.raw),
        weight: C.VOTE_WEIGHT_EASYOCR,
      });
    }
  }

  const combinedRaw = engines.map(e => e.raw).join('\n').substring(0, 5000);
  const avgConfidence = engines.length > 0 ? engines.reduce((s, e) => s + e.confidence, 0) / engines.length : 0;
  const voting = voteByField(engines);

  return {
    raw: combinedRaw,
    confidence: Math.round(avgConfidence),
    engines: engines.map(e => ({ name: e.name, confidence: e.confidence })),
    fields: voting.voted,
    fieldDetails: voting.details,
    votingCount: engines.length,
    duration: Date.now() - t0,
  };
}

module.exports = { runMultiEngineOcr, extractFieldsFromRaw };
