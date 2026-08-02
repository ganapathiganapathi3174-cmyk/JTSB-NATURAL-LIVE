const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const turso = require('./_turso.js');
const neon = require('./_neon.js');
const queue = require('./_queue.js');
const crypto_helper = require('./_crypto.js');
const metrics = require('./_metrics.js');

const CRITICAL_TABLES = ['users', 'referrals', 'topups', 'wallet_balances', 'wallet_transactions', 'uniques', 'sponsor_data', 'sponsor_claims'];
const ANALYTICS_TABLES = ['verification_logs', 'payment_logs', 'audit_logs', 'admin_logs', 'analytics_events'];
const SENSITIVE_TABLES = ['users', 'upi_payments'];

function isCriticalTable(table) {
  return CRITICAL_TABLES.includes(table);
}

function isAnalyticsTable(table) {
  return ANALYTICS_TABLES.includes(table);
}

function isSensitiveTable(table) {
  return SENSITIVE_TABLES.includes(table);
}

const REQUEST_TIMEOUT_MS = parseInt(process.env.SUPABASE_TIMEOUT || '20000', 10);

let _supabaseClient = null;

function getSupabaseClient() {
  if (_supabaseClient) return _supabaseClient;
  let supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in Vercel Environment Variables (Settings → Environment Variables) or in .env.local file.');
  }
  // Normalize URL: strip trailing slash, ensure https:// prefix
  // This prevents "requested path is invalid" errors from malformed URLs
  supabaseUrl = supabaseUrl.replace(/\/+$/, '');
  if (!supabaseUrl.startsWith('http://') && !supabaseUrl.startsWith('https://')) {
    supabaseUrl = 'https://' + supabaseUrl;
    console.warn('[SUPABASE] Added https:// prefix to SUPABASE_URL');
  }
  _supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        if (options.signal) {
          options.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
        return fetch(url, { ...options, signal: controller.signal })
          .finally(() => clearTimeout(timeoutId));
      },
    },
  });
  return _supabaseClient;
}

function encryptSensitive(data, table) {
  if (!isSensitiveTable(table) || !data) return data;
  const result = { ...data };
  if (result.utr) result.utr = crypto_helper.encrypt(String(result.utr));
  if (result.phone) {
    const rawPhone = String(result.phone);
    result.phone = crypto_helper.encrypt(rawPhone);
    result.phone_hash = crypto.createHash('sha256').update(rawPhone.trim()).digest('hex');
  }
  if (result.email) {
    const rawEmail = String(result.email);
    result.email = crypto_helper.encrypt(rawEmail);
    result.email_hash = crypto.createHash('sha256').update(rawEmail.toLowerCase().trim()).digest('hex');
  }
  if (result.password) result.password = crypto_helper.encrypt(String(result.password));
  return result;
}

function decryptSensitive(data, table) {
  if (!isSensitiveTable(table) || !data) return data;
  const result = { ...data };
  if (result.utr) result.utr = crypto_helper.decrypt(result.utr);
  if (result.phone) result.phone = crypto_helper.decrypt(result.phone);
  if (result.email) result.email = crypto_helper.decrypt(result.email);
  if (result.password) result.password = crypto_helper.decrypt(result.password);
  return result;
}

async function getDoc(table, id) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
    if (error && (error.code === 'PGRST116' || error.code === '22P02')) return null;
    if (error) throw new Error(`GET error: ${JSON.stringify(error)}`);
    return decryptSensitive(data, table);
  } catch (err) {
    metrics.trackDBError('supabase');
    if (isCriticalTable(table)) {
      console.warn(`[FAILOVER] Supabase getDoc failed for ${table}/${id}, trying Turso`);
      const backup = await turso.readBackup(table, id);
      if (backup) return decryptSensitive(backup.data, table);
    }
    throw err;
  }
}

async function deleteDoc(table, id) {
  try {
    const supabase = getSupabaseClient();
    await supabase.from(table).delete().eq('id', id);
    if (isCriticalTable(table)) {
      turso.deleteBackup(table, id).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(`[DELETE] Failed for ${table}/${id}, queuing: ${err.message}`);
    await queue.enqueue('delete', table, id, { id }, 'delete');
    return true;
  }
}

async function runQuery(table, filters, options = {}) {
  try {
    const supabase = getSupabaseClient();
    let query = supabase.from(table).select(options.select || '*');
    if (filters && filters.length) {
      for (const f of filters) {
        if (f.op === 'EQUAL') query = query.eq(f.field, f.value);
        else if (f.op === 'NOT_EQUAL') query = query.neq(f.field, f.value);
        else if (f.op === 'GREATER_THAN') query = query.gt(f.field, f.value);
        else if (f.op === 'GREATER_OR_EQUAL') query = query.gte(f.field, f.value);
        else if (f.op === 'LESS_THAN') query = query.lt(f.field, f.value);
        else if (f.op === 'LESS_OR_EQUAL') query = query.lte(f.field, f.value);
        else if (f.op === 'ARRAY_CONTAINS') query = query.contains(f.field, [f.value]);
        else if (f.op === 'IN') query = query.in(f.field, f.value);
      }
    }
    if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending !== false });
    if (options.limit) query = query.limit(options.limit);
    const { data, error } = await query;
    if (error) throw new Error(`QUERY error ${JSON.stringify(error)}`);
    const decrypted = (data || []).map(d => decryptSensitive(d, table));
    return decrypted;
  } catch (err) {
    if (isCriticalTable(table) && filters && filters.length > 0) {
      console.warn(`[FAILOVER] Supabase runQuery failed for ${table}, trying Turso`);
      const idFilter = filters.find(f => f.field === 'id' && f.op === 'EQUAL');
      if (idFilter && idFilter.value) {
        const backup = await turso.readBackup(table, idFilter.value);
        if (backup) return [decryptSensitive(backup.data, table)];
      }
    }
    throw err;
  }
}

async function writeDoc(table, id, data) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const encrypted = encryptSensitive(data, table);
  const record = { ...encrypted, id };
  if (!data.created_at) record.created_at = now;

  try {
    const safe = await filterMissingColumns(table, record);
    await supabase.from(table).upsert(safe, { onConflict: 'id' });

    if (isCriticalTable(table)) {
      turso.syncBackup(table, id, record).catch(() => {});
    }
    return { id, ...data };
  } catch (err) {
    console.error(`[WRITE] Failed for ${table}/${id}, queuing: ${err.message}`);
    await queue.enqueue('write', table, id, record, 'write');
    if (isCriticalTable(table)) {
      turso.syncBackup(table, id, record).catch(() => {});
    }
    return { id, ...data };
  }
}

async function updateDoc(table, id, data) {
  const supabase = getSupabaseClient();
  const encrypted = encryptSensitive(data, table);

  try {
    const safe = await filterMissingColumns(table, { ...encrypted, updated_at: new Date().toISOString() });
    const result = await supabase.from(table).update(safe).eq('id', id).select('id');
    if (result && result.error) throw new Error(`UPDATE error ${JSON.stringify(result.error)}`);

    if (isCriticalTable(table)) {
      getDoc(table, id).then(record => {
        if (record) turso.syncBackup(table, id, encryptSensitive(record, table)).catch(() => {});
      }).catch(() => {});
    }
    return true;
  } catch (err) {
    console.error(`[UPDATE] Failed for ${table}/${id}, queuing: ${err.message}`);
    await queue.enqueue('update', table, id, { ...encrypted, updated_at: new Date().toISOString() }, 'update');
    return true;
  }
}

async function addDoc(table, data) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const encrypted = encryptSensitive(data, table);
  const record = { ...encrypted, created_at: now };

  try {
    const safe = await filterMissingColumns(table, record);
    const { data: result, error } = await supabase.from(table).insert(safe).select('id').single();
    if (error) throw new Error(`ADD error ${JSON.stringify(error)}`);

    if (isCriticalTable(table) && result && result.id) {
      turso.syncBackup(table, result.id, { ...record, id: result.id }).catch(() => {});
    }
    if (isAnalyticsTable(table)) {
      neon.insertAnalyticsLog(table, { ...record, id: result?.id }).catch(() => {});
    }
    return result;
  } catch (err) {
    const isTableMissing = err.message && (err.message.includes('Could not find the table') || err.message.includes('does not exist') || err.message.includes('relation') && err.message.includes('does not exist'));
    if (isTableMissing) {
      console.warn(`[ADD] Table "${table}" does not exist in DB — skipping write`);
    } else {
      console.error(`[ADD] Failed for ${table}: ${err.message}`);
    }
    const fallbackId = 'pending_' + Date.now();
    await queue.enqueue('write', table, fallbackId, record, 'write').catch(() => {});
    if (isAnalyticsTable(table)) {
      neon.insertAnalyticsLog(table, { ...record, id: fallbackId }).catch(() => {});
    }
    return { id: fallbackId };
  }
}

async function countQuery(table, filters = []) {
  const supabase = getSupabaseClient();
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  for (const f of filters) {
    if (f.op === 'EQUAL') query = query.eq(f.field, f.value);
  }
  const { count, error } = await query;
  if (error) throw new Error(`COUNT error ${JSON.stringify(error)}`);
  return count || 0;
}

async function resilientQuery(table, filters, options = {}) {
  try {
    return await runQuery(table, filters, options);
  } catch (err) {
    if (isCriticalTable(table)) {
      console.warn(`[RESILIENT] Primary query failed for ${table}, trying Turso`);
      const idFilter = filters?.find(f => f.field === 'id' && f.op === 'EQUAL');
      if (idFilter && idFilter.value) {
        const backup = await turso.readBackup(table, idFilter.value);
        if (backup) return [decryptSensitive(backup.data, table)];
      }
    }
    throw err;
  }
}

async function conditionalUpdateDoc(table, id, conditions, data) {
  const supabase = getSupabaseClient();
  const now = new Date().toISOString();
  const encrypted = encryptSensitive(data, table);
  try {
    // Filter the SET payload: a missing column must not abort the whole update.
    const safe = await filterMissingColumns(table, { ...encrypted, updated_at: now });
    let query = supabase.from(table).update(safe).eq('id', id);
    for (const cond of conditions) {
      // A condition field that doesn't exist would raise 42703 and silently
      // zero-out the update (approval treated as idempotent no-op). Skip it so
      // the remaining conditions still apply atomically.
      if (!(await optionalColumnExists(table, cond.field))) {
        console.warn(`[CONDITIONAL_UPDATE] ${table}.${cond.field} condition skipped (missing column) — continuing with remaining conditions`);
        continue;
      }
      if (cond.op === 'EQUAL') query = query.eq(cond.field, cond.value);
      else if (cond.op === 'NOT_EQUAL') query = query.neq(cond.field, cond.value);
      else if (cond.op === 'IN') query = query.in(cond.field, cond.value);
      else if (cond.op === 'GREATER_THAN') query = query.gt(cond.field, cond.value);
      else if (cond.op === 'LESS_THAN') query = query.lt(cond.field, cond.value);
      else if (cond.op === 'GREATER_OR_EQUAL') query = query.gte(cond.field, cond.value);
      else if (cond.op === 'LESS_OR_EQUAL') query = query.lte(cond.field, cond.value);
    }
    const { data: result, error } = await query.select('id');
    if (error) throw new Error(`CONDITIONAL_UPDATE error ${JSON.stringify(error)}`);
    const affected = result && result.length ? result.length : 0;
    if (affected > 0 && isCriticalTable(table)) {
      getDoc(table, id).then(record => {
        if (record) turso.syncBackup(table, id, encryptSensitive(record, table)).catch(() => {});
      }).catch(() => {});
    }
    return affected;
  } catch (err) {
    console.error(`[CONDITIONAL_UPDATE] Failed for ${table}/${id}, queuing: ${err.message}`);
    await queue.enqueue('update', table, id, { ...encrypted, updated_at: now }, 'update');
    return 0;
  }
}

async function runQueryDecrypted(table, filters, options = {}) {
  const reqStart = Date.now();
  const fnName = 'runQueryDecrypted';
  const logSlow = (msg, elapsed) => {
    if (elapsed > 2000) {
      console.log(`[SLOW QUERY] ⚠️ ${msg} took ${elapsed}ms (exceeds 2s)`);
      console.log(`  File: api/_supabase.js, Function: ${fnName}, Line: 304 (start), Execution Time: ${elapsed}ms`);
    }
  };

  const sensitiveFields = { users: ['email', 'phone'], upi_payments: ['utr'] };
  const fieldsToFilterOn = sensitiveFields[table];
  const hasSensitiveFilter = filters && filters.some(f => fieldsToFilterOn?.includes(f.field));
  if (!hasSensitiveFilter) return runQuery(table, filters, options);

  console.log(`[runQueryDecrypted] START table=${table}, filters=${JSON.stringify(filters)}`);

  // For sensitive-field filters, paginate through all records, decrypt in-memory, then filter
  const supabase = getSupabaseClient();
  const PAGE_SIZE = 1000;
  let allResults = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const tPage = Date.now();
    console.log(`[runQueryDecrypted] Page ${page}: fetching range ${page * PAGE_SIZE}-${(page + 1) * PAGE_SIZE - 1}`);
    let query = supabase.from(table).select(options.select || '*');
    if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending !== false });
    query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, error } = await query;
    const fetchTime = Date.now() - tPage;
    if (fetchTime > 2000) {
      console.log(`[SLOW QUERY] ⚠️ Page ${page} fetch took ${fetchTime}ms (exceeds 2s)`);
      console.log(`  File: api/_supabase.js, Function: ${fnName}, Line: 334, Execution Time: ${fetchTime}ms`);
    }
    if (error) throw new Error(`QUERY error ${JSON.stringify(error)}`);
    const tDecrypt = Date.now();
    const batch = (data || []).map(d => decryptSensitive(d, table));
    const decryptTime = Date.now() - tDecrypt;
    if (decryptTime > 2000) {
      console.log(`[SLOW QUERY] ⚠️ Page ${page} decryption of ${batch.length} rows took ${decryptTime}ms`);
      console.log(`  File: api/_supabase.js, Function: ${fnName}, Line: 342, Execution Time: ${decryptTime}ms`);
    }
    allResults = allResults.concat(batch);
    hasMore = batch.length === PAGE_SIZE;
    console.log(`[runQueryDecrypted] Page ${page}: fetched ${batch.length} rows, fetch=${fetchTime}ms, decrypt=${decryptTime}ms, total=${Date.now() - tPage}ms`);
    page++;
    if (page > 100) break;
  }

  console.log(`[runQueryDecrypted] Fetched ${allResults.length} total rows, now filtering in-memory`);

  let results = allResults;
  for (const f of filters) {
    const tFilter = Date.now();
    if (f.op === 'EQUAL') results = results.filter(r => r[f.field] === f.value);
    else if (f.op === 'NOT_EQUAL') results = results.filter(r => r[f.field] !== f.value);
    else if (f.op === 'IN') results = results.filter(r => f.value.includes(r[f.field]));
    else if (f.op === 'LIKE') results = results.filter(r => r[f.field]?.includes(f.value.replace(/%/g, '')));
    const filterTime = Date.now() - tFilter;
    logSlow(`Filter ${f.field} ${f.op}`, filterTime);
  }

  const totalTime = Date.now() - reqStart;
  logSlow(`Total ${fnName}`, totalTime);
  console.log(`[runQueryDecrypted] END: ${results.length} results in ${totalTime}ms`);
  return results;
}

async function atomicCreditWallet(userId, amount, paymentId, description, txType = 'deposit') {
  const COL_WALLET_BALANCES = 'wallet_balances';
  const COL_WALLET_TX = 'wallet_transactions';
  let retries = 5;
  let lastError;
  while (retries > 0) {
    try {
      const wallets = await runQuery(COL_WALLET_BALANCES, [{ field: 'id', op: 'EQUAL', value: userId }]);
      if (!wallets || wallets.length === 0) {
        await writeDoc(COL_WALLET_BALANCES, userId, { balance: 0, total_earned: 0 });
        retries--;
        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
        continue;
      }

      const wallet = wallets[0];
      const currentBalance = wallet.balance || 0;
      const currentTotalEarned = wallet.total_earned || 0;
      const newBalance = currentBalance + amount;
      const newTotalEarned = currentTotalEarned + amount;

      const affected = await conditionalUpdateDoc(COL_WALLET_BALANCES, userId, [
        { field: 'balance', op: 'EQUAL', value: currentBalance },
      ], { balance: newBalance, total_earned: newTotalEarned });

      if (affected > 0) {
        await addDoc(COL_WALLET_TX, {
          user_id: userId, type: txType, amount,
          description, reference_id: paymentId, balance_after: newBalance,
        });
        return { balance: newBalance, total_earned: newTotalEarned };
      }

      retries--;
      if (retries > 0) await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
    } catch (err) {
      lastError = err;
      retries--;
      if (retries > 0) await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(lastError || 'Failed to credit wallet after retries');
}

// ── Resilient updates: drop optional columns that don't exist yet ──
// Some tables (payment_sessions, upi_payments) only gain hardening columns
// (screenshot_phash / verification_attempts / next_retry_at / last_error)
// after migration 0003 is applied to the live DB. Writing a column that does
// not exist fails the ENTIRE update (42703), which would silently discard the
// verification result. updateDocFiltered() detects missing columns once per
// process (re-checked every 5 min so a later migration is picked up) and
// strips them before writing, so the pipeline degrades gracefully until the
// migration is applied.
const OPTIONAL_COLUMN_RECHECK_MS = 5 * 60 * 1000;
let _optionalColumnCache = new Map();
let _optionalColumnCheckedAt = 0;

async function optionalColumnExists(table, column) {
  const key = table + '.' + column;
  if (_optionalColumnCache.has(key) && Date.now() - _optionalColumnCheckedAt < OPTIONAL_COLUMN_RECHECK_MS) {
    return _optionalColumnCache.get(key);
  }
  // Default to "exists" whenever we can't confirm otherwise (no DB reachable,
  // probe threw, etc.) — only strip a column on a DEFINITIVE column-not-found
  // error, so a mocked/offline environment never silently drops fields.
  let exists = true;
  try {
    const supabase = module.exports.getSupabaseClient();
    const { error } = await supabase.from(table).select(column).limit(1);
    if (error) {
      const msg = String((error && error.message) || error);
      const code = String((error && error.code) || '');
      const missing = /does not exist|PGRST204|42703|Could not find the/i.test(msg + ' ' + code);
      exists = !missing;
    }
  } catch (e) {
    exists = true;
  }
  _optionalColumnCache.set(key, exists);
  _optionalColumnCheckedAt = Date.now();
  return exists;
}

// Test helper: forget every cached optional-column probe so a test can
// re-run detection with a fresh mock.
function resetOptionalColumnCache() {
  _optionalColumnCache.clear();
  _optionalColumnCheckedAt = 0;
}

// Strip every column the live table does not have from a write payload.
// Used as a safety net inside the CORE write primitives (writeDoc, updateDoc,
// addDoc, conditionalUpdateDoc) so a pending migration column can NEVER abort
// the entire write with 42703 — notifications, audit, approval, wallet and
// referral writes included. Columns are probed once per 5 min (cached), so
// steady-state writes add no round trips.
async function filterMissingColumns(table, data) {
  const payload = { ...data };
  const keys = Object.keys(payload);
  if (!keys.length) return payload;
  const results = await Promise.all(keys.map(k => optionalColumnExists(table, k)));
  let dropped = 0;
  for (let i = 0; i < keys.length; i++) {
    if (!results[i]) {
      console.warn(`[SCHEMA-FILTER] ${table}.${keys[i]} missing (migration pending?) — skipping column`);
      delete payload[keys[i]];
      dropped++;
    }
  }
  if (dropped) console.warn(`[SCHEMA-FILTER] ${table}: dropped ${dropped} missing column(s) before write`);
  return payload;
}

// Write data, first stripping any listed optional columns that the table
// doesn't actually have. Only 'optionalColumns' are probed — core columns are
// always written (they are guaranteed by earlier migrations).
async function updateDocFiltered(table, id, data, optionalColumns) {
  const payload = { ...data };
  if (Array.isArray(optionalColumns) && optionalColumns.length) {
    for (const col of optionalColumns) {
      if (col in payload && !(await optionalColumnExists(table, col))) {
        console.warn(`[UPDATE-FILTERED] ${table}.${col} missing (migration pending?) — skipping column`);
        delete payload[col];
      }
    }
  }
  return module.exports.updateDoc(table, id, payload);
}

// Insert a record, first stripping any listed optional columns the table lacks.
// Mirrors updateDocFiltered so audit/trail inserts survive a pending migration
// instead of aborting the entire INSERT (42703) and losing the record.
async function addDocFiltered(table, data, optionalColumns) {
  const payload = { ...data };
  if (Array.isArray(optionalColumns) && optionalColumns.length) {
    for (const col of optionalColumns) {
      if (col in payload && !(await optionalColumnExists(table, col))) {
        console.warn(`[ADD-FILTERED] ${table}.${col} missing (migration pending?) — skipping column`);
        delete payload[col];
      }
    }
  }
  return module.exports.addDoc(table, payload);
}

// ── Targeted lookup helpers (indexed queries, decrypt only matching row) ──

// Cache whether the hash columns exist in the users table.
// The schema defines email_hash/phone_hash, but if the migration was never
// applied the lookup throws 42703 and falls back to a full scan. Detect once,
// then skip the doomed hash query (re-check every 5 min so a later migration
// is picked up automatically).
let _hashColumnMissing = null;
let _hashColumnCheckedAt = 0;
const HASH_COLUMN_RECHECK_MS = 5 * 60 * 1000;

function hashColumnMissing() {
  if (_hashColumnMissing === true && Date.now() - _hashColumnCheckedAt < HASH_COLUMN_RECHECK_MS) {
    return true;
  }
  return false;
}

function markHashColumnState(missing) {
  _hashColumnMissing = missing;
  _hashColumnCheckedAt = Date.now();
}

// Detect whether the users table has email_hash/phone_hash ONCE per process and
// share that result across every finder. Without this, each findUserByEmail /
// findUserByPhone call issues a doomed query against the missing column (42703)
// before falling back to a scan — doubling the number of round trips on every
// registration/login and burning ~0.5s of latency each.
let _hashColumnPromise = null;

function ensureHashColumnDetection() {
  const shouldRecheck = _hashColumnMissing === true && Date.now() - _hashColumnCheckedAt >= HASH_COLUMN_RECHECK_MS;
  if (_hashColumnPromise && !shouldRecheck) return _hashColumnPromise;
  _hashColumnPromise = (async () => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('users').select('email_hash').limit(1);
      markHashColumnState(!!error);
    } catch (err) {
      markHashColumnState(true);
    }
  })();
  _hashColumnPromise.catch(e => console.error('[SUPABASE] hash-column probe failed: ' + e.message));
  return _hashColumnPromise;
}

async function findUserByEmail(email) {
  if (!email) return null;
  const target = email.toLowerCase().trim();
  const emailHash = crypto.createHash('sha256').update(target).digest('hex');
  const supabase = getSupabaseClient();

  await ensureHashColumnDetection();
  if (!hashColumnMissing()) {
    const { data, error } = await supabase.from('users').select('*').eq('email_hash', emailHash).limit(1);
    if (!error) {
      markHashColumnState(false);
      if (data && data.length > 0) return decryptSensitive(data[0], 'users');
      return null;
    }
    // Column may not exist (pre-migration) — fall back to scan, cache the state
    markHashColumnState(true);
  }

  // Fallback scan — single query, no extra getDoc round trip. The scan row
  // already carries the decrypted email/phone needed for duplicate checks.
  const { data: fallback } = await supabase.from('users').select('id,email,phone').limit(1000);
  if (!fallback) return null;
  for (const row of fallback) {
    const decrypted = decryptSensitive(row, 'users');
    if (decrypted.email && decrypted.email.toLowerCase().trim() === target) {
      return decrypted;
    }
  }
  return null;
}

async function findUserByPhone(phone) {
  if (!phone) return null;
  const target = phone.trim();
  const phoneHash = crypto.createHash('sha256').update(target).digest('hex');
  const supabase = getSupabaseClient();

  await ensureHashColumnDetection();
  if (!hashColumnMissing()) {
    const { data, error } = await supabase.from('users').select('*').eq('phone_hash', phoneHash).limit(1);
    if (!error) {
      markHashColumnState(false);
      if (data && data.length > 0) return decryptSensitive(data[0], 'users');
      return null;
    }
    // Column may not exist (pre-migration) — fall back to scan, cache the state
    markHashColumnState(true);
  }

  // Fallback scan — single query, no extra getDoc round trip.
  const { data: fallback } = await supabase.from('users').select('id,email,phone').limit(1000);
  if (!fallback) return null;
  for (const row of fallback) {
    const decrypted = decryptSensitive(row, 'users');
    if (decrypted.phone && decrypted.phone.trim() === target) {
      return decrypted;
    }
  }
  return null;
}

async function findUserBySponsorCode(code) {
  if (!code) return null;
  // referral_code is NOT encrypted — use runQuery directly
  const results = await runQuery('users', [{ field: 'referral_code', op: 'EQUAL', value: code.toUpperCase() }], { limit: 1 });
  return results.length > 0 ? results[0] : null;
}

module.exports = { getDoc, deleteDoc, runQuery, runQueryDecrypted, writeDoc, updateDoc, updateDocFiltered, addDoc, addDocFiltered, countQuery, resilientQuery, isCriticalTable, conditionalUpdateDoc, getSupabaseClient, atomicCreditWallet, findUserByEmail, findUserByPhone, findUserBySponsorCode, resetOptionalColumnCache };
