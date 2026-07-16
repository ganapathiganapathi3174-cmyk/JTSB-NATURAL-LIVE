// One-time migration: backfill email_hash and phone_hash for existing users
// Run: node api/backfillHashes.js
// Requires existing encrypted email/phone columns to be decryptable via _crypto.js

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const crypto_helper = require('./_crypto.js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  global: { fetch: (...args) => fetch(...args) },
});

function decrypt(value) {
  try { return crypto_helper.decrypt(value); } catch { return null; }
}

(async () => {
  console.log('[backfillHashes] Starting...');

  let page = 0;
  const PAGE_SIZE = 1000;
  let totalUpdated = 0;
  let totalSkipped = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email, phone, email_hash, phone_hash')
      .is('email_hash', null)
      .range(from, to);

    if (error) {
      console.error(`[backfillHashes] Query error: ${error.message}`);
      process.exit(1);
    }

    if (!users || users.length === 0) break;

    for (const user of users) {
      const updates = {};
      let needsUpdate = false;

      if (!user.email_hash && user.email) {
        const decryptedEmail = decrypt(user.email);
        if (decryptedEmail) {
          updates.email_hash = crypto.createHash('sha256').update(decryptedEmail.toLowerCase().trim()).digest('hex');
          needsUpdate = true;
        }
      }
      if (!user.phone_hash && user.phone) {
        const decryptedPhone = decrypt(user.phone);
        if (decryptedPhone) {
          updates.phone_hash = crypto.createHash('sha256').update(decryptedPhone.trim()).digest('hex');
          needsUpdate = true;
        } else {
          // If phone isn't encrypted (e.g., plaintext), hash it directly
          updates.phone_hash = crypto.createHash('sha256').update(user.phone.trim()).digest('hex');
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from('users')
          .update(updates)
          .eq('id', user.id);

        if (updateError) {
          console.error(`[backfillHashes] Update error for ${user.id}: ${updateError.message}`);
        } else {
          totalUpdated++;
        }
      } else {
        totalSkipped++;
      }
    }

    page++;
    console.log(`[backfillHashes] Page ${page}: ${users.length} users processed (updated: ${totalUpdated}, skipped: ${totalSkipped})`);
  }

  console.log(`[backfillHashes] Complete. Total updated: ${totalUpdated}, Total skipped: ${totalSkipped}`);
  process.exit(0);
})().catch(err => {
  console.error(`[backfillHashes] Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
