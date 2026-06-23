const crypto = require('crypto');
const turso = require('./_turso.js');

const MAX_RETRIES = 3;
const MAX_DLQ_RETRIES = 5;
const BACKOFF_MS = [1000, 5000, 15000];

const queue = [];
const dlq = [];
let processing = false;
let scheduled = false;

function generateId() {
  return 'q_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

async function enqueue(type, table, id, data, operation = 'write') {
  const item = {
    id: generateId(),
    type,
    table,
    recordId: id,
    data: JSON.stringify(data || {}),
    operation,
    attempts: 0,
    status: 'pending_sync',
    error: null,
    created_at: new Date().toISOString(),
  };
  queue.push(item);

  // Persist to Turso for durability
  try {
    const c = turso.getClient();
    if (c) {
      await c.execute({
        sql: `INSERT INTO queue_items (id, type, table_name, record_id, data, operation, attempts, status, error, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET status = ?, attempts = ?`,
        args: [item.id, type, table, id, item.data, operation, 0, 'pending_sync', null, item.created_at, 'pending_sync', 0],
      });
    }
  } catch (err) {
    console.warn('[QUEUE] Failed to persist to Turso:', err.message);
  }

  if (!processing) processQueue();
  return item;
}

async function processQueue() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;

    item.status = 'in_progress';
    item.attempts++;

    try {
      const supabase = getSupabaseClient();
      const parsed = JSON.parse(item.data);

      if (item.operation === 'write') {
        await supabase.from(item.table).upsert(parsed, { onConflict: 'id' });
      } else if (item.operation === 'update') {
        await supabase.from(item.table).update(parsed).eq('id', item.recordId);
      } else if (item.operation === 'delete') {
        await supabase.from(item.table).delete().eq('id', item.recordId);
      }

      item.status = 'completed';
      item.error = null;

      // Sync to Turso if critical
      const { isCriticalTable } = require('./_supabase.js');
      if (isCriticalTable && isCriticalTable(item.table)) {
        turso.syncBackup(item.table, item.recordId, parsed).catch(() => {});
      }

      // Remove from Turso queue
      const c = turso.getClient();
      if (c) {
        await c.execute({ sql: 'DELETE FROM queue_items WHERE id = ?', args: [item.id] }).catch(() => {});
      }
    } catch (err) {
      console.error(`[QUEUE] Attempt ${item.attempts}/${MAX_RETRIES} failed for ${item.table}/${item.recordId}: ${err.message}`);

      if (item.attempts >= MAX_DLQ_RETRIES) {
        item.status = 'manual_review';
        dlq.push(item);
        console.error(`[DLQ] Moved to DLQ after ${item.attempts} attempts: ${item.table}/${item.recordId}`);

        // Persist DLQ to Turso
        const c = turso.getClient();
        if (c) {
          await c.execute({
            sql: `INSERT INTO dlq_items (id, type, table_name, record_id, data, operation, attempts, error, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO NOTHING`,
            args: [item.id, item.type, item.table, item.recordId, item.data, item.operation, item.attempts, err.message, item.created_at],
          }).catch(() => {});
        }

        await persistDLQ(item, err.message);
      } else {
        // Re-queue with backoff
        const backoff = BACKOFF_MS[Math.min(item.attempts - 1, BACKOFF_MS.length - 1)];
        item.status = 'pending_sync';
        item.error = err.message;

        setTimeout(() => {
          queue.push(item);
          if (!processing) processQueue();
        }, backoff);

        // Update Turso status
        const c = turso.getClient();
        if (c) {
          await c.execute({
            sql: 'UPDATE queue_items SET status = ?, attempts = ?, error = ? WHERE id = ?',
            args: ['pending_sync', item.attempts, err.message, item.id],
          }).catch(() => {});
        }
      }
    }
  }

  processing = false;
}

function getSupabaseClient() {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('Supabase not configured');
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

async function persistDLQ(item, error) {
  try {
    const tursoClient = turso.getClient();
    if (tursoClient) {
      await tursoClient.execute({
        sql: `INSERT INTO dlq_items (id, type, table_name, record_id, data, operation, attempts, error, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO NOTHING`,
        args: [item.id, item.type, item.table, item.recordId, item.data, item.operation, item.attempts, error, item.created_at],
      });
    }
  } catch (e) { /* DLQ persistence failure is non-fatal */ }
}

async function retryDLQ(itemId) {
  const idx = dlq.findIndex(i => i.id === itemId);
  if (idx === -1) return false;
  const item = dlq.splice(idx, 1)[0];
  item.attempts = 0;
  item.status = 'pending_sync';
  item.error = null;
  queue.push(item);
  if (!processing) processQueue();
  return true;
}

async function retryAllDLQ() {
  while (dlq.length > 0) {
    const item = dlq.shift();
    item.attempts = 0;
    item.status = 'pending_sync';
    item.error = null;
    queue.push(item);
  }
  if (!processing) processQueue();
  return dlq.length;
}

async function getQueueStatus() {
  return {
    active: queue.filter(i => i.status === 'pending_sync' || i.status === 'in_progress').length,
    completed: queue.filter(i => i.status === 'completed').length,
    deadLetter: dlq.length,
    dlqItems: dlq.map(i => ({ id: i.id, table: i.table, recordId: i.recordId, operation: i.operation, attempts: i.attempts, error: i.error, created_at: i.created_at })),
  };
}

async function ensureQueueTables() {
  const c = turso.getClient();
  if (!c) return;
  try {
    await c.execute(`CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY, type TEXT, table_name TEXT, record_id TEXT, data TEXT,
      operation TEXT, attempts INTEGER DEFAULT 0, status TEXT DEFAULT 'pending_sync',
      error TEXT, created_at TEXT
    )`);
    await c.execute(`CREATE TABLE IF NOT EXISTS dlq_items (
      id TEXT PRIMARY KEY, type TEXT, table_name TEXT, record_id TEXT, data TEXT,
      operation TEXT, attempts INTEGER DEFAULT 0, error TEXT, created_at TEXT
    )`);
  } catch (err) {
    console.error('[QUEUE] ensureQueueTables error:', err.message);
  }
}

// Recover pending items from Turso on startup
async function recoverPending() {
  const c = turso.getClient();
  if (!c) return;
  try {
    const result = await c.execute({
      sql: "SELECT * FROM queue_items WHERE status = 'pending_sync'",
    });
    for (const row of result.rows) {
      queue.push({
        id: row.id,
        type: row.type,
        table: row.table_name,
        recordId: row.record_id,
        data: row.data,
        operation: row.operation,
        attempts: Number(row.attempts) || 0,
        status: 'pending_sync',
        error: row.error,
        created_at: row.created_at,
      });
    }
    if (result.rows.length > 0 && !processing) {
      processQueue();
    }
  } catch (err) {
    console.warn('[QUEUE] Recover error:', err.message);
  }
}

module.exports = {
  enqueue, processQueue, retryDLQ, retryAllDLQ, getQueueStatus,
  ensureQueueTables, recoverPending,
};
