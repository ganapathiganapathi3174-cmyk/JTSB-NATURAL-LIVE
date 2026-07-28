const { getSupabaseClient } = require('../api/_supabase.js');
const { hashPassword } = require('../api/_shared.js');

module.exports = async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const systemEmails = ['system120@jayaraj.in', 'system500@jayaraj.in', 'system1000@jayaraj.in'];
    const systemPhones = ['9999999120', '9999999500', '9999999100'];
    const systemPassword = 'System@123';
    const hashed = hashPassword(systemPassword);
    let fixed = 0;

    for (let i = 0; i < systemEmails.length; i++) {
      const referralCode = ['SYS120', 'SYS500', 'SYS1000'][i];
      const { data: users } = await supabase.from('users').select('id,email,phone,password_hash').eq('referral_code', referralCode).limit(1);
      if (!users || users.length === 0) continue;

      const user = users[0];
      const updates = {};

      // Fix encrypted email → plain text
      if (user.email && user.email.includes(':')) {
        updates.email = systemEmails[i];
      }

      // Fix encrypted phone
      if (user.phone && user.phone.includes(':')) {
        updates.phone = systemPhones[i];
      }

      // Fix missing password_hash
      if (!user.password_hash) {
        updates.password_hash = hashed;
      }

      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('users').update(updates).eq('id', user.id);
        if (error) {
          console.error('[FIX-SYSTEM] Error updating ' + referralCode + ': ' + error.message);
        } else {
          console.log('[FIX-SYSTEM] Fixed ' + Object.keys(updates).join(',') + ' for ' + referralCode + ' (id=' + user.id + ')');
          fixed++;
        }
      }

      // Also try to set password column if it exists (separate query to handle missing column gracefully)
      try {
        await supabase.from('users').update({ password: hashed }).eq('id', user.id);
      } catch (_) { /* password column may not exist */ }
    }

    res.writeHead(200);
    res.end(JSON.stringify({ fixed, message: 'System users fixed. Try login now.' }));
  } catch (err) {
    console.error('[FIX-SYSTEM] Error: ' + err.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
