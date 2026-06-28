const { spawn } = require('child_process');
const path = require('path');

const backend = spawn('node', ['api/local-dev.js'], { stdio: 'inherit', cwd: __dirname });
backend.on('error', e => { console.error('Backend failed:', e.message); process.exit(1); });

setTimeout(() => {
  const frontend = spawn('npx', ['vite', '--port', '5173', '--host'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, 'frontend'),
    shell: true,
  });
  frontend.on('error', e => { console.error('Frontend failed:', e.message); process.exit(1); });
  frontend.on('exit', code => { backend.kill(); process.exit(code); });
}, 500);

process.on('SIGINT', () => { backend.kill(); process.exit(0); });
process.on('SIGTERM', () => { backend.kill(); process.exit(0); });
