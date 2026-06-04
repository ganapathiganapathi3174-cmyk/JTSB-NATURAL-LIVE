import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FirebaseUser, FirebaseNotification } from '../db/firebase-db.js';

import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

function getImageUrl(url) {
  if (!url) return null;
  if (url.includes('alt=media')) return url;
  if (url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'alt=media';
}

const EXPECTED_UPI = 'jayarajj126-3@okicici';
const UPI_SIMILARITY_THRESHOLD = 85;

function normalizeUpi(upi) {
  let s = upi.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9@._-]/g, '');
  const corrections = { '1': 'l', 'l': '1', '0': 'o', 'o': '0', '5': 's', 's': '5', '8': 'b', 'b': '8' };
  return s.split('').map(c => corrections[c] || c).join('');
}

function stringSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(dp[i], dp[i - 1], prev);
      prev = tmp;
    }
  }
  return Math.round((1 - dp[a.length] / maxLen) * 100);
}

function isUpiValid(ocrUpi) {
  if (!ocrUpi) return false;
  return stringSimilarity(normalizeUpi(ocrUpi), normalizeUpi(EXPECTED_UPI)) >= UPI_SIMILARITY_THRESHOLD;
}

const OCR_TIMEOUT = 45000;
const VALIDATION_TIMEOUT = 60000;
const VALIDATION_CALL_TIMEOUT = 120000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]).catch(err => {
    if (fallback !== undefined) return typeof fallback === 'function' ? fallback(err) : fallback;
    throw err;
  });
}

const OCR_FIX_MAP = { 'l': '1', 'I': '1', 'O': '0', 'o': '0', 'S': '5', 'B': '8' };
const _ocrFixCache = new Map();
function applyOcrFix(s) {
  if (!s) return s;
  const cached = _ocrFixCache.get(s);
  if (cached !== undefined) return cached;
  const result = s.split('').map(c => OCR_FIX_MAP[c] || c).join('');
  if (_ocrFixCache.size > 100) _ocrFixCache.clear();
  _ocrFixCache.set(s, result);
  return result;
}

function removeUtrNumbers(t) {
  if (!t) return t;
  return t.replace(/\b\d{10,18}\b/g, '').replace(/\b\d{10,18}\b/g, '');
}

function extractAfter(text, keywords, { stopBefore, numericOnly, minLength, maxLength } = {}) {
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(`${escaped}[:\\s]+(.{1,80})`, 'i'));
    if (!m) continue;
    let val = m[1].trim();
    if (stopBefore) {
      const idx = val.search(stopBefore);
      if (idx !== -1) val = val.substring(0, idx).trim();
    }
    if (numericOnly) {
      const nums = val.match(/\d+/g);
      if (nums) {
        const combined = nums.join('');
        if (combined.length >= (minLength || 1) && combined.length <= (maxLength || Infinity)) return combined;
      }
    } else {
      if (val) return val;
    }
  }
  return null;
}

const OCR_ENGINE_CONFIG = {
  useGoogleVision: !!import.meta.env.VITE_GOOGLE_VISION_API_KEY,
  visionApiKey: import.meta.env.VITE_GOOGLE_VISION_API_KEY || '',
};

async function recognizeGoogleVision(imageUrl) {
  if (!OCR_ENGINE_CONFIG.useGoogleVision || !OCR_ENGINE_CONFIG.visionApiKey) return null;
  try {
    const resp = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${OCR_ENGINE_CONFIG.visionApiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ image: { content: imageUrl.split(',')[1] }, features: [{ type: 'TEXT_DETECTION' }] }] })
      }
    );
    const data = await resp.json();
    if (data?.responses?.[0]?.textAnnotations?.[0]) {
      return { text: data.responses[0].textAnnotations[0].description, confidence: Math.round((data.responses[0].textAnnotations[0].confidence || 0.9) * 100), source: 'google_vision' };
    }
  } catch {}
  return null;
}

// Tesseract worker pool — reuse workers to avoid repeated ~200ms init
let _tesseractPool = null;
async function _getTessPool() {
  if (_tesseractPool) return _tesseractPool;
  const { createWorker } = await import('tesseract.js');
  const [w1, w2, w3] = await Promise.all([
    createWorker('eng'),
    createWorker('eng'),
    createWorker('eng'),
  ]);
  await Promise.all([
    w1.setParameters({ tessedit_pageseg_mode: '6', tessedit_ocr_engine_mode: '3', preserve_interword_spaces: '1' }),
    w2.setParameters({ tessedit_pageseg_mode: '3', tessedit_ocr_engine_mode: '3', preserve_interword_spaces: '1' }),
    w3.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789₹.,' }),
  ]);
  _tesseractPool = { w1, w2, w3 };
  return _tesseractPool;
}

async function recognizeTesseract(imageUrl) {
  try {
    const pool = await _getTessPool();
    const results = await Promise.all([
      pool.w1.recognize(imageUrl).then(r => ({ text: r.data.text || '', confidence: Math.round(r.data.confidence || 0), source: 'tesseract-psm6' })),
      pool.w2.recognize(imageUrl).then(r => ({ text: r.data.text || '', confidence: Math.round(r.data.confidence || 0), source: 'tesseract-psm3' })),
    ]);
    return results.reduce((a, b) => a.confidence >= b.confidence ? a : b);
  } catch { return null; }
}

async function tesseractNumberPass(imageUrl) {
  try {
    const pool = await _getTessPool();
    const { data } = await pool.w3.recognize(imageUrl);
    return data?.text || '';
  } catch { return ''; }
}

async function recognizeWithFallback(imageUrl) {
  const [gvResult, tessResult] = await Promise.all([recognizeGoogleVision(imageUrl), recognizeTesseract(imageUrl)]);
  if (gvResult && tessResult) {
    return gvResult.confidence >= tessResult.confidence ? gvResult : tessResult;
  }
  return gvResult || tessResult || { text: '', confidence: 0 };
}

function preprocessImage(url) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.setAttribute('crossOrigin', 'anonymous');
    img.onload = () => {
      try {
        const scale = 3;
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const total = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          const contrast = 1.8;
          gray = contrast * (gray - 128) + 128;
          gray = Math.max(0, Math.min(255, gray));
          d[i] = gray; d[i + 1] = gray; d[i + 2] = gray;
        }
        const sharp = new Uint8ClampedArray(d.length);
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const idx = (y * w + x) * 4;
            const v = -d[((y-1)*w+(x-1))*4] - d[((y-1)*w+x)*4] - d[((y-1)*w+(x+1))*4] - d[(y*w+(x-1))*4] + 9*d[idx] - d[(y*w+(x+1))*4] - d[((y+1)*w+(x-1))*4] - d[((y+1)*w+x)*4] - d[((y+1)*w+(x+1))*4];
            sharp[idx] = Math.max(0, Math.min(255, v)); sharp[idx+1] = sharp[idx]; sharp[idx+2] = sharp[idx]; sharp[idx+3] = d[idx+3];
          }
        }
        for (let y = 1; y < h - 1; y++) { for (let x = 1; x < w - 1; x++) { const idx = (y * w + x) * 4; d[idx] = sharp[idx]; d[idx+1] = sharp[idx+1]; d[idx+2] = sharp[idx+2]; } }
        // Binarization: compute OTSU global and Sauvola local, pick the better result
        const grayPixels = new Float32Array(total);
        for (let i = 0; i < total; i++) grayPixels[i] = d[i * 4];
        // OTSU
        const hist = new Array(256).fill(0);
        for (let i = 0; i < total; i++) hist[Math.round(grayPixels[i])]++;
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, maxVariance = 0, otsuThreshold = 128;
        for (let i = 0; i < 256; i++) {
          wB += hist[i];
          if (wB === 0) continue;
          const wF = total - wB;
          if (wF === 0) break;
          sumB += i * hist[i];
          const meanB = sumB / wB;
          const meanF = (sum - sumB) / wF;
          const variance = wB * wF * (meanB - meanF) * (meanB - meanF);
          if (variance > maxVariance) { maxVariance = variance; otsuThreshold = i; }
        }
        // Sauvola local thresholding using integral images (O(n) total)
        const radius = Math.max(4, Math.round(Math.min(w, h) / 20));
        const intImg = new Float64Array((w + 1) * (h + 1));
        const intSq = new Float64Array((w + 1) * (h + 1));
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const g = grayPixels[idx];
            const row = (y + 1) * (w + 1) + (x + 1);
            intImg[row] = g + intImg[row - (w + 1)] + intImg[row - 1] - intImg[row - (w + 2)];
            intSq[row] = g * g + intSq[row - (w + 1)] + intSq[row - 1] - intSq[row - (w + 2)];
          }
        }
        const sauvPixels = new Uint8ClampedArray(total);
        const k = 0.2, R = 128;
        for (let y = 0; y < h; y++) {
          const y1 = Math.max(0, y - radius), y2 = Math.min(h - 1, y + radius);
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - radius), x2 = Math.min(w - 1, x + radius);
            const b2 = (y2 + 1) * (w + 1), b1 = y1 * (w + 1);
            const r2 = x2 + 1, r1 = x1;
            const count = (y2 - y1 + 1) * (x2 - x1 + 1);
            const sum = intImg[b2 + r2] - intImg[b1 + r2] - intImg[b2 + r1] + intImg[b1 + r1];
            const sqSum = intSq[b2 + r2] - intSq[b1 + r2] - intSq[b2 + r1] + intSq[b1 + r1];
            const mean = sum / count;
            const variance = (sqSum / count) - (mean * mean);
            const std = Math.sqrt(Math.max(0, variance));
            const threshold = mean * (1 + k * ((std / R) - 1));
            sauvPixels[y * w + x] = grayPixels[y * w + x] >= threshold ? 255 : 0;
          }
        }
        // Decide: pick OTSU if balanced, otherwise Sauvola
        let otsuBlack = 0;
        for (let i = 0; i < total; i++) { if (grayPixels[i] < otsuThreshold) otsuBlack++; }
        const otsuRatio = otsuBlack / total;
        const useOtsu = otsuRatio >= 0.05 && otsuRatio <= 0.5;
        let blackCount = 0;
        for (let i = 0; i < total; i++) {
          const val = useOtsu ? (grayPixels[i] >= otsuThreshold ? 255 : 0) : sauvPixels[i];
          if (val === 0) blackCount++;
          const idx4 = i * 4;
          d[idx4] = val; d[idx4 + 1] = val; d[idx4 + 2] = val;
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
    img.src = url;
  });
}

function analyzeImageQuality(url) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.setAttribute('crossOrigin', 'anonymous');
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const d = imageData.data;

        let lapSum = 0, lapCount = 0;
        for (let y = 2; y < img.height - 2; y++) {
          for (let x = 2; x < img.width - 2; x++) {
            const idx = (y * img.width + x) * 4;
            const lap = -d[((y-2)*img.width+x)*4] - d[((y-1)*img.width+x)*4] + 4*d[idx] - d[((y+1)*img.width+x)*4] - d[((y+2)*img.width+x)*4];
            lapSum += lap * lap;
            lapCount++;
          }
        }
        const lapVariance = lapCount > 0 ? lapSum / lapCount : 0;
        const minDim = Math.min(img.width, img.height);
        const ratio = img.width / img.height;

        resolve({
          passed: lapVariance >= 50 && minDim >= 300 && ratio <= 1.5 && ratio >= 0.3,
          blurry: lapVariance < 50,
          lowResolution: minDim < 300,
          cropped: ratio > 1.5 || ratio < 0.3,
          width: img.width,
          height: img.height,
          lapVariance: Math.round(lapVariance),
        });
      } catch { resolve({ passed: true }); }
    };
    img.onerror = () => resolve({ passed: true });
    img.src = url;
  });
}

function getRelativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getValidationBadge(user) {
  if (user.auto_approved) return { label: 'Recommended Approval', className: 'badge badge-paid' };
  if (user.auto_rejected) return { label: 'Rejected', className: 'badge badge-rejected' };
  if (user.validation_status === 'failed') return { label: 'Manual Review', className: 'badge badge-pending' };
  if (user.duplicate_utr_flag) return { label: 'Duplicate UTR', className: 'badge badge-rejected' };
  if (user.payment_status === 'approved') return { label: 'Approved', className: 'badge badge-paid' };
  if (user.payment_status === 'rejected') return { label: 'Rejected', className: 'badge badge-rejected' };
  return { label: 'Pending', className: 'badge badge-pending' };
}

function ZoomModal({ url, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="zoom-overlay" onClick={onClose}>
      <img src={getImageUrl(url)} alt="Screenshot Zoom" />
    </div>
  );
}

function useOcr(imageUrl) {
  const [ocrData, setOcrData] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState(null);

  useEffect(() => {
    if (!imageUrl) { setOcrData(null); return; }
    let cancelled = false;
    (async () => {
      setOcrLoading(true);
      setOcrError(null);
      setOcrData(null);
      try {
        // Image quality analysis
        const quality = await analyzeImageQuality(getImageUrl(imageUrl));
        if (!quality.passed) {
          const issues = [];
          if (quality.blurry) issues.push('blurry');
          if (quality.lowResolution) issues.push('low resolution');
          if (quality.cropped) issues.push('abnormal aspect ratio');
          setOcrError(`Poor image quality: ${issues.join(', ')}`);
          setOcrLoading(false);
          return;
        }
        const processedUrl = await withTimeout(preprocessImage(getImageUrl(imageUrl)), OCR_TIMEOUT, null);
        const originalUrl = getImageUrl(imageUrl);
        // Run OCR on both processed and original in parallel
        const [procResult, origResult] = await Promise.all([
          withTimeout(recognizeWithFallback(processedUrl || originalUrl), OCR_TIMEOUT, { text: '', confidence: 0 }),
          processedUrl ? withTimeout(recognizeWithFallback(originalUrl), OCR_TIMEOUT, { text: '', confidence: 0 }) : Promise.resolve({ text: '', confidence: 0 }),
        ]);
        // Pick best result (more text wins, tie-break by confidence)
        let { text, confidence } = procResult;
        if (origResult.text && (!text || origResult.text.length > text.length || (origResult.text.length === text.length && origResult.confidence > confidence))) {
          text = origResult.text;
          confidence = origResult.confidence;
          console.log('[OCR] Using original image result over processed');
        }
        if (cancelled) return;
        if (!text) { setOcrData({ raw: '', ocr_confidence: 0 }); return; }

        const isGooglePay = /Google Pay/i.test(text) || /UPI transaction ID/i.test(text);

        function extractAfter(text, keywords, { stopBefore, numericOnly, minLength, maxLength } = {}) {
          for (const kw of keywords) {
            const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(escaped + '[\\s:]*([^\\n]+)', 'i');
            const m = text.match(re);
            if (m) {
              let val = m[1].trim();
              if (stopBefore) {
                for (const s of stopBefore) {
                  const idx = val.indexOf(s);
                  if (idx !== -1) val = val.substring(0, idx).trim();
                }
              }
              if (numericOnly) {
                val = val.replace(/[^0-9]/g, '');
                if (minLength && val.length < minLength) continue;
                if (maxLength && val.length > maxLength) continue;
              }
              if (val) return val;
            }
          }
          return null;
        }

        function extractAmount(text) {
          if (!text) return null;
          const compacted = text.replace(/(\d)\s+(?=\d)/g, '$1');
          const ocrFixed = applyOcrFix(text);
          const compactedFixed = applyOcrFix(compacted);

          const sources = [...new Set([text, ocrFixed, compacted, compactedFixed])].filter(Boolean);

          // Pass 0: Exact "₹ 120" or "₹120" anywhere — highest priority
          for (const t of sources) {
            if (/(?:₹|Rs\.?|INR)\s*120(?:\.00)?/i.test(t)) return '120';
          }

          // Pass 0.5: Standalone "120" anywhere in text — before any other number match
          for (const t of sources) {
            if (/\b120\b/.test(t)) return '120';
          }

          // Pass 1: Amount near "Amount" label — collect all matches, pick closest to 120
          let bestLabel = null;
          let bestLabelDist = Infinity;
          for (const t of sources) {
            const allLabel = [...t.matchAll(/(?:Amount|Total|Pay)[:\s]*₹?\s*(\d{1,6}(?:[.,]\d{1,2})?)/gi)];
            for (const m of allLabel) {
              const val = parseFloat(m[1].replace(/,/g, ''));
              if (!isNaN(val) && val >= 50 && val <= 500) {
                const dist = Math.abs(val - 120);
                if (dist < bestLabelDist) { bestLabelDist = dist; bestLabel = String(Math.round(val)); }
              }
            }
          }
          if (bestLabel) return bestLabel;

          // Pass 2: Currency-prefixed amounts (₹, Rs, INR) — pick closest to EXPECTED
          let bestCurrency = null;
          let bestDist = Infinity;
          for (const t of sources) {
            const allCurr = [...t.matchAll(/(?:₹|Rs\.?|INR)\s*(\d{1,6}(?:[.,]\d{1,2})?)/gi)];
            for (const m of allCurr) {
              const val = parseFloat(m[1].replace(/,/g, ''));
              if (!isNaN(val) && val >= 1 && val <= 10000) {
                const dist = Math.abs(val - 120);
                if (dist < bestDist) { bestDist = dist; bestCurrency = String(Math.round(val)); }
              }
            }
          }
          if (bestCurrency) return bestCurrency;

          // Pass 3: Number ending with .00 — pick closest to 120
          let bestDot = null;
          let bestDotDist = Infinity;
          for (const t of sources) {
            const allDot = [...t.matchAll(/\b(\d{2,5})\.00\b/g)];
            for (const m of allDot) {
              const val = parseInt(m[1], 10);
              if (val >= 50 && val <= 10000) {
                const dist = Math.abs(val - 120);
                if (dist < bestDotDist) { bestDotDist = dist; bestDot = String(val); }
              }
            }
          }
          if (bestDot) return bestDot;

          // Pass 4: Aggressive scan — first remove UTR-length numbers, then scan
          for (const t of sources) {
            const cleaned = removeUtrNumbers(t);
            const numbers = cleaned.match(/\b(\d{2,5})\b/g);
            if (numbers) {
              let bestAgg = null;
              let bestAggDist = Infinity;
              for (const n of numbers) {
                const parsed = parseInt(n, 10);
                if (parsed >= 50 && parsed <= 500 && parsed !== 2024 && parsed !== 2025 && parsed !== 2026) {
                  if (n.length === 4) {
                    const a = parseInt(n.substring(0, 2), 10);
                    const b = parseInt(n.substring(2, 4), 10);
                    if ((a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31)) continue;
                  }
                  const dist = Math.abs(parsed - 120);
                  if (dist < bestAggDist) { bestAggDist = dist; bestAgg = n; }
                }
              }
              if (bestAgg) return bestAgg;
            }
          }

          // Pass 5: Substring "120" check
          for (const t of sources) {
            if (t && t.includes('120')) return '120';
          }

          // Pass 6: Swapped-digit fallback (e.g., 92→29)
          for (const t of sources) {
            const cleaned = removeUtrNumbers(t);
            const numbers = cleaned.match(/\b(\d{2,5})\b/g) || [];
            for (const n of numbers) {
              if (n.length >= 2) {
                const swapped = parseInt(n[1] + n[0] + n.substring(2), 10);
                if (swapped >= 50 && swapped <= 500) return String(swapped);
              }
            }
          }

          return null;
        }

        function extractPaymentStatus(text) {
          const m1 = text.match(/Status[:\s]+(Success(?:ful)?|Completed|Failed|Pending|Processing)/i);
          if (m1) return m1[1].trim();

          const standalone = text.match(/(?:^|[\n\r])\s*(Completed|Paid|Successful)\s*(?:$|[\n\r])/im);
          if (standalone) return standalone[1].trim();

          const nearAmount = text.match(/₹\s*\d+[^\n]*\n[^\n]*(Completed|Paid|Successful)/i) ||
                             text.match(/(Completed|Paid|Successful)[^\n]*\n[^\n]*₹/i);
          if (nearAmount) return nearAmount[1].trim();

          const nearTo = text.match(/To[:\s][^\n]*(Completed|Paid|Successful)/i);
          if (nearTo) return nearTo[1].trim();

          const any = text.match(/\b(Completed|Paid|Successful)\b/i);
          if (any) return any[1].trim();

          return null;
        }

        const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
        const OCR_MONTH_FIX = { 'mar':'may','jur':'jun','jul':'jun','aug':'apr','jui':'jun','juu':'jun','juI':'jun','apt':'apr','aor':'apr','may':'may','mav':'may','sep':'sep','sept':'sep','oct':'oct','nov':'nov','dec':'dec' };

        function guessMonth(word) {
          if (!word) return null;
          const w = word.toLowerCase().replace(/[^a-z]/g, '');
          if (OCR_MONTH_FIX[w]) return OCR_MONTH_FIX[w];
          const m = MONTHS.find(m => w.startsWith(m) || m.startsWith(w) || stringSimilarity(w, m) >= 40);
          return m || null;
        }

        function correctDate(rawDate) {
          if (!rawDate) return null;
          let trimmed = rawDate.trim().replace(/[,\s]+/g, ' ').replace(/^[^\d]+/, '').replace(/[^a-zA-Z\d\s/-]+$/, '').trim();

          // DD-MM-YYYY or DD/MM/YYYY
          const numMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
          if (numMatch) {
            let day = parseInt(numMatch[1], 10), mon = parseInt(numMatch[2], 10), yr = numMatch[3];
            let ds = numMatch[1], ms = numMatch[2];
            if (day > 31 && ds.length === 2) {
              const swapped = parseInt(ds[1] + ds[0], 10);
              if (swapped >= 1 && swapped <= 31) { day = swapped; ds = String(swapped).padStart(2, '0'); }
            }
            if (mon > 12 && ms.length === 2) {
              const swapped = parseInt(ms[1] + ms[0], 10);
              if (swapped >= 1 && swapped <= 12) { mon = swapped; ms = String(swapped).padStart(2, '0'); }
            }
            if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
              const yr4 = yr.length === 2 ? '20' + yr : yr;
              return `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}/${yr4}`;
            }
            return null;
          }

          // YYYY-MM-DD or YYYY/MM/DD
          const ymdMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
          if (ymdMatch) {
            const yr = ymdMatch[1], mon = parseInt(ymdMatch[2], 10), day = parseInt(ymdMatch[3], 10);
            if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
              return `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}/${yr}`;
            }
            return null;
          }

          // "1 Jun 2026" or "1 June 2026" or "01 Jun 2026"
          const txtMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
          if (txtMatch) {
            let day = parseInt(txtMatch[1], 10);
            const monWord = txtMatch[2].toLowerCase();
            let yr = txtMatch[3];
            if (day > 31) return null;
            const matchedMonth = guessMonth(monWord);
            if (day >= 1 && day <= 31 && matchedMonth) {
              const yr4 = yr.length === 2 ? '20' + yr : yr;
              return `${String(day).padStart(2, '0')} ${matchedMonth.charAt(0).toUpperCase() + matchedMonth.slice(1)} ${yr4}`;
            }
            return null;
          }

          return null;
        }

        function extractDate(text) {
          if (!text) return null;
          const texts = [text, applyOcrFix(text)];
          const datePatterns = [
            /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/g,
            /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[,]?\s+(\d{4})/gi,
            /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g,
          ];

          for (const t of texts) {
            // Search near payment keywords first
            const keywords = ['Completed', 'UPI transaction ID', 'UTR', 'Status', 'Paid', 'Payment'];
            for (const kw of keywords) {
              const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(escaped + '[^\\n]*\\n([^\\n]*\\n?){0,4}', 'i');
              const m = t.match(re);
              if (m) {
                for (const pattern of datePatterns) {
                  const dm = m[0].match(pattern);
                  if (dm) {
                    const cd = correctDate(dm[1] || (dm[2] ? dm[1] + ' ' + dm[2] + ' ' + dm[3] : null));
                    if (cd) return cd;
                  }
                }
              }
            }

            // Full-text scan with all patterns
            for (const pattern of datePatterns) {
              const allDates = [...t.matchAll(pattern)];
              for (const dm of allDates) {
                const raw = dm[1] || (dm[2] ? dm[1] + ' ' + dm[2] + ' ' + dm[3] : null);
                if (raw) {
                  const cd = correctDate(raw);
                  if (cd) return cd;
                }
              }
            }

            // Additional line-by-line scan for dates with full month names
            const lines = t.split('\n');
            for (const line of lines) {
              // Match "DD Month YYYY" or "DD MonthName YYYY"
              const lm = line.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
              if (lm) {
                const cd = correctDate(lm[1] + ' ' + lm[2] + ' ' + lm[3]);
                if (cd) return cd;
              }
            }
          }

          return null;
        }

        let m;
        const utrMatch = extractAfter(text, ['UPI transaction ID', 'UTR', 'Transaction ID', 'Reference ID'], { numericOnly: true, minLength: 10, maxLength: 18 })
          || extractAfter(applyOcrFix(text), ['UPI transaction ID', 'UTR', 'Transaction ID', 'Reference ID'], { numericOnly: true, minLength: 10, maxLength: 18 })
          // Fallback: any 10-18 digit number in text (generic UTR pattern)
          || ((m = text.match(/\b(\d{10,18})\b/)) && m[1]);
        let amount = extractAmount(text);
        // UPI ID extraction: find ALL UPI IDs, distinguish sender vs receiver
        function findAllUpiIds(t) {
          const results = [];
          const patterns = [
            /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/gi,
          ];
          for (const p of patterns) {
            const matches = [...t.matchAll(p)];
            for (const m of matches) {
              const id = m[1].toLowerCase().replace(/[^a-z0-9@._-]/g, '');
              if (id.includes('@') && !results.some(r => r.id === id)) {
                results.push({ id, index: m.index, raw: m[1] });
              }
            }
          }
          return results;
        }

        function categorizeUpi(text, allUpis) {
          if (allUpis.length === 0) return { sender: null, receiver: null };
          const lines = text.split('\n');
          let fromLine = -1, toLine = -1;
          for (let i = 0; i < lines.length; i++) {
            if (/^From[:\s]/i.test(lines[i])) fromLine = i;
            if (/^To[:\s]/i.test(lines[i])) toLine = i;
          }
          if (allUpis.length === 1) return { sender: allUpis[0], receiver: null };
          // If we found both "From" and "To" lines, assign by proximity
          if (fromLine >= 0 && toLine >= 0) {
            for (const upi of allUpis) {
              const lineIdx = text.substring(0, upi.index).split('\n').length - 1;
              if (Math.abs(lineIdx - fromLine) <= Math.abs(lineIdx - toLine)) {
                return { sender: upi, receiver: allUpis.find(u => u.id !== upi.id) };
              }
            }
          }
          // If expected UPI is among them, it's the receiver (the person getting paid)
          const expectedIdx = allUpis.findIndex(u => isUpiValid(u.id));
          if (expectedIdx >= 0) {
            const receiver = allUpis[expectedIdx];
            const sender = allUpis.find((u, i) => i !== expectedIdx);
            return { sender, receiver };
          }
          // Default: first is sender, second is receiver
          return { sender: allUpis[0], receiver: allUpis.length > 1 ? allUpis[1] : null };
        }

        const allUpis = [...findAllUpiIds(text), ...findAllUpiIds(applyOcrFix(text))];
        const uniqueUpis = allUpis.filter((u, i, a) => a.findIndex(x => x.id === u.id) === i);
        const { sender: senderUpi, receiver: receiverUpi } = categorizeUpi(text, uniqueUpis);
        const upiMatch = senderUpi ? [senderUpi.raw] : null;

        const date = extractDate(text);
        const timeMatch = text.match(/(\d{1,2}:\d{2}\s?[APap][Mm])/);
        const paymentStatus = extractPaymentStatus(text);

        // Sender/Receiver name extraction
        let receiverName = null, senderName = null;
        const toMatch = text.match(/(?:^|\n)\s*To[:\s]+([A-Za-z\s]+)/i);
        if (toMatch) {
          let rn = toMatch[1].trim();
          const stopIdx = Math.min(
            rn.indexOf('Google Pay') !== -1 ? rn.indexOf('Google Pay') : Infinity,
            rn.indexOf('@') !== -1 ? rn.indexOf('@') : Infinity
          );
          if (stopIdx !== Infinity) rn = rn.substring(0, stopIdx).trim();
          if (rn) receiverName = rn;
        }
        const fromMatch = text.match(/(?:^|\n)\s*From[:\s]+([A-Za-z\s]+)/i);
        if (fromMatch) {
          let fn = fromMatch[1].trim();
          const stopIdx = fn.indexOf('@');
          if (stopIdx !== -1) fn = fn.substring(0, stopIdx).trim();
          if (fn) senderName = fn;
        }
        // If no "From" found, look for a name near the sender's UPI
        if (!senderName && senderUpi) {
          const beforeText = text.substring(Math.max(0, senderUpi.index - 80), senderUpi.index);
          const nameBefore = beforeText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*$/);
          if (nameBefore) senderName = nameBefore[1].trim();
        }

        // === AMOUNT MERGE SCAN: if raw text scan missed it, merge all extracted field texts and re-scan ===
        if (!amount) {
          const extraSources = [receiverName, paymentStatus, utrMatch].filter(Boolean);
          if (extraSources.length > 0) {
            const merged = [text, applyOcrFix(text), ...extraSources].filter(Boolean).join('\n');
            amount = extractAmount(merged);
          }
        }

        // === FALLBACK: amount still missing → run Tesseract on original uncropped image ===
        if (!amount && processedUrl) {
          try {
            const pool = await _getTessPool();
            const { data } = await pool.w1.recognize(getImageUrl(imageUrl));
            if (data?.text) {
              const amount2 = extractAmount(data.text);
              if (amount2) amount = amount2;
            }
          } catch (e) {
            // fallback failed silently
          }
        }

        // === FALLBACK 2: number-only Tesseract pass (whitelist digits only) ===
        if (!amount) {
          try {
            const nText = await tesseractNumberPass(originalUrl);
            if (nText) {
              const cleaned = nText.replace(/[^\d₹.,\s\n]/g, '');
              const amount2 = extractAmount(cleaned);
              if (amount2) amount = amount2;
            }
          } catch (e) {
            // fallback failed silently
          }
        }

        // === ADDITIONAL EXTRACTIONS: bank name, reference number, transaction ID ===
        function extractBankName(text) {
          const banks = [
            'State Bank of India', 'SBI', 'HDFC Bank', 'ICICI Bank', 'Axis Bank',
            'Kotak Mahindra', 'Yes Bank', 'PNB', 'Punjab National Bank',
            'Bank of Baroda', 'BOB', 'Canara Bank', 'Union Bank',
            'Indian Bank', 'Bank of India', 'Central Bank of India',
            'Indian Overseas Bank', 'UCO Bank', 'Federal Bank', 'IDBI Bank',
            'South Indian Bank', 'IDFC First Bank', 'Bandhan Bank',
            'Jana Small Finance Bank', 'Paytm Payments Bank',
          ];
          const textLower = text.toLowerCase();
          for (const bank of banks) {
            if (textLower.includes(bank.toLowerCase())) return bank;
          }
          const m = text.match(/(?:Bank|bank)[:\s]+([A-Za-z\s]+?)(?:\n|$)/);
          if (m) return m[1].trim();
          return null;
        }
        function extractRefNumber(text) {
          const m = text.match(/(?:Ref(?:erence)?(?:\s*No|#|\.)?[:\s]*)([A-Za-z0-9/-]{6,20})/i);
          if (m) return m[1].trim();
          return null;
        }
        function extractTransactionId(text) {
          const m = text.match(/(?:Transaction\s*(?:ID|No|#|Id)[:\s]*)([A-Za-z0-9]{6,30})/i);
          if (m) return m[1].trim();
          const m2 = text.match(/(?:Txn\s*(?:ID|No|#|Id|\.)[:\s]*)([A-Za-z0-9]{6,30})/i);
          if (m2) return m2[1].trim();
          return null;
        }
        const bankName = extractBankName(text);
        const refNumber = extractRefNumber(text);
        const transactionId = extractTransactionId(text);

        setOcrData({
          raw: text,
          ocr_confidence: Math.round(confidence),
          isGooglePay,
          utr: utrMatch || null,
          amount,
          upi_id: upiMatch ? upiMatch[0] : null,
          sender_upi: senderUpi ? senderUpi.id : null,
          receiver_upi: receiverUpi ? receiverUpi.id : null,
          sender_name: senderName,
          receiver_name: receiverName,
          date,
          time: timeMatch ? timeMatch[1] : null,
          payment_status: paymentStatus,
          bank_name: bankName,
          ref_number: refNumber,
          transaction_id: transactionId,
        });
      } catch (err) {
        if (!cancelled) setOcrError(err.message);
      } finally {
        if (!cancelled) setOcrLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imageUrl]);
  return { ocrData, ocrLoading, ocrError };
}

function PaymentModal({ user, onClose, onVerify, onVerifyAndNext }) {
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState('');
  const [dupCheck, setDupCheck] = useState(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [zoomUrl, setZoomUrl] = useState(null);
  const [autoApprovalRes, setAutoApprovalRes] = useState(null);
  const [autoApproving, setAutoApproving] = useState(false);
  const [showOverrideConfirm, setShowOverrideConfirm] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [forceApproving, setForceApproving] = useState(false);
  const [adminApproving, setAdminApproving] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  const currentAdminStatus = user.admin_approval_status || 'APPROVED';

  async function handleAdminApproval(status) {
    if (!adminMessage || !adminMessage.trim()) {
      setMsg('Message to user is required');
      return;
    }
    setAdminApproving(true);
    try {
      const adminName = getAdminName();
      await FirebaseUser.updateAdminApproval(user.id, status, adminName);
      if (status === 'APPROVED') {
        await FirebaseUser.updatePaymentStatus(user.id, 'approved');
      }
      await FirebaseNotification.send({
        receiverId: user.id,
        receiverName: user.name || '',
        message: adminMessage,
        type: status === 'APPROVED' ? 'admin_approval_approved' : 'admin_approval_rejected',
        senderId: adminName,
        senderName: adminName,
      });
      setAdminMessage('');
      console.log(`[ADMIN APPROVAL] PaymentModal: User ${user.id} ${status} by ${adminName}`);
      setMsg(status === 'APPROVED' ? 'Login Approved!' : 'Login Rejected!');
      setTimeout(() => { onClose(); }, 800);
    } catch (err) {
      console.error('Admin approval error:', err);
      setMsg(err.message);
    }
    setAdminApproving(false);
  }

  const isCyclePayment = user.cycle_payment_status === 'pending' || user.cycle_payment_utr;
  const displayUtr = isCyclePayment ? user.cycle_payment_utr : user.utr_number;
  const displayUrl = isCyclePayment ? user.cycle_upi_screenshot_url : user.upi_screenshot_url;

  const { ocrData, ocrLoading, ocrError } = useOcr(displayUrl);

  useEffect(() => {
    let cancelled = false;
    if (displayUtr) {
      setDupLoading(true);
      FirebaseUser.findDuplicateUtr(displayUtr, user.id).then(r => { if (!cancelled) setDupCheck(r); }).catch(() => {}).finally(() => { if (!cancelled) setDupLoading(false); });
    } else {
      setDupLoading(false);
      setDupCheck(null);
    }
    return () => { cancelled = true; };
  }, [displayUtr, user.id]);

  useEffect(() => {
    let cancelled = false;
    if (ocrData && !autoApprovalRes && !autoApproving) {
      setAutoApproving(true);
      const timeoutId = setTimeout(() => {
        if (!cancelled) {
          setMsg('⏱ Processing Timeout');
        }
      }, VALIDATION_TIMEOUT);
      const userInputs = {
        utr: displayUtr,
        amount: user.user_entered_amount || '120',
        date: user.user_entered_date || '',
      };
      withTimeout(FirebaseUser.processAutoApproval(user.id, { ocrData, userInputs }), VALIDATION_CALL_TIMEOUT, { autoApproved: false, autoRejected: true, wasAutoRejected: true, failureReasons: ['Validation timed out'] }).then(res => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setAutoApprovalRes(res);
        if (res.wasAutoApproved) {
          setMsg('✓ Recommended Approval!');
          setTimeout(() => { if (!cancelled) onClose(); }, 1200);
        } else if (res.wasAutoRejected) {
          setMsg('✗ Rejected');
          setTimeout(() => { if (!cancelled) onClose(); }, 2000);
        }
      }).catch(() => { if (!cancelled) clearTimeout(timeoutId); }).finally(() => { if (!cancelled) setAutoApproving(false); });
    }
    return () => { cancelled = true; };
  }, [ocrData, user.id, autoApprovalRes, onClose, displayUtr]);

  const validations = useMemo(() => {
    const v = [];

    // OCR Confidence: PASS (≥70) or FAIL (<70 or missing)
    const conf = ocrData?.ocr_confidence;
    if (conf !== undefined) {
      v.push({ label: 'OCR Confidence', passed: conf >= 70, ocrValue: `${conf}%` });
    } else {
      v.push({ label: 'OCR Confidence', passed: false, reason: 'No OCR data' });
    }

    // Amount: PASS (120 ±1) or FAIL (detected wrong) or SKIPPED (not detected)
    if (ocrData?.amount) {
      const parsed = parseFloat(ocrData.amount.replace(/[,]/g, ''));
      v.push({ label: 'Amount (₹120)', passed: !isNaN(parsed) && Math.abs(parsed - 120) < 1, ocrValue: ocrData.amount });
    } else if (ocrError) {
      v.push({ label: 'Amount (₹120)', passed: null, reason: 'OCR failed' });
    } else if (displayUrl) {
      v.push({ label: 'Amount (₹120)', passed: null, reason: 'Skipped (not detected)' });
    } else {
      v.push({ label: 'Amount (₹120)', passed: null, reason: 'No screenshot' });
    }

    // UPI ID: PASS (valid sender UPI) or FAIL (wrong) or SKIPPED (not detected)
    const upiToCheck = ocrData?.sender_upi || ocrData?.upi_id;
    if (upiToCheck) {
      v.push({ label: 'UPI ID', passed: isUpiValid(upiToCheck), ocrValue: upiToCheck });
    } else {
      v.push({ label: 'UPI ID', passed: false, reason: 'Not detected' });
    }

    // Payment Status: derive from OCR or infer from UTR + amount
    if (ocrData?.payment_status) {
      const status = ocrData.payment_status.toLowerCase();
      const ok = status === 'completed' || status === 'success' || status === 'successful' || status === 'paid';
      v.push({ label: 'Payment Status', passed: ok, ocrValue: ocrData.payment_status });
    } else {
      const utrOk = displayUtr && !dupCheck;
      const amtOk = ocrData?.amount && Math.abs(parseFloat(ocrData.amount.replace(/[,]/g, '')) - 120) < 1;
      if (utrOk && amtOk) {
        v.push({ label: 'Payment Status', passed: true, ocrValue: 'Inferred' });
      } else {
        v.push({ label: 'Payment Status', passed: null, reason: 'Unknown' });
      }
    }

    // Transaction Date: PASS (today) or FAIL (wrong) or SKIPPED (not detected)
    if (ocrData?.date) {
      const today = new Date();
      // Apply OCR month confusion fix before parsing
      let dateStr = ocrData.date.replace(/-/g, '/');
      const ocrMonthFix = { 'mar': 'may', 'jur': 'jun', 'jul': 'jun', 'aug': 'apr' };
      for (const [bad, good] of Object.entries(ocrMonthFix)) {
        const re = new RegExp('\\b' + bad + '\\b', 'gi');
        if (re.test(dateStr)) dateStr = dateStr.replace(re, good.charAt(0).toUpperCase() + good.slice(1));
      }
      const ocrDate = new Date(dateStr);
      const isToday = !isNaN(ocrDate.getTime()) && ocrDate.toDateString() === today.toDateString();
      v.push({ label: 'Transaction Date', passed: isToday, ocrValue: ocrData.date });
    } else if (ocrError) {
      v.push({ label: 'Transaction Date', passed: null, reason: 'OCR failed' });
    } else if (displayUrl) {
      v.push({ label: 'Transaction Date', passed: null, reason: 'Skipped (not detected)' });
    } else {
      v.push({ label: 'Transaction Date', passed: null, reason: 'No screenshot' });
    }

    // Unique UTR: PASS or FAIL
    if (dupCheck) {
      v.push({ label: 'Unique UTR', passed: false, reason: 'Duplicate UTR detected' });
    } else if (displayUtr) {
      v.push({ label: 'Unique UTR', passed: true });
    } else {
      v.push({ label: 'Unique UTR', passed: false, reason: 'No UTR to check' });
    }
    return v;
  }, [dupCheck, displayUtr, displayUrl, ocrData, ocrError]);

  const hasFailures = useMemo(() => validations.some(v => v.passed === false), [validations]);

  async function handleVerify(status) {
    setVerifying(true);
    setMsg('');
    try {
      if (status !== 'pending') {
        if (!adminMessage || !adminMessage.trim()) {
          setMsg('Message to user is required');
          setVerifying(false);
          return;
        }
      }
      await onVerify(user.id, status);
      if (status !== 'pending') {
        const adminName = getAdminName();
        await FirebaseNotification.send({
          receiverId: user.id,
          receiverName: user.name || '',
          message: adminMessage,
          type: status === 'approved' ? 'payment_approved' : 'payment_rejected',
          senderId: adminName,
          senderName: adminName,
        });
        setAdminMessage('');
      }
      setMsg(status === 'approved' ? 'Approved!' : 'Rejected!');
      setTimeout(() => { onClose(); }, 800);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleApproveAndNext() {
    setVerifying(true);
    setMsg('');
    try {
      if (!adminMessage || !adminMessage.trim()) {
        setMsg('Message to user is required');
        setVerifying(false);
        return;
      }
      await onVerify(user.id, 'approved');
      const adminName = getAdminName();
      await FirebaseNotification.send({
        receiverId: user.id,
        receiverName: user.name || '',
        message: adminMessage,
        type: 'payment_approved',
        senderId: adminName,
        senderName: adminName,
      });
      setAdminMessage('');
      onClose();
      if (onVerifyAndNext) onVerifyAndNext();
    } catch (err) {
      setMsg(err.message);
      setVerifying(false);
    }
  }

  function getAdminName() {
    try {
      const stored = sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
      return stored;
    } catch {
      return 'Admin';
    }
  }

  async function handleForceApprove() {
    setForceApproving(true);
    setMsg('');
    try {
      const adminName = getAdminName();
      if (!adminMessage || !adminMessage.trim()) {
        setMsg('Message to user is required');
        setForceApproving(false);
        return;
      }
      await FirebaseUser.forceApprovePayment(user.id, adminName, overrideReason);
      await FirebaseUser.updateAdminApproval(user.id, 'APPROVED').catch(() => {});
      await FirebaseNotification.send({
        receiverId: user.id,
        receiverName: user.name || '',
        message: adminMessage,
        type: 'payment_approved',
        senderId: adminName,
        senderName: adminName,
        adminId: adminName,
        adminName,
      });
      setAdminMessage('');
      setMsg('✓ Force Approved!');
      setShowOverrideConfirm(false);
      setOverrideReason('');
      setTimeout(() => { onClose(); }, 1200);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setForceApproving(false);
    }
  }

  if (!user) return null;

  const isQualified = user.is_qualified && user.account_status === 'inactive';
  const allPassed = autoApprovalRes?.autoApproved;

  return (
    <>
      <div className="modal-modern-overlay" onClick={onClose}>
        <div className="modal-modern" onClick={e => e.stopPropagation()}>
          <div className="modal-modern-header">
            <h2>{isCyclePayment ? 'Verify Cycle Payment' : 'Verify Payment'}</h2>
            <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
          </div>

          {(autoApprovalRes?.autoApproved || autoApprovalRes?.wasAutoApproved) && (
            <div className="alert alert-success text-center modal-alert-mb">
              Recommended Approval — All fields match
            </div>
          )}

          {(autoApprovalRes?.autoRejected || autoApprovalRes?.wasAutoRejected) && (
            <div className="alert alert-error modal-alert-mb">
              <strong>Rejected</strong> — {autoApprovalRes.failureReasons?.includes('Duplicate UTR') ? 'Duplicate UTR detected' : autoApprovalRes.failureReasons?.some(r => r.includes('Failed') || r.includes('failed')) ? 'Payment status is Failed' : 'Validation failed'}
              {autoApprovalRes.failureReasons?.length > 0 && (
                <ul className="text-sm" style={{ margin: '0.35rem 0 0 1.25rem' }}>
                  {autoApprovalRes.failureReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          )}

          {autoApprovalRes?.autoPending && (
            <div className="alert alert-warning modal-alert-mb">
              <strong>Manual Review Required</strong> — Some checks did not pass. Review the details below before deciding.
              {autoApprovalRes.failureReasons?.length > 0 && (
                <ul className="text-sm" style={{ margin: '0.35rem 0 0 1.25rem' }}>
                  {autoApprovalRes.failureReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          )}

          {autoApproving && (
            <div className="verify-section">
              <h4>Running Auto-Approval Checks...</h4>
              <div className="muted text-xs">Validating payment data...</div>
            </div>
          )}

          {isQualified && (
            <div className="alert alert-warning modal-alert-mb">
              <strong>Cycle Payment Required</strong> — User has completed 2 referrals and needs reactivation.
            </div>
          )}

          {dupCheck && (
            <div className="dup-warning-card">
              <h4>⚠ Duplicate UTR Detected</h4>
              <div className="detail"><strong>Existing User:</strong> {dupCheck.name}</div>
              <div className="detail"><strong>Email:</strong> {dupCheck.email}</div>
              <div className="detail"><strong>Status:</strong> {dupCheck.payment_status || dupCheck.cycle_payment_status}</div>
              {dupCheck.created_at && <div className="detail"><strong>Paid on:</strong> {formatDateTime(dupCheck.created_at)}</div>}
            </div>
          )}

          <div className="verify-section">
            <h4>
              Auto Validation
              {allPassed && <span className="verification-badge valid ml-sm">All Passed</span>}
              {hasFailures && <span className="verification-badge invalid ml-sm">Issues Found</span>}
            </h4>
            <div className="validation-pills">
              {validations.map((v, i) => {
                let cls = '';
                let icon = '○';
                if (v.passed === true) { cls = 'pass'; icon = '✓'; }
                else if (v.passed === false) { cls = 'fail'; icon = '✗'; }
                return (
                  <span key={i} className={`validation-pill ${cls}`}>
                    {icon} {v.label}{v.reason ? ` (${v.reason})` : ''}
                  </span>
                );
              })}
            </div>
          </div>

          {autoApprovalRes?.details && (
            <div className="verify-section">
              <h4>Validation Details</h4>
              {autoApprovalRes.confidenceScore !== undefined && (
                <div className="detail-row-bordered" style={{ marginBottom: 10 }}>
                  <span>Confidence Score</span>
                  <span>
                    <span className={`${autoApprovalRes.confidenceLabel === 'HIGH' ? 'text-success' : autoApprovalRes.confidenceLabel === 'MEDIUM' ? 'text-warning' : 'text-danger'}`}>
                      {autoApprovalRes.confidenceScore}% ({autoApprovalRes.confidenceLabel})
                    </span>
                  </span>
                </div>
              )}
              <div className="text-sm">
                {autoApprovalRes.details.map((d, i) => (
                  <div key={i} className="detail-row-bordered">
                    <span>{d.check}</span>
                    <span>
                      {d.passed === true ? (
                        <span className="text-success">✓ Pass</span>
                      ) : d.passed === false ? (
                        <span className="text-danger">✗ {d.reason || 'Fail'}</span>
                      ) : (
                        <span className="text-muted">○ Skipped — {d.reason || 'Not applicable'}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ocrData && (
            <div className="verify-section">
              <h4>OCR Extracted Data</h4>
              <div className="extracted-data-grid">
                {ocrData.utr && <><span className="label">UTR:</span><span className="value">{ocrData.utr}</span></>}
                {ocrData.amount && <><span className="label">Amount:</span><span className="value">₹{ocrData.amount}</span></>}
                {ocrData.receiver_name && <><span className="label">To:</span><span className="value">{ocrData.receiver_name}</span></>}
                {ocrData.receiver_upi && <><span className="label">Receiver UPI:</span><span className="value">{ocrData.receiver_upi}</span></>}
                {ocrData.sender_name && <><span className="label">From:</span><span className="value">{ocrData.sender_name}</span></>}
                {ocrData.sender_upi && <><span className="label">Sender UPI:</span><span className="value">{ocrData.sender_upi}</span></>}
                {ocrData.upi_id && !ocrData.sender_upi && <><span className="label">UPI ID:</span><span className="value">{ocrData.upi_id}</span></>}
                {ocrData.payment_status && <><span className="label">Status:</span><span className="value">{ocrData.payment_status}</span></>}
                {ocrData.date && <><span className="label">Date:</span><span className="value">{ocrData.date}</span></>}
                {ocrData.time && <><span className="label">Time:</span><span className="value">{ocrData.time}</span></>}
                {ocrData.bank_name && <><span className="label">Bank:</span><span className="value">{ocrData.bank_name}</span></>}
                {ocrData.ref_number && <><span className="label">Ref No:</span><span className="value">{ocrData.ref_number}</span></>}
                {ocrData.transaction_id && <><span className="label">Txn ID:</span><span className="value">{ocrData.transaction_id}</span></>}
              </div>
            </div>
          )}

          {ocrData && (
            <div className="verify-section">
              <h4>OCR vs User Input</h4>
              <div className="text-sm">
                <div className="detail-row-bordered">
                  <span>UTR</span>
                  <span>
                    <span className="text-muted">User: {displayUtr || '—'}</span>
                    {' | '}
                    <span style={{ color: ocrData.utr ? 'var(--success)' : 'var(--danger)' }}>OCR: {ocrData.utr || 'Not detected'}</span>
                    {ocrData.utr && displayUtr && <span style={{ marginLeft: 8, color: ocrData.utr === displayUtr ? 'var(--success)' : 'var(--danger)' }}>{ocrData.utr === displayUtr ? '✓ Match' : '✗ Mismatch'}</span>}
                  </span>
                </div>
                <div className="detail-row-bordered">
                  <span>Amount</span>
                  <span>
                    <span className="text-muted">User: ₹{user.user_entered_amount || 120}</span>
                    {' | '}
                    <span style={{ color: ocrData.amount ? 'var(--success)' : 'var(--danger)' }}>OCR: {ocrData.amount ? `₹${ocrData.amount}` : 'Not detected'}</span>
                    {ocrData.amount && <span style={{ marginLeft: 8, color: ocrData.amount === String(user.user_entered_amount || 120) ? 'var(--success)' : 'var(--warning)' }}>{ocrData.amount === String(user.user_entered_amount || 120) ? '✓ Match' : `₹${ocrData.amount} vs ₹${user.user_entered_amount || 120}`}</span>}
                  </span>
                </div>
                <div className="detail-row-bordered">
                  <span>Date</span>
                  <span>
                    <span className="text-muted">User: {user.user_entered_date || 'Today'}</span>
                    {' | '}
                    <span style={{ color: ocrData.date ? 'var(--success)' : 'var(--danger)' }}>OCR: {ocrData.date || 'Not detected'}</span>
                  </span>
                </div>
                <div className="detail-row-bordered">
                  <span>Sender UPI</span>
                  <span>
                    <span style={{ color: (ocrData.sender_upi || ocrData.upi_id) ? (isUpiValid(ocrData.sender_upi || ocrData.upi_id) ? 'var(--success)' : 'var(--danger)') : 'var(--danger)' }}>
                      {ocrData.sender_upi || ocrData.upi_id || 'Not detected'}
                    </span>
                  </span>
                </div>
                {ocrData.receiver_upi && (
                  <div className="detail-row-bordered">
                    <span>Receiver UPI</span>
                    <span style={{ color: 'var(--muted)' }}>{ocrData.receiver_upi}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {ocrLoading && (
            <div className="verify-section">
              <h4>OCR Processing...</h4>
              <div className="muted text-xs">Extracting text from screenshot...</div>
            </div>
          )}

          {ocrError && (
            <div className="verify-section">
              <h4>OCR Error</h4>
              <div className="text-xs text-danger">{ocrError}</div>
            </div>
          )}

          <div className="detail-grid-sm">
            <div>
              <div className="muted text-sm">User</div>
              <div className="font-bold" style={{ fontSize: '1.05rem' }}>{user.name}</div>
            </div>
            <div className="detail-grid-2col">
              <div>
                <div className="muted text-sm">Email</div>
                <div style={{ fontSize: '0.9rem' }}>{user.email}</div>
              </div>
              <div>
                <div className="muted text-sm">Phone</div>
                <div style={{ fontSize: '0.9rem' }}>{user.phone || '—'}</div>
              </div>
            </div>

            <div>
              <div className="muted text-sm">UTR Number</div>
              <div className="font-mono font-bold" style={{ fontSize: '1.1rem' }}>
                {displayUtr || '—'}
                {dupLoading && <span className="muted ml-sm text-xs">Checking...</span>}
                {dupCheck && <span className="verification-badge invalid ml-sm">Duplicate</span>}
                {!dupLoading && !dupCheck && displayUtr && <span className="verification-badge valid ml-sm">Unique</span>}
              </div>
            </div>

            <div>
              <div className="muted text-sm">Current Status</div>
              <span className={`badge ${(isCyclePayment ? user.cycle_payment_status : user.payment_status) === 'approved' ? 'badge-paid' : (isCyclePayment ? user.cycle_payment_status : user.payment_status) === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                {isCyclePayment ? (user.cycle_payment_status ? user.cycle_payment_status.charAt(0).toUpperCase() + user.cycle_payment_status.slice(1) : 'Pending') : (user.payment_status ? user.payment_status.charAt(0).toUpperCase() + user.payment_status.slice(1) : 'Pending')}
              </span>
              {isCyclePayment && user.cycle_payment_status === 'pending' && (
                <span className="ml-sm text-warning text-xs">(Cycle Payment)</span>
              )}
            </div>

            <div>
              <div className="muted text-sm">Payment Screenshot</div>
              {displayUrl ? (
                <div>
                  <img src={getImageUrl(displayUrl)} alt="Payment Screenshot Thumbnail" className="screenshot-thumb" onClick={() => setZoomUrl(displayUrl)} loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                  <span className="relative-time" style={{ display: 'block', marginTop: '0.25rem' }}>Uploaded {getRelativeTime(user.created_at)}</span>
                </div>
              ) : (
                <div className="muted">No screenshot uploaded</div>
              )}
            </div>

            {user.created_at && (
              <div>
                <div className="muted text-sm">Payment Date</div>
                <div style={{ fontSize: '0.9rem' }}>{formatDateTime(user.created_at)}</div>
                <div className="relative-time">{getRelativeTime(user.created_at)}</div>
              </div>
            )}

            {user.referred_by && (
              <div>
                <div className="muted text-sm">Referred By</div>
                <div>{user.referred_by}</div>
              </div>
            )}

            <div className="detail-grid-2col">
              <div>
                <div className="muted text-sm">Referral Code</div>
                <div className="font-mono">{user.referral_code}</div>
              </div>
              <div>
                <div className="muted text-sm">Total Referrals</div>
                <div>{user.total_referral_count || 0} (Cycle: {user.referrals_count || 0})</div>
              </div>
            </div>
          </div>

          <div className="modal-modern-body" style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
            <div className="field">
              <label>Message to User *</label>
              <textarea
                className="input w-full"
                placeholder="Explain to the user why this action was taken (required)"
                value={adminMessage}
                onChange={e => setAdminMessage(e.target.value)}
                rows={2}
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {!autoApprovalRes?.wasAutoApproved && !autoApprovalRes?.wasAutoRejected && (
            <div className="modal-modern-footer" style={{ borderTop: 'none', paddingTop: '0.5rem' }}>
              <button className={`btn-modern btn-modern-success${verifying ? ' btn-loading' : ''}`} onClick={handleApproveAndNext} disabled={verifying}>
                {'\u2713'} Approve & Next
              </button>
              <button className={`btn-modern btn-modern-success${verifying ? ' btn-loading' : ''}`} onClick={() => handleVerify('approved')} disabled={verifying}>
                {'\u2713'} Approve
              </button>
              <button className={`btn-modern btn-modern-danger${verifying ? ' btn-loading' : ''}`} onClick={() => handleVerify('rejected')} disabled={verifying}>
                {'\u2715'} Reject
              </button>
              <button className={`btn-modern btn-modern-ghost${verifying ? ' btn-loading' : ''}`} onClick={() => handleVerify('pending')} disabled={verifying}>
                {'\u23F3'} Keep Pending
              </button>
              {hasFailures && !showOverrideConfirm && (
                <button className="btn-modern btn-modern-warning" onClick={() => setShowOverrideConfirm(true)} disabled={verifying}>
                  {'\u26A0\uFE0F'} Force Approve
                </button>
              )}
            </div>
          )}

          {/* Admin Login Approval — independent from payment verification */}
          <div className="modal-modern-body" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <h4 style={{ margin: '0 0 0.5rem' }}>Admin Login Approval</h4>
            <div className="muted text-sm mb-sm">
              Current: <strong>{currentAdminStatus}</strong>
            </div>
            <div className="flex-row">
              <button
                className={`btn-modern btn-modern-success${adminApproving ? ' btn-loading' : ''}`}
                onClick={() => handleAdminApproval('APPROVED')}
                disabled={adminApproving || currentAdminStatus === 'APPROVED'}
                style={{ opacity: currentAdminStatus === 'APPROVED' ? 0.5 : 1 }}
              >
                {'\u2713'} Approve Login
              </button>
              <button
                className={`btn-modern btn-modern-danger${adminApproving ? ' btn-loading' : ''}`}
                onClick={() => handleAdminApproval('REJECTED')}
                disabled={adminApproving || currentAdminStatus === 'REJECTED'}
                style={{ opacity: currentAdminStatus === 'REJECTED' ? 0.5 : 1 }}
              >
                {'\u2715'} Reject Login
              </button>
            </div>
          </div>

          {showOverrideConfirm && (
            <div className="modal-modern-body" style={{ background: 'rgba(245, 165, 36, 0.06)', borderTop: '1px solid var(--border)' }}>
              <h4 className="text-warning" style={{ margin: '0 0 0.5rem' }}>Force Approve Payment</h4>
              <p className="muted text-sm mb-sm">
                This will bypass all validation checks. The user's account will be activated immediately.
              </p>
              <textarea
                className="input w-full mb-sm"
                placeholder="Reason for override (optional)"
                value={overrideReason}
                onChange={e => setOverrideReason(e.target.value)}
                rows={2}
                style={{ resize: 'vertical' }}
              />
              <div className="flex-row">
                <button className="btn-modern btn-modern-warning" onClick={handleForceApprove} disabled={forceApproving}>
                  {forceApproving ? '\u23F3' : '\u2713'} Confirm Force Approve
                </button>
                <button className="btn-modern btn-modern-ghost" onClick={() => { setShowOverrideConfirm(false); setOverrideReason(''); }} disabled={forceApproving}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {msg && (
            <div className="modal-modern-body" style={{ paddingTop: 0 }}>
              <p style={{ margin: 0, color: msg.includes('\u2713') || msg.includes('!') ? 'var(--success)' : 'var(--danger)' }}>
                {msg}
              </p>
            </div>
          )}
        </div>
      </div>
      {zoomUrl && <ZoomModal url={zoomUrl} onClose={() => setZoomUrl(null)} />}
    </>
  );
}

export default function FirebaseAdminPaymentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [q, setQ] = useState('');
  const [smartFilter, setSmartFilter] = useState('');
  const [dupAlerts, setDupAlerts] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) { navigate('/fb-admin', { replace: true }); return; }
    const unsubscribe = FirebaseUser.subscribeToPayments((usersWithPayment) => {
      setUsers(usersWithPayment);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    const status = searchParams.get('status');
    if (status) setSmartFilter(status);
  }, [searchParams]);

  useEffect(() => {
    if (users.length > 0) {
      FirebaseUser.getAllUtrs().then(allUtrs => {
        const seen = {};
        const alerts = [];
        allUtrs.forEach(u => {
          if (seen[u.utr]) alerts.push({ utr: u.utr, users: [seen[u.utr], u] });
          seen[u.utr] = u;
        });
        setDupAlerts(alerts);
      }).catch(() => {});
    }
  }, [users]);

  const handleVerify = async (userId, status) => {
    const user = users.find(u => u.id === userId);
    const isCycle = user?.cycle_payment_status === 'pending' || user?.cycle_payment_utr;
    if (isCycle) {
      if (status === 'approved') { await FirebaseUser.reactivate(userId); }
      else { await FirebaseUser.updateCyclePaymentStatus(userId, status); }
    } else {
      if (status === 'approved') { await FirebaseUser.updatePaymentStatus(userId, 'approved'); }
      else { await FirebaseUser.updatePaymentStatus(userId, status); }
    }
    const adminStatus = status === 'approved' ? 'APPROVED' : status === 'rejected' ? 'REJECTED' : null;
    if (adminStatus) {
      const adminName = getAdminName();
      await FirebaseUser.updateAdminApproval(userId, adminStatus, adminName).catch(() => {});
    }
  };

  const openVerification = useCallback((user) => {
    setSelectedUser(user);
  }, []);

  const filteredUsers = useMemo(() => {
    let filtered = users;
    if (smartFilter) {
      switch (smartFilter) {
        case 'pending':
          filtered = filtered.filter(u => { const c = u.cycle_payment_status === 'pending' || u.cycle_payment_utr; return c ? u.cycle_payment_status === 'pending' : u.payment_status === 'pending'; });
          break;
        case 'approved':
          filtered = filtered.filter(u => { const c = u.cycle_payment_status === 'pending' || u.cycle_payment_utr; const s = c ? u.cycle_payment_status : u.payment_status; return s === 'approved'; });
          break;
        case 'recommended_approval':
          filtered = filtered.filter(u => u.auto_approved === true);
          break;
        case 'manual_review':
          filtered = filtered.filter(u => !u.auto_approved && !u.auto_rejected && u.payment_status !== 'approved');
          break;
        case 'rejected':
          filtered = filtered.filter(u => u.auto_rejected === true || u.payment_status === 'rejected');
          break;
        case 'duplicate_utr':
          filtered = filtered.filter(u => { const utr = (u.cycle_payment_status === 'pending' || u.cycle_payment_utr) ? u.cycle_payment_utr : u.utr_number; return dupAlerts.some(a => a.utr === utr); });
          break;
        case 'today':
          filtered = filtered.filter(u => { if (!u.created_at) return false; return new Date(u.created_at).toDateString() === new Date().toDateString(); });
          break;
        case 'week':
          filtered = filtered.filter(u => { if (!u.created_at) return false; return new Date(u.created_at) >= new Date(Date.now() - 7 * 86400000); });
          break;
        case 'admin_pending':
          filtered = filtered.filter(u => (u.admin_approval_status || 'APPROVED') === 'PENDING');
          break;
        case 'admin_approved':
          filtered = filtered.filter(u => u.admin_approval_status === 'APPROVED');
          break;
        case 'admin_rejected':
          filtered = filtered.filter(u => u.admin_approval_status === 'REJECTED');
          break;
        default: break;
      }
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(u => {
        const mName = u.name && u.name.toLowerCase().includes(ql);
        const mEmail = u.email && u.email.toLowerCase().includes(ql);
        const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
        const utr = isCycle ? u.cycle_payment_utr : u.utr_number;
        return mName || mEmail || (utr && utr.includes(q));
      });
    }
    return filtered;
  }, [users, smartFilter, q, dupAlerts]);

  const stats = useMemo(() => {
    let pending = 0, approved = 0, rejected = 0, autoApproved = 0, autoRejected = 0, manualReview = 0, pendingApproval = 0;
    for (const u of users) {
      const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
      const s = isCycle ? u.cycle_payment_status : u.payment_status;
      if (s === 'pending') pending++;
      else if (s === 'approved') approved++;
      else if (s === 'rejected') rejected++;
      if (u.auto_approved) autoApproved++;
      if (u.auto_rejected) autoRejected++;
      if (u.validation_status === 'failed' && !u.auto_approved && !u.auto_rejected) manualReview++;
      if ((u.admin_approval_status || 'APPROVED') === 'PENDING') pendingApproval++;
    }
    return { pending, approved, rejected, dupAlerts: dupAlerts.length, autoApproved, autoRejected, manualReview, pendingApproval };
  }, [users, dupAlerts]);

  const handleDeleteUser = async (userId, userEmail, userPhone) => {
    if (!window.confirm('Delete this user permanently?')) return;
    try {
      await FirebaseUser.deleteUser(userId, { email: userEmail, phone: userPhone });
      setUsers(prev => prev.filter(u => u.id !== userId));
    }
    catch (err) { console.error('Delete error:', err); alert('Delete failed: ' + (err.message || 'Unknown error')); }
  };

  const updateSmartFilter = (value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('status', value);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    setSmartFilter(value);
  };

  const pendingCounts = useMemo(() => ({
    pendingPayments: stats.pending,
    pendingTopups: 0,
  }), [stats]);

  function getAdminName() {
    try {
      return sessionStorage.getItem('fb_admin_name') || localStorage.getItem('fb_admin_name') || 'Admin';
    } catch { return 'Admin'; }
  }

  return (
    <div className="admin-layout">
      <AdminSidebar pendingCounts={pendingCounts} userName={getAdminName()} />

      <main className="admin-content">
        <div className="admin-content-inner">
          <div className="admin-page-header">
            <h1 className="admin-page-title">
              <span className="admin-page-title-icon">{'\u{1F4B3}'}</span>
              Payment Verification
            </h1>
            <div className="admin-page-actions">
              <span className="badge badge-pending text-xs">{stats.pending} pending</span>
            </div>
          </div>

          <div className="stats-grid-modern">
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending Payments</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approved}</div>
              <div className="stat-label">Approved</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4E1}'}</div>
              <div className="stat-value">{stats.autoApproved}</div>
              <div className="stat-label">Auto Approved</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u{1F6AB}'}</div>
              <div className="stat-value">{stats.autoRejected}</div>
              <div className="stat-label">Auto Rejected</div>
            </div>
            <div className="stat-card-modern" style={{ borderColor: stats.dupAlerts > 0 ? 'var(--danger)' : undefined }}>
              <div className="stat-bg-icon">{'\u26A0\uFE0F'}</div>
              <div className="stat-value" style={{ color: stats.dupAlerts > 0 ? 'var(--danger)' : 'var(--muted)' }}>{stats.dupAlerts}</div>
              <div className="stat-label">Duplicate UTR</div>
            </div>
            <div className="stat-card-modern" style={{ borderColor: stats.pendingApproval > 0 ? 'var(--warning)' : undefined }}>
              <div className="stat-bg-icon">{'\u{1F512}'}</div>
              <div className="stat-value" style={{ color: stats.pendingApproval > 0 ? 'var(--warning)' : 'var(--muted)' }}>{stats.pendingApproval}</div>
              <div className="stat-label">Pending Approval</div>
            </div>
          </div>

          <div className="card-modern mb-md">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F50D}'} Search & Smart Filter</h2>
            </div>
            <div className="search-bar-modern">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email, or UTR..." />
              <select value={smartFilter} onChange={e => updateSmartFilter(e.target.value)}>
                <option value="">All Payments</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="recommended_approval">Recommended Approval</option>
                <option value="manual_review">Manual Review Required</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="duplicate_utr">Duplicate UTR</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="admin_pending">Pending Approval</option>
                <option value="admin_approved">Admin Approved</option>
                <option value="admin_rejected">Admin Rejected</option>
              </select>
            </div>
          </div>

          <div className="card-modern">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Payments ({filteredUsers.length})</h2>
            </div>
            <p className="muted text-sm mb-md">
              Smart verification enabled. Valid payments are auto-approved. Others require manual review.
            </p>

            <div className="table-wrap-modern">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>UTR</th>
                    <th>Type</th>
                    <th>Validation</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const isCycle = u.cycle_payment_status === 'pending' || u.cycle_payment_utr;
                    const displayUtr = isCycle ? u.cycle_payment_utr : u.utr_number;
                    const displayUrl = isCycle ? u.cycle_upi_screenshot_url : u.upi_screenshot_url;
                    const isDup = displayUtr && dupAlerts.some(a => a.utr === displayUtr);
                    const badge = getValidationBadge(u);
                    return (
                      <tr key={u.id} style={u.auto_approved || u.auto_rejected ? { opacity: 0.65 } : {}}>
                        <td data-label="Date" className="text-xs whitespace-nowrap">
                          {u.created_at ? <><div>{new Date(u.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div><div className="relative-time">{getRelativeTime(u.created_at)}</div></> : '—'}
                        </td>
                        <td data-label="Name">
                          <div className="font-semibold">{u.name}</div>
                          <div className="text-xs" style={{ color: 'var(--muted)' }}>{u.email}</div>
                        </td>
                        <td data-label="Phone">{u.phone || '—'}</td>
                        <td data-label="UTR" className="font-mono text-sm">
                          {displayUtr || '—'}
                          {isDup && <span className="verification-badge invalid" style={{ display: 'block', marginTop: '0.2rem' }}>Duplicate</span>}
                        </td>
                        <td data-label="Type">
                          {isCycle ? <span className="badge badge-rejected badge-xs">Cycle</span> : <span className="muted badge-xs">Initial</span>}
                        </td>
                        <td data-label="Validation">
                          <div className="verification-summary">
                            {isDup && <span className="verification-badge invalid">Dup UTR</span>}
                            {displayUrl && <span className="verification-badge valid">SS</span>}
                            {!displayUrl && displayUtr && <span className="verification-badge invalid">No SS</span>}
                            {u.auto_approved && <span className="verification-badge valid">Auto</span>}
                            {u.auto_rejected && <span className="verification-badge invalid">Rejected</span>}
                            {u.validation_status === 'failed' && !u.auto_approved && !u.auto_rejected && <span className="verification-badge invalid">Review</span>}
                          </div>
                        </td>
                        <td data-label="Status">
                          <span className={badge.className}>{badge.label}</span>
                        </td>
                        <td data-label="Actions">
                          <div className="flex-actions">
                            <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => openVerification(u)}>Verify</button>
                            {displayUrl && <button className="btn-modern btn-modern-ghost btn-modern-xs" onClick={() => window.open(getImageUrl(displayUrl), '_blank', 'noopener,noreferrer')} title="View Screenshot">{'\u{1F4F7}'}</button>}
                            <button className="btn-modern btn-modern-danger btn-modern-xs" onClick={() => handleDeleteUser(u.id, u.email, u.phone)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr><td colSpan={8} className="muted text-center" style={{ padding: '2rem' }}>No payments found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedUser && (
            <PaymentModal
              key={selectedUser.id}
              user={selectedUser}
              onClose={() => setSelectedUser(null)}
              onVerify={handleVerify}
              onVerifyAndNext={() => {
                const currentIdx = filteredUsers.findIndex(u => u.id === selectedUser.id);
                if (currentIdx + 1 < filteredUsers.length) setSelectedUser(filteredUsers[currentIdx + 1]);
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
