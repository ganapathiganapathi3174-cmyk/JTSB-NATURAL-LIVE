const { createClient } = require('@supabase/supabase-js');
const turso = require('./_turso.js');
const neon = require('./_neon.js');
const queue = require('./_queue.js');
const crypto_helper = require('./_crypto.js');

const CRITICAL_TABLES = ['users', 'referrals', 'topups', 'wallet_balances', 'wallet_transactions', 'uniques', 'sponsor_data'];
const ANALYTICS_TABLES = ['verification_logs', 'payment_logs', 'audit_logs', 'admin_logs', 'analytics_events'];
const SENSITIVE_TABLES = ['users', 'upi_payments'];

const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1500, 3000];

function isCriticalTable(table) {
  return CRITICAL_TABLES.includes(table);
}

function isAnalyticsTable(table) {
  return ANALYTICS_TABLES.includes(table);
}

function isSensitiveTable(table) {
  return SENSITIVE_TABLES.includes(table);
}

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function encryptSensitive(data, table) {
  if (!isSensitiveTable(table) || !data) return data;
  const result = { ...data };
  if (result.utr) result.utr = crypto_helper.encrypt(String(result.utr));
  if (result.phone) result.phone = crypto_helper.encrypt(String(result.phone));
  if (result.email) result.email = crypto_helper.encrypt(String(result.email));
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

async function withRetry(fn, label) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        console.warn(`[RETRY] ${label} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. Retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

async function getDoc(table, id) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await withRetry(() =>
      supabase.from(table).select('*').eq('id', id).single(),
      `getDoc ${table}/${id}`
    );
    if (error && error.code === 'PGRST116') return null;
    if (error) throw new Error(`GET error: ${JSON.stringify(error)}`);
    return decryptSensitive(data, table);
  } catch (err) {
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
    await withRetry(() =>
      supabase.from(table).delete().eq('id', id),
      `deleteDoc ${table}/${id}`
    );
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
    const { data, error } = await withRetry(() => query, `runQuery ${table}`);
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
  const record = { ...encrypted, id, updated_at: now };
  if (!data.created_at) record.created_at = now;

  try {
    await withRetry(() =>
      supabase.from(table).upsert(record, { onConflict: 'id' }),
      `writeDoc ${table}/${id}`
    );

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
    await withRetry(() =>
      supabase.from(table).update({ ...encrypted, updated_at: new Date().toISOString() }).eq('id', id),
      `updateDoc ${table}/${id}`
    );

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
  const record = { ...encrypted, created_at: now, updated_at: now };

  try {
    const { data: result, error } = await withRetry(() =>
      supabase.from(table).insert(record).select('id').single(),
      `addDoc ${table}`
    );
    if (error) throw new Error(`ADD error ${JSON.stringify(error)}`);

    if (isCriticalTable(table) && result && result.id) {
      turso.syncBackup(table, result.id, { ...record, id: result.id }).catch(() => {});
    }
    if (isAnalyticsTable(table)) {
      neon.insertAnalyticsLog(table, { ...record, id: result?.id }).catch(() => {});
    }
    return result;
  } catch (err) {
    console.error(`[ADD] Failed for ${table}, queuing: ${err.message}`);
    const fallbackId = 'pending_' + Date.now();
    await queue.enqueue('write', table, fallbackId, record, 'write');
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
  const { count, error } = await withRetry(() => query, `countQuery ${table}`);
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

module.exports = { getDoc, deleteDoc, runQuery, writeDoc, updateDoc, addDoc, countQuery, resilientQuery, isCriticalTable };
