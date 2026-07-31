const fs = require('fs');
const path = require('path');
function checkNativeModules(dir, depth) {
  if (depth > 3) return;
  const files = fs.readdirSync(dir);
  files.forEach(f => {
    const fp = path.join(dir, f);
    if (f.endsWith('.node')) console.log('  '.repeat(depth) + 'NATIVE: ' + fp);
    if (f.endsWith('.js')) {
      const c = fs.readFileSync(fp, 'utf8');
      const reqs = c.match(/require\(['"]([^'"]+)['"]\)/g) || [];
      reqs.forEach(r => {
        const mod = r.replace(/require\(['"](.*?)['"]\)/, '$1');
        if (!mod.startsWith('.') && !mod.startsWith('/')) {
          console.log('  '.repeat(depth) + 'DEP: ' + mod + ' (from ' + f + ')');
        }
      });
    }
  });
}
checkNativeModules('api/_newEngine', 0);