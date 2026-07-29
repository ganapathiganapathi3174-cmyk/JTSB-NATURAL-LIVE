const engine = require('./_newEngine/index.js');

async function verify(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  return engine.run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf);
}

module.exports = { verify };
