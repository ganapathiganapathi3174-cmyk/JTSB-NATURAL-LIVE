const crypto = require('crypto');

function log(msg) {
  console.log(`[FRAUD-DETECTION] ${msg}`);
}

async function detectFraud(imageBuffer, votedResult, existingData) {
  const tStart = Date.now();
  log('Starting fraud detection analysis');

  const result = {
    score: 0,
    riskLevel: 'SAFE',
    flags: [],
    details: {},
    checks: {},
  };

  let totalRisk = 0;
  const maxRisk = 100;

  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

  const duplicateCheck = checkDuplicates(imageHash, votedResult, existingData);
  result.checks.duplicateCheck = duplicateCheck;
  if (duplicateCheck.isDuplicate) {
    totalRisk += 30;
    result.flags.push('duplicate_submission');
    result.details.duplicate = duplicateCheck.detail;
  }

  const screenshotCheck = checkScreenshotAuthenticity(imageBuffer);
  result.checks.screenshotCheck = screenshotCheck;
  if (screenshotCheck.isTampered) {
    totalRisk += screenshotCheck.riskContribution;
    result.flags.push('potential_tampering');
    result.details.tampering = screenshotCheck.detail;
  }

  const amountAnomalyCheck = checkAmountAnomalies(votedResult);
  result.checks.amountCheck = amountAnomalyCheck;
  if (amountAnomalyCheck.isAnomalous) {
    totalRisk += amountAnomalyCheck.riskContribution;
    result.flags.push('amount_anomaly');
    result.details.amountAnomaly = amountAnomalyCheck.detail;
  }

  const upiAnomalyCheck = checkUPIAnomalies(votedResult);
  result.checks.upiCheck = upiAnomalyCheck;
  if (upiAnomalyCheck.isSuspicious) {
    totalRisk += upiAnomalyCheck.riskContribution;
    result.flags.push('suspicious_upi');
    result.details.upiAnomaly = upiAnomalyCheck.detail;
  }

  const timeAnomalyCheck = checkTimeAnomalies(votedResult);
  result.checks.timeCheck = timeAnomalyCheck;
  if (timeAnomalyCheck.isSuspicious) {
    totalRisk += timeAnomalyCheck.riskContribution;
    result.flags.push('time_anomaly');
    result.details.timeAnomaly = timeAnomalyCheck.detail;
  }

  const utrAnomalyCheck = checkUTRPatterAnomalies(votedResult);
  result.checks.utrCheck = utrAnomalyCheck;
  if (utrAnomalyCheck.isSuspicious) {
    totalRisk += utrAnomalyCheck.riskContribution;
    result.flags.push('suspicious_utr_pattern');
    result.details.utrAnomaly = utrAnomalyCheck.detail;
  }

  result.score = Math.min(maxRisk, totalRisk);

  if (result.score <= 20) result.riskLevel = 'SAFE';
  else if (result.score <= 50) result.riskLevel = 'LOW_RISK';
  else if (result.score <= 80) result.riskLevel = 'MEDIUM_RISK';
  else result.riskLevel = 'HIGH_RISK';

  log(`Fraud score: ${result.score}, risk: ${result.riskLevel}, flags: ${result.flags.length}`);
  result.processingTime = Date.now() - tStart;
  return result;
}

function checkDuplicates(imageHash, votedResult, existingData) {
  const result = { isDuplicate: false, riskContribution: 0, detail: '' };

  if (existingData && existingData.existingHashes) {
    const hashes = Array.isArray(existingData.existingHashes) ? existingData.existingHashes : [];
    const existingUtrs = Array.isArray(existingData.existingUtrs) ? existingData.existingUtrs : [];

    if (hashes.includes(imageHash)) {
      result.isDuplicate = true;
      result.riskContribution = 30;
      result.detail = 'Screenshot hash matches existing submission';
      return result;
    }

    if (votedResult.utr && votedResult.utr.value) {
      const utr = String(votedResult.utr.value).toUpperCase().replace(/\s+/g, '');
      if (existingUtrs.includes(utr)) {
        result.isDuplicate = true;
        result.riskContribution = 25;
        result.detail = 'UTR matches existing transaction';
        return result;
      }
    }
  }

  return result;
}

function checkScreenshotAuthenticity(imageBuffer) {
  const result = { isTampered: false, riskContribution: 0, detail: '' };

  try {
    const size = imageBuffer.length;

    if (size < 1024) {
      result.isTampered = true;
      result.riskContribution = 20;
      result.detail = `Suspiciously small image: ${(size / 1024).toFixed(1)}KB`;
      return result;
    }

    if (size > 10 * 1024 * 1024) {
      result.isTampered = true;
      result.riskContribution = 10;
      result.detail = `Unusually large image: ${(size / 1024 / 1024).toFixed(1)}MB`;
      return result;
    }

    const header = imageBuffer.slice(0, 4);
    const footer = imageBuffer.slice(-4);
    const validHeaders = [
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
      Buffer.from([0xFF, 0xD8, 0xFF, 0xE1]),
      Buffer.from([0x89, 0x50, 0x4E, 0x47]),
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
    ];

    const hasValidHeader = validHeaders.some(h =>
      header.slice(0, h.length).equals(h)
    );

    if (!hasValidHeader) {
      result.isTampered = true;
      result.riskContribution = 15;
      result.detail = 'Invalid or unusual image header';
    }
  } catch (err) {
    result.detail = `Error checking image: ${err.message}`;
  }

  return result;
}

function checkAmountAnomalies(votedResult) {
  const result = { isAnomalous: false, riskContribution: 0, detail: '' };

  if (votedResult.amount && votedResult.amount.value) {
    const amount = parseFloat(String(votedResult.amount.value).replace(/[^0-9.]/g, ''));
    if (!isNaN(amount)) {
      if (amount <= 0) {
        result.isAnomalous = true;
        result.riskContribution = 20;
        result.detail = `Invalid amount: ${amount}`;
      } else if (amount > 100000) {
        result.isAnomalous = true;
        result.riskContribution = 10;
        result.detail = `Unusually high amount: ${amount}`;
      }
    } else {
      result.isAnomalous = true;
      result.riskContribution = 15;
      result.detail = `Unparseable amount: ${votedResult.amount.value}`;
    }
  }

  return result;
}

function checkUPIAnomalies(votedResult) {
  const result = { isSuspicious: false, riskContribution: 0, detail: '' };

  if (votedResult.upi && votedResult.upi.value) {
    const upi = String(votedResult.upi.value).toLowerCase().trim();
    const upiRegex = /^[\w.\-]+@[\w.]+$/;
    if (!upiRegex.test(upi)) {
      result.isSuspicious = true;
      result.riskContribution = 15;
      result.detail = `Invalid UPI format: ${upi}`;
    }
  }

  return result;
}

function checkTimeAnomalies(votedResult) {
  const result = { isSuspicious: false, riskContribution: 0, detail: '' };

  if (votedResult.time && votedResult.time.value) {
    const timeStr = String(votedResult.time.value).trim();
    const match = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      const hours = parseInt(match[1], 10);
      if (hours < 0 || hours > 23) {
        result.isSuspicious = true;
        result.riskContribution = 10;
        result.detail = `Invalid hour value: ${hours}`;
      }
    }
  }

  return result;
}

function checkUTRPatterAnomalies(votedResult) {
  const result = { isSuspicious: false, riskContribution: 0, detail: '' };

  if (votedResult.utr && votedResult.utr.value) {
    const utr = String(votedResult.utr.value).replace(/\s+/g, '');

    const repeatedPattern = /^(\d)\1{9,}$/;
    if (repeatedPattern.test(utr)) {
      result.isSuspicious = true;
      result.riskContribution = 25;
      result.detail = 'UTR contains all same digits (likely fake)';
      return result;
    }

    const sequentialPattern = /^1234567890/;
    if (sequentialPattern.test(utr)) {
      result.isSuspicious = true;
      result.riskContribution = 20;
      result.detail = 'UTR is sequential (likely fake)';
      return result;
    }

    if (utr.length < 10 || utr.length > 30) {
      result.isSuspicious = true;
      result.riskContribution = 10;
      result.detail = `Unusual UTR length: ${utr.length}`;
    }
  }

  return result;
}

module.exports = { detectFraud };
