// ─────────────────────────────────────────────────────────────
// FULL AUDIT LOGGER  (api/_auditLogger.js)
//
// Appends an immutable audit trail to the `audit_logs` table for
// every payment-session lifecycle event: created, proof submitted,
// verification started/completed/failed, retry scheduled, expired.
//
// Idempotency: an in-memory dedup keyed by `action:target_id`
// prevents duplicate audit rows when the same transition is observed
// multiple times (e.g. two concurrent polls). Writes are best-effort
// and never throw — auditing must never break the payment flow.
//
// Business-approval audit rows (approve/reject) are already written
// by _approvalPipeline.js; this module does NOT duplicate them.
// ─────────────────────────────────────────────────────────────

const { COL_AUDIT_LOGS } = require('./_shared.js');
// Dynamic lookup (not destructured at load) so unit tests can patch addDoc.
const supabaseMod = require('./_supabase.js');
const stateMachine = require('./_stateMachine.js');

const seen = new Set();
const MAX_SEEN = 8000;

function eventKey(action, targetId) {
  return String(action) + ':' + String(targetId || 'unknown');
}

function resetForTests() {
  seen.clear();
}

// Write one audit row. Returns true when written, false on duplicate
// or when the write failed silently.
async function logAudit(entry) {
  try {
    const key = eventKey(entry.action, entry.target_id);
    if (seen.has(key)) return false;
    if (seen.size > MAX_SEEN) seen.clear();
    seen.add(key);
    await supabaseMod.addDoc(COL_AUDIT_LOGS, {
      action: entry.action,
      target_id: entry.target_id,
      target_type: entry.target_type || 'payment_session',
      admin_id: entry.admin_id || 'system',
      details: entry.details || {},
      created_at: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}

// Convenience wrapper for order/session lifecycle events.
async function logOrderEvent(opts) {
  const { action, orderId, userId, type, amount, from, to, reason, admin } = opts || {};
  return logAudit({
    action,
    target_id: orderId,
    target_type: 'payment_session',
    admin_id: admin || 'system',
    details: {
      userId: userId || null,
      type: type || null,
      amount: amount != null ? Number(amount) : null,
      from: from || null,
      to: to || null,
      reason: reason || null,
      at: new Date().toISOString(),
    },
  });
}

// Audit a state-machine transition if the model allows it.
async function logTransition(order, to, extra = {}) {
  const from = (order && (order.status || 'pending')) || 'pending';
  const t = stateMachine.transition(from, to, { trigger: extra.trigger, by: extra.admin });
  if (!t.allowed) {
    if (extra.warn !== false) {
      console.warn('[AUDIT] illegal transition skipped: ' + t.reason);
    }
    return false;
  }
  return logOrderEvent({
    action: 'session_' + from + '_to_' + to,
    orderId: order?.id || order?.orderId || extra.orderId,
    userId: order?.user_id || extra.userId,
    type: order?.type,
    amount: order?.amount,
    from,
    to,
    reason: extra.reason,
    admin: extra.admin,
  });
}

module.exports = { logAudit, logOrderEvent, logTransition, resetForTests };
