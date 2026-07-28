const PREFIXES = {
  ENGINE: '[ENGINE]',
  IMAGE: '[IMAGE]',
  ENHANCE: '[ENHANCE]',
  OCR: '[OCR]',
  EXTRACT: '[EXTRACT]',
  NORMALIZE: '[NORMALIZE]',
  VALIDATE: '[VALIDATE]',
  DEDUP: '[DEDUP]',
  FRAUD: '[FRAUD]',
  DECIDE: '[DECIDE]',
  AUDIT: '[AUDIT]',
};

function ts() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function makeLogger(prefix) {
  return {
    info: (msg) => console.log(`[${ts()}] ${prefix} ${msg}`),
    debug: (msg) => { if (process.env.VERBOSE) console.log(`[${ts()}] ${prefix} ${msg}`); },
    warn: (msg) => console.warn(`[${ts()}] ${prefix} WARN: ${msg}`),
    error: (msg) => console.error(`[${ts()}] ${prefix} ERROR: ${msg}`),
  };
}

const loggers = {};
for (const [key, prefix] of Object.entries(PREFIXES)) {
  loggers[key] = makeLogger(prefix);
}

module.exports = loggers;