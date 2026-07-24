const PREFIXES = {
  AUTH: '[AUTH]',
  ENHANCE: '[ENHANCE]',
  OCR: '[OCR]',
  EXTRACT: '[EXTRACT]',
  VALIDATE: '[VALIDATE]',
  DEDUP: '[DEDUP]',
  FRAUD: '[FRAUD]',
  DECIDE: '[DECIDE]',
  PIPELINE: '[PIPELINE]',
  STORE: '[STORE]',
};

function ts() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function makeLogger(prefix) {
  return {
    info: (orderId, msg) => console.log(`[${ts()}] ${prefix} ${orderId} ${msg}`),
    warn: (orderId, msg) => console.warn(`[${ts()}] ${prefix} ${orderId} WARN: ${msg}`),
    error: (orderId, msg) => console.error(`[${ts()}] ${prefix} ${orderId} ERROR: ${msg}`),
  };
}

const loggers = {};
for (const [key, prefix] of Object.entries(PREFIXES)) {
  loggers[key] = makeLogger(prefix);
}

module.exports = loggers;
