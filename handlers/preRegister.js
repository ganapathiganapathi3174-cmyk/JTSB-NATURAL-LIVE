const { COL_PENDING_REGS, COL_USERS, hashPassword, isSystemReferralCode, getPackageByReferral, getReferrerPackage, validatePackageAmount } = require('../api/_shared.js');
const { addDoc, writeDoc, findUserByEmail, findUserByPhone, findUserBySponsorCode, getDoc, runQuery, deleteDoc } = require('../api/_supabase.js');

// OCR is NOT imported here — preRegister never triggers OCR (Requirement #4)
// OCR runs ONLY when user uploads payment proof via submitPaymentProof

module.exports = async (req, res) => {
  const reqStart = Date.now();
  const LOG = (msg) => console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] [preRegister] ${msg}`);
  const STEP = (n, msg) => console.log(`[preRegister] Step ${n}: ${msg} — +${Date.now() - reqStart}ms`);
  
  // Wrapper that measures every async operation and flags >2s queries
  async function MEASURE(label, fn, file, func, line) {
    LOG(`Before ${label}`);
    const t0 = Date.now();
    try {
      const result = await fn();
      const elapsed = Date.now() - t0;
      LOG(`After ${label} — ${elapsed}ms`);
      if (elapsed > 2000) {
        console.log(`[preRegister SLOW QUERY] ⚠️ "${label}" took ${elapsed}ms (exceeds 2s)`);
        console.log(`  File: ${file || 'handlers/preRegister.js'}, Function: ${func || 'module.exports'}, Line: ${line || 'N/A'}, Execution Time: ${elapsed}ms`);
      }
      return result;
    } catch (err) {
      const elapsed = Date.now() - t0;
      LOG(`ERROR in "${label}" at +${elapsed}ms: ${err.message}`);
      console.error(err.stack);
      throw err;
    }
  }

  try {
    console.log(`[preRegister] ==================== START ====================`);
    STEP(1, 'Request received — parsing body');

    const { name, email, phone, password, referralCode } = req.body || {};

    // Step 1: Validate Form
    STEP(2, 'Validating form fields');
    const errors = [];
    if (!name || !name.trim()) errors.push('Name is required');
    else if (['unknown', 'undefined', 'null'].includes(name.trim().toLowerCase())) errors.push('Invalid name value');
    if (!email || !email.trim()) errors.push('Email is required');
    else if (['unknown', 'undefined', 'null'].includes(email.trim().toLowerCase())) errors.push('Invalid email value');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('Invalid email format');
    if (!phone || !phone.trim()) errors.push('Phone is required');
    else if (['unknown', 'undefined', 'null'].includes(phone.trim().toLowerCase())) errors.push('Invalid phone value');
    if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
    const refCode = referralCode && referralCode.trim() ? referralCode.trim().toUpperCase() : null;
    if (errors.length) {
      res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') }));
      LOG(`Response: validation error — total ${Date.now() - reqStart}ms`);
      return;
    }
    STEP(2, 'Form validation passed ✓');

    // Step 2-4: Run ALL independent DB queries in ONE PARALLEL BATCH
    // (email lookup, phone lookup, referral lookup, pending-email, pending-phone).
    // These queries are fully independent — running them together collapses 5
    // sequential round trips into a single latency window. On a high-latency
    // Supabase connection (~400-1200ms RTT each) this is what keeps the whole
    // registration under the gateway timeout instead of exceeding it.
    STEP(3, 'Before parallel DB queries — checking email/phone/referral/pending');
    const normalizedEmail = email.toLowerCase().trim();
    const [existingEmailUser, existingPhoneUser, refUser, existingEmailPending, existingPhonePending] = await Promise.all([
      MEASURE('findUserByEmail', () => findUserByEmail(email), 'handlers/preRegister.js', 'module.exports', 58).catch(() => null),
      MEASURE('findUserByPhone', () => findUserByPhone(phone), 'handlers/preRegister.js', 'module.exports', 73).catch(() => null),
      refCode
        ? MEASURE('findUserBySponsorCode', () => findUserBySponsorCode(refCode), 'handlers/preRegister.js', 'module.exports', 90).catch(() => null)
        : Promise.resolve(null),
      MEASURE(
        'findPendingEmail',
        () => runQuery(COL_PENDING_REGS, [{ field: 'email', op: 'EQUAL', value: normalizedEmail }], { limit: 1 }),
        'handlers/preRegister.js', 'module.exports', 64
      ).catch((e) => { LOG('Email duplicate query failed: ' + (e?.message || e)); return []; }),
      MEASURE(
        'findPendingPhone',
        () => runQuery(COL_PENDING_REGS, [{ field: 'phone', op: 'EQUAL', value: phone.trim() }], { limit: 1 }),
        'handlers/preRegister.js', 'module.exports', 79
      ).catch((e) => { LOG('Phone duplicate query failed: ' + (e?.message || e)); return []; }),
    ]);
    STEP(3, 'After parallel DB queries — email/phone/referral/pending checked');

    // Email duplicate check
    if (existingEmailUser) {
      const uEmailRaw = (existingEmailUser.email || '').toLowerCase().trim();
      if (uEmailRaw === normalizedEmail) {
        res.writeHead(409); res.end(JSON.stringify({ error: 'Email already registered. Please login.' }));
        LOG(`Response: email exists in users table — total ${Date.now() - reqStart}ms`);
        return;
      }
    }
    if (existingEmailPending && existingEmailPending.length > 0) {
      const pend = existingEmailPending[0];
      if (pend.user_id) {
        try {
          const owner = await getDoc(COL_USERS, pend.user_id);
          if (owner) {
            const oEmailRaw = (owner.email || '').toLowerCase().trim();
            if (oEmailRaw === normalizedEmail) {
              res.writeHead(409); res.end(JSON.stringify({ error: 'Email already registered. Please login.' }));
              LOG(`Response: email exists in users via pending_reg — total ${Date.now() - reqStart}ms`);
              return;
            }
          }
        } catch (e) { LOG(`Owner fetch failed for pending_reg ${pend.id}: ${e.message}`); }
        try {
          await deleteDoc(COL_PENDING_REGS, pend.id);
          LOG(`Cleaned up stale pending_registration ${pend.id} for email ${email}`);
        } catch (e) { LOG(`Stale pending_reg cleanup failed for email ${email}: ${e.message}`); }
      } else {
        const realUser = await findUserByEmail(email).catch(() => null);
        if (realUser) {
          res.writeHead(409); res.end(JSON.stringify({ error: 'Email already registered. Please login.' }));
          LOG(`Response: email exists in users table (pending_reg has no user_id) — total ${Date.now() - reqStart}ms`);
          return;
        }
        try {
          await deleteDoc(COL_PENDING_REGS, pend.id);
          LOG(`Cleaned up orphaned pending_registration ${pend.id} (no user_id, user deleted) for email ${email}`);
        } catch (e) { LOG(`Orphaned pending_reg cleanup failed for email ${email}: ${e.message}`); }
      }
    }

    // Phone duplicate check
    if (existingPhoneUser) {
      const uPhoneRaw = (existingPhoneUser.phone || '').trim();
      if (uPhoneRaw === phone.trim()) {
        res.writeHead(409); res.end(JSON.stringify({ error: 'Phone already registered. Please login.' }));
        LOG(`Response: phone exists in users table — total ${Date.now() - reqStart}ms`);
        return;
      }
    }
    if (existingPhonePending && existingPhonePending.length > 0) {
      const pend = existingPhonePending[0];
      if (pend.user_id) {
        try {
          const owner = await getDoc(COL_USERS, pend.user_id);
          if (owner) {
            const oPhoneRaw = (owner.phone || '').trim();
            if (oPhoneRaw === phone.trim()) {
              res.writeHead(409); res.end(JSON.stringify({ error: 'Phone already registered. Please login.' }));
              LOG(`Response: phone exists in users via pending_reg — total ${Date.now() - reqStart}ms`);
              return;
            }
          }
        } catch (e) { LOG(`Owner fetch failed for pending_reg ${pend.id}: ${e.message}`); }
        try {
          await deleteDoc(COL_PENDING_REGS, pend.id);
          LOG(`Cleaned up stale pending_registration ${pend.id} for phone ${phone}`);
        } catch (e) { LOG(`Stale pending_reg cleanup failed for phone ${phone}: ${e.message}`); }
      } else {
        const realUser = await findUserByPhone(phone).catch(() => null);
        if (realUser) {
          res.writeHead(409); res.end(JSON.stringify({ error: 'Phone already registered. Please login.' }));
          LOG(`Response: phone exists in users table (pending_reg has no user_id) — total ${Date.now() - reqStart}ms`);
          return;
        }
        try {
          await deleteDoc(COL_PENDING_REGS, pend.id);
          LOG(`Cleaned up orphaned pending_registration ${pend.id} (no user_id, user deleted) for phone ${phone}`);
        } catch (e) { LOG(`Orphaned pending_reg cleanup failed for phone ${phone}: ${e.message}`); }
      }
    }

    // Referral code validation
    let referrer = null;
    if (refCode) {
      referrer = refUser;

      if (referrer && referrer.referral_active === false && !isSystemReferralCode(referrer.referral_code)) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'This referral link is currently inactive. Please contact the owner or administrator.' }));
        LOG(`Response: referral inactive — total ${Date.now() - reqStart}ms`);
        return;
      }
      if (referrer && referrer.referral_limit_reached && !isSystemReferralCode(referrer.referral_code)) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'You have reached your maximum referral limit.' }));
        LOG(`Response: referral limit reached — total ${Date.now() - reqStart}ms`);
        return;
      }
    }
    STEP(5, 'Sponsor validation passed ✓');

    // Step 5: Determine allowed package from referral chain
    STEP(5.5, 'Determining allowed package');
    let allowedPackage = null;
    if (refCode && referrer) {
      const userPkg = getReferrerPackage(referrer);
      if (userPkg) {
        allowedPackage = userPkg;
      } else {
        const sysPkg = getPackageByReferral(refCode);
        if (sysPkg) allowedPackage = sysPkg;
      }
    }
    LOG('Allowed package: ' + (allowedPackage || 'any (no referral or no package constraint)'));

    // Step 6: Create Pending User (DB insert)
    STEP(6, 'Before Database Insert — creating pending registration');
    const pendingReg = await MEASURE(
      'addDoc(pending_registrations)',
      () => addDoc(COL_PENDING_REGS, {
        name: name.trim(), email: email.toLowerCase().trim(), phone: phone.trim(),
        password_hash: hashPassword(password), referral_code: refCode,
      }),
      'handlers/preRegister.js', 'module.exports', 113
    );
    STEP(6, 'After Database Insert — pending reg created ✓');

    // Step 6b: Payment Order Creation is deferred to frontend
    // Frontend calls POST /api/createPaymentOrder after amount selection
    // This is by design — payment amount depends on user's plan selection
    STEP(7, 'Payment order creation — deferred to frontend');
    LOG('Payment order is created by frontend via createPaymentOrder endpoint');

    // Step 7: Return Success with allowed package info
    const totalMs = Date.now() - reqStart;
    STEP(8, `Returning success — total ${totalMs}ms`);
    if (totalMs > 2000) {
      console.log(`[preRegister SLOW QUERY] ⚠️ Total took ${totalMs}ms (exceeds 2s)`);
      console.log(`  File: handlers/preRegister.js, Function: module.exports, Line: 136, Execution Time: ${totalMs}ms`);
    }
    res.writeHead(200); res.end(JSON.stringify({
      pendingRegId: pendingReg.id,
      referrer: referrer ? { name: referrer.name, code: referrer.referral_code } : null,
      allowedPackage: allowedPackage ? parseInt(allowedPackage) : null,
    }));
    LOG(`Response sent — total ${Date.now() - reqStart}ms`);
    console.log(`[preRegister] ==================== END (${totalMs}ms) ====================`);

  } catch (err) {
    const totalMs = Date.now() - reqStart;
    console.log(`[preRegister] ==================== ERROR at +${totalMs}ms ====================`);
    console.error(`[preRegister ERROR] ${err.message}`);
    console.error(err.stack);
    if (!res.headersSent) {
      res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
    }
    LOG(`Error response sent — total ${totalMs}ms`);
  }
};
