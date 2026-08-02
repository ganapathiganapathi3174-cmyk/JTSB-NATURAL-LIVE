// ─────────────────────────────────────────────────────────────
// PERCEPTUAL HASH (dHash)  (api/_newEngine/phash.js)
//
// Difference-hash: resize to 33x32, greyscale, then compare each
// pixel against its right neighbour → 1024 bits → 256-char hex.
// Robust to re-compression, minor crops and brightness shifts.
// Used alongside SHA-256 so duplicate screenshots are caught even
// when the bytes differ (different encode, same content).
//
// Resolution matters: at 9x8 (64-bit) the downscale erases the
// text, so ANY two UPI-app screenshots measure distance 1-2 and
// are falsely flagged as duplicates. At 33x32 (1024-bit) distinct
// payments measure 7+ while re-encoded copies of the SAME image
// stay at ~0-1, so threshold 4 separates them cleanly.
//
// Pure image code — lazy-required by the duplicate checker so the
// engine stays cold-start cheap.
// ─────────────────────────────────────────────────────────────

const { Jimp } = require('jimp');

const WIDTH = 33;
const HEIGHT = 32;
const BITS = (WIDTH - 1) * HEIGHT; // 1024

const HEX = '0123456789abcdef';

function binToHex(bits) {
  const padded = bits.padEnd(Math.ceil(bits.length / 4) * 4, '0');
  let hex = '';
  for (let i = 0; i < padded.length; i += 4) {
    hex += HEX[parseInt(padded.substr(i, 4), 2)];
  }
  return hex;
}

function hexToBin(hex) {
  if (!hex || typeof hex !== 'string') return '';
  let bin = '';
  for (const ch of hex.toLowerCase()) {
    const n = parseInt(ch, 16);
    if (Number.isNaN(n)) return '';
    bin += ('0000' + n.toString(2)).slice(-4);
  }
  return bin;
}

// Compute the 64-bit dHash of an image buffer. Returns a 16-char
// lowercase hex string, or null if the image cannot be decoded.
async function computePhash(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  try {
    const img = await Jimp.read(buffer);
    // Jimp v1 uses object-style args; scan() callback `this` binding changed
    // across versions, so read the resized RGBA buffer directly instead.
    img.resize({ w: WIDTH, h: HEIGHT });
    img.greyscale();
    const data = img.bitmap.data; // RGBA, WIDTH*HEIGHT pixels
    let bits = '';
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH - 1; x++) {
        const idxA = (y * WIDTH + x) * 4;
        bits += data[idxA] > data[idxA + 4] ? '1' : '0';
      }
    }
    return binToHex(bits);
  } catch {
    return null;
  }
}

// Number of differing bits between two hex hashes (0..64).
function hammingDistance(a, b) {
  const binA = hexToBin(a);
  const binB = hexToBin(b);
  if (!binA || !binB || binA.length !== binB.length) return BITS;
  let dist = 0;
  for (let i = 0; i < binA.length; i++) {
    if (binA[i] !== binB[i]) dist++;
  }
  return dist;
}

// Two hashes are "similar" when they differ by <= threshold bits.
function isSimilar(a, b, threshold) {
  return hammingDistance(a, b) <= (threshold == null ? 10 : threshold);
}

module.exports = { computePhash, hammingDistance, isSimilar, binToHex, hexToBin, BITS, WIDTH, HEIGHT };
