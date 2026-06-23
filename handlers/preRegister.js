const { COL_USERS, COL_UNIQUES, COL_PENDING_REGS, randomString, hashPassword } = require('../_shared.js');
const { runQuery, addDoc, writeDoc } = require('../_supabase.js');

module.exports = async (req, res) => {
  try {
    const { name, email, phone, password, referralCode } = req.body || {};

    const errors = [];
    if (!name || !name.trim()) errors.push('Name is required');
    if (!email || !email.trim()) errors.push('Email is required');
    if (!phone || !phone.trim()) errors.push('Phone is required');
    if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
    const refCode = referralCode && referralCode.trim() ? referralCode.trim().toUpperCase() : null;
    if (errors.length) { res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') })); return; }

    const existingEmail = await runQuery(COL_USERS, [{ field: 'email', op: 'EQUAL', value: email.toLowerCase().trim() }]);
    if (existingEmail.length) { res.writeHead(409); res.end(JSON.stringify({ error: 'Email already registered. Please login.' })); return; }

    const existingPhone = await runQuery(COL_USERS, [{ field: 'phone', op: 'EQUAL', value: phone.trim() }]);
    if (existingPhone.length) { res.writeHead(409); res.end(JSON.stringify({ error: 'Phone already registered. Please login.' })); return; }

    let referrer = null;
    if (refCode) {
      const refs = await runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode }]);
      if (refs.length) referrer = refs[0];
    }

    const pendingReg = await addDoc(COL_PENDING_REGS, {
      name: name.trim(), email: email.toLowerCase().trim(), phone: phone.trim(),
      password_hash: hashPassword(password), referral_code: refCode,
    });

    res.writeHead(200); res.end(JSON.stringify({ pendingRegId: pendingReg.id, referrer: referrer ? { name: referrer.name, code: referrer.referral_code } : null }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
