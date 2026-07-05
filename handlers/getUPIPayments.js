const { COL_UPI_PAYMENTS, COL_USERS, COL_PENDING_REGS } = require('../api/_shared.js');
const { runQuery } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    const { type, status, search } = req.body || {};
    const filters = [];
    if (type) filters.push({ field: 'payment_type', op: 'EQUAL', value: type });
    if (status) filters.push({ field: 'status', op: 'EQUAL', value: status });
    if (search) {
      const docs = await runQuery(COL_UPI_PAYMENTS, filters, { orderBy: 'created_at', ascending: false, limit: 200 });
      const q = search.toLowerCase();
      const filtered = docs.filter(d =>
        (d.utr && d.utr.toLowerCase().includes(q)) ||
        (d.upi_id && d.upi_id.toLowerCase().includes(q))
      );
      const enriched = await enrichWithUserInfo(filtered);
      const mapped = mapFields(enriched);
      res.writeHead(200); res.end(JSON.stringify(mapped)); return;
    }
    const docs = await runQuery(COL_UPI_PAYMENTS, filters, { orderBy: 'created_at', ascending: false, limit: 200 });
    const enriched = await enrichWithUserInfo(docs);
    const mapped = mapFields(enriched);
    res.writeHead(200); res.end(JSON.stringify(mapped));
  } catch (err) {
    console.error('[getUPIPayments] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};

function mapFields(payments) {
  return payments.map(p => {
    const ocr = p.ocr_result || {};
    return {
      paymentId: p.id,
      userId: p.user_id,
      pendingRegId: p.pending_reg_id,
      fullName: p._userName || (p.pendingRegId ? null : null),
      userEmail: p._userEmail || '',
      userMobile: p._userPhone || '',
      amount: p.amount,
      utr: p.utr,
      upiId: p.upi_id,
      screenshotUrl: p.screenshot_url,
      status: p.status,
      verificationReason: (p.rejection_reasons && Array.isArray(p.rejection_reasons))
        ? p.rejection_reasons.join('; ')
        : (p.rejection_reasons ? String(p.rejection_reasons) : ''),
      rejection_reasons: p.rejection_reasons,
      paymentType: p.payment_type,
      paymentDate: p.payment_date,
      createdAt: p.created_at,
      verifiedAt: p.verified_at,
      userName: p._userName,
      userEmail: p._userEmail,
      userPhone: p._userPhone,
      screenshot_url: p.screenshot_url,
      created_at: p.created_at,
      status: p.status,
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
      matchedAmount: p.matched_amount !== undefined ? p.matched_amount : null,
      matchedReceiver: p.matched_receiver !== undefined ? p.matched_receiver : null,
      matchedUtr: p.matched_utr !== undefined ? p.matched_utr : null,
      matchedDate: p.matched_date !== undefined ? p.matched_date : null,
      matchedStatus: p.matched_status !== undefined ? p.matched_status : null,
      final_score: p.final_score || null,
      fraud_score: p.fraud_score || null,
      verificationResult: p.verification_result || null,
      rawText: ocr.rawText || ocr.ocrText || '',
      wordCount: ocr.wordCount || 0,
      fieldCount: ocr.fieldCount || 0,
    };
  });
}

async function enrichWithUserInfo(payments) {
  if (!payments.length) return payments;

  // Collect lookup IDs from both user_id and pending_reg_id
  const lookupIds = [];
  for (const p of payments) {
    if (p.user_id) lookupIds.push({ type: 'user', id: p.user_id });
    if (p.pending_reg_id) lookupIds.push({ type: 'pending_reg', id: p.pending_reg_id });
  }
  if (!lookupIds.length) return payments;

  // Batch fetch all referenced users and pending registrations
  const userIds = [...new Set(lookupIds.filter(l => l.type === 'user').map(l => l.id))];
  const pendingRegIds = [...new Set(lookupIds.filter(l => l.type === 'pending_reg').map(l => l.id))];

  const [users, pendingRegs] = await Promise.all([
    userIds.length ? runQuery(COL_USERS, [{ field: 'id', op: 'IN', value: userIds }], { limit: 200 }) : Promise.resolve([]),
    pendingRegIds.length ? runQuery(COL_PENDING_REGS, [{ field: 'id', op: 'IN', value: pendingRegIds }], { limit: 200 }) : Promise.resolve([]),
  ]);

  const userMap = {};
  users.forEach(u => { if (u) userMap['user:' + u.id] = u; });
  pendingRegs.forEach(p => { if (p) userMap['pending_reg:' + p.id] = p; });

  return payments.map(p => {
    let info = null;
    if (p.user_id) info = userMap['user:' + p.user_id];
    if (!info && p.pending_reg_id) info = userMap['pending_reg:' + p.pending_reg_id];
    if (!info && p.user_id) info = userMap['user:' + p.user_id] || null;
    return {
      ...p,
      _userName: info?.name || 'User Not Found',
      _userEmail: info?.email || '',
      _userPhone: info?.phone || '',
    };
  });
}
