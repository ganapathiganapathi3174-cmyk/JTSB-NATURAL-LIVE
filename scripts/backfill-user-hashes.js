// Backfill email_hash / phone_hash for existing users.
//
// Prerequisite: run scripts/0001-user-hash-columns.sql in the Supabase SQL
// editor first (the script below needs the columns to exist).
//
// Usage:
//   node scripts/backfill-user-hashes.js
//
// Idempotent: only rows whose hash columns are still NULL are processed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const crypto_helper = require('../api/_crypto.js');

const ROOT = path.join(__dirname, '..');
try {
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n').forEach(l => {
    const eq = l.indexOf('=');
    if (eq <= 0) return;
    const key = l.slice(0, eq).trim();
    const val = l.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = val;
  });
} catch (_) {}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function hashEmail(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase().trim()).digest('hex');
}
function hashPhone(phone) {
  return crypto.createHash('sha256').update(String(phone).trim()).digest('hex');
}
function decrypt(value) {
  try { return crypto_helper.decrypt(value); } catch { return null; }
}

(async () => {
  console.log('[backfill-user-hashes] Starting...');
  let page = 0;
  const PAGE_SIZE = 1000;
  let totalUpdated = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, phone, email_hash, phone_hash')
      .or('email_hash.is.null,phone_hash.is.null')
      .range(from, to);

    if (error) {
      console.error('[backfill-user-hashes] Query error:', error.message);
      if (error.code === '42703' || (error.message || '').includes('does not exist')) {
        console.error('The email_hash/phone_hash columns do not exist yet.');
        console.error('Run scripts/0001-user-hash-columns.sql in the Supabase SQL editor first.');
      }
      process.exit(1);
    }

    if (!users || users.length === 0) break;

    for (const user of users) {
      const updates = {};
      if (!user.email_hash && user.email) {
        const plain = decrypt(user.email) || user.email;
        updates.email_hash = hashEmail(plain);
      }
      if (!user.phone_hash && user.phone) {
        const plain = decrypt(user.phone) || user.phone;
        updates.phone_hash = hashPhone(plain);
      }
      if (Object.keys(updates).length === 0) continue;

      const { error: updateError } = await supabase.from('users').update(updates).eq('id', user.id);
      if (updateError) {
        console.error('[backfill-user-hashes] Update error for', user.id, ':', updateError.message);
      } else {
        totalUpdated++;
      }
    }

    page++;
    console.log(`[backfill-user-hashes] Page ${page}: processed ${users.length} rows (total updated: ${totalUpdated})`);
  }

  console.log(`[backfill-user-hashes] Complete. Total updated: ${totalUpdated}`);
  process.exit(0);
})().catch(err => {
  console.error('[backfill-user-hashes] Fatal:', err.message);
  process.exit(1);
});
