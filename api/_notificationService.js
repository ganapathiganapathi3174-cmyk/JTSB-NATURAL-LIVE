// ─────────────────────────────────────────────────────────────
// AUTOMATIC NOTIFICATIONS  (api/_notificationService.js)
//
// Sends lifecycle notifications (payment_approved already handled by
// _approvalPipeline.js; this module adds manual_review, verification
// failed/exhausted, and expiry notices). Writes are best-effort and
// idempotent — a dedup key `type:receiverId:referenceId` prevents
// duplicate rows when the same lifecycle event is observed more than
// once (concurrent polls, worker + poll race). Never throws.
// ─────────────────────────────────────────────────────────────

const { COL_NOTIFICATIONS } = require('./_shared.js');
// Dynamic lookup (not destructured at load) so unit tests can patch addDoc.
const supabaseMod = require('./_supabase.js');

const seen = new Set();
const MAX_SEEN = 5000;

function resetForTests() { seen.clear(); }

function dedupKey(type, receiverId, referenceId) {
  return String(type) + ':' + String(receiverId || '') + ':' + String(referenceId || '');
}

// Core notify. Returns true when inserted, false on duplicate/failure.
async function notify(opts) {
  const { receiverId, title, message, type, referenceId, senderId, senderName } = opts || {};
  if (!receiverId) return false;
  const key = dedupKey(type || 'system', receiverId, referenceId);
  if (seen.has(key)) return false;
  if (seen.size > MAX_SEEN) seen.clear();
  seen.add(key);
  try {
    await supabaseMod.addDoc(COL_NOTIFICATIONS, {
      receiverId,
      title: title || 'Update',
      message: message || '',
      type: type || 'system',
      status: 'unread',
      createdAt: new Date().toISOString(),
      senderId: senderId || 'system',
      senderName: senderName || 'System',
    });
    return true;
  } catch {
    return false;
  }
}

async function notifyManualReview(order) {
  const amount = order && order.amount != null ? Number(order.amount) : null;
  return notify({
    receiverId: order.user_id || order.pending_reg_id,
    title: 'Payment Under Manual Review',
    message: 'Your ' + (order.type || 'payment') + ' payment' + (amount != null ? ' of \u20B9' + amount : '') + ' is under manual review. Our team is verifying your screenshot.',
    type: 'payment_manual_review',
    referenceId: order.id,
  });
}

async function notifyVerificationFailed(order, reason) {
  return notify({
    receiverId: order.user_id || order.pending_reg_id,
    title: 'Payment Verification Failed',
    message: 'We could not verify your payment' + (reason ? ': ' + reason : '.') + ' Please submit your screenshot again or contact support.',
    type: 'payment_verification_failed',
    referenceId: order.id,
  });
}

async function notifySessionExpired(order) {
  return notify({
    receiverId: order.user_id || order.pending_reg_id,
    title: 'Payment Session Expired',
    message: 'Your payment session has expired. Please start a new payment to continue.',
    type: 'payment_session_expired',
    referenceId: order.id,
  });
}

module.exports = { notify, notifyManualReview, notifyVerificationFailed, notifySessionExpired, resetForTests };
