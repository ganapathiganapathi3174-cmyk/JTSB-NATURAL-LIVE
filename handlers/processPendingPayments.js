const https = require('https');
const crypto = require('crypto');
const {
  COL_USERS, COL_PENDING_REGS, COL_TOPUPS, COL_WALLET_BALANCES, COL_WALLET_TX,
  COL_UPI_PAYMENTS, COL_TOPUP_INCOME, COL_VERIFICATION_LOGS, MAX_REFERRALS, randomString,
} = require('../api/_shared.js');
const { getDoc, deleteDoc, runQuery, writeDoc, updateDoc, addDoc, conditionalUpdateDoc, atomicCreditWallet } = require('../api/_supabase.js');
const { runVerification } = require('../api/_verificationEngine.js');
const metrics = require('../api/_metrics.js');
const { broadcast } = require('../api/_sse.js');

const PER_PAYMENT_TIMEOUT_MS = 120000;
let isProcessing = false;

function TRACE(label) {
  console.log(`[TRACE:${new Date().toISOString().slice(11,23)}] ${label}`);
}

module.exports = async (req, res) => {
  TRACE('AAA: processPendingPayments ENTERED');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  TRACE('AAB: headers set');
  if (req.method === 'OPTIONS') { TRACE('AAC: OPTIONS early return'); return res.writeHead(200).end(); }
  TRACE('AAD: method check passed');
  if (req.method !== 'POST') { TRACE('AAE: not POST, returning 405'); res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }
  TRACE('AAF: method is POST');
  TRACE(`AAG: isProcessing=${isProcessing}`);
  if (isProcessing) { TRACE('AAH: isProcessing=true, returning 429'); res.writeHead(429); res.end(JSON.stringify({ error: 'Already processing', isProcessing: true })); return; }
  TRACE('AAI: setting isProcessing=true');
  isProcessing = true;
  TRACE('AAJ: isProcessing set, entering try block');
  let processingError = null;

  try {
    TRACE('AAK: inside try');
    const today = new Date().toISOString().split('T')[0];
    const startedAt = new Date().toISOString();
    TRACE(`AAL: today=${today}, startedAt=${startedAt}`);

    TRACE('AAM: about to query pending payments');
    const pendingPayments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 100 });
    TRACE(`AAN: pendingPayments query returned: length=${pendingPayments ? pendingPayments.length : 'NULL/undefined'}`);
    if (!pendingPayments) { TRACE('AAO: pendingPayments is null/undefined'); }

    console.log(`[AUTO-VERIFY] Pending payments: ${pendingPayments ? pendingPayments.length : 0}`);

    const results = { processed: 0, approved: 0, rejected: 0, manualReview: 0, ocrSkipped: 0, errors: [] };

    TRACE(`AAP: about to loop over ${pendingPayments ? pendingPayments.length : 0} payments`);

    for (const payment of pendingPayments) {
      const paymentId = payment.id;
      const utr = payment.utr || paymentId;
      results.processed++;
      TRACE(`AAQ: LOOP START for paymentId=${paymentId}, utr=${utr ? utr.substring(0,8)+'****' : 'null'}`);

      try {
        const amountNum = Number(payment.amount) || 0;
        const type = payment.payment_type;
        TRACE(`AAR: amount=${amountNum}, type=${type}, current status in DB=${payment.status}`);

        // PROTECTION: Atomic Verification Lock
        const lockedAt = new Date().toISOString();
        TRACE(`AAS: attempting conditionalUpdateDoc for lock, status condition='pending'`);
        const locked = await conditionalUpdateDoc(COL_UPI_PAYMENTS, paymentId, [
          { field: 'status', op: 'EQUAL', value: 'pending' },
        ], { verification_locked: true, verification_locked_at: lockedAt, status: 'verifying', verification_started_at: lockedAt });
        TRACE(`AAT: conditionalUpdateDoc returned locked=${locked}`);
        if (locked === 0) {
          TRACE(`AAU: locked=0, checking why...`);
          TRACE(`AAV: payment.verification_locked=${payment.verification_locked}, payment.verification_locked_at=${payment.verification_locked_at}, payment.status=${payment.status}`);
          TRACE(`AAW: Could not acquire lock — skipping payment ${paymentId}`);
          results.errors.push({ utr, error: 'Payment not in pending state' });
          results.processed--;
          continue;
        }
        TRACE(`AAX: Lock acquired! Status should now be 'verifying'`);

        // ── VERIFICATION ENGINE (with per-payment timeout) ──
        TRACE(`AAY: Starting runVerification for ${paymentId}`);
        const verificationResult = await Promise.race([
          runVerification(payment),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Verification timed out after 120s')), PER_PAYMENT_TIMEOUT_MS)),
        ]);
        TRACE(`AAZ: runVerification completed`);

        const finalStatus = verificationResult.status === 'approved' ? 'verified' : verificationResult.status;
        TRACE(`ABA: finalStatus=${finalStatus}, verificationScore=${verificationResult.verificationScore}, fraudScore=${verificationResult.fraudScore}`);
        TRACE(`ABB: verificationResult keys: ${Object.keys(verificationResult).join(', ')}`);

        const reasons = verificationResult.reasons;
        const ocrData = verificationResult.ocrData;
        const screenshotHash = verificationResult.screenshotHash;
        const imageQuality = verificationResult.imageQuality;
        const steps = verificationResult.steps;
        const fraudScore = verificationResult.fraudScore;
        const verificationScore = verificationResult.verificationScore;
        const verificationDuration = verificationResult.verificationDuration;

        const completedAt = new Date().toISOString();
        TRACE(`ABC: completedAt=${completedAt}`);

        // Save verification result to payment
        console.log(`[DB-SAVE] Payment ${paymentId}: saving status=${finalStatus}, matchedAmount=${verificationResult.matchedAmount}, matchedReceiver=${verificationResult.matchedReceiver}, matchedUtr=${verificationResult.matchedUtr}, matchedDate=${verificationResult.matchedDate}, extractedAmount=${ocrData?.extractedAmount}, extractedUtr=${ocrData?.extractedUtr}`);
        TRACE(`ABD: about to updateDoc for ${paymentId} with status=${finalStatus}`);
        const updateResult = await updateDoc(COL_UPI_PAYMENTS, paymentId, {
          status: finalStatus,
          screenshot_hash: screenshotHash || payment.screenshot_hash,
          ocr_result: ocrData ? {
            rawText: ocrData.ocrText,
            confidence: ocrData.confidence,
            extractedAmount: ocrData.extractedAmount,
            extractedUtr: ocrData.extractedUtr,
            extractedReceiverUpi: ocrData.extractedReceiverUpi,
            extractedSenderUpi: ocrData.extractedSenderUpi,
            extractedDate: ocrData.extractedDate,
            extractedTime: ocrData.extractedTime,
            extractedStatus: ocrData.extractedStatus,
            extractedBankName: ocrData.extractedBankName,
            extractedTxnId: ocrData.extractedTxnId,
            wordCount: ocrData.wordCount,
            ambiguous: ocrData.ambiguous,
            matchedAmount: verificationResult.matchedAmount,
            matchedReceiver: verificationResult.matchedReceiver,
            matchedUtr: verificationResult.matchedUtr,
            matchedDate: verificationResult.matchedDate,
          } : null,
          rejection_reasons: reasons,
          final_score: verificationScore,
          verified_at: completedAt,
          verification_locked: false,
          verification_completed_at: completedAt,
          verification_duration: verificationDuration,
        });
        TRACE(`ABE: updateDoc returned: ${JSON.stringify(updateResult)}`);

        // IMMEDIATELY READ BACK AND VERIFY STATUS CHANGE
        TRACE(`ABF: Reading back payment ${paymentId} to verify status change...`);
        const readBack = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }], { limit: 1 });
        if (readBack && readBack.length > 0) {
          TRACE(`ABG: READBACK status=${readBack[0].status}, verification_locked=${readBack[0].verification_locked}, verified_at=${readBack[0].verified_at}`);
        } else {
          TRACE(`ABH: READBACK FAILED — payment ${paymentId} not found after update!`);
        }

        // Save verification log
        TRACE(`ABI: about to addDoc verification log`);
        await addDoc(COL_VERIFICATION_LOGS, {
          verification_id: 'VER_' + randomString(16),
          payment_id: paymentId,
          user_id: payment.user_id || '',
          utr: payment.utr,
          payment_type: type || 'unknown',
          selected_amount: amountNum,
          ocr_amount: ocrData ? String(ocrData.extractedAmount || '') : null,
          ocr_upi: ocrData ? (ocrData.extractedReceiverUpi || ocrData.extractedSenderUpi || '') : null,
          ocr_utr: ocrData ? (ocrData.extractedUtr || '') : null,
          ocr_date: ocrData ? (ocrData.extractedDate || '') : null,
          ocr_confidence: ocrData ? (ocrData.confidence || 0) : 0,
          final_score: verificationScore || 0,
          status: finalStatus,
          reason: reasons,
          image_hash: screenshotHash || '',
          validation_steps: steps,
          created_at: completedAt,
        });
        TRACE(`ABJ: verification log saved`);

        // Metrics
        if (finalStatus === 'verified') metrics.trackPaymentApproved('auto');
        else if (finalStatus === 'rejected') metrics.trackPaymentRejected('auto');
        else if (finalStatus === 'manual_review') metrics.trackPaymentManualReview();
        TRACE(`ABK: metrics tracked for ${finalStatus}`);

        // Broadcast SSE update
        TRACE(`ABL: broadcasting SSE for ${paymentId}, status=${finalStatus}`);
        try { broadcast('paymentUpdated', { id: paymentId, status: finalStatus, type, autoProcessed: true }); }
        catch (sseErr) { TRACE(`ABM: SSE broadcast failed: ${sseErr.message}`); }
        TRACE(`ABN: SSE broadcast completed`);

        // Handle results
        if (finalStatus === 'rejected') {
          TRACE(`ABO: handling REJECTED flow`);
          results.rejected++;
          try {
            TRACE(`ABP: adding notification for rejection`);
            await addDoc('notifications', {
              receiverId: payment.user_id || '',
              title: 'Payment Auto-Rejected',
              message: 'Your payment of ₹' + amountNum + ' was rejected: ' + reasons.join('. '),
              type: 'payment_rejected', status: 'unread', createdAt: new Date().toISOString(),
              senderId: 'system', senderName: 'System',
            });
          } catch (e) { console.error('[PROCESS] notify reject failed:', e.message); }
          try {
            TRACE(`ABQ: adding audit log for rejection`);
            await addDoc('audit_logs', {
              action: 'auto_reject', target_id: paymentId, target_type: 'upi_payment',
              admin_id: 'system', details: { reasons, fraudScore, verificationScore, screenshotHash },
              created_at: new Date().toISOString(),
            });
          } catch (e) { console.error('[PROCESS] audit reject failed:', e.message); }
          TRACE(`ABR: continue (skipping to next payment after reject)`);
          continue;
        }

        if (finalStatus === 'manual_review') {
          TRACE(`ABS: handling MANUAL_REVIEW flow`);
          results.manualReview++;
          try {
            TRACE(`ABT: adding notification for manual review`);
            await addDoc('notifications', {
              receiverId: payment.user_id || '',
              title: 'Payment Under Review',
              message: 'Your payment of ₹' + amountNum + ' has been flagged for manual review.',
              type: 'payment_manual_review', status: 'unread', createdAt: new Date().toISOString(),
              senderId: 'system', senderName: 'System',
            });
          } catch (e) { console.error('[PROCESS] notify manual_review failed:', e.message); }
          TRACE(`ABU: continue (skipping after manual review)`);
          continue;
        }

        // ── APPROVED ──
        TRACE(`ABV: handling APPROVED flow`);
        if (type === 'registration') {
          TRACE(`ABW: type is registration`);
          const pendingRegId = payment.pending_reg_id || payment.user_id;
          if (!pendingRegId) {
            TRACE(`ABX: no pendingRegId, rejecting`);
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['No registration session ID'], verified_at: completedAt, verification_locked: false });
            results.rejected++; continue;
          }
          TRACE(`ABY: pendingRegId=${pendingRegId}`);
          const pendingReg = await getDoc(COL_PENDING_REGS, pendingRegId);
          if (!pendingReg) {
            TRACE(`ABZ: pending reg not found, rejecting`);
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['Registration session expired'], verified_at: completedAt, verification_locked: false });
            results.rejected++; continue;
          }
          TRACE(`ACA: pendingReg found: name=${pendingReg.name}, email=${pendingReg.email}`);

          const newUserId = crypto.randomUUID();
          let referredByUserId = null;
          let referredByCode = null;
          const refCode = pendingReg.referral_code;
          if (refCode) {
            TRACE(`ACB: looking up referral code: ${refCode}`);
            const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode.toUpperCase() }], { limit: 1 });
            if (refUsers.length) { referredByUserId = refUsers[0].id; referredByCode = refCode.toUpperCase(); }
            TRACE(`ACC: referredByUserId=${referredByUserId}, referredByCode=${referredByCode}`);
          }

          const userName = pendingReg.name || '';
          const userEmail = pendingReg.email || '';
          const userPhone = pendingReg.phone || '';
          const missingFields = [];
          if (!userName) missingFields.push('name');
          if (!userEmail) missingFields.push('email');
          if (!userPhone) missingFields.push('phone');
          if (['unknown', 'undefined', 'null'].includes(userName.toLowerCase())) missingFields.push('name=unknown');
          if (['unknown', 'undefined', 'null'].includes(userEmail.toLowerCase())) missingFields.push('email=unknown');
          if (['unknown', 'undefined', 'null'].includes(userPhone.toLowerCase())) missingFields.push('phone=unknown');
          if (missingFields.length) {
            TRACE(`ACD: missing fields detected: ${missingFields.join(', ')}`);
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['Invalid registration data: ' + missingFields.join(', ')], verified_at: completedAt, verification_locked: false });
            results.rejected++; continue;
          }

          TRACE(`ACE: creating user: id=${newUserId}, name=${userName}`);
          await writeDoc(COL_USERS, newUserId, {
            id: newUserId, email: userEmail, name: userName,
            phone: userPhone, password_hash: pendingReg.password_hash,
            referral_code: randomString(8), referred_by: referredByCode,
            account_status: 'active', payment_status: 'success',
            approved: true, active: true, membership_paid: true,
            joined_date: new Date().toISOString(), approved_date: new Date().toISOString(),
          });
          TRACE(`ACF: user created, creating wallet`);
          await writeDoc(COL_WALLET_BALANCES, newUserId, { balance: 0, total_earned: amountNum });
          await addDoc(COL_WALLET_TX, { user_id: newUserId, type: 'deposit', amount: amountNum, description: 'Registration payment (UPI)', reference_id: paymentId, balance_after: amountNum });
          if (referredByUserId) await atomicCreditWallet(referredByUserId, amountNum * 0.1, paymentId, 'Referral bonus for ' + newUserId, 'referral_bonus');
          try { await deleteDoc(COL_PENDING_REGS, pendingRegId); } catch (e) { console.error('[PROCESS] delete pending reg failed:', e.message); }
          TRACE(`ACG: wallet/ref/tx done`);

          TRACE(`ACH: FINAL updateDoc for payment ${paymentId} to verified`);
          await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'verified', user_id: newUserId, verification_locked: false, verification_completed_at: new Date().toISOString() });
          TRACE(`ACI: final updateDoc done`);
          
          // READ BACK AGAIN to confirm final status
          const readBack2 = await runQuery(COL_UPI_PAYMENTS, [{ field: 'id', op: 'EQUAL', value: paymentId }], { limit: 1 });
          if (readBack2 && readBack2.length > 0) {
            TRACE(`ACJ: FINAL READBACK status=${readBack2[0].status}, user_id=${readBack2[0].user_id}`);
          } else {
            TRACE(`ACK: FINAL READBACK FAILED`);
          }

          try { await addDoc('notifications', { receiverId: newUserId, title: 'Registration Approved', message: 'Welcome! Your registration payment of ₹' + amountNum + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: new Date().toISOString(), senderId: 'system', senderName: 'System' }); } catch (e) { console.error('[PROCESS] notify registration failed:', e.message); }
          try { await addDoc('audit_logs', { action: 'auto_approve_registration', target_id: paymentId, target_type: 'upi_payment', admin_id: 'system', details: { userId: newUserId, amount: amountNum, verificationScore, fraudScore }, created_at: new Date().toISOString() }); } catch (e) { console.error('[PROCESS] audit registration failed:', e.message); }
          results.approved++;
          TRACE(`ACL: registration approved, results.approved=${results.approved}`);
        } else if (type === 'topup') {
          TRACE(`ACM: type is topup`);
          const userId = payment.user_id;
          if (!userId) {
            TRACE(`ACN: no userId, rejecting`);
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['User not identified'], verified_at: completedAt, verification_locked: false });
            results.rejected++; continue;
          }
          const userDoc = await getDoc(COL_USERS, userId);
          if (!userDoc) {
            TRACE(`ACO: userDoc not found, rejecting`);
            await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['User account not found'], verified_at: completedAt, verification_locked: false });
            results.rejected++; continue;
          }
          TRACE(`ACP: userDoc found, crediting wallet`);

          await atomicCreditWallet(userId, amountNum, paymentId, 'Topup via UPI');
          const referredByCode = userDoc.referred_by || null;
          const { id: topupId } = await addDoc(COL_TOPUPS, { user_id: userId, amount: amountNum, utr: payment.utr, screenshot_url: payment.screenshot_url, status: 'approved', verified_at: completedAt });
          TRACE(`ACQ: wallet credited, topupId=${topupId}`);

          if (referredByCode) {
            try {
              const refUsers = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: referredByCode }], { limit: 1 });
              const referrer = refUsers.length ? refUsers[0] : null;
              if (referrer) {
                const sponsorTopups = await runQuery(COL_TOPUPS, [{ field: 'user_id', op: 'EQUAL', value: referrer.id }, { field: 'status', op: 'EQUAL', value: 'approved' }], { limit: 1 });
                const incomeStatus = sponsorTopups.length > 0 ? 'eligible' : 'locked';
                await addDoc(COL_TOPUP_INCOME, { user_id: referrer.id, from_user_id: userId, topup_id: topupId, amount: amountNum, level: 1, status: incomeStatus });
                const currentCount = referrer.topup_referral_qualified_count || 0;
                const newCount = currentCount + 1;
                await updateDoc(COL_USERS, referrer.id, { topup_referral_qualified_count: newCount, topup_referral_qualified: (referrer.referrals_count || 0) + newCount >= MAX_REFERRALS });
                if (userDoc.referred_by_status !== 'approved') await updateDoc(COL_USERS, userId, { referred_by_status: 'approved' });
              }
            } catch (e) { console.error('[PROCESS] topup referral failed:', e.message); }
          }

          try {
            if (userDoc.topup_referral_qualified && !userDoc.sponsor_topup_completed) {
              await updateDoc(COL_USERS, userId, { account_status: 'inactive', sponsor_topup_completed: true });
              const lockedIncome = await runQuery(COL_TOPUP_INCOME, [{ field: 'user_id', op: 'EQUAL', value: userId }, { field: 'status', op: 'EQUAL', value: 'locked' }], { limit: 100 });
              for (const inc of lockedIncome) await updateDoc(COL_TOPUP_INCOME, inc.id, { status: 'eligible' });
            }
          } catch (e) { console.error('[PROCESS] sponsor topup unlock failed:', e.message); }

          TRACE(`ACR: FINAL updateDoc for topup ${paymentId} to verified`);
          await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'verified', user_id: userId, verification_locked: false, verification_completed_at: new Date().toISOString() });
          try { await addDoc('notifications', { receiverId: userId, title: 'Topup Approved', message: 'Your topup of ₹' + amountNum + ' has been verified.', type: 'payment_approved', status: 'unread', createdAt: new Date().toISOString(), senderId: 'system', senderName: 'System' }); } catch (e) { console.error('[PROCESS] notify topup failed:', e.message); }
          try { await addDoc('audit_logs', { action: 'auto_approve_topup', target_id: paymentId, target_type: 'upi_payment', admin_id: 'system', details: { userId, amount: amountNum, verificationScore, fraudScore }, created_at: new Date().toISOString() }); } catch (e) { console.error('[PROCESS] audit topup failed:', e.message); }
          results.approved++;
          TRACE(`ACS: topup approved, results.approved=${results.approved}`);
        } else {
          TRACE(`ACT: unknown type=${type}, rejecting`);
          await updateDoc(COL_UPI_PAYMENTS, paymentId, { status: 'rejected', rejection_reasons: ['Unknown payment type: ' + type], verified_at: new Date().toISOString(), verification_locked: false });
          results.rejected++;
        }
        TRACE(`ACU: LOOP END for payment ${paymentId}, finalStatus=${finalStatus}`);
      } catch (e) {
        TRACE(`ACV: CAUGHT ERROR in payment loop: ${e.message}`);
        TRACE(`ACW: Stack: ${e.stack ? e.stack.substring(0, 500) : 'no stack'}`);
        results.errors.push({ utr: payment.utr || payment.id, error: e.message });
        try { await updateDoc(COL_UPI_PAYMENTS, payment.id, { status: 'manual_review', verification_locked: false, rejection_reasons: ['System error: ' + e.message], verified_at: new Date().toISOString() }); } catch (e2) { console.error('[PROCESS] error handler fallback failed:', e2.message); }
        TRACE(`ACX: error handled, status set to manual_review`);
      }
    }

    TRACE(`ACY: END of loop, results: processed=${results.processed} approved=${results.approved} rejected=${results.rejected} manualReview=${results.manualReview}`);
    console.log(`[AUTO-VERIFY] END: processed=${results.processed} approved=${results.approved} rejected=${results.rejected} manualReview=${results.manualReview} errors=${results.errors.length}`);
    TRACE(`ACZ: about to send response`);
    res.writeHead(200); res.end(JSON.stringify(results));
    TRACE(`ADA: response sent`);
  } catch (err) {
    TRACE(`ADB: CAUGHT FATAL ERROR: ${err.message}`);
    TRACE(`ADC: Stack: ${err.stack ? err.stack.substring(0, 500) : 'no stack'}`);
    processingError = err;
    console.error('[processPendingPayments] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  } finally {
    TRACE(`ADD: in finally block, setting isProcessing=false`);
    isProcessing = false;
    TRACE(`ADE: isProcessing set to false, function EXIT`);
    if (processingError) console.error('[AUTO-VERIFY] Fatal error:', processingError.message);
  }
};
