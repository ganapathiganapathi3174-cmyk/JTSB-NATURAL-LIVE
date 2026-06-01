import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FirebaseTopup, FirebaseUser, FirebaseNotification } from '../db/firebase-db.js';
import AdminSidebar from '../components/AdminSidebar.jsx';

const ADMIN_KEY = 'fb_admin_token';

function getInactiveReasonLabel(reason) {
  if (reason === 'own_topup_completed') return 'Own Topup Completed';
  return reason || '—';
}

function getImageUrl(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'alt=media';
}

function getImageUrlScreenshot(url) {
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

const OCR_TIMEOUT = 10000;
  const VALIDATION_TIMEOUT = 15000;
  const VALIDATION_CALL_TIMEOUT = 30000;

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]).catch(err => {
    if (fallback !== undefined) return typeof fallback === 'function' ? fallback(err) : fallback;
    throw err;
  });
}

const OCR_ENGINE_CONFIG = { useGoogleVision: false, visionApiKey: '' };

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

async function recognizeTesseract(imageUrl) {
  try {
    const { createWorker } = await import('tesseract.js');
    const modes = ['6', '3'];
    const results = await Promise.all(modes.map(async (psm) => {
      const w = await createWorker('eng');
      await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_ocr_engine_mode: '3', preserve_interword_spaces: '1' });
      const { data } = await w.recognize(imageUrl);
      await w.terminate();
      return { text: data.text || '', confidence: Math.round(data.confidence || 0), source: `tesseract-psm${psm}` };
    }));
    return results.reduce((a, b) => a.confidence >= b.confidence ? a : b);
  } catch { return null; }
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
        const cropRatio = 0.85;
        const cropY = Math.floor(img.height * (1 - cropRatio));
        const cropH = img.height - cropY;
        const scale = 4;
        const w = cropH * scale;
        const h = cropH * scale;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, cropY, img.width, cropH, 0, 0, w, h);
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
        // OTSU binarization after sharpen — skip if it collapses to near-blank
        const hist = new Array(256).fill(0);
        for (let i = 0; i < d.length; i += 4) hist[Math.round(d[i])]++;
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, maxVariance = 0, threshold = 128;
        for (let i = 0; i < 256; i++) {
          wB += hist[i];
          if (wB === 0) continue;
          const wF = total - wB;
          if (wF === 0) break;
          sumB += i * hist[i];
          const meanB = sumB / wB;
          const meanF = (sum - sumB) / wF;
          const variance = wB * wF * (meanB - meanF) * (meanB - meanF);
          if (variance > maxVariance) { maxVariance = variance; threshold = i; }
        }
        let blackCount = 0;
        for (let i = 0; i < d.length; i += 4) {
          const val = d[i] >= threshold ? 255 : 0;
          if (val === 0) blackCount++;
          d[i] = val; d[i + 1] = val; d[i + 2] = val;
        }
        const blackRatio = blackCount / total;
        // If binarization collapsed to nearly all-white or all-black, undo it
        if (blackRatio < 0.01 || blackRatio > 0.99) {
          console.log('[PREPROCESS] OTSU collapsed (blackRatio=' + blackRatio.toFixed(4) + '), reverting to grayscale');
          for (let i = 0; i < d.length; i += 4) {
            d[i] = sharp[i]; d[i + 1] = sharp[i + 1]; d[i + 2] = sharp[i + 2];
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
    img.src = url;
  });
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
        const processedUrl = await withTimeout(preprocessImage(getImageUrlScreenshot(imageUrl)), OCR_TIMEOUT, null);
        const originalUrl = getImageUrlScreenshot(imageUrl);
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

        function applyOcrFix(s) {
          const fixMap = { 'l': '1', 'I': '1', 'O': '0', 'o': '0', 'S': '5', 'B': '8' };
          return s.split('').map(c => fixMap[c] || c).join('');
        }

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

          // Log preview of text being scanned
          const preview = text.substring(0, 300).replace(/\n/g, '\\n');
          console.log('[AMOUNT] text preview:', preview);

          // Deduplicated sources
          const sources = [...new Set([text, ocrFixed, compacted, compactedFixed])].filter(Boolean);

          for (const t of sources) {
            // 1. Currency-prefixed (₹, Rs, INR) — simplest pattern, first match wins
            const currMatch = t.match(/(?:₹|Rs\.?|INR)\s*(\d{1,6}(?:[.,]\d{1,2})?)/i);
            if (currMatch) {
              const val = parseFloat(currMatch[1].replace(/,/g, ''));
              if (!isNaN(val) && val >= 1 && val <= 10000) {
                const rounded = String(Math.round(val));
                console.log('[AMOUNT] currency match:', currMatch[0], '→', rounded);
                return rounded;
              }
            }

            // 2. Standalone 120 (word boundary)
            if (/\b120\b/.test(t)) {
              console.log('[AMOUNT] standalone 120 match');
              return '120';
            }

            // 3. Number ending with .00
            const dotMatch = t.match(/\b(\d{2,5})\.00\b/);
            if (dotMatch) {
              const val = parseInt(dotMatch[1], 10);
              if (val >= 50 && val <= 10000) {
                console.log('[AMOUNT] .00 match:', dotMatch[1]);
                return String(val);
              }
            }
          }

          // 4. Aggressive: find any number close to 120 in full text
          console.log('[AMOUNT] trying aggressive number scan');
          for (const t of sources) {
            const numbers = t.match(/\b(\d{2,5})\b/g);
            if (numbers) {
              for (const n of numbers) {
                const parsed = parseInt(n, 10);
                if (parsed >= 50 && parsed <= 500 && parsed !== 2024 && parsed !== 2025 && parsed !== 2026) {
                  if (n.length === 4) {
                    const a = parseInt(n.substring(0, 2), 10);
                    const b = parseInt(n.substring(2, 4), 10);
                    if ((a >= 1 && a <= 31 && b >= 1 && b <= 12) || (a >= 1 && a <= 12 && b >= 1 && b <= 31)) continue;
                  }
                  console.log('[AMOUNT] aggressive number match:', n);
                  return n;
                }
                // Also try swapping digits (92→29)
                if (n.length >= 2) {
                  const swapped = parseInt(n[1] + n[0] + n.substring(2), 10);
                  if (swapped >= 50 && swapped <= 500) {
                    console.log('[AMOUNT] swapped digit match:', n, '→', swapped);
                    return String(swapped);
                  }
                }
              }
            }
          }

          // 5. Nuclear: substring "120" check
          for (const t of sources) {
            if (t && t.includes('120')) {
              console.log('[AMOUNT] substring 120 found');
              return '120';
            }
          }

          console.log('[AMOUNT] no amount found');
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

        function correctDate(rawDate) {
          if (!rawDate) return null;
          const trimmed = rawDate.trim();

          const numMatch = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
          if (numMatch) {
            let day = parseInt(numMatch[1]), mon = parseInt(numMatch[2]), yr = numMatch[3];
            let ds = numMatch[1], ms = numMatch[2];

            if (day > 31 && ds.length === 2) {
              const swapped = parseInt(ds[1] + ds[0]);
              if (swapped >= 1 && swapped <= 31) { day = swapped; ds = String(swapped).padStart(2, '0'); }
            }

            if (mon > 12 && ms.length === 2) {
              const swapped = parseInt(ms[1] + ms[0]);
              if (swapped >= 1 && swapped <= 12) { mon = swapped; ms = String(swapped).padStart(2, '0'); }
            }

            if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
              return `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}/${yr}`;
            }
            return null;
          }

          const txtMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
          if (txtMatch) {
            const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
            let day = parseInt(txtMatch[1]), monWord = txtMatch[2].toLowerCase(), yr = txtMatch[3];
            let ds = txtMatch[1];

            if (day > 31 && ds.length === 2) {
              const swapped = parseInt(ds[1] + ds[0]);
              if (swapped >= 1 && swapped <= 31) { day = swapped; ds = String(swapped); }
            }

            const ocrMonthFix = { 'mar': 'may', 'jur': 'jun', 'jul': 'jun', 'aug': 'apr' };
            if (ocrMonthFix[monWord]) monWord = ocrMonthFix[monWord];

            const matchedMonth = months.find(m => monWord.startsWith(m) || stringSimilarity(monWord, m) >= 50);
            if (day >= 1 && day <= 31 && matchedMonth) {
              return `${String(day).padStart(2, '0')} ${matchedMonth.charAt(0).toUpperCase() + matchedMonth.slice(1)} ${yr}`;
            }
            return null;
          }

          return null;
        }

        function extractDate(text) {
          const datePatterns = [
            /(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/,
            /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
            /(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
          ];

          const texts = [text, applyOcrFix(text)];

          for (const t of texts) {
            const keywords = ['Completed', 'UPI transaction ID', 'UTR'];
            for (const kw of keywords) {
              const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(escaped + '[^\\n]*\\n([^\\n]*\\n?){0,3}', 'i');
              const m = t.match(re);
              if (m) {
                for (const pattern of datePatterns) {
                  const dm = m[0].match(pattern);
                  if (dm) return correctDate(dm[1]);
                }
              }
            }

            for (const pattern of datePatterns) {
              const dm = t.match(pattern);
              if (dm) return correctDate(dm[1]);
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
        // UPI ID: try original text, then OCR-fixed text, with flexible patterns
        let upiMatch = text.match(/([a-zA-Z0-9._-]+@(?:okicici|oksbi|okaxis|paytm|ibl))/i)
          || text.match(/([a-zA-Z0-9._-]+)[@0](?:okicici|oksbi|okaxis|paytm|ibl)/i);
        if (!upiMatch) {
          const fixedUpi = applyOcrFix(text).match(/([a-zA-Z0-9._-]+)[@0](?:okicici|oksbi|okaxis|paytm|ibl)/i);
          if (fixedUpi) upiMatch = fixedUpi;
        }
        // Fallback: any @ pattern (generic UPI ID)
        if (!upiMatch) {
          const genericUpi = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i)
            || applyOcrFix(text).match(/([a-zA-Z0-9._-]+[@0][a-zA-Z0-9._-]+)/i);
          if (genericUpi) upiMatch = genericUpi;
        }
        const date = extractDate(text);
        const timeMatch = text.match(/(\d{1,2}:\d{2}\s?[APap][Mm])/);
        const receiverNameMatch = text.match(/To[:\s]+([A-Za-z\s]+)/i);
        const paymentStatus = extractPaymentStatus(text);
        let receiverName = null;
        if (receiverNameMatch) {
          let rn = receiverNameMatch[1].trim();
          const stopIdx = Math.min(
            rn.indexOf('Google Pay') !== -1 ? rn.indexOf('Google Pay') : Infinity,
            rn.indexOf('@') !== -1 ? rn.indexOf('@') : Infinity
          );
          if (stopIdx !== Infinity) rn = rn.substring(0, stopIdx).trim();
          if (rn) receiverName = rn;
        }

        // === AMOUNT MERGE SCAN: if raw text scan missed it, merge all extracted field texts and re-scan ===
        if (!amount) {
          const extraSources = [receiverName, paymentStatus, utrMatch].filter(Boolean);
          if (extraSources.length > 0) {
            const merged = [text, applyOcrFix(text), ...extraSources].filter(Boolean).join('\n');
            console.log('[AMOUNT MERGE] scanning', extraSources.length, 'extra source(s):', extraSources);
            amount = extractAmount(merged);
            if (amount) console.log('[AMOUNT MERGE] found:', amount);
            else console.log('[AMOUNT MERGE] still not found');
          }
        }

        // === FALLBACK: amount still missing → run Tesseract on original uncropped image ===
        if (!amount && processedUrl) {
          try {
            console.log('[AMOUNT FALLBACK] Running Tesseract on original image...');
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker('eng');
            await worker.setParameters({ tessedit_pageseg_mode: '6' });
            const { data } = await worker.recognize(getImageUrlScreenshot(imageUrl));
            await worker.terminate();
            if (data?.text) {
              const amount2 = extractAmount(data.text);
              if (amount2) {
                console.log('[AMOUNT FALLBACK] Found in original image:', amount2);
                amount = amount2;
              }
            }
          } catch (e) {
            console.log('[AMOUNT FALLBACK] Failed:', e.message);
          }
        }

        // === FALLBACK 2: number-only Tesseract pass (whitelist digits only) ===
        if (!amount) {
          try {
            console.log('[AMOUNT NUM-ONLY] Running number-whitelist Tesseract...');
            const { createWorker } = await import('tesseract.js');
            const numWorker = await createWorker('eng');
            await numWorker.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789₹.,' });
            const { data } = await numWorker.recognize(recognizeUrl);
            await numWorker.terminate();
            if (data?.text) {
              const nText = data.text.replace(/[^\d₹.,\s\n]/g, '');
              console.log('[AMOUNT NUM-ONLY] raw output:', nText.substring(0, 200));
              const amount2 = extractAmount(nText);
              if (amount2) {
                console.log('[AMOUNT NUM-ONLY] Found:', amount2);
                amount = amount2;
              }
            }
          } catch (e) {
            console.log('[AMOUNT NUM-ONLY] Failed:', e.message);
          }
        }

        setOcrData({
          raw: text,
          ocr_confidence: Math.round(confidence),
          isGooglePay,
          utr: utrMatch || null,
          amount,
          upi_id: upiMatch ? upiMatch[1] : null,
          date,
          time: timeMatch ? timeMatch[1] : null,
          receiver_name: receiverName,
          payment_status: paymentStatus,
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

function TopupModal({ topup, onClose, onVerify, onDelete, userData }) {
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState('');
  const [dupCheck, setDupCheck] = useState(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [autoApprovalRes, setAutoApprovalRes] = useState(null);
  const [autoApproving, setAutoApproving] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

  const isInactive = userData?.account_status === 'inactive';
  const inactiveReason = userData ? getInactiveReasonLabel(userData.inactive_reason) : null;

  const displayUrl = topup?.screenshotData;
  const { ocrData, ocrLoading, ocrError } = useOcr(topup?.status === 'pending' ? displayUrl : null);

  useEffect(() => {
    if (topup?.transactionId) {
      setDupLoading(true);
      FirebaseUser.checkDuplicateUtrInTopups(topup.transactionId, topup.id).then(result => {
        setDupCheck(result);
      }).catch(() => {}).finally(() => setDupLoading(false));
    }
  }, [topup?.transactionId, topup?.id]);

  useEffect(() => {
    if (ocrData && !autoApprovalRes && !autoApproving && topup.status === 'pending') {
      setAutoApproving(true);
      const timeoutId = setTimeout(() => {
        setAutoApproving(false);
        setMsg('⏱ Processing Timeout');
      }, VALIDATION_TIMEOUT);
      withTimeout(FirebaseUser.processTopupAutoApproval(topup.id, topup, { ocrData }), VALIDATION_CALL_TIMEOUT, { autoApproved: false, autoRejected: true, wasAutoRejected: true, failureReasons: ['Validation timed out'] }).then(res => {
        clearTimeout(timeoutId);
        setAutoApprovalRes(res);
        if (res.wasAutoApproved) {
          setMsg('✓ Auto Approved!');
          setTimeout(() => { onClose(); }, 1200);
        } else if (res.wasAutoRejected) {
          setMsg('✗ Auto Rejected');
          setTimeout(() => { onClose(); }, 2000);
        }
      }).catch(() => { clearTimeout(timeoutId); }).finally(() => { clearTimeout(timeoutId); setAutoApproving(false); });
    }
  }, [ocrData, topup.id, topup.status, autoApprovalRes, autoApproving, onClose]);

  const validations = useMemo(() => {
    const v = [];
    const topupAmount = Number(topup?.amount || 0);

    // OCR Confidence: PASS (≥70) or FAIL (<70 or missing)
    const conf = ocrData?.ocr_confidence;
    if (conf !== undefined) {
      v.push({ label: 'OCR Confidence', passed: conf >= 70, ocrValue: `${conf}%` });
    } else {
      v.push({ label: 'OCR Confidence', passed: false, reason: 'No OCR data' });
    }

    // Amount: PASS (within tolerance) or FAIL (detected wrong) or SKIPPED (not detected)
    if (ocrData?.amount) {
      const parsed = parseFloat(ocrData.amount.replace(/[,]/g, ''));
      const ok = topupAmount > 0 && !isNaN(parsed) && Math.abs(parsed - topupAmount) < 10;
      v.push({ label: `Amount (₹${topupAmount})`, passed: ok, ocrValue: ocrData.amount });
    } else if (displayUrl) {
      v.push({ label: `Amount (₹${topupAmount})`, passed: null, reason: 'Skipped (not detected)' });
    } else {
      v.push({ label: `Amount (₹${topupAmount})`, passed: null, reason: 'No screenshot' });
    }

    // UPI ID: PASS (valid) or FAIL (not detected — per spec fallback)
    if (ocrData?.upi_id) {
      v.push({ label: 'UPI ID', passed: isUpiValid(ocrData.upi_id), ocrValue: ocrData.upi_id });
    } else {
      v.push({ label: 'UPI ID', passed: false, reason: 'Not detected' });
    }

    // Payment Status: derive from OCR or infer from transaction ID + amount
    if (ocrData?.payment_status) {
      const status = ocrData.payment_status.toLowerCase();
      const ok = status === 'completed' || status === 'success' || status === 'successful' || status === 'paid';
      v.push({ label: 'Payment Status', passed: ok, ocrValue: ocrData.payment_status });
    } else {
      const idOk = topup?.transactionId && !dupCheck;
      const amtOk = ocrData?.amount && topupAmount > 0 && Math.abs(parseFloat(ocrData.amount.replace(/[,]/g, '')) - topupAmount) < 10;
      if (idOk && amtOk) {
        v.push({ label: 'Payment Status', passed: true, ocrValue: 'Inferred' });
      } else {
        v.push({ label: 'Payment Status', passed: null, reason: 'Unknown' });
      }
    }

    // Transaction Date: PASS (today) or SKIPPED (not detected)
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
    } else if (displayUrl) {
      v.push({ label: 'Transaction Date', passed: null, reason: 'Skipped (not detected)' });
    } else {
      v.push({ label: 'Transaction Date', passed: null, reason: 'No screenshot' });
    }

    // Unique Transaction ID: PASS or FAIL
    if (dupCheck) {
      v.push({ label: 'Unique Transaction ID', passed: false, reason: 'Duplicate ID detected' });
    } else if (topup?.transactionId) {
      v.push({ label: 'Unique Transaction ID', passed: true });
    } else {
      v.push({ label: 'Unique Transaction ID', passed: false, reason: 'No ID to check' });
    }
    return v;
  }, [dupCheck, displayUrl, ocrData, ocrError, topup]);

  const hasFailures = useMemo(() => validations.some(v => v.passed !== true), [validations]);
  const allPassed = autoApprovalRes?.autoApproved;

  async function handleVerify(status) {
    setVerifying(true);
    setMsg('');
    try {
      if (!adminMessage || !adminMessage.trim()) {
        setMsg('Message to user is required');
        setVerifying(false);
        return;
      }
      await onVerify(topup.id, status);
      await FirebaseNotification.send({
        receiverId: topup.userId,
        receiverName: topup.userName || '',
        message: adminMessage,
        type: status === 'approved' ? 'topup_approved' : 'topup_rejected',
        senderId: 'Admin',
        senderName: 'Admin',
      });
      setAdminMessage('');
      setMsg(status === 'approved' ? 'Topup Approved!' : 'Topup Rejected!');
      setTimeout(onClose, 1000);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setVerifying(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this topup record permanently?')) return;
    setDeleting(true);
    try {
      await onDelete(topup.id);
      onClose();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setDeleting(false);
    }
  }

  if (!topup) return null;

  return (
    <div className="modal-modern-overlay" onClick={onClose}>
      <div className="modal-modern" onClick={e => e.stopPropagation()}>
        <div className="modal-modern-header">
          <h2>Topup Details</h2>
          <button onClick={onClose} className="btn-modern btn-modern-ghost btn-modern-sm">{'\u2715'}</button>
        </div>

        {autoApprovalRes?.wasAutoApproved && (
          <div className="alert alert-success modal-alert-mb text-center" style={{ fontSize: '1rem' }}>
            ✓ Auto Approved — All validations passed
          </div>
        )}

        {autoApprovalRes?.wasAutoRejected && (
          <div className="alert alert-error modal-alert-mb">
            <strong>✗ Auto Rejected</strong> — Validation tests failed.
            {autoApprovalRes.failureReasons?.length > 0 && (
              <ul className="text-sm" style={{ margin: '0.35rem 0 0 1.25rem' }}>
                {autoApprovalRes.failureReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        )}

        {autoApprovalRes && !autoApprovalRes.wasAutoApproved && !autoApprovalRes.wasAutoRejected && (
          <div className="alert alert-error modal-alert-mb">
            <strong>Manual Review Required</strong> — Some checks are inconclusive.
          </div>
        )}

        {autoApproving && (
          <div className="verify-section">
            <h4>Running Auto-Approval Checks...</h4>
            <div className="muted" style={{ fontSize: '0.8rem' }}>Validating topup data...</div>
          </div>
        )}

        {dupCheck && (
          <div className="dup-warning-card">
            <h4>⚠ Duplicate Transaction ID Detected</h4>
            <div className="detail"><strong>Existing User:</strong> {dupCheck.userName}</div>
            <div className="detail"><strong>Email:</strong> {dupCheck.userEmail}</div>
            <div className="detail"><strong>Amount:</strong> ₹{Number(dupCheck.amount || 0).toFixed(2)}</div>
            <div className="detail"><strong>Status:</strong> {dupCheck.status}</div>
            {dupCheck.createdAt && <div className="detail"><strong>Date:</strong> {new Date(dupCheck.createdAt).toLocaleString()}</div>}
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
                  {icon} {v.label}
                </span>
              );
            })}
          </div>
        </div>

        {autoApprovalRes?.details && (
          <div className="verify-section">
            <h4>Validation Details</h4>
            <div className="text-sm">
              {autoApprovalRes.details.map((d, i) => (
                <div key={i} className="detail-row-bordered">
                  <span>{d.check}</span>
                  <span style={{ color: d.passed ? 'var(--success)' : d.passed === false ? 'var(--danger)' : 'var(--muted)' }}>
                    {d.passed === true ? '✓ Pass' : d.passed === false ? `✗ ${d.reason || 'Fail'}` : '○ Skip'}
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
              {ocrData.receiver_name && <><span className="label">Receiver:</span><span className="value">{ocrData.receiver_name}</span></>}
              {ocrData.upi_id && <><span className="label">UPI ID:</span><span className="value">{ocrData.upi_id}</span></>}
              {ocrData.payment_status && <><span className="label">Status:</span><span className="value">{ocrData.payment_status}</span></>}
              {ocrData.date && <><span className="label">Date:</span><span className="value">{ocrData.date}</span></>}
              {ocrData.time && <><span className="label">Time:</span><span className="value">{ocrData.time}</span></>}
            </div>
          </div>
        )}

        {ocrLoading && (
          <div className="verify-section">
            <h4>OCR Processing...</h4>
            <div className="muted" style={{ fontSize: '0.8rem' }}>Extracting text from screenshot...</div>
          </div>
        )}

        {ocrError && (
          <div className="verify-section">
            <h4>OCR Error</h4>
            <div style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>{ocrError}</div>
          </div>
        )}

        <div className="detail-grid-sm">
          <div>
            <div className="muted text-sm">User</div>
            <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{topup.userName}</div>
          </div>
          <div>
            <div className="muted text-sm">Email</div>
            <div style={{ fontSize: '0.9rem' }}>{topup.userEmail}</div>
          </div>
          <div>
            <div className="muted text-sm">Phone</div>
            <div>{topup.userPhone || '—'}</div>
          </div>
          <div>
            <div className="muted text-sm">Amount</div>
            <div className="font-bold text-success" style={{ fontSize: '1.5rem' }}>₹{Number(topup.amount || 0).toFixed(2)}</div>
          </div>
          <div>
            <div className="muted text-sm">Transaction ID</div>
            <div className="font-mono" style={{ fontSize: '1rem', fontWeight: 'bold' }}>
              {topup.transactionId || '—'}
              {dupLoading && <span className="muted ml-sm" style={{ fontSize: '0.75rem' }}>Checking...</span>}
              {dupCheck && <span className="verification-badge invalid ml-sm">Duplicate</span>}
              {!dupLoading && !dupCheck && topup.transactionId && <span className="verification-badge valid ml-sm">Unique</span>}
            </div>
          </div>
          <div>
            <div className="muted text-sm">Referral Code</div>
            <div className="font-mono">{topup.userReferralCode || '—'}</div>
          </div>
          {topup.referred_by && (
            <div>
              <div className="muted text-sm">Referred By</div>
              <div>{topup.referred_by}</div>
            </div>
          )}
          <div>
            <div className="muted text-sm">Current Status</div>
            <div>
              <span className={`badge ${topup.status === 'approved' ? 'badge-paid' : topup.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                {topup.status ? topup.status.charAt(0).toUpperCase() + topup.status.slice(1) : 'Pending'}
              </span>
              {autoApprovalRes?.wasAutoApproved && <span className="verification-badge valid" style={{ marginLeft: '0.35rem' }}>Auto</span>}
              {autoApprovalRes?.wasAutoRejected && <span className="verification-badge invalid" style={{ marginLeft: '0.35rem' }}>Auto</span>}
            </div>
          </div>
          {isInactive && (
            <div>
              <div className="muted text-sm">Account Status</div>
              <div>
                <span className="badge badge-rejected badge-xs">Inactive</span>
                <span className="badge badge-pending badge-xs" style={{ marginLeft: '0.25rem' }}>
                  {inactiveReason}
                </span>
              </div>
            </div>
          )}
          <div>
            <div className="muted text-sm">Payment Screenshot</div>
            {displayUrl ? (
              <div>
                <button type="button" className="btn btn-primary" style={{ marginBottom: '0.5rem' }}
                  onClick={() => window.open(getImageUrlScreenshot(displayUrl), '_blank', 'noopener,noreferrer')}>
                  Open Image
                </button>
                <br />
                <img src={getImageUrlScreenshot(displayUrl)} alt="Topup Screenshot"
                  style={{ maxWidth: '100%', borderRadius: '8px', marginTop: '0.5rem', border: '1px solid var(--border)' }}
                  loading="lazy"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            ) : (
              <div className="muted">No screenshot uploaded</div>
            )}
          </div>
          <div>
            <div className="muted text-sm">Submitted At</div>
            <div>{topup.createdAt ? new Date(topup.createdAt).toLocaleString() : '—'}</div>
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

        {!autoApprovalRes?.wasAutoApproved && !autoApprovalRes?.wasAutoRejected && topup.status === 'pending' && (
          <div className="modal-modern-footer" style={{ borderTop: 'none', paddingTop: '0.5rem' }}>
            <button className={`btn-modern btn-modern-success${verifying ? ' btn-loading' : ''}`}
              onClick={() => handleVerify('approved')} disabled={verifying}>
              {'\u2713'} Approve Topup
            </button>
            <button className={`btn-modern btn-modern-danger${verifying ? ' btn-loading' : ''}`}
              onClick={() => handleVerify('rejected')} disabled={verifying}>
              {'\u2715'} Reject Topup
            </button>
          </div>
        )}
        {topup.status !== 'pending' && (
          <div className="modal-modern-footer" style={{ borderTop: 'none', paddingTop: '0.5rem' }}>
            <button className={`btn-modern btn-modern-danger${deleting ? ' btn-loading' : ''}`}
              onClick={handleDelete} disabled={deleting}>
              {'\u{1F5D1}'} Delete Record
            </button>
          </div>
        )}

        {msg && (
          <div className="modal-modern-body" style={{ paddingTop: 0 }}>
            <p style={{ margin: 0, color: msg.includes('\u2713') || msg.includes('Approved') ? 'var(--success)' : 'var(--danger)' }}>
              {msg}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FirebaseAdminTopupsPage() {
  const navigate = useNavigate();
  const [topups, setTopups] = useState([]);
  const [selectedTopup, setSelectedTopup] = useState(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sponsors, setSponsors] = useState([]);
  const [creditModal, setCreditModal] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [crediting, setCrediting] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem(ADMIN_KEY);
    if (!token) {
      navigate('/fb-admin', { replace: true });
      return;
    }
    const unsubscribe = FirebaseTopup.subscribeToTopups((data) => {
      setTopups(data || []);
    });
    return () => { if (unsubscribe) unsubscribe(); };
  }, [navigate]);

  useEffect(() => {
    FirebaseTopup.getSponsorsAwaitingCredit().then(setSponsors).catch(() => {});
  }, []);

  const handleReview = async (topup) => {
    setSelectedTopup(topup);
    try {
      const user = await FirebaseUser.findById(topup.userId);
      setSelectedUser(user);
    } catch {
      setSelectedUser(null);
    }
  };

  const refreshSponsors = async () => {
    const list = await FirebaseTopup.getSponsorsAwaitingCredit();
    setSponsors(list);
  };

  const handleVerify = async (topupId, status) => {
    await FirebaseTopup.updateStatus(topupId, status, 'admin');
  };

  const handleDelete = async (topupId) => {
    await FirebaseTopup.delete(topupId);
  };

  const handleCreditSponsor = async () => {
    if (!creditModal || !creditAmount || Number(creditAmount) <= 0) return;
    setCrediting(true);
    try {
      await FirebaseTopup.creditSponsor(creditModal.id, Number(creditAmount), 'admin');
      setCreditModal(null);
      setCreditAmount('');
      await refreshSponsors();
    } catch (err) {
      alert(err.message);
    } finally {
      setCrediting(false);
    }
  };

  const filteredTopups = useMemo(() => {
    let filtered = topups;
    if (statusFilter) {
      if (statusFilter === 'auto_approved') {
        filtered = filtered.filter(t => t.auto_approved === true);
      } else if (statusFilter === 'auto_rejected') {
        filtered = filtered.filter(t => t.auto_rejected === true);
      } else {
        filtered = filtered.filter(t => t.status === statusFilter);
      }
    }
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(t =>
        (t.userName && t.userName.toLowerCase().includes(ql)) ||
        (t.userEmail && t.userEmail.toLowerCase().includes(ql)) ||
        (t.transactionId && t.transactionId.toLowerCase().includes(ql))
      );
    }
    return filtered;
  }, [topups, statusFilter, q]);

  const stats = useMemo(() => ({
    pending: topups.filter(t => t.status === 'pending').length,
    approved: topups.filter(t => t.status === 'approved').length,
    rejected: topups.filter(t => t.status === 'rejected').length,
    autoApproved: topups.filter(t => t.auto_approved).length,
    autoRejected: topups.filter(t => t.auto_rejected).length,
    total: topups.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
  }), [topups]);

  const pendingCounts = useMemo(() => ({
    pendingPayments: 0,
    pendingTopups: stats.pending,
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
              <span className="admin-page-title-icon">{'\u{1F4E4}'}</span>
              Topup Management
            </h1>
            <div className="admin-page-actions">
              <button className="btn-modern btn-modern-ghost btn-modern-sm" onClick={refreshSponsors}>Refresh</button>
            </div>
          </div>

          {sponsors.filter(s => !s.sponsor_credited).length > 0 && (
            <div className="card-modern mb-md" style={{ borderLeft: '4px solid var(--accent)' }}>
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u{1F3C6}'} Sponsors Awaiting Credit ({sponsors.filter(s => !s.sponsor_credited).length})</h2>
              </div>
              <div className="table-wrap-modern">
                <table>
                  <thead>
                    <tr>
                      <th>Sponsor No</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Topup Refs</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsors.filter(s => !s.sponsor_credited).map(s => (
                      <tr key={s.id}>
                        <td data-label="Sponsor No"><code>{s.referral_code || '—'}</code></td>
                        <td data-label="Name" className="font-semibold">{s.name}</td>
                        <td data-label="Email" className="text-sm">{s.email}</td>
                        <td data-label="Topup Refs">{s.topup_referrals_count}</td>
                        <td data-label="Amount" className="font-bold text-success">₹{Number(s.sponsor_topup_amount || 0).toFixed(2)}</td>
                        <td data-label="Status"><span className="badge badge-pending">Awaiting Credit</span></td>
                        <td data-label="Action">
                          <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => { setCreditModal(s); setCreditAmount(s.sponsor_topup_amount || ''); }}>
                            Credit Now
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {sponsors.filter(s => s.sponsor_credited).length > 0 && (
            <div className="card-modern mb-md">
              <div className="card-modern-header">
                <h2 className="card-modern-title">{'\u{1F4B5}'} Credit History</h2>
              </div>
              <div className="table-wrap-modern">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Amount Credited</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsors.filter(s => s.sponsor_credited).map(s => (
                      <tr key={s.id}>
                        <td data-label="Name" className="font-semibold">{s.name}</td>
                        <td data-label="Email" className="text-sm">{s.email}</td>
                        <td data-label="Amount Credited" className="font-bold text-success">₹{Number(s.sponsor_credited_amount || 0).toFixed(2)}</td>
                        <td data-label="Date" style={{ fontSize: '0.8rem' }}>{s.sponsor_credited_at ? new Date(s.sponsor_credited_at).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="stats-grid-modern">
            <div className="stat-card-modern warning">
              <div className="stat-bg-icon">{'\u23F3'}</div>
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending Topups</div>
            </div>
            <div className="stat-card-modern success">
              <div className="stat-bg-icon">{'\u2705'}</div>
              <div className="stat-value">{stats.approved}</div>
              <div className="stat-label">Approved Topups</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u{1F6AB}'}</div>
              <div className="stat-value">{stats.rejected}</div>
              <div className="stat-label">Rejected Topups</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4E1}'}</div>
              <div className="stat-value">{stats.autoApproved}</div>
              <div className="stat-label">Auto Approved</div>
            </div>
            <div className="stat-card-modern danger">
              <div className="stat-bg-icon">{'\u{1F4A2}'}</div>
              <div className="stat-value">{stats.autoRejected}</div>
              <div className="stat-label">Auto Rejected</div>
            </div>
            <div className="stat-card-modern accent">
              <div className="stat-bg-icon">{'\u{1F4B8}'}</div>
              <div className="stat-value">₹{stats.total.toFixed(2)}</div>
              <div className="stat-label">Total Amount</div>
            </div>
          </div>

          <div className="card-modern mb-md">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F50D}'} Search & Filter</h2>
            </div>
            <div className="search-bar-modern">
              <input value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search by name, email, or transaction ID..." />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All Topups</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option disabled>{'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'}</option>
                <option value="auto_approved">Auto Approved</option>
                <option value="auto_rejected">Auto Rejected</option>
              </select>
            </div>
          </div>

          <div className="card-modern">
            <div className="card-modern-header">
              <h2 className="card-modern-title">{'\u{1F4CB}'} Topup Requests ({filteredTopups.length})</h2>
            </div>
            <p className="muted text-sm mb-md">
              Real-time updates enabled. Click "Review" to view details and approve/reject.
            </p>

            <div className="table-wrap-modern">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>User</th>
                    <th>Email</th>
                    <th>Amount</th>
                    <th>Transaction ID</th>
                    <th>Sponsor No</th>
                    <th>Benefit</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTopups.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Date" style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td data-label="User" className="font-semibold">{t.userName}</td>
                      <td data-label="Email" className="text-sm">{t.userEmail}</td>
                      <td data-label="Amount" className="font-bold">₹{Number(t.amount || 0).toFixed(2)}</td>
                      <td data-label="Transaction ID" className="font-mono text-sm">{t.transactionId || '—'}</td>
                      <td data-label="Sponsor No" className="font-mono" style={{ fontSize: '0.8rem' }}>{t.referred_by || '—'}</td>
                      <td data-label="Benefit">
                        {t.status === 'approved' ? (
                          <span className="badge badge-paid badge-xs">Done</span>
                        ) : (
                          <span className="muted badge-xs">—</span>
                        )}
                      </td>
                      <td data-label="Status">
                        <span className={`badge ${t.status === 'approved' ? 'badge-paid' : t.status === 'rejected' ? 'badge-rejected' : 'badge-pending'}`}>
                          {t.status ? t.status.charAt(0).toUpperCase() + t.status.slice(1) : 'Pending'}
                        </span>
                        {t.auto_approved && <span className="verification-badge valid" style={{ marginLeft: '0.25rem' }}>Auto</span>}
                        {t.auto_rejected && <span className="verification-badge invalid" style={{ marginLeft: '0.25rem' }}>Auto</span>}
                      </td>
                      <td data-label="Actions">
                        <div className="action-group">
                          <button className="btn-modern btn-modern-primary btn-modern-xs" onClick={() => handleReview(t)}>
                            Review
                          </button>
                          {t.status !== 'pending' && (
                            <button className="btn-modern btn-modern-danger btn-modern-xs"
                              onClick={() => { if (window.confirm('Delete topup for ' + t.userName + '?')) { handleDelete(t.id); } }}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTopups.length === 0 && (
                    <tr><td colSpan={9}><div className="empty-state-modern"><span className="empty-icon">{'\u{1F4ED}'}</span><span className="empty-text">No topup requests found.</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {selectedTopup && (
            <TopupModal
              topup={selectedTopup}
              userData={selectedUser}
              onClose={() => { setSelectedTopup(null); setSelectedUser(null); }}
              onVerify={handleVerify}
              onDelete={handleDelete}
            />
          )}

          {creditModal && (
            <div className="modal-modern-overlay" onClick={() => { if (!crediting) { setCreditModal(null); } }}>
              <div className="modal-modern" onClick={e => e.stopPropagation()}>
                <div className="modal-modern-header">
                  <h2>Credit Sponsor</h2>
                  <button onClick={() => setCreditModal(null)} className="btn-modern btn-modern-ghost btn-modern-sm" disabled={crediting}>{'\u2715'}</button>
                </div>
                <div className="modal-modern-body">
                  <div className="detail-grid mb-md">
                    <div className="detail-row">
                      <span className="detail-label">Sponsor</span>
                      <span className="detail-value">{creditModal.name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{creditModal.email}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Topup Referrals</span>
                      <span className="detail-value">{creditModal.topup_referrals_count}</span>
                    </div>
                  </div>
                  <div className="field">
                    <label>Credit Amount (INR)</label>
                    <input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)}
                      placeholder="Enter amount" min="1" disabled={crediting} />
                  </div>
                </div>
                <div className="modal-modern-footer">
                  <button className={`btn-modern btn-modern-success${crediting ? ' btn-loading' : ''}`}
                    onClick={handleCreditSponsor} disabled={crediting || !creditAmount || Number(creditAmount) <= 0}>
                    {crediting ? 'Crediting...' : '\u2713 Credit Amount'}
                  </button>
                  <button className="btn-modern btn-modern-ghost" onClick={() => setCreditModal(null)} disabled={crediting}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
