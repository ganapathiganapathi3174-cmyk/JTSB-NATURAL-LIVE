const { COL_UPI_PAYMENTS, COL_TOPUPS, COL_VERIFICATION_LOGS, COL_PROCESSED_PAYMENTS, COL_DELETION_AUDIT_LOGS } = require('../api/_shared.js');
const { runQueryDecrypted, runQuery, deleteDoc, getDoc, addDoc } = require('../api/_supabase.js');
const r2 = require('../api/_r2.js');

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(JSON.stringify({ error: 'Method not allowed' })); return; }

    const { utr } = req.body || {};
    if (!utr) { res.writeHead(400); res.end(JSON.stringify({ error: 'UTR required' })); return; }
    if (!req.admin) { res.writeHead(401); res.end(JSON.stringify({ error: 'Authentication required' })); return; }

    const adminInfo = { adminId: req.admin.email || 'admin', adminName: req.admin.name || 'Admin' };

    const docs = await runQueryDecrypted(COL_UPI_PAYMENTS, [{ field: 'utr', op: 'EQUAL', value: utr }]);
    if (!docs.length) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'No payment found with this UTR' }));
      return;
    }

    let deletedCount = 0;
    let storageDeleted = false;
    const cascade = { topups: 0, verification_logs: 0, processed_payments: 0 };
    for (const d of docs) {
      // Delete R2 screenshot if present
      if (d.screenshot_url) {
        try {
          const r2Domain = process.env.R2_PUBLIC_DOMAIN;
          const url = d.screenshot_url;
          if (r2Domain && url.includes(r2Domain)) {
            const key = url.split('/').slice(3).join('/').split('?')[0];
            if (key) { await r2.deleteFile(key); storageDeleted = true; }
          }
        } catch {}
      }
      // Delete DB record
      await deleteDoc(COL_UPI_PAYMENTS, d.id);
      // Verify deletion
      const verify = await getDoc(COL_UPI_PAYMENTS, d.id);
      if (verify) {
        console.error(`[deleteUPIPayment] Post-delete verification FAILED for ${d.id} — record still exists`);
        continue;
      }
      deletedCount++;

      // Cascade delete related records
      const pid = d.id;
      const uid = d.user_id;
      const utrVal = d.utr;

      // 1. Delete verification_logs by payment_id
      try {
        const vlogs = await runQuery(COL_VERIFICATION_LOGS, [{ field: 'payment_id', op: 'EQUAL', value: pid }], { limit: 500 });
        for (const v of vlogs) {
          try { await deleteDoc(COL_VERIFICATION_LOGS, v.id); cascade.verification_logs++; } catch {}
        }
      } catch (e) { console.error('[deleteUPIPayment] Cascade delete verification_logs error:', e.message); }

      // 2. Delete topups by user_id + utr
      if (uid && utrVal) {
        try {
          const topups = await runQuery(COL_TOPUPS, [
            { field: 'user_id', op: 'EQUAL', value: uid },
            { field: 'utr', op: 'EQUAL', value: utrVal },
          ], { limit: 100 });
          for (const t of topups) {
            try { await deleteDoc(COL_TOPUPS, t.id); cascade.topups++; } catch {}
          }
        } catch (e) { console.error('[deleteUPIPayment] Cascade delete topups error:', e.message); }

        // 3. Delete processed_payments by user_id + utr
        try {
          const processed = await runQuery(COL_PROCESSED_PAYMENTS, [
            { field: 'user_id', op: 'EQUAL', value: uid },
            { field: 'utr', op: 'EQUAL', value: utrVal },
          ], { limit: 100 });
          for (const p of processed) {
            try { await deleteDoc(COL_PROCESSED_PAYMENTS, p.id); cascade.processed_payments++; } catch {}
          }
        } catch (e) { console.error('[deleteUPIPayment] Cascade delete processed_payments error:', e.message); }
      }
    }

    // Audit log
    try {
      const cascadeTotal = cascade.topups + cascade.verification_logs + cascade.processed_payments;
      await addDoc(COL_DELETION_AUDIT_LOGS, {
        admin_id: adminInfo.adminId,
        admin_name: adminInfo.adminName,
        deleted_record_id: utr,
        record_type: 'upi_payment',
        reason: 'Deleted via legacy deleteUPIPayment handler',
        collection: COL_UPI_PAYMENTS,
        deleted_count: deletedCount + cascadeTotal,
        deleted_at: new Date().toISOString(),
      });
    } catch {}

    res.writeHead(200); res.end(JSON.stringify({ success: true, deletedCount, storageDeleted, cascade }));
  } catch (err) {
    console.error('[deleteUPIPayment] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
