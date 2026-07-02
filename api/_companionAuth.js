const crypto = require('crypto');

const companionState = {
  connected: false,
  deviceName: 'Unknown',
  lastSyncAt: null,
  lastSyncIp: null,
  paymentsReceived: 0,
  errors: 0,
  lastError: null,
};

const companionHmacStore = new Map();

function getCompanionKey() {
  return process.env.COMPANION_API_KEY || '';
}

function authenticateRequest(req) {
  const key = getCompanionKey();
  if (!key) return { ok: false, error: 'Companion API not configured' };
  const headerKey = req.headers['x-companion-key'];
  if (!headerKey || headerKey !== key) return { ok: false, error: 'Invalid companion key' };
  const deviceName = req.headers['x-companion-device'] || 'Android Device';
  companionState.connected = true;
  companionState.deviceName = deviceName;
  companionState.lastSyncAt = new Date().toISOString();
  companionState.lastSyncIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  return { ok: true, deviceName };
}

function verifyReplay(utr, amount, timestamp) {
  const key = utr + ':' + amount.toFixed(2);
  if (companionHmacStore.has(key)) {
    const existing = companionHmacStore.get(key);
    if (Date.now() - existing < 300000) return false;
  }
  companionHmacStore.set(key, Date.now());
  if (companionHmacStore.size > 10000) {
    const cutoff = Date.now() - 3600000;
    for (const [k, v] of companionHmacStore) {
      if (v < cutoff) companionHmacStore.delete(k);
    }
  }
  return true;
}

function recordPaymentReceived() {
  companionState.paymentsReceived++;
}

function recordError(errMsg) {
  companionState.errors++;
  companionState.lastError = errMsg;
}

function getCompanionStatus() {
  return { ...companionState };
}

module.exports = {
  authenticateRequest,
  verifyReplay,
  recordPaymentReceived,
  recordError,
  getCompanionStatus,
};
