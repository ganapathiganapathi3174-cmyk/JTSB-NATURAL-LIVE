const fs = require('fs');
function traceImports(filePath, depth) {
  if (depth > 2) return;
  const c = fs.readFileSync(filePath, 'utf8');
  const m = c.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  m.forEach(r => {
    const mod = r.replace(/require\(['"](.*?)['"]\)/, '$1');
    console.log('  '.repeat(depth) + mod);
    if (mod.startsWith('./') || mod.startsWith('../')) {
      const resolved = require.resolve('./' + mod, { paths: [require('path').dirname(filePath)] });
      traceImports(resolved, depth + 1);
    }
  });
}
traceImports('api/verification7.js', 0);