const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = path.join(__dirname, '..');

let pythonPath = null;

function detectPython() {
  if (pythonPath !== null) return pythonPath;
  const candidates = [
    'python3', 'python',
    'C:\\Python312\\python.exe',
    'C:\\Users\\pavi\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    '/usr/bin/python3', '/usr/bin/python',
  ];
  for (const cmd of candidates) {
    try {
      const r = require('child_process').execSync(`"${cmd}" --version`, { timeout: 3000, stdio: 'pipe' });
      if (r) { pythonPath = cmd; return cmd; }
    } catch {}
  }
  pythonPath = false;
  return false;
}

function runPythonScript(scriptName, imagePath, timeoutMs) {
  return new Promise((resolve) => {
    const py = detectPython();
    if (!py) {
      resolve({ success: false, error: 'Python not available', engine: scriptName.replace('.py', ''), blocks: [], duration: 0 });
      return;
    }
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: 'Script not found: ' + scriptName, engine: scriptName.replace('.py', ''), blocks: [], duration: 0 });
      return;
    }
    const t0 = Date.now();
    execFile(py, [scriptPath, imagePath], { timeout: timeoutMs || 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const duration = Date.now() - t0;
      if (err) {
        resolve({ success: false, error: err.message, engine: scriptName.replace('.py', ''), blocks: [], duration });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        parsed.engine = scriptName.replace('.py', '');
        parsed.duration = duration;
        resolve(parsed);
      } catch (e) {
        resolve({ success: false, error: 'Parse error: ' + e.message, engine: scriptName.replace('.py', ''), blocks: [], duration });
      }
    });
  });
}

function runPaddleOCR(imagePath, timeoutMs) {
  return runPythonScript('_paddle_ocr.py', imagePath, timeoutMs);
}

function runEasyOCR(imagePath, timeoutMs) {
  return runPythonScript('_easyOcrRunner.py', imagePath, timeoutMs);
}

module.exports = { detectPython, runPaddleOCR, runEasyOCR, runPythonScript };
