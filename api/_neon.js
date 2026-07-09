const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connectionString = process.env.NEON_DATABASE_URL;
  if (!connectionString) {
    console.warn('[NEON] NEON_DATABASE_URL not set — analytics disabled');
    return null;
  }
  pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) return { rows: [], rowCount: 0 };
  try {
    const result = await p.query(text, params);
    return result;
  } catch (err) {
    console.error('[NEON] Query error:', err.message);
    throw err;
  }
}

const ALLOWED_ANALYTICS_TABLES = ['verification_logs', 'payment_logs', 'audit_logs', 'admin_logs', 'analytics_events'];

function validateTable(table) {
  if (!ALLOWED_ANALYTICS_TABLES.includes(table)) throw new Error('Invalid table: ' + table);
}

async function insertAnalyticsLog(table, data) {
  const p = getPool();
  if (!p) return null;
  try { validateTable(table); } catch { return null; }
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  try {
    const result = await p.query(
      `INSERT INTO "${table}" (${keys.map(k => `"${k.replace(/[^a-z_]/g, '')}"`).join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
      values
    );
    return result.rows[0]?.id || null;
  } catch (err) {
    console.error(`[NEON] insertAnalyticsLog error (${table}):`, err.message);
    return null;
  }
}

async function getAnalyticsLogs(table, filters = {}, options = {}) {
  const p = getPool();
  if (!p) return [];
  try { validateTable(table); } catch { return []; }
  let sql = `SELECT * FROM "${table}" WHERE 1=1`;
  const params = [];
  let idx = 1;
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      const cleanField = field.replace(/[^a-z_]/g, '');
      if (field.endsWith('__gte')) {
        sql += ` AND "${cleanField.replace('__gte', '')}" >= $${idx}`;
      } else if (field.endsWith('__lte')) {
        sql += ` AND "${cleanField.replace('__lte', '')}" <= $${idx}`;
      } else if (field.endsWith('__neq')) {
        sql += ` AND "${cleanField.replace('__neq', '')}" != $${idx}`;
      } else {
        sql += ` AND "${cleanField}" = $${idx}`;
      }
      params.push(value);
      idx++;
    }
  }
  if (options.orderBy) {
    const cleanOrderBy = String(options.orderBy).replace(/[^a-z_]/g, '');
    sql += ` ORDER BY "${cleanOrderBy}" ${options.ascending ? 'ASC' : 'DESC'}`;
  }
  if (options.limit) {
    const cleanLimit = parseInt(options.limit, 10);
    if (!isNaN(cleanLimit) && cleanLimit > 0 && cleanLimit <= 10000) {
      sql += ` LIMIT ${cleanLimit}`;
    }
  }
  try {
    const result = await p.query(sql, params);
    return result.rows;
  } catch (err) {
    console.error(`[NEON] getAnalyticsLogs error (${table}):`, err.message);
    return [];
  }
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

async function verifyConnection() {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = { query, insertAnalyticsLog, getAnalyticsLogs, closePool, verifyConnection };
