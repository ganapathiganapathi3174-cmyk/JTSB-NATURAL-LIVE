const fs = require('fs');
const path = require('path');
const os = require('os');
const r2 = require('../api/_r2.js');

const LOCAL_DIR = path.join(__dirname, '..', 'public', 'uploads');
const TMP_DIR = path.join(os.tmpdir(), 'jtsb-uploads');

let bucketEnsured = false;

async function ensureBucket(supabase) {
  if (bucketEnsured) return true;
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets || !buckets.some(b => b.name === 'payments')) {
      const { error } = await supabase.storage.createBucket('payments', { public: true });
      if (error) throw error;
    }
    bucketEnsured = true;
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.writeHead(200).end();
  if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed' })); return; }

  try {
    const { image, fileName } = req.body || {};
    if (!image) { res.writeHead(400); res.end(JSON.stringify({ error: 'Image data is required' })); return; }

    const buf = Buffer.from(image, 'base64');
    const safeName = 'screenshots/' + Date.now() + '_' + (fileName || 'screenshot.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');

    // Try Cloudflare R2 first
    const r2Result = await r2.uploadFile(safeName, buf);
    if (r2Result && r2Result.url) {
      res.writeHead(200); res.end(JSON.stringify({ url: r2Result.url, path: safeName }));
      return;
    }

    // Fallback: Supabase Storage
    try {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_KEY;
      if (url && key) {
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(url, key, { auth: { persistSession: false } });
        await ensureBucket(supabase);
        const { data, error } = await supabase.storage.from('payments').upload(safeName, buf, {
          contentType: 'image/jpeg', upsert: false,
        });
        if (!error) {
          const { data: urlData } = supabase.storage.from('payments').getPublicUrl(safeName);
          res.writeHead(200); res.end(JSON.stringify({ url: urlData.publicUrl, path: safeName }));
          return;
        }
      }
    } catch (e) { /* fall through to tmp */ }

    // Final fallback: writable temp directory
    const targetDir = TMP_DIR;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const localFile = path.join(targetDir, path.basename(safeName));
    fs.writeFileSync(localFile, buf);
    const origin = req.headers.origin || 'http://localhost:5173';
    res.writeHead(200); res.end(JSON.stringify({ url: origin + '/uploads/' + path.basename(localFile), path: safeName }));
  } catch (err) {
    res.writeHead(500); res.end(JSON.stringify({ error: err.message }));
  }
};
