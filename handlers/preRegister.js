const { COL_USERS, COL_UNIQUES, COL_PENDING_REGS, randomString, hashPassword } = require('../api/_shared.js');
const { runQuery, runQueryDecrypted, addDoc, writeDoc } = require('../api/_supabase.js');

module.exports = async (req, res) => {
  try {
    const { name, email, phone, password, referralCode } = req.body || {};

    const errors = [];
    if (!name || !name.trim()) errors.push('Name is required');
    else if (['unknown', 'undefined', 'null'].includes(name.trim().toLowerCase())) errors.push('Invalid name value');
    if (!email || !email.trim()) errors.push('Email is required');
    else if (['unknown', 'undefined', 'null'].includes(email.trim().toLowerCase())) errors.push('Invalid email value');
    if (!phone || !phone.trim()) errors.push('Phone is required');
    else if (['unknown', 'undefined', 'null'].includes(phone.trim().toLowerCase())) errors.push('Invalid phone value');
    if (!password || password.length < 6) errors.push('Password must be at least 6 characters');
    const refCode = referralCode && referralCode.trim() ? referralCode.trim().toUpperCase() : null;
    if (errors.length) { res.writeHead(400); res.end(JSON.stringify({ error: errors.join('. ') })); return; }

    const [existingEmail, existingPhone, refMatches] = await Promise.all([
      runQueryDecrypted(COL_USERS, [{ field: 'email', op: 'EQUAL', value: email.toLowerCase().trim() }]),
      runQueryDecrypted(COL_USERS, [{ field: 'phone', op: 'EQUAL', value: phone.trim() }]),
      refCode ? runQuery(COL_USERS, [{ field: 'referral_code', op: 'EQUAL', value: refCode }]) : Promise.resolve([]),
    ]);
    if (existingEmail.length) { res.writeHead(409); res.end(JSON.stringify({ error: 'Email already registered. Please login.' })); return; }
    if (existingPhone.length) { res.writeHead(409); res.end(JSON.stringify({ error: 'Phone already registered. Please login.' })); return; }
    const referrer = refMatches.length ? refMatches[0] : null;

    const pendingReg = await addDoc(COL_PENDING_REGS, {
      name: name.trim(), email: email.toLowerCase().trim(), phone: phone.trim(),
      password_hash: hashPassword(password), referral_code: refCode,
    });

    res.writeHead(200); res.end(JSON.stringify({ pendingRegId: pendingReg.id, referrer: referrer ? { name: referrer.name, code: referrer.referral_code } : null }));
  } catch (err) {
    console.error('[preRegister] Error:', err.message);
    res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
