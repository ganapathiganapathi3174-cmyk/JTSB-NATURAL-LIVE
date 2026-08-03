const { TEST_MODE, TEST_PAYMENT_AMOUNT } = require('../_shared.js');

// Canonical package amounts (single source of truth; matches _shared.js PACKAGES).
const BASE_AMOUNTS = [120, 500, 1000];
const ALLOWED_AMOUNTS = TEST_MODE ? [...BASE_AMOUNTS, TEST_PAYMENT_AMOUNT] : BASE_AMOUNTS;

module.exports = {
  RECEIVER_NAME: 'JEYARAJ ALAGAR',
  RECEIVER_UPI: 'jayarajj126-3@okicici',

  ALLOWED_AMOUNTS,

  TESSERACT_LANG: 'eng',
  TESSERACT_CONFIG: { legacy: false, oem: 1, psm: 3 },

  OCR_TIMEOUT_MS: 60000,
  AI_VISION_TIMEOUT_MS: 30000,
  VERIFY_TIMEOUT_MS: 180000,
  // Hard ceiling for a single verifySession() call (ms). MUST stay well below
  // Vercel's maxDuration (60s) and the route-level 120s payment timeout so the
  // status poll can never be severed mid-verification. On expiry the facade
  // returns manual_review and the order is retried (bounded by VERIFY_MAX_ATTEMPTS).
  VERIFY_BUDGET_MS: parseInt(process.env.VERIFY_BUDGET_MS || '45000', 10),
  // Budget for the AI-vision stage when OCR fields are incomplete (ms).
  AI_VISION_BUDGET_MS: parseInt(process.env.AI_VISION_BUDGET_MS || '15000', 10),
  // Timeouts for Tesseract.js (worker cold-start download + recognition).
  TESSERACT_WORKER_INIT_TIMEOUT_MS: parseInt(process.env.TESSERACT_WORKER_INIT_TIMEOUT_MS || '30000', 10),
  TESSERACT_TIMEOUT_MS: parseInt(process.env.TESSERACT_TIMEOUT_MS || '30000', 10),

  MIN_IMAGE_SIZE: 1024,
  MAX_IMAGE_SIZE: 20 * 1024 * 1024,
  MIN_WIDTH: 320,
  MIN_HEIGHT: 240,
  MAX_WIDTH: 4096,
  MAX_HEIGHT: 4096,
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],

  BLUR_THRESHOLD: 100,
  DARK_THRESHOLD: 50,
  MIN_OCR_CONFIDENCE: 30,
  // STRICT auto-approval confidence floor (enterprise rule). Tunable via env for ops flexibility.
  // Minimum OCR confidence to consider fields extracted (NOT an approval gate).
  // Auto-approve depends on business fields, not OCR confidence.
  CONFIDENCE_APPROVE: parseInt(process.env.AUTO_APPROVE_CONFIDENCE || '60', 10),
  CONFIDENCE_REJECT: 40,

  // Screenshot payment-time must fall within ±PAYMENT_TIME_WINDOW_MIN minutes of
  // the server's current time (Asia/Kolkata) to be eligible for auto-approval.
  TIME_WINDOW_MIN: parseInt(process.env.PAYMENT_TIME_WINDOW_MIN || '30', 10),

  FRAUD_RAPID_WINDOW_MS: 60000,
  FRAUD_MAX_PER_WINDOW: 3,

  // Perceptual-hash duplicate detection (dHash, 1024-bit).
  // Two screenshots are "same image" when hamming distance <= threshold.
  // At 1024-bit: re-encoded copies of the SAME screenshot measure ~0-1,
  // while genuinely different payments measure 7+ (verified empirically).
  // A threshold of 4 cleanly separates reuse from distinct transactions.
  PHASH_THRESHOLD: parseInt(process.env.PHASH_THRESHOLD || '4', 10),
  PHASH_SCAN_LIMIT: parseInt(process.env.PHASH_SCAN_LIMIT || '300', 10),

  DECISION: {
    APPROVE: 'verified',
    REJECT: 'rejected',
    MANUAL_REVIEW: 'manual_review',
  },

  RESULTS: {
    PASS: 'pass',
    FAIL: 'fail',
    UNCERTAIN: 'uncertain',
  },
};
