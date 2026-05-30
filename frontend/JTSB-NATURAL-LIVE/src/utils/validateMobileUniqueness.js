const mobileCache = new Map();
const CACHE_TTL_MS = 30000;

function normalizePhone(phone) {
  return String(phone).replace(/\s+/g, '').replace(/[-()]/g, '').trim();
}

function isValidMobileFormat(phone) {
  const normalized = normalizePhone(phone);
  return /^[6-9]\d{9}$/.test(normalized);
}

function getFromCache(normalizedPhone) {
  const entry = mobileCache.get(normalizedPhone);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    mobileCache.delete(normalizedPhone);
    return null;
  }
  return entry;
}

function setCache(normalizedPhone, isUnique) {
  mobileCache.set(normalizedPhone, {
    isUnique,
    timestamp: Date.now(),
  });
}

export async function validateMobileUniqueness(phone, dbLayer = null) {
  const normalized = normalizePhone(phone);

  if (!normalized || normalized.length < 10) {
    return {
      isUnique: false,
      error: 'Phone number is required',
      allowRegistration: false,
    };
  }

  if (!isValidMobileFormat(normalized)) {
    return {
      isUnique: false,
      error: 'Please enter a valid 10-digit Indian mobile number',
      allowRegistration: false,
    };
  }

  const cached = getFromCache(normalized);
  if (cached !== null) {
    if (cached.isUnique) {
      return {
        isUnique: true,
        error: null,
        allowRegistration: true,
      };
    } else {
      return {
        isUnique: false,
        error: 'This mobile number is already in use',
        allowRegistration: false,
      };
    }
  }

  const resolver = dbLayer || (await import('../db/firebase-db.js')).FirebaseUser;
  const existing = await resolver.findByPhone(normalized);

  if (existing) {
    setCache(normalized, false);
    return {
      isUnique: false,
      error: 'This mobile number is already in use',
      allowRegistration: false,
    };
  }

  setCache(normalized, true);
  return {
    isUnique: true,
    error: null,
    allowRegistration: true,
  };
}

export function clearMobileCache(phone) {
  if (phone) {
    mobileCache.delete(normalizePhone(phone));
  } else {
    mobileCache.clear();
  }
}

export function getCacheStats() {
  return {
    size: mobileCache.size,
    entries: Array.from(mobileCache.entries()).map(([key, val]) => ({
      phone: key,
      isUnique: val.isUnique,
      age: Date.now() - val.timestamp,
    })),
  };
}

export { isValidMobileFormat, normalizePhone };
