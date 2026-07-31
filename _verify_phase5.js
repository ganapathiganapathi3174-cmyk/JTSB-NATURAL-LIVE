const fs = require('fs');
const files = [];
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) { if (!e.name.match(/node_modules|\.git|dist/)) walk(dir + '/' + e.name); }
    else if (e.name.endsWith('.js')) files.push(dir + '/' + e.name);
  }
}
walk('api'); walk('handlers');
let sec = { authGates:0, rateLimitXFDBug:0, rateLimitRealIP:0, inputValidation:0, errorLeak:0, corsWildcard:0, bearerAuth:0, magicByteCheck:0, failClosed:0, devSecrets:0 };
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  if (c.includes('requireAdmin')) sec.authGates++;
  if (c.includes('x-forwarded-for') && !c.includes('getClientIp')) sec.rateLimitXFDBug++;
  if (c.includes('getClientIp')) sec.rateLimitRealIP++;
  if (c.includes('res.writeHead(400') || c.includes('req.body ||')) sec.inputValidation++;
  if (c.includes('err.message') && !c.includes('console.error')) sec.errorLeak++;
  if (c.includes('Access-Control-Allow-Origin') && c.includes('*')) sec.corsWildcard++;
  if (c.includes('Authorization') && c.includes('Bearer')) sec.bearerAuth++;
  if (c.includes('magic bytes') || c.includes('magicByte') || c.includes('0xFFD8')) sec.magicByteCheck++;
  if (c.includes('503')) sec.failClosed++;
  if (c.includes('dev-jwt-secret-not-for-production') || c.includes('System@123') || c.includes('jayaraj7523')) sec.devSecrets++;
});
let endpoints = {};
files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  if (c.includes('PAYMENT_CONFIRM_SECRET') && c.includes('503')) endpoints.paymentConfirmFailClosed = true;
  if (c.includes('SMS_PAYMENT_SECRET') && c.includes('503')) endpoints.smsPaymentConfirmFailClosed = true;
  if (c.includes('COMPANION_API_KEY') && c.includes('401')) endpoints.companionKeyRequired = true;
  if (c.includes('x-companion-key')) endpoints.companionKey = 'required';
  if (c.includes('x-nonce')) endpoints.replayProtection = true;
});
console.log(JSON.stringify({ security: sec, endpoints: endpoints }, null, 2));