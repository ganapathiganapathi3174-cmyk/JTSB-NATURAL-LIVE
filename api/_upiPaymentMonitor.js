const { COL_UPI_PAYMENTS } = require('./_shared.js');
const { runQuery, updateDoc, addDoc } = require('./_supabase.js');
const { broadcast } = require('./_sse.js');

const PENDING_TIMEOUT_MINUTES = parseInt(process.env.PENDING_PAYMENT_TIMEOUT_MINUTES || '10', 10);
const PENDING_TIMEOUT_MS = PENDING_TIMEOUT_MINUTES * 60 * 1000;
const CHECK_INTERVAL_MS = 30000;

let checkTimer = null;
let lastErrorMsg = '';

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [PAYMENT-MONITOR] [${tag}] ${msg}`);
}

async function checkAndExpirePendingPayments() {
  try {
    const payments = await runQuery(COL_UPI_PAYMENTS, [
      { field: 'status', op: 'EQUAL', value: 'pending' },
    ], { limit: 200 });

    if (!payments || payments.length === 0) return;

    const now = Date.now();
    let expiredCount = 0;

    for (const payment of payments) {
      const createdTime = payment.created_at ? new Date(payment.created_at).getTime() : 0;
      if (!createdTime) continue;

      const age = now - createdTime;
      if (age >= PENDING_TIMEOUT_MS) {
        try {
          await updateDoc(COL_UPI_PAYMENTS, payment.id, {
            status: 'expired',
            rejection_reasons: ['Payment expired after ' + PENDING_TIMEOUT_MINUTES + ' minutes'],
            verified_at: new Date().toISOString(),
          });
          expiredCount++;
          log('EXPIRE', `Payment ${payment.id} (UTR:${payment.utr}) expired after ${PENDING_TIMEOUT_MINUTES}min`);

          try {
            broadcast('paymentExpired', {
              id: payment.id,
              userId: payment.user_id,
              amount: payment.amount,
              type: payment.payment_type,
              status: 'expired',
            });
          } catch (e) { log('BROADCAST', 'paymentExpired failed: ' + e.message); }

          try {
            await addDoc('audit_logs', {
              action: 'payment_expired',
              target_id: payment.id,
              target_type: 'upi_payment',
              admin_id: 'system',
              details: {
                utr: payment.utr,
                amount: payment.amount,
                type: payment.payment_type,
                timeoutMinutes: PENDING_TIMEOUT_MINUTES,
                created_at: payment.created_at,
                expired_at: new Date().toISOString(),
              },
              created_at: new Date().toISOString(),
            });
          } catch (e) { log('AUDIT', 'payment_expired audit failed: ' + e.message); }
        } catch (e) {
          log('EXPIRE-ERR', `Failed to expire payment ${payment.id}: ${e.message}`);
        }
      }
    }

    if (expiredCount > 0) {
      log('CLEANUP', `Expired ${expiredCount} pending payment(s)`);
    }
  } catch (e) {
    const msg = e.message || '';
    if (msg !== lastErrorMsg) {
      log('CHECK-ERR', msg);
      lastErrorMsg = msg;
    }
  }
}

function startMonitor() {
  if (checkTimer) return;
  checkTimer = setInterval(checkAndExpirePendingPayments, CHECK_INTERVAL_MS);
  log('START', `Payment monitor started (timeout=${PENDING_TIMEOUT_MINUTES}min, interval=${CHECK_INTERVAL_MS/1000}s)`);
}

function stopMonitor() {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    log('STOP', 'Payment monitor stopped');
  }
}

module.exports = {
  checkAndExpirePendingPayments,
  startMonitor,
  stopMonitor,
  PENDING_TIMEOUT_MINUTES,
};
