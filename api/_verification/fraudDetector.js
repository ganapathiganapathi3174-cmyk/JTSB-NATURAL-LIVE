const C = require('./config');
const log = require('./logger').FRAUD;

function detectTextAnomalies(ocrText) {
  const issues = [];
  let score = 0;
  const upperText = ocrText.toUpperCase();
  if (/(?:PHOTOSHOP|EDITED|MODIFIED|CANVA|SNAPSEED|PICSART)/i.test(ocrText)) { issues.push('Editing software name detected'); score += 40; }
  if (/(?:SAMPLE|DUMMY|TEST|TEMPLATE|FAKE)/i.test(upperText)) { issues.push('Suspicious keyword detected'); score += 30; }
  const repeatedPattern = /(.)\1{5,}/;
  if (repeatedPattern.test(ocrText)) { issues.push('Repeated characters detected (possible manipulation)'); score += 15; }
  const lines = ocrText.split('\n').filter(l => l.trim().length > 0);
  if (lines.length > 0 && lines.length < 3) { issues.push('Very few text lines (possible cropped screenshot)'); score += 10; }
  const numberDensity = (ocrText.match(/\d/g) || []).length / Math.max(1, ocrText.length);
  if (numberDensity > 0.5) { issues.push('Abnormal digit density (' + Math.round(numberDensity * 100) + '%)'); score += 10; }
  const specialChars = (ocrText.match(/[^\w\s.,\-:\/@₹()]/g) || []).length;
  if (specialChars > ocrText.length * 0.1) { issues.push('High special character density'); score += 10; }
  return { issues, score: Math.min(score, 100) };
}

function detectReceiverAnomalies(extractedReceiver, expectedReceiver) {
  const issues = [];
  let score = 0;
  if (!extractedReceiver) return { issues: ['Receiver not found in OCR'], score: 30 };
  const found = extractedReceiver.toLowerCase();
  const expected = expectedReceiver.toLowerCase();
  if (found === expected) return { issues, score: 0 };
  const expectedUser = expected.split('@')[0];
  const foundUser = found.split('@')[0];
  if (foundUser.length < 3) { issues.push('Suspiciously short receiver username (' + foundUser + ')'); score += 20; }
  if (/\d{4,}/.test(foundUser) && foundUser !== expectedUser) { issues.push('Receiver has long numeric prefix different from expected'); score += 15; }
  if (found.split('@')[1] && expected.split('@')[1] && found.split('@')[1] !== expected.split('@')[1]) { issues.push('UPI domain mismatch'); score += 10; }
  return { issues, score: Math.min(score, 100) };
}

function detectTimingAnomalies(orderCreatedAt, paymentTimeStr) {
  const issues = [];
  let score = 0;
  if (!orderCreatedAt) return { issues, score: 0 };
  const now = new Date();
  const orderTime = new Date(orderCreatedAt);
  const diffMs = now.getTime() - orderTime.getTime();
  const diffMinutes = diffMs / 60000;
  if (diffMinutes < 1) { issues.push('Payment submitted within 1 minute of session creation (possibly pre-staged)'); score += 20; }
  if (diffMinutes > C.MAX_SESSION_AGE_MINUTES * 3) { issues.push('Payment submitted after ' + Math.round(diffMinutes) + ' minutes (exceeds 3x normal window)'); score += 15; }
  if (paymentTimeStr) {
    const m = paymentTimeStr.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const hours = parseInt(m[1]);
      if (hours >= 0 && hours < 5) { issues.push('Transaction at unusual hour (' + paymentTimeStr + ')'); score += 10; }
    }
  }
  return { issues, score: Math.min(score, 100) };
}

function detectAmountAnomalies(extractedAmount, expectedAmount) {
  const issues = [];
  let score = 0;
  if (!extractedAmount || extractedAmount.value === null) return { issues: ['Amount not extracted'], score: 10 };
  const found = Number(extractedAmount.value);
  const expected = Number(expectedAmount);
  if (found !== expected && C.ALLOWED_AMOUNTS.includes(found)) {
    issues.push('Amount ₹' + found + ' is a valid package amount but differs from expected ₹' + expected);
    score += 10;
  }
  if (found > 100000) { issues.push('Abnormally high amount: ₹' + found); score += 25; }
  if (found <= 0) { issues.push('Invalid amount: ₹' + found); score += 30; }
  return { issues, score: Math.min(score, 100) };
}

function detectImageAnomalies(authResult, qualityResult) {
  const issues = [];
  let score = 0;
  if (authResult) {
    if (authResult.isCameraPhoto) { issues.push('Screenshot appears to be a camera photo (not a direct screenshot)'); score += 25; }
    if (authResult.isEdited) { issues.push('ELA analysis suggests image editing'); score += 20; }
    if (authResult.isCropped) { issues.push('Image appears cropped at edges'); score += 10; }
    if (authResult.isOverlay) { issues.push('Possible overlay detected'); score += 15; }
    if (authResult.tamperScore > 50) { issues.push('High tamper score: ' + authResult.tamperScore); score += 15; }
  }
  if (qualityResult) {
    if (qualityResult.blurScore > 70) { issues.push('Very blurry image (score=' + qualityResult.blurScore + ')'); score += 10; }
    if (qualityResult.darkScore > 70) { issues.push('Very dark image (score=' + qualityResult.darkScore + ')'); score += 10; }
  }
  return { issues, score: Math.min(score, 100) };
}

function detectOcrConfidenceAnomalies(confidence) {
  const issues = [];
  let score = 0;
  if (confidence < 40) { issues.push('Very low OCR confidence: ' + Math.round(confidence) + '%'); score += 30; }
  else if (confidence < 60) { issues.push('Low OCR confidence: ' + Math.round(confidence) + '%'); score += 15; }
  else if (confidence < 80) { issues.push('Moderate OCR confidence: ' + Math.round(confidence) + '%'); score += 5; }
  return { issues, score: Math.min(score, 100) };
}

function run({ ocrText, extracted, authResult, qualityResult, ocrConfidence }) {
  const t0 = Date.now();
  const expectedReceiver = C.EXPECTED_RECEIVER_UPI;
  const expectedAmount = C.TEST_MODE ? C.TEST_PAYMENT_AMOUNT : 0;

  const textAnomalies = detectTextAnomalies(ocrText || '');
  const receiverAnomalies = detectReceiverAnomalies(
    extracted && extracted.receiverUpi ? extracted.receiverUpi.value : null,
    expectedReceiver
  );
  const amountAnomalies = detectAmountAnomalies(extracted && extracted.amount, expectedAmount);
  const imageAnomalies = detectImageAnomalies(authResult, qualityResult);
  const ocrAnomalies = detectOcrConfidenceAnomalies(ocrConfidence || 0);

  const allIssues = [
    ...textAnomalies.issues,
    ...receiverAnomalies.issues,
    ...amountAnomalies.issues,
    ...imageAnomalies.issues,
    ...ocrAnomalies.issues,
  ];
  const fraudScore = Math.min(100, Math.round(
    textAnomalies.score * 0.2 +
    receiverAnomalies.score * 0.25 +
    amountAnomalies.score * 0.15 +
    imageAnomalies.score * 0.25 +
    ocrAnomalies.score * 0.15
  ));
  let riskLevel = 'low';
  if (fraudScore >= C.FRAUD_THRESHOLDS.high) riskLevel = 'high';
  else if (fraudScore >= C.FRAUD_THRESHOLDS.medium) riskLevel = 'medium';
  else if (fraudScore >= C.FRAUD_THRESHOLDS.low) riskLevel = 'low';

  log.info('', 'Fraud score=' + fraudScore + ' risk=' + riskLevel + ' flags=' + allIssues.length + ' (' + (Date.now() - t0) + 'ms)');
  return { fraudScore, riskLevel, issues: allIssues, breakdown: { text: textAnomalies.score, receiver: receiverAnomalies.score, amount: amountAnomalies.score, image: imageAnomalies.score, ocr: ocrAnomalies.score }, duration: Date.now() - t0 };
}

module.exports = { run };
