const _shared = require('../_shared.js');

module.exports = Object.freeze({
  TEST_MODE: _shared.TEST_MODE,
  TEST_PAYMENT_AMOUNT: _shared.TEST_PAYMENT_AMOUNT,

  EXPECTED_RECEIVER_UPI: _shared.ADMIN_UPI_ID,
  EXPECTED_RECEIVER_NAME: _shared.ADMIN_NAME,
  ALLOWED_AMOUNTS: _shared.TEST_MODE
    ? [_shared.TEST_PAYMENT_AMOUNT, 120, 500, 1000]
    : [120, 500, 1000],
  REAL_AMOUNTS: [120, 500, 1000],

  UTR_MIN_LENGTH: 10,
  UTR_MAX_LENGTH: 30,
  MIN_IMAGE_SIZE: 5000,
  MAX_IMAGE_SIZE: 15 * 1024 * 1024,
  MIN_IMAGE_WIDTH: 100,
  MIN_IMAGE_HEIGHT: 100,
  MAX_IMAGE_WIDTH: 6000,
  MAX_IMAGE_HEIGHT: 12000,
  MIN_OCR_CONFIDENCE: 30,
  MIN_OCR_TEXT_LENGTH: 10,
  MAX_SESSION_AGE_MINUTES: 120,
  PER_PAYMENT_TIMEOUT_MS: 5000,
  OCR_ENGINE_TIMEOUT_MS: 2500,
  OCR_TOTAL_TIMEOUT_MS: 3000,
  ENHANCEMENT_TARGET_WIDTH: 1200,
  ENHANCEMENT_MAX_WIDTH: 2400,
  ACCEPTED_PAYMENT_STATUSES: new Set(['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'CREDITED', 'DONE', 'SENT', 'DEBIT_SUCCESS']),
  REJECTED_PAYMENT_STATUSES: new Set(['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED', 'UNSUCCESSFUL', 'REVERSED', 'EXPIRED']),
  APPROVED_STATUS: 'verified',
  REJECTED_STATUS: 'rejected',
  MANUAL_REVIEW_STATUS: 'manual_review',
  SUPPORTED_APPS: ['Google Pay', 'GPay', 'PhonePe', 'Paytm', 'BHIM', 'Amazon Pay', 'CRED', 'ICICI Bank', 'HDFC Bank', 'SBI', 'Axis Bank', 'Kotak', 'Yes Bank'],
  WEIGHTS: {
    amount: 15, receiver: 15, status: 10, date: 10, time: 5,
    utr_valid: 10, utr_match: 15, ocr_confidence: 5,
    image_quality: 3, authenticity: 5, bank_sms: 2, fraud: 5,
  },
  SCORE_THRESHOLDS: { autoApprove: 85, manualReview: 60, rejectBelow: 40 },
  FRAUD_THRESHOLDS: { low: 30, medium: 60, high: 80 },
  IST_TIMEZONE: 'Asia/Kolkata',
});
