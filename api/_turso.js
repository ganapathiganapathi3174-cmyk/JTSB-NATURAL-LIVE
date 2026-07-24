let createClient = null;
try {
  ({ createClient } = require('@libsql/client'));
} catch (_) {
  console.warn('[TURSO] @libsql/client native module not available — backup disabled');
}

let client = null;

function getClient() {
  if (client) return client;
  if (!createClient) return null;
  const url = process.env.TURSO_DATABASE_URL || process.env.TURSO_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.warn('[TURSO] TURSO_DATABASE_URL not set — backup disabled');
    return null;
  }
  client = createClient({ url, authToken: authToken || undefined });
  return client;
}

const BACKUP_TABLES = ['users', 'referrals', 'topups', 'wallet_balances', 'wallet_transactions', 'uniques', 'sponsor_data'];

async function ensureBackupTables() {
  const c = getClient();
  if (!c) return;
  try {
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_users (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_referrals (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_topups (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_wallet_balances (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_wallet_transactions (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_uniques (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_sponsor_data (
        id TEXT PRIMARY KEY, data TEXT, backed_up_at TEXT
      )
    `);
    await c.execute(`
      CREATE TABLE IF NOT EXISTS backup_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, snapshot_type TEXT, data TEXT, created_at TEXT
      )
    `);
  } catch (err) {
    console.error('[TURSO] ensureBackupTables error:', err.message);
  }
}

async function syncBackup(table, id, data) {
  const c = getClient();
  if (!c) return false;
  const backupTable = `backup_${table}`;
  if (!BACKUP_TABLES.includes(table)) return false;
  try {
    const json = JSON.stringify(data || {});
    const now = new Date().toISOString();
    await c.execute({
      sql: `INSERT INTO ${backupTable} (id, data, backed_up_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = ?, backed_up_at = ?`,
      args: [id, json, now, json, now],
    });
    return true;
  } catch (err) {
    console.error(`[TURSO] syncBackup error (${table}/${id}):`, err.message);
    return false;
  }
}

async function readBackup(table, id) {
  const c = getClient();
  if (!c) return null;
  const backupTable = `backup_${table}`;
  if (!BACKUP_TABLES.includes(table)) return null;
  try {
    const result = await c.execute({
      sql: `SELECT data, backed_up_at FROM ${backupTable} WHERE id = ?`,
      args: [id],
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { data: JSON.parse(row.data || '{}'), backed_up_at: row.backed_up_at };
  } catch (err) {
    console.error(`[TURSO] readBackup error (${table}/${id}):`, err.message);
    return null;
  }
}

async function queryBackup(sql, args = []) {
  const c = getClient();
  if (!c) return { rows: [] };
  try {
    const result = await c.execute({ sql, args });
    return result;
  } catch (err) {
    console.error('[TURSO] queryBackup error:', err.message);
    return { rows: [] };
  }
}

async function createSnapshot(snapshotType, data) {
  const c = getClient();
  if (!c) return null;
  try {
    const json = JSON.stringify(data || {});
    const now = new Date().toISOString();
    const result = await c.execute({
      sql: `INSERT INTO backup_snapshots (snapshot_type, data, created_at) VALUES (?, ?, ?) RETURNING id`,
      args: [snapshotType, json, now],
    });
    return result.rows[0]?.id || null;
  } catch (err) {
    console.error('[TURSO] createSnapshot error:', err.message);
    return null;
  }
}

async function deleteBackup(table, id) {
  const c = getClient();
  if (!c) return false;
  const backupTable = `backup_${table}`;
  if (!BACKUP_TABLES.includes(table)) return false;
  try {
    await c.execute({ sql: `DELETE FROM ${backupTable} WHERE id = ?`, args: [id] });
    return true;
  } catch (err) {
    console.error(`[TURSO] deleteBackup error (${table}/${id}):`, err.message);
    return false;
  }
}

async function verifyConnection() {
  const c = getClient();
  if (!c) return false;
  try {
    await c.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getClient, syncBackup, readBackup, queryBackup, createSnapshot, deleteBackup,
  ensureBackupTables, verifyConnection, BACKUP_TABLES,
};
