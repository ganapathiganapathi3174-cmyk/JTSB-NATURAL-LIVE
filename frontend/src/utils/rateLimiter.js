const _rateLimitMap = new Map();

export function checkRateLimit(key, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = _rateLimitMap.get(key);
  if (!entry) {
    _rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  if (now > entry.resetAt) {
    _rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxAttempts - 1 };
  }
  entry.count++;
  if (entry.count > maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: maxAttempts - entry.count };
}
