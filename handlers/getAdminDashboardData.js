const { COL_USERS, COL_UPI_PAYMENTS, COL_PENDING_REGS, COL_TOPUPS, COL_SPONSOR_CLAIMS, TEST_MODE, TEST_PAYMENT_AMOUNT, TEST_UPI_ID, TEST_PAYEE_NAME } = require('../api/_shared.js');
const { runQuery, getSupabaseClient } = require('../api/_supabase.js');
const { getCompanionStatus } = require('../api/_companionAuth.js');

module.exports = async (req, res) => {
  try {
    const supabase = getSupabaseClient();

    const results = await Promise.allSettled([
      runQuery(COL_USERS, [], { orderBy: 'created_at', ascending: false, limit: 500 }),
      supabase.from(COL_TOPUPS).select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from(COL_PENDING_REGS).select('*').order('created_at', { ascending: false }).limit(500),
      runQuery(COL_UPI_PAYMENTS, [], { orderBy: 'created_at', ascending: false, limit: 500 }),
      runQuery(COL_SPONSOR_CLAIMS, [], { orderBy: 'created_at', ascending: false, limit: 200 }),
    ]);

    const diagnostics = {
      usersSuccess: results[0].status === 'fulfilled',
      topupsSuccess: results[1].status === 'fulfilled',
      pendingSuccess: results[2].status === 'fulfilled',
      paymentsSuccess: results[3].status === 'fulfilled',
      claimsSuccess: results[4].status === 'fulfilled',
      usersError: results[0].status === 'rejected' ? (results[0].reason?.message || 'unknown') : null,
      topupsError: results[1].status === 'rejected' ? (results[1].reason?.message || 'unknown') : null,
      pendingError: results[2].status === 'rejected' ? (results[2].reason?.message || 'unknown') : null,
      paymentsError: results[3].status === 'rejected' ? (results[3].reason?.message || 'unknown') : null,
      claimsError: results[4].status === 'rejected' ? (results[4].reason?.message || 'unknown') : null,
      usersCount: results[0].status === 'fulfilled' ? (results[0].value || []).length : -1,
      topupsCount: results[1].status === 'fulfilled' ? ((results[1].value || {}).data || []).length : -1,
      pendingCount: results[2].status === 'fulfilled' ? ((results[2].value || {}).data || []).length : -1,
      paymentsCount: results[3].status === 'fulfilled' ? (results[3].value || []).length : -1,
      claimsCount: results[4].status === 'fulfilled' ? (results[4].value || []).length : -1,
    };
    console.log(`[DASHBOARD] DIAGNOSTICS:`, JSON.stringify(diagnostics));

    const allSucceeded = diagnostics.usersSuccess && diagnostics.topupsSuccess && diagnostics.pendingSuccess && diagnostics.paymentsSuccess;
    if (!allSucceeded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Dashboard query failed', diagnostics }));
      return;
    }

    const users = results[0].value;
    const topupsRes = results[1].value;
    const pendingRegsRes = results[2].value;
    const upiPayments = results[3].value;
    const sponsorClaims = results[4].status === 'fulfilled' ? (results[4].value || []) : [];

    const pendingRegs = pendingRegsRes.data || [];
    const topups = topupsRes.data || [];

    // Combine users from both tables so admin sees all users
    const allUsers = [
      ...(users || []).map(u => ({ ...u, _source: 'user' })),
      ...(pendingRegs || []).map(r => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        referral_code: r.referral_code || '',
        payment_status: r.status || 'pending',
        account_status: 'inactive',
        created_at: r.created_at,
        _source: 'pending_registration',
      })),
    ];

    // Build lookup maps from combined data
    const userById = {};
    for (const u of allUsers) userById[u.id] = u;

    const userByEmail = {};
    for (const u of allUsers) { if (u.email) userByEmail[u.email.toLowerCase()] = u; }

    const regById = {};
    for (const r of pendingRegs) regById[r.id] = r;

    function lookupUser(up) {
      const lookupId = up.user_id || up.pending_reg_id;
      // 1. Primary: match userId → allUsers.id
      if (lookupId && userById[lookupId]) return userById[lookupId];
      // 2. If lookupId points to pending_registrations, try reg first
      if (lookupId && regById[lookupId]) return regById[lookupId];
      // 3. Fallback: match decrypted email to users
      if (up.email) {
        const byEmail = userByEmail[up.email.toLowerCase()];
        if (byEmail) return byEmail;
      }
      // 4. Fallback: match decrypted phone to users
      if (up.phone) {
        for (const u of allUsers) {
          if (u.phone && u.phone === up.phone) return u;
        }
      }
      return null;
    }

    // Build fallback set for payments whose user_ids are not in initial batch
    const missingIds = new Set();
    for (const up of upiPayments) {
      const lookupId = up.user_id || up.pending_reg_id;
      if (lookupId && !userById[lookupId] && !regById[lookupId]) missingIds.add(lookupId);
    }
    if (missingIds.size > 0) {
      const missingUsers = await runQuery(COL_USERS, [{ field: 'id', op: 'IN', value: Array.from(missingIds) }], { limit: 200 }).catch(() => []);
      for (const u of missingUsers) { userById[u.id] = u; userByEmail[u.email?.toLowerCase()] = u; }
      const missingRegs = await runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'IN', value: Array.from(missingIds) }], { limit: 200 }).catch(() => []);
      for (const r of missingRegs) { regById[r.id] = r; }
    }

    const pendingPayments = upiPayments.map(up => {
      const lookupId = up.user_id || up.pending_reg_id;
      const userInfo = lookupUser(up);
      if (!userInfo) {
        console.error(`[DASHBOARD] No user found for payment ${up.id} (userId: ${up.user_id}, pendingRegId: ${up.pending_reg_id})`);
      }
      let mappedStatus = up.status;
      if (mappedStatus === 'verified') mappedStatus = 'approved';
      else if (mappedStatus === 'manual_review') mappedStatus = 'manual_review';
      else if (mappedStatus !== 'rejected') mappedStatus = 'pending';

      const ocr = up.ocr_result || {};
      return {
        id: up.id,
        userId: up.user_id,
        pendingRegId: up.pending_reg_id,
        utr: up.utr,
        amount: up.amount,
        payment_type: up.payment_type,
        upi_id: up.upi_id,
        screenshot_url: up.screenshot_url,
        rejection_reasons: up.rejection_reasons,
        ocr_result: up.ocr_result,
        final_score: up.final_score,
        fraud_score: up.fraud_score || 0,
        screenshot_hash: up.screenshot_hash,
        status: up.status,
        payment_status: mappedStatus,
        created_at: up.payment_date || up.created_at,
        verified_at: up.verified_at,
        verification_duration: up.verification_duration,
        name: userInfo?.name || 'User Not Found',
        email: userInfo?.email || '',
        phone: userInfo?.phone || '',
        referral_code: userInfo?.referral_code || '',
        _source: userInfo ? (regById[lookupId] ? 'pending_registration' : 'user') : '',

        // Extracted verification display fields (from ocr_result jsonb)
        ocrConfidence: ocr.confidence || 0,
        extractedAmount: ocr.extractedAmount || null,
        extractedUtr: ocr.extractedUtr || null,
        extractedReceiverUpi: ocr.extractedReceiverUpi || null,
        extractedSenderUpi: ocr.extractedSenderUpi || null,
        extractedDate: ocr.extractedDate || null,
        extractedTime: ocr.extractedTime || null,
        extractedStatus: ocr.extractedStatus || null,
        extractedBankName: ocr.extractedBankName || null,
        extractedTxnId: ocr.extractedTxnId || null,
        receiverName: ocr.receiverName || null,
        senderName: ocr.senderName || null,
        ocrText: ocr.rawText || '',
        wordCount: ocr.wordCount || 0,
        fieldCount: ocr.fieldCount || 0,
        // Match booleans
        matchedAmount: up.matched_amount !== undefined ? up.matched_amount : null,
        matchedReceiver: up.matched_receiver !== undefined ? up.matched_receiver : null,
        matchedUtr: up.matched_utr !== undefined ? up.matched_utr : null,
        matchedDate: up.matched_date !== undefined ? up.matched_date : null,
        matchedStatus: up.matched_status !== undefined ? up.matched_status : null,
      };
    });

    console.log(`[DASHBOARD] Enriched ${pendingPayments.length} payments from ${upiPayments.length} raw rows`);

    const companionState = getCompanionStatus();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      users: allUsers,
      topups,
      pendingPayments,
      sponsorClaims,
      _diagnostics: diagnostics,
      _companion: companionState,
      _testMode: TEST_MODE ? { enabled: true, amount: TEST_PAYMENT_AMOUNT, upiId: TEST_UPI_ID, payeeName: TEST_PAYEE_NAME } : { enabled: false },
    }));
  } catch (err) {
    console.error('[getAdminDashboardData] Error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
};
