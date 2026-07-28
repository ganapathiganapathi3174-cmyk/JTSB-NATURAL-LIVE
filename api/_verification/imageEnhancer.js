const C = require('./config');
const log = require('./logger').ENHANCE;

function detectBlur(buf) {
  try {
    if (buf.length < 100) return { blurScore: 0, passed: true, issues: [] };
    let totalDiff = 0;
    let count = 0;
    const sampleRate = Math.max(1, Math.floor(buf.length / 2000));
    for (let i = 1; i < buf.length - 1; i += sampleRate) {
      totalDiff += Math.abs(buf[i] - buf[i - 1]);
      count++;
    }
    const avgDiff = count > 0 ? totalDiff / count : 0;
    const blurScore = Math.max(0, Math.min(100, 100 - (avgDiff * 2)));
    const passed = blurScore <= C.BLUR_SCORE_MAX;
    const issues = passed ? [] : ['Image blur score exceeds threshold: ' + Math.round(blurScore)];
    return { blurScore: Math.round(blurScore), passed, issues };
  } catch (e) {
    return { blurScore: 0, passed: true, issues: [] };
  }
}

async function createContrastStrategy(buf) {
  try {
    const { Jimp } = require('jimp');
    const img = await Jimp.read(buf);
    img.contrast(0.3);
    const enhancedBuf = await img.getBuffer('image/png');
    return { name: 'contrast_enhanced', buf: enhancedBuf };
  } catch (e) {
    log.warn('Contrast enhancement failed: ' + e.message);
    return null;
  }
}

async function run(buf) {
  const t0 = Date.now();
  const strategies = [{ name: 'original', buf }];

  if (buf.length < 5 * 1024 * 1024) {
    const contrast = await createContrastStrategy(buf);
    if (contrast) strategies.push(contrast);
  }

  const blurCheck = detectBlur(buf);

  log.info('Quality: blur=' + blurCheck.blurScore + ' strategies=' + strategies.length + ' (' + (Date.now() - t0) + 'ms)');
  return {
    strategies,
    quality: {
      blurScore: blurCheck.blurScore,
      passed: blurCheck.passed,
      issues: blurCheck.issues,
    },
    duration: Date.now() - t0,
  };
}

module.exports = { run, detectBlur, createContrastStrategy };