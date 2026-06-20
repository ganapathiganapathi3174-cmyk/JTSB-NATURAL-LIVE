const LS_KEY = 'rl';

function read() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}

function write(data) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
  catch { /* quota exceeded — silently degrade */ }
}

export function checkRateLimit(key, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const store = read();
  let entry = store[key];

  if (!entry || now > entry.resetAt) {
    store[key] = { count: 1, resetAt: now + windowMs };
    write(store);
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  entry.count++;
  if (entry.count > maxAttempts) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    write(store);
    return { allowed: false, remaining: 0, retryAfter };
  }

  write(store);
  return { allowed: true, remaining: maxAttempts - entry.count };
}
