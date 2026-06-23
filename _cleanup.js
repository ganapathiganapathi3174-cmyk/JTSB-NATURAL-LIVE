const turso = require('./_turso.js');
const r2 = require('./_r2.js');
const { createClient } = require('@supabase/supabase-js');

const ORPHAN_AGE_DAYS = 30;
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function cleanupOrphanFiles() {
  const supabase = getSupabase();
  if (!supabase) { console.warn('[CLEANUP] Supabase not configured'); return 0; }

  const cutoff = new Date(Date.now() - ORPHAN_AGE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const files = await r2.listFiles('screenshots/');
    let deleted = 0;
    for (const file of files) {
      if (new Date(file.lastModified) > cutoff) continue;

      const key = file.key;
      const utr = key.replace('screenshots/', '').replace(/^\d+_/, '').replace(/\.\w+$/, '');

      // Check if this screenshot is referenced by any upi_payment
      const { data: payments } = await supabase
        .from('upi_payments')
        .select('id')
        .or(`screenshot_url.ilike.%${encodeURIComponent(key)}%,screenshot_url.ilike.%${key}%`)
        .limit(1);

      if (!payments || payments.length === 0) {
        await r2.deleteFile(key);
        deleted++;
      }
    }

    return deleted;
  } catch (err) {
    console.error('[CLEANUP] Error:', err.message);
    return 0;
  }
}

async function createDailySnapshot() {
  const supabase = getSupabase();
  if (!supabase) { console.warn('[SNAPSHOT] Supabase not configured'); return; }

  const snapshotTables = ['users', 'referrals', 'topups', 'wallet_balances', 'wallet_transactions', 'sponsor_data'];
  const snapshot = {};

  for (const table of snapshotTables) {
    try {
      const { data, count } = await supabase.from(table).select('*', { count: 'exact' });
      snapshot[table] = { count: count || 0, sample: data ? data.slice(0, 5) : [] };
    } catch (err) {
      console.warn(`[SNAPSHOT] Failed to snapshot ${table}:`, err.message);
      snapshot[table] = { count: -1, error: err.message };
    }
  }

  await turso.createSnapshot('daily', snapshot);
}

async function cleanupOldSnapshots() {
  const c = turso.getClient();
  if (!c) return 0;
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await c.execute({
      sql: "DELETE FROM backup_snapshots WHERE created_at < ? AND snapshot_type = 'daily'",
      args: [cutoff],
    });
    return result.rowsAffected;
  } catch (err) {
    console.error('[CLEANUP] cleanupOldSnapshots error:', err.message);
    return 0;
  }
}

let dailyTimer = null;

function startDailyTasks() {
  if (dailyTimer) return;

  cleanupOrphanFiles().catch(() => {});

  createDailySnapshot().catch(() => {});
  cleanupOldSnapshots().catch(() => {});

  dailyTimer = setInterval(() => {
    cleanupOrphanFiles().catch(() => {});
    createDailySnapshot().catch(() => {});
    cleanupOldSnapshots().catch(() => {});
  }, SNAPSHOT_INTERVAL_MS);
}

function stopDailyTasks() {
  if (dailyTimer) {
    clearInterval(dailyTimer);
    dailyTimer = null;
  }
}

module.exports = { cleanupOrphanFiles, createDailySnapshot, cleanupOldSnapshots, startDailyTasks, stopDailyTasks };
