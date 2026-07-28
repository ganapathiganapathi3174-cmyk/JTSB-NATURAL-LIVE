const engine = require('./_verification6/index.js');

async function verify(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  return engine.run(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf);
}

module.exports = { verify };
