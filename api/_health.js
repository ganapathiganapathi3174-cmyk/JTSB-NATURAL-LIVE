const { createClient } = require('@supabase/supabase-js');
const turso = require('./_turso.js');
const neon = require('./_neon.js');
const r2 = require('./_r2.js');

const CHECK_INTERVAL_MS = 300000;

const status = {
  supabase: { status: 'unknown', lastCheck: null, latency: 0, error: null },
  turso: { status: 'unknown', lastCheck: null, latency: 0, error: null },
  neon: { status: 'unknown', lastCheck: null, latency: 0, error: null },
  r2: { status: 'unknown', lastCheck: null, latency: 0, error: null },
};

const history = {
  supabase: [],
  turso: [],
  neon: [],
  r2: [],
};

let intervalHandle = null;

async function checkSupabase() {
  const start = Date.now();
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Not configured');
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true }).limit(1);
    if (error) throw error;
    status.supabase = { status: 'healthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: null };
  } catch (err) {
    status.supabase = { status: 'unhealthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: err.message };
  }
  history.supabase.push({ ...status.supabase, timestamp: status.supabase.lastCheck });
  if (history.supabase.length > 100) history.supabase.shift();
}

async function checkTurso() {
  const start = Date.now();
  try {
    const c = turso.getClient();
    if (!c) throw new Error('Not configured');
    await c.execute('SELECT 1');
    status.turso = { status: 'healthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: null };
  } catch (err) {
    status.turso = { status: 'unhealthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: err.message };
  }
  history.turso.push({ ...status.turso, timestamp: status.turso.lastCheck });
  if (history.turso.length > 100) history.turso.shift();
}

async function checkNeon() {
  const start = Date.now();
  try {
    const ok = await neon.verifyConnection();
    if (!ok) throw new Error('Connection failed');
    status.neon = { status: 'healthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: null };
  } catch (err) {
    status.neon = { status: 'unhealthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: err.message };
  }
  history.neon.push({ ...status.neon, timestamp: status.neon.lastCheck });
  if (history.neon.length > 100) history.neon.shift();
}

async function checkR2() {
  const start = Date.now();
  try {
    const ok = await r2.verifyConnection();
    if (!ok) throw new Error('Connection failed');
    status.r2 = { status: 'healthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: null };
  } catch (err) {
    status.r2 = { status: 'unhealthy', lastCheck: new Date().toISOString(), latency: Date.now() - start, error: err.message };
  }
  history.r2.push({ ...status.r2, timestamp: status.r2.lastCheck });
  if (history.r2.length > 100) history.r2.shift();
}

async function runAllChecks() {
  await Promise.all([
    checkSupabase().catch(() => {}),
    checkTurso().catch(() => {}),
    checkNeon().catch(() => {}),
    checkR2().catch(() => {}),
  ]);
}

let logIntervalHandle = null;

function startHealthChecks() {
  if (intervalHandle) return;
  runAllChecks();
  intervalHandle = setInterval(runAllChecks, CHECK_INTERVAL_MS);

  // Log any unhealthy providers (once per change); suppress expected non-critical ones
  const EXPECTED_UNHEALTHY = ['turso', 'neon', 'r2'];
  logIntervalHandle = setInterval(() => {
    for (const [name, s] of Object.entries(status)) {
      if (s.status === 'unhealthy' && s._logged !== true) {
        if (EXPECTED_UNHEALTHY.includes(name)) {
          s._logged = true; // mark as logged but don't print
        } else {
          console.warn(`[HEALTH] ${name} is unhealthy: ${s.error}`);
          s._logged = true;
        }
      }
      if (s.status === 'healthy') {
        s._logged = false;
      }
    }
  }, CHECK_INTERVAL_MS * 2);
}

function stopHealthChecks() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (logIntervalHandle) {
    clearInterval(logIntervalHandle);
    logIntervalHandle = null;
  }
}

function getHealthStatus() {
  const allHealthy = Object.values(status).every(s => s.status === 'healthy');
  return {
    overall: allHealthy ? 'healthy' : 'degraded',
    lastRun: new Date().toISOString(),
    providers: { ...status },
    history: {
      supabase: history.supabase.slice(-20),
      turso: history.turso.slice(-20),
      neon: history.neon.slice(-20),
      r2: history.r2.slice(-20),
    },
  };
}

module.exports = { startHealthChecks, stopHealthChecks, getHealthStatus, runAllChecks };
