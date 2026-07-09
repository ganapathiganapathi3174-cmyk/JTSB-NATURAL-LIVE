const crypto = require('crypto');
const { hashPassword, PACKAGES } = require('./_shared.js');
const { getSupabaseClient } = require('./_supabase.js');
const { encrypt } = require('./_crypto.js');

const SYSTEM_USERS = [
  {
    name: 'System ₹120',
    email: 'system120@jayaraj.in',
    phone: '9999999120',
    password: 'System@123',
    referral_code: 'SYS120',
    sponsor_code: 'SYSTEM',
    package: 120,
  },
  {
    name: 'System ₹500',
    email: 'system500@jayaraj.in',
    phone: '9999999500',
    password: 'System@123',
    referral_code: 'SYS500',
    sponsor_code: 'SYSTEM',
    package: 500,
  },
  {
    name: 'System ₹1000',
    email: 'system1000@jayaraj.in',
    phone: '9999999100',
    password: 'System@123',
    referral_code: 'SYS1000',
    sponsor_code: 'SYSTEM',
    package: 1000,
  },
];

const SYSTEM_REFERRAL_CODES = SYSTEM_USERS.map(u => u.referral_code);

function isSystemReferralCode(code) {
  return code && SYSTEM_REFERRAL_CODES.includes(code.toUpperCase());
}

function getSystemPackage(referralCode) {
  const user = SYSTEM_USERS.find(u => u.referral_code === referralCode.toUpperCase());
  return user ? user.package : null;
}

async function initSystemUsers() {
  console.log('[SYSTEM-INIT] Checking system users...');
  const supabase = getSupabaseClient();
  let created = 0;

  for (const userDef of SYSTEM_USERS) {
    const existingByCode = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', userDef.referral_code)
      .limit(1)
      .maybeSingle();

    if (existingByCode.data) {
      const existingId = existingByCode.data.id;
      // Fix encrypted email → plain text so frontend findByEmail works
      const fullRecord = await supabase.from('users').select('email,phone,password_hash,password').eq('id', existingId).maybeSingle();
      if (!fullRecord.data) { console.log('[SYSTEM-INIT] Could not fetch full record for ' + userDef.referral_code); continue; }
      const updates = {};
      // Fix encrypted email → plain text so frontend findByEmail works
      if (fullRecord.data.email && fullRecord.data.email.includes(':')) {
        console.log('[SYSTEM-INIT] Fixing encrypted email for ' + userDef.referral_code + ' (id=' + existingId + ')');
        updates.email = userDef.email.toLowerCase();
      }
      // Fix encrypted phone
      if (fullRecord.data.phone && fullRecord.data.phone.includes(':')) {
        updates.phone = userDef.phone;
      }
      // Fix missing password_hash
      if (!fullRecord.data.password_hash) {
        updates.password_hash = hashPassword(userDef.password);
      }
      // Fix missing password field (frontend login reads user.password)
      if (!fullRecord.data.password) {
        updates.password = hashPassword(userDef.password);
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('users').update(updates).eq('id', existingId);
        console.log('[SYSTEM-INIT] Fixed ' + Object.keys(updates).join(',') + ' for ' + userDef.referral_code);
      }
      console.log('[SYSTEM-INIT] User ' + userDef.referral_code + ' already exists (id=' + existingId + '), skipping');
      continue;
    }

    let existingByEmailHash = null;
    try {
      existingByEmailHash = await supabase
        .from('users')
        .select('id')
        .eq('email_hash', crypto.createHash('sha256').update(userDef.email.toLowerCase().trim()).digest('hex'))
        .limit(1)
        .maybeSingle();
    } catch (_) { /* email_hash column may not exist */ }

    if (existingByEmailHash?.data) {
      console.log('[SYSTEM-INIT] User ' + userDef.email + ' already exists by email hash (id=' + existingByEmailHash.data.id + '), skipping');
      continue;
    }

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    const userData = {
      id: userId,
      email: userDef.email.toLowerCase(),
      name: userDef.name,
      phone: userDef.phone,
      password_hash: hashPassword(userDef.password),
      password: hashPassword(userDef.password),
      referral_code: userDef.referral_code,
      referred_by: userDef.sponsor_code,
      account_status: 'active',
      payment_status: 'success',
      approved: true,
      active: true,
      membership_paid: true,
      membership_type: String(userDef.package),
      // is_system_user omitted — column may not exist in deployed schema
      referrals_count: 0,
      total_referral_count: 0,
      referral_limit_reached: false,
      referral_active: true,
      is_qualified: false,
      joined_date: now,
      approved_date: now,
      // email_hash and phone_hash omitted — column may not exist in deployed schema;
      // findUserByEmail/Phone both have fallback scan logic that works without them
    };

    const { error: insertError } = await supabase.from('users').insert(userData);
    if (insertError) {
      console.error('[SYSTEM-INIT] Failed to create user ' + userDef.referral_code + ': ' + insertError.message);
      continue;
    }

    await supabase.from('wallet_balances').insert({
      id: userId,
      balance: 0,
      total_earned: 0,
      total_withdrawn: 0,
    });

    console.log('[SYSTEM-INIT] Created user ' + userDef.referral_code + ' (package=₹' + userDef.package + ', id=' + userId + ')');
    created++;
  }

  if (created > 0) {
    console.log('[SYSTEM-INIT] Created ' + created + ' system user(s)');
  } else {
    console.log('[SYSTEM-INIT] All system users already exist, no action taken');
  }

  return created;
}

module.exports = { initSystemUsers, SYSTEM_USERS, SYSTEM_REFERRAL_CODES, isSystemReferralCode, getSystemPackage };
