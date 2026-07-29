const https = require('https');
const C = require('./config.js');

function httpsPost(url, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs || C.AI_VISION_TIMEOUT_MS,
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

async function runGeminiVision(imageUrl) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY not configured', engine: 'gemini' };

  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
    const prompt = 'Extract all text visible in this UPI payment screenshot. Provide structured JSON with: amount (number), utr (string), upi_id (string), receiver_name (string), date (YYYY-MM-DD), time (HH:MM), status (SUCCESS/FAILED/PENDING), bank_or_app (string). Only respond with valid JSON. If unsure, set the value to null.';
    const body = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: 'PLACEHOLDER' } }
        ]
      }]
    };

    const raw = await httpsPost(url, body, C.AI_VISION_TIMEOUT_MS);
    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'No JSON in Gemini response', engine: 'gemini', raw: text };

    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, engine: 'gemini', fields: parsed, raw: text };
  } catch (e) {
    return { success: false, error: e.message, engine: 'gemini' };
  }
}

async function runGPTVision(imageUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { success: false, error: 'OPENAI_API_KEY not configured', engine: 'gpt4' };

  try {
    const url = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: 'gpt-4.1',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text visible in this UPI payment screenshot as JSON with: amount (number), utr (string), upi_id (string), receiver_name (string), date (YYYY-MM-DD), time (HH:MM), status (SUCCESS/FAILED/PENDING), bank_or_app (string). Only respond with valid JSON.' },
          { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
        ]
      }],
      max_tokens: 1000,
      temperature: 0.1,
    };

    const raw = await httpsPost(url, body, C.AI_VISION_TIMEOUT_MS);
    const text = raw?.choices?.[0]?.message?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'No JSON in GPT response', engine: 'gpt4', raw: text };

    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, engine: 'gpt4', fields: parsed, raw: text };
  } catch (e) {
    return { success: false, error: e.message, engine: 'gpt4' };
  }
}

async function runAIVision(imageUrl) {
  const result = { success: false, engines: {}, bestFields: null, avgConfidence: 0 };

  const gemini = await runGeminiVision(imageUrl);
  result.engines.gemini = gemini;

  const gpt4 = await runGPTVision(imageUrl);
  result.engines.gpt4 = gpt4;

  const successful = [gemini, gpt4].filter(e => e.success);
  result.success = successful.length > 0;

  if (successful.length === 1) {
    result.bestFields = successful[0].fields;
  } else if (successful.length >= 2) {
    const fields = ['amount', 'utr', 'upi_id', 'receiver_name', 'date', 'time', 'status', 'bank_or_app'];
    const merged = {};
    for (const field of fields) {
      const values = successful.map(e => e.fields?.[field]).filter(v => v !== null && v !== undefined && v !== '');
      const unique = [...new Set(values.map(v => String(v).toLowerCase().trim()))];
      if (unique.length === 1) merged[field] = values[0];
      else if (unique.length > 1) {
        merged[field] = values[0];
        merged[field + '_conflict'] = true;
      }
    }
    result.bestFields = merged;
  }

  return result;
}

module.exports = { runAIVision, runGeminiVision, runGPTVision };
