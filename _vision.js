const https = require('https');
const crypto = require('crypto');
const r2 = require('./_r2.js');

async function getGoogleToken() {
  const keyBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyBase64) return null;
  let sa;
  try { sa = JSON.parse(Buffer.from(keyBase64, 'base64').toString()); } catch { return null; }
  const now = Math.floor(Date.now() / 1000);
  const jwt = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    + '.' + Buffer.from(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now })).toString('base64url');
  const sign = crypto.createSign('RSA-SHA256').update(jwt).end();
  const sig = sign.sign(sa.private_key, 'base64url');
  const jwtSigned = jwt + '.' + sig;
  return new Promise((resolve, reject) => {
    const body = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwtSigned);
    const req = https.request('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const r = JSON.parse(data); resolve(r.access_token || null); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

const DEFAULT_UPI_ID = 'jayarajj126-3@okicici';

function fetchBuffer(url) {
  // Try R2 for cloudflare r2 URLs
  const r2Domain = process.env.R2_PUBLIC_DOMAIN;
  if (r2Domain && url.includes(r2Domain)) {
    const key = url.split('/').slice(3).join('/');
    return r2.getFile(key).then(result => {
      if (result && result.buffer) return result.buffer;
      throw new Error('R2 fetch failed, falling back to HTTP');
    }).catch(() => fetchBufferHTTP(url));
  }
  return fetchBufferHTTP(url);
}

function fetchBufferHTTP(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : require('http');
    mod.get(url, { timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
  });
}

function getImageDimensions(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] === 0xFF) {
        const marker = buffer[offset + 1];
        if (marker >= 0xC0 && marker <= 0xC3) {
          return {
            width: (buffer[offset + 7] << 8) + buffer[offset + 8],
            height: (buffer[offset + 5] << 8) + buffer[offset + 6],
          };
        }
        if (marker === 0xD9 || marker === 0xDA) break;
        if (marker === 0xD0 || marker === 0xD1 || marker === 0xD2 || marker === 0xD3 ||
            marker === 0xD4 || marker === 0xD5 || marker === 0xD6 || marker === 0xD7 ||
            marker === 0xD8) {
          offset += 2;
        } else {
          const segLen = (buffer[offset + 2] << 8) + buffer[offset + 3];
          offset += 2 + segLen;
        }
      } else {
        offset++;
      }
    }
  } else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: (buffer[16] << 24) + (buffer[17] << 16) + (buffer[18] << 8) + buffer[19],
      height: (buffer[20] << 24) + (buffer[21] << 16) + (buffer[22] << 8) + buffer[23],
    };
  }
  return { width: 0, height: 0 };
}

function analyzeImageQuality(buffer, annotations) {
  const dims = getImageDimensions(buffer);
  const result = { width: dims.width, height: dims.height, blurry: false, cropped: false, dark: false, incomplete: false };

  const words = (annotations || []).slice(1);
  if (words.length > 0) {
    const confs = words.map(w => w.confidence || 0);
    const mean = confs.reduce((s, c) => s + c, 0) / confs.length;
    const variance = confs.reduce((s, c) => s + (c - mean) ** 2, 0) / confs.length;
    if (variance > 0.05) result.blurry = true;
  }

  if (dims.width > 0 && dims.height > 0 && annotations.length > 1) {
    const verts = (annotations[0].boundingPoly && annotations[0].boundingPoly.vertices) || [];
    if (verts.length > 0) {
      const xs = verts.map(v => v.x || 0);
      const ys = verts.map(v => v.y || 0);
      const marginX = dims.width * 0.02;
      const marginY = dims.height * 0.02;
      if (Math.min(...xs) <= marginX || Math.max(...xs) >= dims.width - marginX ||
          Math.min(...ys) <= marginY || Math.max(...ys) >= dims.height - marginY) {
        result.cropped = true;
        result.incomplete = true;
      }
    }
  }

  if (dims.width > 0 && dims.height > 0) {
    const megapixels = (dims.width * dims.height) / 1000000;
    const bytesPerMP = buffer.length / Math.max(megapixels, 0.1);
    if (bytesPerMP < 50000) result.dark = true;
  }

  return result;
}

async function callVisionAPI(base64Image) {
  const token = await getGoogleToken();
  if (!token) return null;

  const body = JSON.stringify({
    requests: [{
      image: { content: base64Image },
      features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
    }],
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'vision.googleapis.com',
      path: '/v1/images:annotate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Vision API timeout')); });
    req.write(body);
    req.end();
  });
}

function parseOCRText(fullText, annotations) {
  const result = {
    rawText: fullText || '',
    extractedAmount: null,
    extractedUtr: null,
    extractedUpiId: null,
    extractedDate: null,
    extractedStatus: null,
    confidence: 0,
    wordCount: 0,
    amountCount: 0,
    upiIdCount: 0,
    utrCount: 0,
    ambiguous: false,
  };

  if (!fullText) return result;

  const words = (annotations || []).slice(1);
  result.wordCount = words.length;
  if (words.length > 0) {
    const totalConf = words.reduce((s, w) => s + (w.confidence || 0), 0);
    result.confidence = Math.round((totalConf / words.length) * 10000) / 100;
  }

  const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
  const foundAmounts = [];
  const foundUpiIds = [];
  const foundUtrs = [];

  for (const line of lines) {
    const upper = line.toUpperCase();

    const amtMatches = line.matchAll(/(?:₹|RS\.?\s*|INR\s*)(\d[\d,]*\.?\d{0,2})/gi);
    for (const m of amtMatches) foundAmounts.push(parseFloat(m[1].replace(/,/g, '')));

    const utrMatches = line.matchAll(/UTR\s*:?\s*([A-Z0-9]{10,})/gi);
    for (const m of utrMatches) foundUtrs.push(m[1]);
    const refMatches = line.matchAll(/(?:REF|REFERENCE|TRANSACTION\s*ID|TXN\s*ID)\s*:?\s*([A-Z0-9]{10,})/gi);
    for (const m of refMatches) foundUtrs.push(m[1]);

    const upiMatches = line.matchAll(/([\w.-]+@[\w.]+)/gi);
    for (const m of upiMatches) {
      const id = m[1].toLowerCase();
      if (id.includes('@')) foundUpiIds.push(id);
    }

    if (!result.extractedDate) {
      const dateMatch = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (dateMatch) {
        const d = dateMatch[1].padStart(2, '0');
        const m = dateMatch[2].padStart(2, '0');
        const y = dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3];
        result.extractedDate = `${y}-${m}-${d}`;
      }
    }

    if (!result.extractedStatus) {
      if (/\b(SUCCESS|SUCCESSFUL)\b/i.test(upper)) {
        result.extractedStatus = 'SUCCESS';
      }
    }
  }

  if (foundAmounts.length > 0) result.extractedAmount = foundAmounts[0];
  if (foundUtrs.length > 0) result.extractedUtr = foundUtrs[0];
  if (foundUpiIds.length > 0) result.extractedUpiId = foundUpiIds[0];

  result.amountCount = [...new Set(foundAmounts)].length;
  result.upiIdCount = [...new Set(foundUpiIds)].length;
  result.utrCount = [...new Set(foundUtrs)].length;

  if (result.amountCount > 1 || result.upiIdCount > 1 || result.utrCount > 1) {
    result.ambiguous = true;
  }

  return result;
}

async function analyzeScreenshot(imageUrl) {
  const visionResult = { ocrAvailable: false, ocrParsed: null, imageHash: '', imageQuality: null, error: null };

  try {
    const buf = await fetchBuffer(imageUrl);
    const crypto = require('crypto');
    visionResult.imageHash = crypto.createHash('sha256').update(buf).digest('hex');

    const base64 = buf.toString('base64');
    const apiResponse = await callVisionAPI(base64);

    if (!apiResponse) {
      visionResult.ocrAvailable = false;
      visionResult.error = 'Vision API credentials not available';
      return visionResult;
    }

    if (apiResponse.error) {
      visionResult.ocrAvailable = false;
      visionResult.error = 'Vision API error: ' + (apiResponse.error.message || JSON.stringify(apiResponse.error));
      return visionResult;
    }

    const responses = apiResponse.responses || [];
    if (responses.length === 0 || !responses[0]) {
      visionResult.ocrAvailable = false;
      visionResult.error = 'No response from Vision API';
      return visionResult;
    }

    const textAnnotations = responses[0].textAnnotations || [];
    const fullText = responses[0].fullTextAnnotation ? responses[0].fullTextAnnotation.text : '';
    const ocrText = fullText || (textAnnotations.length > 0 ? textAnnotations[0].description : '');

    visionResult.ocrAvailable = true;
    visionResult.ocrParsed = parseOCRText(ocrText, textAnnotations);
    visionResult.ocrParsed.rawText = ocrText;
    visionResult.rawApiResponse = {
      textLength: ocrText.length,
      annotationCount: textAnnotations.length,
    };
    visionResult.imageQuality = analyzeImageQuality(buf, textAnnotations);

    return visionResult;
  } catch (e) {
    visionResult.error = 'Screenshot analysis failed: ' + e.message;
    return visionResult;
  }
}

module.exports = { analyzeScreenshot, parseOCRText, DEFAULT_UPI_ID };
