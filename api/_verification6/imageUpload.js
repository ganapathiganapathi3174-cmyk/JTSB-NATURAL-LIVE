const https = require('https');
const http = require('http');

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function upload(order, screenshotUrl, screenshotBuf) {
  const t0 = Date.now();
  let buf = screenshotBuf || null;
  let source = 'buffer';
  if (!buf && screenshotUrl) {
    buf = await fetchBuffer(screenshotUrl);
    source = 'url';
  }
  if (!buf || buf.length === 0) throw new Error('No image data');
  return { buffer: buf, size: buf.length, source, elapsed: Date.now() - t0 };
}

module.exports = { upload, fetchBuffer };
