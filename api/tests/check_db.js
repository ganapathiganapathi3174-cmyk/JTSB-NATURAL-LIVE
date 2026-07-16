require('dotenv').config({path:require('path').join(__dirname,'..','.env.local')});
const { createClient } = require('@supabase/supabase-js');
const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
(async()=>{
  const d1 = await c.from('upi_payments').select('id,status,utr,payment_type,pending_reg_id',{count:'exact'}).order('created_at',{ascending:false}).limit(10);
  console.log('upi_payments count=' + d1.count);
  d1.data.forEach(p => console.log('  ' + p.id.slice(0,8) + ' ' + p.status + ' ' + p.utr.slice(0,12) + ' reg=' + (p.pending_reg_id ? 'yes' : 'no')));

  const d2 = await c.from('pending_registrations').select('id,name',{count:'exact'}).limit(10);
  console.log('pending_registrations count=' + d2.count);
  d2.data.forEach(r => console.log('  ' + r.id.slice(0,8) + ' ' + r.name));
})();
