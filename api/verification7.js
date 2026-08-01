// Compatibility shim → single verification facade.
// All verification now flows through api/_verificationEngine.js.
const { verifySession } = require('./_verificationEngine.js');

async function verify(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf) {
  return verifySession(order, screenshotUrl, userId, userUtr, userUpi, screenshotBuf);
}

module.exports = { verify, verifySession };
