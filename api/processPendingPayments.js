const https = require('https');
const crypto = require('crypto');
const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_UPI_PAYMENTS, COL_TOPUP_INCOME, COL_VERIFICATION_LOGS, MAX_REFERRALS, randomString,
} = require('./_shared.js');
const { getDoc, deleteDoc, runQuery, writeDoc, updateDoc, addDoc } = require('./_supabase.js');
const { analyzeScreenshot } = require('./_vision.js');

const DEFAULT_UPI_ID = 'jayarajj126-3@okicici';
const ALLOWED_AMOUNTS = [120, 500, 1000];

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : require('http');
    mod.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const today = new Date().toISOString().split('T')[0];

    const pendingPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 100 });

    const results = { processed: 0, approved: 0, rejected: 0, manualReview: 0, ocrSkipped: 0, errors: [] };

    for (const payment of pendingPayments) {
      const paymentId = payment.id;
      const utr = payment.utr || paymentId;
      results.processed++;

      try {
        const amountNum = Number(payment.amount) || 0;
        const type = payment.payment_type;
        const validationSteps = [];
        let rejectionReasons = [];
        const manualReviewReasons = [];

        function recordStep(layer, stepNum, name, passed, detail) {
          validationSteps.push({ layer, step: stepNum, name, passed, detail: detail || '' });
        }

        // PROTECTION: Verification Locking
        if (payment.verification_locked) {
          const lockedAt = payment.verification_locked_at ? new Date(payment.verification_locked_at).getTime() : 0;
          if (lockedAt && (Date.now() - lockedAt) < 300000) {
            results.errors.push({ utr, error: 'Verification locked by another process' });
            results.processed--;
            continue;
          }
        }
        await updateDoc(COL_UPI_PAYMENTS, paymentId, { verification_locked: true, verification_locked_at: new Date().toISOString() });

        // PROTECTION: Rate Limiting
        if (payment.user_id) {
          const recentPayments = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'user_id', op: 'EQUAL', value: payment.user_id },
          ], { limit: 20 });
          const todayStartMs = new Date().setHours(0, 0, 0, 0);
          const todayAttempts = recentPayments.filter(p => {
            const t = p.created_at ? new Date(p.created_at).getTime() : 0;
            return t >= todayStartMs;
          });
          if (todayAttempts.length >= 3) {
            recordStep(0, 0, 'Rate limiting', false, todayAttempts.length + ' payment attempts today exceeds limit of 3');
            rejectionReasons.push('Rate limit exceeded: maximum 3 payment attempts per day');
          } else {
            recordStep(0, 0, 'Rate limiting', true, todayAttempts.length + '/3 attempts used today');
          }
        } else {
          recordStep(0, 0, 'Rate limiting', true, 'No userId — rate limiting not applicable');
        }

        // LAYER 1 — Basic Input Validation
        if (!payment.screenshot_url) {
          recordStep(1, 1, 'Screenshot uploaded', false, 'No screenshot URL provided');
          rejectionReasons.push('No screenshot uploaded');
        } else {
          recordStep(1, 1, 'Screenshot uploaded', true, 'Screenshot URL: ' + payment.screenshot_url.substring(0, 80));
        }

        if (!payment.utr || typeof payment.utr !== 'string' || payment.utr.trim().length < 4) {
          recordStep(1, 2, 'UTR entered', false, 'UTR missing or too short');
          rejectionReasons.push('No valid transaction reference (UTR) provided');
        } else {
          recordStep(1, 2, 'UTR entered', true, 'UTR: ' + payment.utr);
        }

        // LAYER 2 — OCR Extraction
        let ocrResult = null;
        let screenshotHash = '';
        let ocrAvailable = false;
        let imageQuality = null;

        if (payment.screenshot_url && rejectionReasons.length === 0) {
          try {
            const analysis = await analyzeScreenshot(payment.screenshot_url);
            screenshotHash = analysis.imageHash || '';
            ocrAvailable = analysis.ocrAvailable;
            imageQuality = analysis.imageQuality || null;

            if (analysis.error) {
              recordStep(2, 3, 'OCR extraction', false, 'OCR unavailable: ' + analysis.error);
              rejectionReasons.push('Screenshot could not be analyzed: ' + analysis.error);
            } else if (ocrAvailable && analysis.ocrParsed) {
              ocrResult = analysis.ocrParsed;
              recordStep(2, 3, 'OCR extraction', true, 'Extracted ' + ocrResult.wordCount + ' words, confidence: ' + ocrResult.confidence + '%');
            } else {
              recordStep(2, 3, 'OCR extraction', false, 'No text detected in screenshot');
              rejectionReasons.push('No text could be extracted from screenshot');
            }
          } catch (e) {
            recordStep(2, 3, 'OCR extraction', false, 'Error: ' + e.message);
            rejectionReasons.push('Screenshot processing error: ' + e.message);
          }
        } else {
          recordStep(2, 3, 'OCR extraction', false, 'Skipped — no screenshot or prior failures');
        }

        // Minimum 5 OCR fields
        if (rejectionReasons.length === 0 && ocrResult) {
          const ocrFields = [ocrResult.extractedDate, ocrResult.extractedAmount, ocrResult.extractedUpiId, ocrResult.extractedUtr, ocrResult.extractedStatus];
          const extractedCount = ocrFields.filter(Boolean).length;
          if (extractedCount >= 5) {
            recordStep(2, 3.5, 'Minimum OCR fields', true, 'Extracted ' + extractedCount + '/5 fields');
          } else {
            const missing = ['Date', 'Amount', 'UPI ID', 'UTR', 'Status'].filter((_, i) => !ocrFields[i]);
            recordStep(2, 3.5, 'Minimum OCR fields', false, 'Extracted ' + extractedCount + '/5 fields. Missing: ' + missing.join(', '));
            rejectionReasons.push('Insufficient data extracted from screenshot: ' + missing.join(', '));
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(2, 3.5, 'Minimum OCR fields', false, 'No OCR result available');
        }

        // Image Quality
        if (rejectionReasons.length === 0 && imageQuality) {
          if (imageQuality.blurry || imageQuality.cropped || imageQuality.dark || imageQuality.incomplete) {
            const issues = [];
            if (imageQuality.blurry) issues.push('blurry');
            if (imageQuality.cropped) issues.push('cropped');
            if (imageQuality.dark) issues.push('dark');
            if (imageQuality.incomplete) issues.push('incomplete');
            recordStep(1, 0, 'Image quality', false, 'Quality issues: ' + issues.join(', '));
            rejectionReasons.push('Low quality screenshot: ' + issues.join(', '));
          } else {
            recordStep(1, 0, 'Image quality', true, 'Screenshot quality acceptable');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(1, 0, 'Image quality', false, 'Image quality analysis not available');
        }

        // Multi-Detection
        if (rejectionReasons.length === 0 && ocrResult) {
          if (ocrResult.ambiguous) {
            const multiFlags = [];
            if (ocrResult.amountCount > 1) multiFlags.push(ocrResult.amountCount + ' amounts');
            if (ocrResult.upiIdCount > 1) multiFlags.push(ocrResult.upiIdCount + ' UPI IDs');
            if (ocrResult.utrCount > 1) multiFlags.push(ocrResult.utrCount + ' UTRs');
            recordStep(2, 0, 'Multi-detection check', false, 'Ambiguous: ' + multiFlags.join(', '));
            manualReviewReasons.push('Multiple values detected: ' + multiFlags.join(', '));
          } else {
            recordStep(2, 0, 'Multi-detection check', true, 'Single values detected for all fields');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(2, 0, 'Multi-detection check', false, 'No OCR result available');
        }

        // OCR confidence (3-tier)
        if (rejectionReasons.length === 0 && ocrResult) {
          if (ocrResult.confidence >= 99) {
            recordStep(2, 4, 'OCR confidence score', true, 'Confidence: ' + ocrResult.confidence + '%');
          } else if (ocrResult.confidence >= 95) {
            recordStep(2, 4, 'OCR confidence score', false, 'Confidence: ' + ocrResult.confidence + '% — manual review');
            manualReviewReasons.push('OCR confidence borderline: ' + ocrResult.confidence + '%');
          } else {
            recordStep(2, 4, 'OCR confidence score', false, 'Confidence: ' + ocrResult.confidence + '% — too low');
            rejectionReasons.push('OCR confidence too low: ' + ocrResult.confidence + '%');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(2, 4, 'OCR confidence score', false, 'No OCR result available');
        }

        // Layer 2 — Steps 5-9: Field extraction checks
        if (rejectionReasons.length === 0 && ocrResult) {
          const checks = [
            [5, 'Date extracted', ocrResult.extractedDate, 'No date found in screenshot', 'Payment date could not be read from screenshot'],
            [6, 'Amount extracted', ocrResult.extractedAmount, 'No amount found in screenshot', 'Payment amount could not be read from screenshot'],
            [7, 'UPI ID extracted', ocrResult.extractedUpiId, 'No UPI ID found in screenshot', 'Receiver UPI ID could not be read from screenshot'],
            [8, 'UTR extracted', ocrResult.extractedUtr, 'No UTR found in screenshot', 'Transaction reference could not be read from screenshot'],
            [9, 'Payment status SUCCESS', ocrResult.extractedStatus === 'SUCCESS', 'Expected SUCCESS, found: ' + (ocrResult.extractedStatus || 'none'), 'Payment screenshot does not show SUCCESS status'],
          ];
          for (const [stepNum, name, value, failDetail, failReason] of checks) {
            if (rejectionReasons.length > 0) break;
            if (value) {
              recordStep(2, stepNum, name, true, typeof value === 'string' ? name + ': ' + value : 'Status: SUCCESS');
            } else {
              recordStep(2, stepNum, name, false, failDetail);
              rejectionReasons.push(failReason);
            }
          }
        } else if (rejectionReasons.length === 0) {
          for (let s = 5; s <= 9; s++) recordStep(2, s, 'Field check', false, 'No OCR result');
        }

        // LAYER 3 — Cross-Validation
        if (rejectionReasons.length === 0) {
          if (!ALLOWED_AMOUNTS.includes(amountNum)) {
            recordStep(3, 10, 'Exact amount match', false, 'Invalid amount: ' + amountNum);
            rejectionReasons.push('Invalid payment amount');
          } else if (ocrResult && ocrResult.extractedAmount === amountNum) {
            recordStep(3, 10, 'Exact amount match', true, 'User: ₹' + amountNum + ', Screenshot: ₹' + ocrResult.extractedAmount);
          } else {
            recordStep(3, 10, 'Exact amount match', false, 'Mismatch — User: ₹' + amountNum + ', Screenshot: ₹' + (ocrResult ? ocrResult.extractedAmount : 'N/A'));
            rejectionReasons.push('Amount mismatch');
          }
        }

        if (rejectionReasons.length === 0 && ocrResult) {
          const userUtr = payment.utr.trim().toUpperCase();
          const ocrUtr = (ocrResult.extractedUtr || '').trim().toUpperCase();
          if (ocrUtr === userUtr) {
            recordStep(3, 11, 'Exact UTR match', true, 'UTR match confirmed');
          } else {
            recordStep(3, 11, 'Exact UTR match', false, 'User: ' + userUtr + ', Screenshot: ' + ocrUtr);
            rejectionReasons.push('UTR in screenshot does not match entered UTR');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(3, 11, 'Exact UTR match', false, 'No OCR result');
        }

        if (rejectionReasons.length === 0 && ocrResult) {
          if (ocrResult.extractedDate === today) {
            recordStep(3, 12, 'Exact date match', true, 'Date: ' + ocrResult.extractedDate);
          } else {
            recordStep(3, 12, 'Exact date match', false, 'Expected: ' + today + ', Screenshot: ' + ocrResult.extractedDate);
            rejectionReasons.push('Payment date does not match today\'s date');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(3, 12, 'Exact date match', false, 'No OCR result');
        }

        if (rejectionReasons.length === 0 && ocrResult) {
          if (ocrResult.extractedUpiId === DEFAULT_UPI_ID) {
            recordStep(3, 13, 'Exact receiver UPI match', true, 'UPI ID: ' + ocrResult.extractedUpiId);
          } else {
            recordStep(3, 13, 'Exact receiver UPI match', false, 'Expected: ' + DEFAULT_UPI_ID + ', Screenshot: ' + ocrResult.extractedUpiId);
            rejectionReasons.push('Payment was sent to wrong UPI ID');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(3, 13, 'Exact receiver UPI match', false, 'No OCR result');
        }

        if (rejectionReasons.length === 0) {
          const dupUtr = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'utr', op: 'EQUAL', value: payment.utr },
          ], { limit: 2 });
          const existing = dupUtr.filter(d => d.id !== paymentId && d.status !== 'rejected');
          if (existing.length > 0) {
            recordStep(3, 14, 'Duplicate UTR check', false, 'UTR already used in: ' + existing[0].id);
            rejectionReasons.push('This transaction reference has already been used');
          } else {
            recordStep(3, 14, 'Duplicate UTR check', true, 'UTR is unique');
          }
        }

        if (rejectionReasons.length === 0 && screenshotHash) {
          const dupHash = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'screenshot_hash', op: 'EQUAL', value: screenshotHash },
          ], { limit: 2 });
          const existing = dupHash.filter(d => d.id !== paymentId && d.status !== 'rejected');
          if (existing.length > 0) {
            recordStep(3, 15, 'Duplicate screenshot hash check', false, 'Hash already used in: ' + existing[0].id);
            rejectionReasons.push('This screenshot has already been used');
          } else {
            recordStep(3, 15, 'Duplicate screenshot hash check', true, 'Hash unique');
          }
        } else if (rejectionReasons.length === 0) {
          recordStep(3, 15, 'Duplicate screenshot hash check', false, 'No hash available');
        }

        if (rejectionReasons.length === 0) {
          const dupPayments = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'utr', op: 'EQUAL', value: payment.utr },
            { field: 'status', op: 'EQUAL', value: 'verified' },
          ], { limit: 1 });
          if (dupPayments.length > 0 && dupPayments[0].id !== paymentId) {
            recordStep(3, 16, 'Duplicate payment check', false, 'Duplicate: ' + dupPayments[0].id);
            rejectionReasons.push('Duplicate payment record detected');
          } else {
            recordStep(3, 16, 'Duplicate payment check', true, 'Unique');
          }
        }

        // PROTECTION: Anomaly Detection
        const anomalyFlags = [];
        if (screenshotHash && payment.user_id) {
          const hashUsers = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'screenshot_hash', op: 'EQUAL', value: screenshotHash },
          ], { limit: 10 });
          const diffUsers = hashUsers.filter(d => d.id !== paymentId && d.user_id && d.user_id !== payment.user_id && d.status !== 'rejected');
          if (diffUsers.length > 0) anomalyFlags.push('Same screenshot used by multiple accounts');
        }
        if (payment.user_id) {
          const userPayments = await runQuery(COL_UPI_PAYMENTS, [
            { field: 'user_id', op: 'EQUAL', value: payment.user_id },
          ], { limit: 10 });
          const createdTime = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();
          const rapid = userPayments.filter(p => {
            if (p.id === paymentId) return false;
            const t = p.created_at ? new Date(p.created_at).getTime() : 0;
            return t && Math.abs(t - createdTime) < 30000;
          });
          if (rapid.length > 0) anomalyFlags.push('Multiple payments within 30 seconds');
        }
        if (anomalyFlags.length > 0) {
          recordStep(0, 0, 'Anomaly detection', false, anomalyFlags.join('; '));
          rejectionReasons.push('Suspicious payment pattern: ' + anomalyFlags.join('; '));
        } else {
          recordStep(0, 0, 'Anomaly detection', true, 'No anomalies detected');
        }

        // DECISION
        const verificationId = 'VER_' + randomString(16);
        const verifiedAt = new Date().toISOString();

        let finalScore = ocrResult ? Math.round(ocrResult.confidence * 10) / 10 : 0;
        if (imageQuality) {
          if (imageQuality.blurry) finalScore = Math.min(finalScore, 94);
          if (imageQuality.cropped) finalScore = Math.min(finalScore, 90);
          if (imageQuality.dark) finalScore = Math.min(finalScore, 90);
          if (imageQuality.incomplete) finalScore = Math.min(finalScore, 90);
        }

        if (rejectionReasons.length > 0) {
          await updateDoc(COL_UPI_PAYMENTS, paymentId, {
            status: 'rejected', final_score: finalScore, screenshot_hash: screenshotHash,
            rejection_reasons: JSON.stringify(rejectionReasons), ocr_result: ocrResult ? JSON.stringify(ocrResult) : '',
            verified_at: verifiedAt, verification_locked: false,
          });
          await addDoc(COL_VERIFICATION_LOGS, {
            verification_id: verificationId, user_id: payment.user_id || '',
            payment_type: type || 'unknown', selected_amount: amountNum,
            ocr_amount: ocrResult ? ocrResult.extractedAmount : null,
            ocr_upi: ocrResult ? ocrResult.extractedUpiId : null,
            ocr_utr: ocrResult ? ocrResult.extractedUtr : null,
            ocr_date: ocrResult ? ocrResult.extractedDate : null,
            ocr_confidence: ocrResult ? ocrResult.confidence : 0,
            final_score: finalScore, status: 'rejected',
            reason: JSON.stringify(rejectionReasons), verified_at: verifiedAt,
            image_hash: screenshotHash, validation_steps: JSON.stringify(validationSteps),
          });
          results.rejected++;
          continue;
        }

        if (manualReviewReasons.length > 0) {
          await updateDoc(COL_UPI_PAYMENTS, paymentId, {
            status: 'manual_review', final_score: finalScore, screenshot_hash: screenshotHash,
            rejection_reasons: JSON.stringify(manualReviewReasons), ocr_result: ocrResult ? JSON.stringify(ocrResult) : '',
            verified_at: verifiedAt, verification_locked: false,
          });
          await addDoc(COL_VERIFICATION_LOGS, {
            verification_id: verificationId, user_id: payment.user_id || '',
            payment_type: type || 'unknown', selected_amount: amountNum,
            ocr_amount: ocrResult ? ocrResult.extractedAmount : null,
            ocr_upi: ocrResult ? ocrResult.extractedUpiId : null,
            ocr_utr: ocrResult ? ocrResult.extractedUtr : null,
            ocr_date: ocrResult ? ocrResult.extractedDate : null,
            ocr_confidence: ocrResult ? ocrResult.confidence : 0,
            final_score: finalScore, status: 'manual_review',
            reason: JSON.stringify(manualReviewReasons), verified_at: verifiedAt,
            image_hash: screenshotHash, validation_steps: JSON.stringify(validationSteps),
          });
          results.manualReview++;
          continue;
        }

        // ── APPROVAL ──
        if (type === 'registration') {
          const pendingRegId = payment.user_id;
          if (!pendingRegId) {
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: JSON.stringify(['No registration session ID']), verified_at: verifiedAt, verification_locked: false });
            results.rejected++; continue;
          }

          const pendingReg = await getDoc(COL_PENDING_REGS, pendingRegId);
          if (!pendingReg) {
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: JSON.stringify(['Registration session expired']), verified_at: verifiedAt, verification_locked: false });
            results.rejected++; continue;
          }

          const newUserId = 'U' + randomString(16);
          let referredByUserId = null;
          let referredByCode = null;
          const refCode = pendingReg.referral_code;
          if (refCode) {
            const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
            if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode.toUpperCase(); }
          }

          await writeDoc(COL_USERS, newUserId, {
            id: newUserId, email: pendingReg.email, name: pendingReg.name || '',
            phone: pendingReg.phone || '', password_hash: pendingReg.password_hash,
            referral_code: randomString(8), referred_by: referredByCode,
            account_status: 'active', payment_status: 'success',
            approved: true, active: true, membership_paid: true,
            joined_date: new Date().toISOString(), approved_date: new Date().toISOString(),
          });

          await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amountNum });
          await addDoc(COL_WALLET_TX, {
            user_id: newUserId, type: 'deposit', amount: amountNum,
            description: 'Registration payment (UPI)', reference_id: paymentId, balance_after: amountNum,
          });

          if (referredByUserId) {
            const sponsorWallets = await runQuery(COL_WALLET_BALANCES, [{ field: 'id', op: 'EQUAL', value: referredByUserId }], { limit: 1 });
            if (sponsorWallets.length) {
              const sw = sponsorWallets[0];
              const refAmt = amountNum * 0.1;
              await updateDoc(COL_WALLET_BALANCES, referredByUserId, { balance: (sw.balance || 0) + refAmt, total_earned: (sw.total_earned || 0) + refAmt });
              await addDoc(COL_WALLET_TX, {
                user_id: referredByUserId, type: 'referral_bonus', amount: refAmt,
                description: 'Referral bonus for ' + newUserId, balance_after: (sw.balance || 0) + refAmt,
              });
            }
          }

          try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch {}

          await updateDoc(COL_UPI_PAYMENTS, paymentId, {
            status: 'verified', user_id: newUserId, screenshot_hash: screenshotHash,
            ocr_result: ocrResult ? JSON.stringify(ocrResult) : '', rejection_reasons: '[]',
            verified_at: verifiedAt, verification_locked: false,
          });

          await addDoc(COL_VERIFICATION_LOGS, {
            verification_id: 'VER_' + randomString(16), user_id: newUserId,
            payment_type: 'registration', selected_amount: amountNum,
            ocr_amount: ocrResult ? ocrResult.extractedAmount : null,
            ocr_upi: ocrResult ? ocrResult.extractedUpiId : null,
            ocr_utr: ocrResult ? ocrResult.extractedUtr : null,
            ocr_date: ocrResult ? ocrResult.extractedDate : null,
            ocr_confidence: ocrResult ? ocrResult.confidence : 0,
            final_score: finalScore, status: 'approved', reason: '',
            verified_at: verifiedAt, image_hash: screenshotHash,
            validation_steps: JSON.stringify(validationSteps),
          });
          results.approved++;
        }

        if (type === 'topup') {
          const userId = payment.user_id;
          if (!userId) {
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: JSON.stringify(['User not identified']), verified_at: verifiedAt, verification_locked: false });
            results.rejected++; continue;
          }

          const userDoc = await getDoc(COL_USERS, userId);
          if (!userDoc) {
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: JSON.stringify(['User account not found']), verified_at: verifiedAt, verification_locked: false });
            results.rejected++; continue;
          }

          const wallets = await runQuery(COL_WALLET_BALANCES, [{ field: 'id', op: 'EQUAL', value: userId }], { limit: 1 });
          const wallet = wallets.length ? wallets[0] : { balance: 0, total_earned: 0 };
          const newBalance = (wallet.balance || 0) + amountNum;

          await updateDoc(COL_WALLET_BALANCES, userId, { balance: newBalance, total_earned: (wallet.total_earned || 0) + amountNum });
          await addDoc(COL_WALLET_TX, {
            user_id: userId, type: 'deposit', amount: amountNum,
            description: 'Topup via UPI', reference_id: paymentId, balance_after: newBalance,
          });

          const referredByCode = userDoc.referred_by || null;
          const topupData = {
            user_id: userId, amount: amountNum, utr: payment.utr,
            screenshot_url: payment.screenshot_url, status: 'approved', verified_at: verifiedAt,
          };
          const { id: topupId } = await addDoc(COL_TOPUPS, topupData);

          if (referredByCode) {
            try {
              const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
              const referrer = refUsers.length ? refUsers[0] : null;
              if (referrer) {
                const sponsorTopups = await runQuery(COL_TOPUPS, [
                  { field: 'user_id', op: 'EQUAL', value: referrer.id },
                  { field: 'status', op: 'EQUAL', value: 'approved' },
                ], { limit: 1 });
                const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';

                await addDoc(COL_TOPUP_INCOME, {
                  user_id: referrer.id, from_user_id: userId, topup_id: topupId,
                  amount: amountNum, level: 1, status: incomeStatus,
                });

                const currentCount = referrer.topup_referral_qualified_count || 0;
                const newCount = currentCount + 1;
                const topupQualified = (referrer.referrals_count || 0) + newCount >= MAX_REFERRALS;
                await updateDoc(COL_USERS, referrer.id, { topup_referral_qualified_count: newCount, topup_referral_qualified: topupQualified });

                if (userDoc.referred_by_status !== 'approved') {
                  await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
                }
              }
            } catch (e) { /* silent */ }
          }

          try {
            if (userDoc.topup_referral_qualified && !userDoc.sponsor_topup_completed) {
              await updateDoc(COL_USERS, userId, { account_status: 'inactive', sponsor_topup_completed: true });
              const lockedIncome = await runQuery(COL_TOPUP_INCOME, [
                { field: 'user_id', op: 'EQUAL', value: userId },
                { field: 'status', op: 'EQUAL', value: 'locked' },
              ], { limit: 100 });
              for (const inc of lockedIncome) {
                await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'eligible' });
              }
            }
          } catch (e) { /* silent */ }

          await updateDoc(COL_UPI_PAYMENTS, paymentId, {
            status: 'verified', user_id: userId, screenshot_hash: screenshotHash,
            ocr_result: ocrResult ? JSON.stringify(ocrResult) : '', rejection_reasons: '[]',
            verified_at: verifiedAt, verification_locked: false,
          });

          await addDoc(COL_VERIFICATION_LOGS, {
            verification_id: 'VER_' + randomString(16), user_id: userId,
            payment_type: 'topup', selected_amount: amountNum,
            ocr_amount: ocrResult ? ocrResult.extractedAmount : null,
            ocr_upi: ocrResult ? ocrResult.extractedUpiId : null,
            ocr_utr: ocrResult ? ocrResult.extractedUtr : null,
            ocr_date: ocrResult ? ocrResult.extractedDate : null,
            ocr_confidence: ocrResult ? ocrResult.confidence : 0,
            final_score: finalScore, status: 'approved', reason: '',
            verified_at: verifiedAt, image_hash: screenshotHash,
            validation_steps: JSON.stringify(validationSteps),
          });
          results.approved++;
        }
      } catch (e) {
        results.errors.push({ utr, error: e.message });
        try {
          await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'manual_review', verification_locked: false, rejection_reasons: JSON.stringify(['System error: ' + e.message]), verified_at: new Date().toISOString() });
          await addDoc(COL_VERIFICATION_LOGS, {
            verification_id: 'VER_' + randomString(16), user_id: payment.user_id || '',
            payment_type: type || 'unknown', selected_amount: amountNum || 0,
            ocr_confidence: (typeof ocrResult !== 'undefined' && ocrResult) ? ocrResult.confidence : 0,
            final_score: 0, status: 'manual_review',
            reason: JSON.stringify(['System error: ' + e.message]),
            verified_at: new Date().toISOString(),
            image_hash: typeof screenshotHash !== 'undefined' ? screenshotHash : '',
            validation_steps: JSON.stringify(validationSteps || []),
          });
        } catch {}
      }
    }

    res.writeHead(200); res.end(JSON.stringify(results));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
