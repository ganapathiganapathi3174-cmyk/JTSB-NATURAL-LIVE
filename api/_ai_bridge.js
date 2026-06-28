const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const PYTHON_PATH = 'C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312\\python.exe';
const SCRIPT_PATH = path.join(__dirname, '_ai_engine.py');
const SERVER_PATH = path.join(__dirname, '_ai_server.py');

const ANALYSIS_TIMEOUT = 270000;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY = 2000;

let serverProcess = null;
let pendingRequests = new Map();
let requestCounter = 0;
let lineBuffer = '';
let serverRestarts = 0;
let serverExplicitKill = false;

function log(msg) {
  console.log('[' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '] [AI-BRIDGE] ' + msg);
}

// ── Persistent Python Server Management ──────────────────────────────
function startServer() {
  if (serverProcess) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }

  log('Starting persistent AI server...');
  serverExplicitKill = false;

  const torchLib = path.join('C:\\Users\\Sahan\\AppData\\Local\\Programs\\Python\\Python312', 'Lib', 'site-packages', 'torch', 'lib');
  const envPath = (process.env.PATH || '') + ';' + torchLib;

  const child = spawn(PYTHON_PATH, [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: envPath,
      PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True',
      PYTHONIOENCODING: 'utf-8',
      HF_HUB_OFFLINE: '1',
    },
  });

  child.stdout.on('data', (data) => {
    lineBuffer += data.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        const id = msg.id || msg.action;
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          if (msg.action === 'error' || msg.error) {
            pending.reject(new Error(msg.error || msg.message || 'Server error'));
          } else {
            pending.resolve(msg);
          }
        }
      } catch (e) {
        log('Failed to parse server response: ' + e.message + ' line=' + trimmed.substring(0, 200));
      }
    }
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const l of lines) {
      if (l.trim()) log('[SERVER] ' + l.trim());
    }
  });

  child.on('error', (e) => {
    log('Server process error: ' + e.message);
    rejectAllPending(e);
    serverProcess = null;
    scheduleRestart();
  });

  child.on('exit', (code, signal) => {
    if (!serverExplicitKill) {
      log('Server exited unexpectedly code=' + code + ' signal=' + signal);
    }
    rejectAllPending(new Error('Server exited code=' + code));
    serverProcess = null;
    if (!serverExplicitKill) {
      scheduleRestart();
    }
  });

  serverProcess = child;
  serverRestarts = 0;
}

function scheduleRestart() {
  serverRestarts++;
  if (serverRestarts > MAX_RESTART_ATTEMPTS) {
    log('Max restart attempts (' + MAX_RESTART_ATTEMPTS + ') reached — giving up');
    return;
  }
  log('Scheduling restart attempt ' + serverRestarts + '/' + MAX_RESTART_ATTEMPTS + ' in ' + RESTART_DELAY + 'ms');
  setTimeout(startServer, RESTART_DELAY);
}

function rejectAllPending(err) {
  for (const [id, pending] of pendingRequests) {
    pending.reject(err || new Error('Server disconnected'));
  }
  pendingRequests.clear();
}

function ensureServer() {
  if (!serverProcess || !serverProcess.connected) {
    startServer();
  }
}

function sendToServer(msg, timeout = ANALYSIS_TIMEOUT) {
  return new Promise((resolve, reject) => {
    ensureServer();
    const id = msg.id || 'req_' + (++requestCounter);
    msg.id = id;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      pendingRequests.delete(id);
      reject(new Error('AI server request timed out after ' + (timeout / 1000) + 's'));
    }, timeout);

    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        if (!timedOut) resolve(result);
      },
      reject: (err) => {
        clearTimeout(timer);
        if (!timedOut) reject(err);
      },
    });

    try {
      serverProcess.stdin.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error('Failed to write to server stdin: ' + e.message));
    }
  });
}

function killServer() {
  serverExplicitKill = true;
  if (serverProcess) {
    try { serverProcess.kill('SIGTERM'); } catch (_) {}
    serverProcess = null;
  }
  rejectAllPending(new Error('Server killed'));
}

function fetchBufferFromURL(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error('HTTP ' + res.statusCode + ' fetching ' + url));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', function () { this.destroy(); reject(new Error('Timeout fetching screenshot')); });
  });
}

function guessExtension(buf) {
  if (!buf || buf.length < 4) return '.jpg';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return '.webp';
  if (buf[0] === 0x42 && buf[1] === 0x4D) return '.bmp';
  return '.jpg';
}

function runAnalysisViaServer(imagePath, expected) {
  const msg = { action: 'analyze', imagePath, expected: expected || {} };
  return sendToServer(msg, ANALYSIS_TIMEOUT);
}

async function analyzeWithAI(imageUrl, expected) {
  let tempPath = null;
  try {
    const rawBuf = await fetchBufferFromURL(imageUrl);
    const ext = guessExtension(rawBuf);
    const tempDir = os.tmpdir();
    const tempName = 'ai_' + crypto.randomBytes(8).toString('hex') + ext;
    tempPath = path.join(tempDir, tempName);
    fs.writeFileSync(tempPath, rawBuf);

    const result = await runAnalysisViaServer(tempPath, expected);
    return result;
  } catch (e) {
    log('Error: ' + e.message);
    return {
      error: e.message,
      status: 'failed',
      confidence: 0,
      reasons: [e.message],
      stages: {},
      duration: 0,
    };
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function mapAIResultToVerificationFormat(aiOutput) {
  const fallback = {
    ocrResult: { ocrAvailable: false, ocrText: '', confidence: 0, imageHash: '', wordData: [], dimensions: { width: 0, height: 0 }, error: 'AI engine did not return usable results' },
    visualValidation: { isScreenshot: false, isTampered: false, isBlurred: false, isCropped: false, perceptualHash: '', blurScore: 0, tamperScore: 0, issues: [] },
    imageQuality: { passed: false, overallGrade: 'poor', issues: ['AI engine returned no data'] },
    parsed: null,
    aiResult: null,
  };

  if (!aiOutput || aiOutput.error) {
    return { ...fallback, error: aiOutput ? aiOutput.error : 'No output from AI engine' };
  }

  const s1 = aiOutput.stages.stage1_opencv || {};
  const s3 = aiOutput.stages.stage3_multi_ocr || {};
  const s4 = aiOutput.stages.stage4_presence || {};
  const s5 = aiOutput.stages.stage5_match || {};
  const s7 = aiOutput.stages.stage7_quality || {};
  const matched = aiOutput.matched_fields || {};
  const s8 = aiOutput.stages.stage8_decision || {};

  const engines = s3.engines || {};
  const activeEngines = Object.keys(engines).filter(k => engines[k].success);
  const totalBlocks = Object.keys(engines).reduce((s, k) => s + (engines[k].blocks || 0), 0);
  const presence = s4.presence || {};

  return {
    ocrResult: {
      ocrAvailable: totalBlocks > 0,
      ocrText: '',
      confidence: 0,
      imageHash: s1.perceptualHash || crypto.createHash('sha256').update(JSON.stringify(aiOutput)).digest('hex').substring(0, 16),
      wordData: [],
      dimensions: { width: s1.resolution ? s1.resolution.w : 0, height: s1.resolution ? s1.resolution.h : 0 },
      error: null,
      engines: activeEngines,
      engineCount: activeEngines.length,
      rawTextLen: s4.rawTextLen || 0,
    },
    visualValidation: {
      isScreenshot: s1.isScreenshot || false,
      isTampered: s1.isFake || s1.isEdited || false,
      isBlurred: s1.isBlurred || false,
      isCropped: s1.isCropped || false,
      perceptualHash: s1.perceptualHash || '',
      blurScore: s1.blurScore || 0,
      tamperScore: s1.tamperScore || 0,
      issues: s1.issues || [],
    },
    imageQuality: {
      passed: !(s1.isBlurred || s1.isCropped || s1.isFake || s1.isEdited),
      overallGrade: s1.grade || 'good',
      issues: s7.warnings || [],
    },
    parsed: {
      presence: {
        utr: presence.utr || { found: false },
        amount: presence.amount || { found: false },
        upi_id: presence.upi_id || { found: false },
        date: presence.date || { found: false },
      },
      matchedFields: matched,
    },
    aiResult: {
      status: aiOutput.status,
      reasons: aiOutput.reasons || [],
      duration: aiOutput.duration || 0,
      florenceAvailable: aiOutput.florenceAvailable || false,
      stages: {
        opencv: s1,
        multiOcr: { engines: activeEngines },
        presence: s4,
        match: s5,
        quality: s7,
        decision: s8,
      },
    },
  };
}

// Start server on first module load (warm up models immediately)
setTimeout(() => {
  log('Initializing persistent AI server...');
  ensureServer();
}, 100);

// Graceful shutdown
process.once('exit', () => killServer());
process.once('SIGINT', () => { killServer(); process.exit(); });
process.once('SIGTERM', () => { killServer(); process.exit(); });

module.exports = { analyzeWithAI, mapAIResultToVerificationFormat, fetchBufferFromURL, startServer, killServer };
