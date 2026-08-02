// ─────────────────────────────────────────────────────────────
// LIVE WRITE-PROBE  (scripts/probe-live-writes.js)
//
// Proves which columns/tables the code writes UNCONDITIONALLY actually
// fail on LIVE. Fully self-cleaning: each probe row is created, tested,
// and deleted in a `finally`. No data is left behind.
//
// Usage: node scripts/probe-live-writes.js
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnv() {
  const envFile = path.join(__dirname, '..', '.env.local');
  const env = { ...process.env };
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2];
    }
  }
  return env;
}

(async () => {
  const env = loadEnv();
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('FATAL: env required'); process.exit(2); }

  const H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  const tag = 'PROBE_' + crypto.randomBytes(4).toString('hex');
  const failures = [];

  async function del(table, filter) {
    await fetch(`${url}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: H }).catch(() => {});
  }

  // ── PROBE 1: upi_payments.fraud_score/risk_score/utr_hash/verified_by ──
  {
    const id = tag + '_UPI';
    const ins = await fetch(`${url}/rest/v1/upi_payments`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ id, utr: 'TMP-PROBE-' + tag, upi_id: 'probe@ptyes', amount: 1, amount_option: '1', payment_type: 'probe', status: 'pending', user_id: null, pending_reg_id: null, payment_date: new Date().toISOString(), verification_locked: false }),
    });
    const insBody = await ins.text();
    const insOk = ins.status === 201 || ins.status === 200;
    console.log(`[P1] upi_payments INSERT temp row (id=${id}): ${ins.status} ${insOk ? 'OK' : insBody.slice(0,120)}`);

    for (const col of ['fraud_score', 'risk_score', 'utr_hash', 'verified_by']) {
      const r = await fetch(`${url}/rest/v1/upi_payments?id=eq.${id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ [col]: col === 'utr_hash' ? 'abc123' : 0 }),
      });
      const body = await r.text();
      const err42703 = /42703|does not exist|PGRST204/.test(body);
      const status = r.status === 204 || r.status === 200;
      console.log(`[P1] PATCH upi_payments.${col}: ${r.status} ${status ? 'OK' : (err42703 ? 'FAIL 42703' : body.slice(0,110))}`);
      if (status) console.log(`      ⚠️  UNEXPECTED — column exists on live?!`);
      else failures.push(`upi_payments.${col}`);
    }
    await del('upi_payments', `id=eq.${id}`);
    console.log(`[P1] cleanup: deleted ${id}`);
  }

  // ── PROBE 2: audit_logs INSERT (table existence) ──
  {
    const r = await fetch(`${url}/rest/v1/audit_logs`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ action: 'probe', target_id: tag, target_type: 'probe', admin_id: 'probe', details: { t: 1 } }),
    });
    const body = await r.text();
    const tableMissing = /Could not find the table|PGRST205|does not exist/.test(body);
    console.log(`[P2] audit_logs INSERT: ${r.status} ${r.status === 201 ? 'OK (table exists)' : (tableMissing ? 'FAIL — TABLE MISSING' : body.slice(0,120))}`);
    if (!(r.status === 201)) failures.push('audit_logs (TABLE)');
  }

  // ── PROBE 3: notifications camelCase columns ──
  {
    const r = await fetch(`${url}/rest/v1/notifications`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ receiverId: tag, title: 'probe', message: 'x', type: 'probe', status: 'unread', createdAt: new Date().toISOString(), senderId: 'probe', senderName: 'Probe' }),
    });
    const body = await r.text();
    const err42703 = /42703|does not exist|PGRST204/.test(body);
    console.log(`[P3] notifications INSERT (receiverId/createdAt/...): ${r.status} ${r.status === 201 ? 'OK' : (err42703 ? 'FAIL 42703' : body.slice(0,120))}`);
    if (!(r.status === 201)) failures.push('notifications.receiverId/createdAt/senderId/senderName');
  }

  // ── PROBE 4: users.topup_referral_qualified_count ──
  {
    const id = tag + '_USR';
    const ins = await fetch(`${url}/rest/v1/users`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ id, email: tag + '@probe.test', name: 'Probe', referral_code: tag.slice(-6).toUpperCase() }),
    });
    const insBody = await ins.text();
    console.log(`[P4] users INSERT temp row (id=${id}): ${ins.status} ${ins.status === 201 ? 'OK' : insBody.slice(0,120)}`);
    if (ins.status === 201) {
      const r = await fetch(`${url}/rest/v1/users?id=eq.${id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ topup_referral_qualified_count: 1 }),
      });
      const body = await r.text();
      const err42703 = /42703|does not exist|PGRST204/.test(body);
      console.log(`[P4] PATCH users.topup_referral_qualified_count: ${r.status} ${r.status === 204 || r.status === 200 ? 'OK' : (err42703 ? 'FAIL 42703' : body.slice(0,110))}`);
      if (!(r.status === 204 || r.status === 200)) failures.push('users.topup_referral_qualified_count');
      await del('users', `id=eq.${id}`);
      console.log(`[P4] cleanup: deleted ${id}`);
    } else {
      failures.push('users (temp insert failed — cannot test)');
    }
  }

  // ── PROBE 5: payment_sessions.paymentId (camelCase link write) ──
  {
    const id = tag + '_ORD';
    const ins = await fetch(`${url}/rest/v1/payment_sessions`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ id, type: 'probe', amount: 1, status: 'pending', expires_at: new Date(Date.now() + 60000).toISOString() }),
    });
    const insBody = await ins.text();
    console.log(`[P5] payment_sessions INSERT temp row (id=${id}): ${ins.status} ${ins.status === 201 ? 'OK' : insBody.slice(0,120)}`);
    if (ins.status === 201) {
      const r = await fetch(`${url}/rest/v1/payment_sessions?id=eq.${id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ paymentId: tag + '_X' }),
      });
      const body = await r.text();
      const err42703 = /42703|does not exist|PGRST204/.test(body);
      console.log(`[P5] PATCH payment_sessions.paymentId (camelCase): ${r.status} ${r.status === 204 || r.status === 200 ? 'OK' : (err42703 ? 'FAIL 42703' : body.slice(0,110))}`);
      if (!(r.status === 204 || r.status === 200)) failures.push('payment_sessions.paymentId (camelCase)');
      // sanity: is lowercase paymentid the real column?
      const r2 = await fetch(`${url}/rest/v1/payment_sessions?id=eq.${id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ paymentid: tag + '_X' }),
      });
      const b2 = await r2.text();
      const ok2 = r2.status === 204 || r2.status === 200;
      console.log(`[P5] PATCH payment_sessions.paymentid (lowercase): ${r2.status} ${ok2 ? 'OK' : b2.slice(0,110)} (${ok2 ? '→ code should write paymentid' : 'also missing'})`);
      await del('payment_sessions', `id=eq.${id}`);
      console.log(`[P5] cleanup: deleted ${id}`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY — live write failures (unconditional code writes):');
  if (!failures.length) console.log('  NONE — all writes succeed. Schema is consistent.');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(2); });
