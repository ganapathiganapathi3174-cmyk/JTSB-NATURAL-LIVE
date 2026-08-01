const Jimp = require('jimp');
const { Jimp: JimpClass } = Jimp;
const path = require('path');

const FONT_DIR = path.join(__dirname, '..', 'node_modules', '@jimp', 'plugin-print', 'dist', 'fonts', 'open-sans');
const fontCache = {};
async function font(size, style) {
  const key = size + '_' + style;
  if (fontCache[key]) return fontCache[key];
  fontCache[key] = await Jimp.loadFont(path.join(FONT_DIR, 'open-sans-' + size + '-' + style, 'open-sans-' + size + '-' + style + '.fnt'));
  return fontCache[key];
}

function pad(n) { return String(n).padStart(2, '0'); }

async function genPhonePeScreenshot(opts) {
  const o = Object.assign({
    amount: '120.00',
    utr: '1234567892222',
    upi: 'jayarajj126-3@okicici',
    name: 'JEYARAJ ALAGAR',
    date: null,
    time: '10:45 AM',
    status: 'SUCCESS',
    width: 720,
    height: 1280,
  }, opts || {});

  const W = o.width, H = o.height;
  const img = new JimpClass({ width: W, height: H, color: 0xffffffff });

  const today = o.date || new Date();
  const dateStr = typeof today === 'string' ? today : (pad(today.getDate()) + '/' + pad(today.getMonth() + 1) + '/' + today.getFullYear());

  const fTitle = await font(64, 'black');
  const fBody = await font(32, 'black');

  let y = 60;
  img.print({ font: fTitle, x: 60, y: y, text: 'Payment Successful' }); y += 120;
  y += 30;
  img.print({ font: fBody, x: 60, y: y, text: 'Amount Paid: Rs.' + o.amount }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'Paid to: ' + o.name }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'UPI ID: ' + o.upi }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'UTR No: ' + o.utr }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'Date: ' + dateStr }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'Time: ' + o.time }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'Status: ' + o.status }); y += 60;
  img.print({ font: fBody, x: 60, y: y, text: 'Transaction successful via PhonePe' });

  const buf = await img.getBuffer('image/png');
  return {
    buffer: buf,
    dataUrl: 'data:image/png;base64,' + buf.toString('base64'),
    width: W,
    height: H,
  };
}

module.exports = { genPhonePeScreenshot, font };

if (require.main === module) {
  genPhonePeScreenshot().then(s => {
    const fs = require('fs');
    const out = path.join(__dirname, '..', 'tests', 'synthetic_screenshot.png');
    fs.writeFileSync(out, s.buffer);
    console.log('Wrote', out, s.buffer.length, 'bytes', s.width + 'x' + s.height);
  }).catch(e => { console.error('ERR', e); process.exit(1); });
}
