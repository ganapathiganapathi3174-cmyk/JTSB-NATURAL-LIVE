// ─────────────────────────────────────────────────────────────
// PAYMENT STATE MACHINE  (api/_stateMachine.js)
//
// Pure, dependency-free reference model for payment session /
// upi_payments lifecycle transitions. It is used as the single
// source of truth for "which transitions are legal" by the session
// engine, the audit logger, and the verification queue.
//
// It does NOT perform writes — callers keep owning their DB
// writes. This module only validates and documents transitions so
// that every state change is auditable and no illegal move slips
// through.
// ─────────────────────────────────────────────────────────────

const STATES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  MANUAL_REVIEW: 'manual_review',
  FAILED: 'failed',
  EXPIRED: 'expired',
  REFUNDED: 'refunded',
};

// Canonical transition map: from → set of allowed target states.
const TRANSITIONS = {
  pending: ['processing', 'verified', 'rejected', 'manual_review', 'failed', 'expired'],
  processing: ['verified', 'rejected', 'manual_review', 'failed', 'expired', 'pending'],
  manual_review: ['verified', 'rejected', 'pending', 'failed'],
  failed: ['pending', 'rejected', 'verified'],
  expired: ['pending', 'verified', 'rejected'],
  verified: ['pending', 'refunded'],
  rejected: ['pending'],
  refunded: [],
};

const TERMINAL_STATES = new Set(['verified', 'rejected', 'refunded']);
const NEEDS_ATTENTION = new Set(['manual_review', 'failed']);
const VERIFIABLE = new Set(['pending', 'processing', 'manual_review', 'failed']);

function isValidState(state) {
  return state != null && Object.prototype.hasOwnProperty.call(TRANSITIONS, String(state).toLowerCase());
}

function isTerminal(state) {
  return TERMINAL_STATES.has(String(state).toLowerCase());
}

function needsAttention(state) {
  return NEEDS_ATTENTION.has(String(state).toLowerCase());
}

function isVerifiable(state) {
  return VERIFIABLE.has(String(state).toLowerCase());
}

// Whether a transition from → to is allowed by the model.
function canTransition(from, to) {
  if (!isValidState(from)) return false;
  return TRANSITIONS[String(from).toLowerCase()].includes(String(to).toLowerCase());
}

// Enforce a transition. Returns a normalized result object and
// never mutates anything:
//   { allowed:true, from, to, at }
//   { allowed:false, from, to, reason }
function transition(from, to, opts = {}) {
  const fromState = String(from || '').toLowerCase();
  const toState = String(to || '').toLowerCase();
  const at = new Date().toISOString();
  if (!isValidState(fromState)) {
    return { allowed: false, from: fromState, to: toState, reason: 'unknown source state: ' + fromState };
  }
  if (!isValidState(toState)) {
    return { allowed: false, from: fromState, to: toState, reason: 'unknown target state: ' + toState };
  }
  if (!canTransition(fromState, toState)) {
    return { allowed: false, from: fromState, to: toState, reason: 'illegal transition: ' + fromState + ' -> ' + toState, at };
  }
  return { allowed: true, from: fromState, to: toState, at, trigger: opts.trigger || null, by: opts.by || null };
}

// The set of states reachable from `state` (for UI + queue decisions).
function nextStates(state) {
  if (!isValidState(state)) return [];
  return TRANSITIONS[String(state).toLowerCase()].slice();
}

module.exports = {
  STATES,
  TRANSITIONS,
  isValidState,
  isTerminal,
  needsAttention,
  isVerifiable,
  canTransition,
  transition,
  nextStates,
  TERMINAL_STATES,
  NEEDS_ATTENTION,
  VERIFIABLE,
};
