const fs = require('fs');
const c = fs.readFileSync('api/_newEngine/index.js', 'utf8');
const regex = /require\(['"]([^'"]+)['"]\)/g;
const matches = c.match(regex) || [];
matches.forEach(m => console.log(m.replace(/require\(['"](.*?)['"]\)/, '$1')));