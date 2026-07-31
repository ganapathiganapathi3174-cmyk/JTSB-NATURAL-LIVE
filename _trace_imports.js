const fs = require('fs');
const c = fs.readFileSync('api/_paymentOrderManager.js', 'utf8');
const m = c.match(/require\(['"]([^'"]+)['"]\)/g) || [];
m.forEach(r => {
  const mod = r.replace(/require\(['"]([^'"]+)['"]\)/, '$1');
  console.log(mod);
});