const crypto = require('crypto');
const { runQuery } = require('../_supabase.js');
const { COL_UPI_PAYMENTS } = require('../_shared.js');
const C = require('./config');
const log = require('./logger').DEDUP;

function computeTextHash(text) {
  if (!text) return '';
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

async function checkDuplicateUtr(utr) {
  if (!utr) return { isDuplicate: false, existingPaymentId: null };
  try {
    const results = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'utr', op: 'EQUAL', value: utr },
    ], { limit: 5 });
    if (results && results.length > 0) {
      const existing = results[0];
      return { isDuplicate: true, existingPaymentId: existing.id, existingStatus: existing.status, existingCreatedAt: existing.created_at };
    }
  } catch (e) {
    log.error('', 'UTR check failed: ' + e.message);
  }
  return { isDuplicate: false, existingPaymentId: null };
}

async function checkScreenshotHashDuplicate(imageHash) {
  if (!imageHash) return { isDuplicate: false };
  try {
    const results = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'screenshot_hash', op: 'EQUAL', value: imageHash },
    ], { limit: 5 });
    if (results && results.length > 0) {
      return { isDuplicate: true, existingPaymentId: results[0].id, matchCount: results.length };
    }
  } catch (e) {
    log.error('', 'Screenshot hash check failed: ' + e.message);
  }
  return { isDuplicate: false };
}

async function checkOcrTextHashDuplicate(textHash) {
  if (!textHash) return { isDuplicate: false };
  try {
    const results = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'ocr_text_hash', op: 'EQUAL', value: textHash },
    ], { limit: 5 });
    if (results && results.length > 0) {
      return { isDuplicate: true, existingPaymentId: results[0].id, matchCount: results.length };
    }
  } catch (e) {
    log.error('', 'OCR text hash check failed: ' + e.message);
  }
  return { isDuplicate: false };
}

async function checkPerceptualHash(buffer) {
  try {
    const { Jimp } = require('jimp');
    const image = await Jimp.read(buffer);
    image.greyscale().resize(16, 16);
    const data = image.bitmap.data;
    const pixels = [];
    for (let i = 0; i < data.length; i += 4) pixels.push(data[i]);
    const avg = pixels.reduce((a, b) => a + b, 0) / pixels.length;
    const hash = pixels.map(p => p >= avg ? 1 : 0).join('');
    return hash;
  } catch (_) {
    return null;
  }
}

async function run(imageHash, ocrTextHash, utr, imageBuffer) {
  const t0 = Date.now();
  const checks = [];

  const utrCheck = await checkDuplicateUtr(utr);
  checks.push({ name: 'utr_duplicate', ...utrCheck });

  const screenshotCheck = await checkScreenshotHashDuplicate(imageHash);
  checks.push({ name: 'screenshot_duplicate', ...screenshotCheck });

  const textCheck = await checkOcrTextHashDuplicate(ocrTextHash);
  checks.push({ name: 'ocr_text_duplicate', ...textCheck });

  const pHash = imageBuffer ? await checkPerceptualHash(imageBuffer) : null;
  checks.push({ name: 'perceptual_hash', pHash });

  const isDuplicate = utrCheck.isDuplicate || screenshotCheck.isDuplicate || textCheck.isDuplicate;
  log.info('', 'Duplicates: utr=' + utrCheck.isDuplicate + ' screenshot=' + screenshotCheck.isDuplicate + ' text=' + textCheck.isDuplicate + ' (' + (Date.now() - t0) + 'ms)');
  return { checks, isDuplicate, utrCheck, screenshotCheck, textCheck, pHash, duration: Date.now() - t0 };
}

module.exports = { run, computeTextHash, checkDuplicateUtr, checkScreenshotHashDuplicate, checkOcrTextHashDuplicate };
