const { ADMIN_UPI_ID, ALLOWED_PACKAGE_AMOUNTS } = require('./_shared.js');

function log(msg) {
  console.log(`[BUSINESS-RULES] ${msg}`);
}

function validateBusinessRules(votedResult, expectedData) {
  const tStart = Date.now();
  log('Validating business rules');

  const result = {
    passed: false,
    amountCheck: { passed: false, expected: null, extracted: null, detail: '' },
    upiCheck: { passed: false, expected: null, extracted: null, detail: '' },
    utrCheck: { passed: false, detail: '' },
    dateCheck: { passed: false, detail: '' },
    timeCheck: { passed: false, detail: '' },
    duplicateCheck: { passed: true, detail: '' },
    statusCheck: { passed: false, detail: '' },
    allChecks: [],
    overallPassed: false,
    blockingIssues: [],
  };

  const expectedAmount = expectedData.amount;
  const expectedUpi = expectedData.upiId || ADMIN_UPI_ID;
  const expectedUtr = expectedData.utr;
  const expectedDate = expectedData.date;

  if (votedResult.amount && votedResult.amount.value) {
    const extractedAmount = parseFloat(votedResult.amount.value);
    result.amountCheck.extracted = extractedAmount;
    result.amountCheck.expected = expectedAmount;

    if (!isNaN(extractedAmount) && extractedAmount > 0) {
      const allowed = expectedData.allowedAmounts || ALLOWED_PACKAGE_AMOUNTS;
      if (expectedAmount && Math.abs(extractedAmount - expectedAmount) < 0.01) {
        result.amountCheck.passed = true;
        result.amountCheck.detail = `Amount ${extractedAmount} matches expected ${expectedAmount}`;
      } else if (allowed.includes(extractedAmount)) {
        result.amountCheck.passed = true;
        result.amountCheck.detail = `Amount ${extractedAmount} is in allowed list`;
      } else {
        result.amountCheck.detail = `Amount ${extractedAmount} does not match expected ${expectedAmount}`;
        result.blockingIssues.push(result.amountCheck.detail);
      }
    } else {
      result.amountCheck.detail = 'Could not parse extracted amount';
      result.blockingIssues.push(result.amountCheck.detail);
    }
  } else {
    result.amountCheck.detail = 'No amount extracted from screenshot';
    result.blockingIssues.push(result.amountCheck.detail);
  }

  if (votedResult.upi && votedResult.upi.value) {
    const extractedUpi = String(votedResult.upi.value).toLowerCase().replace(/\s+/g, '');
    result.upiCheck.extracted = extractedUpi;
    result.upiCheck.expected = expectedUpi;

    const expectedNormalized = String(expectedUpi).toLowerCase().replace(/\s+/g, '');
    if (extractedUpi === expectedNormalized) {
      result.upiCheck.passed = true;
      result.upiCheck.detail = `UPI ${extractedUpi} matches expected`;
    } else if (extractedUpi.includes(expectedNormalized.split('@')[0])) {
      result.upiCheck.passed = true;
      result.upiCheck.detail = `UPI ${extractedUpi} partially matches expected`;
    } else {
      result.upiCheck.detail = `UPI ${extractedUpi} does not match expected ${expectedUpi}`;
      result.blockingIssues.push(result.upiCheck.detail);
    }
  } else {
    result.upiCheck.detail = 'No UPI extracted from screenshot';
  }

  if (expectedUtr && votedResult.utr && votedResult.utr.value) {
    const extractedUtr = String(votedResult.utr.value).toUpperCase().replace(/\s+/g, '');
    const expectedUtrNorm = String(expectedUtr).toUpperCase().replace(/\s+/g, '');
    if (extractedUtr === expectedUtrNorm) {
      result.utrCheck.passed = true;
      result.utrCheck.detail = 'UTR matches user input';
    } else {
      result.utrCheck.detail = `UTR mismatch: extracted=${extractedUtr.substring(0, 8)}...`;
    }
  } else {
    result.utrCheck.detail = 'No UTR extracted or expected';
  }

  if (votedResult.date && votedResult.date.value) {
    const extractedDate = String(votedResult.date.value).trim();
    result.dateCheck.extracted = extractedDate;

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];

    const dateNorm = extractedDate.replace(/[-/]/g, '');
    const todayNorm = todayStr.replace(/-/g, '');
    const yesterdayNorm = yesterdayStr.replace(/-/g, '');
    const tomorrowNorm = tomorrowStr.replace(/-/g, '');

    if (dateNorm === todayNorm || extractedDate === todayStr) {
      result.dateCheck.passed = true;
      result.dateCheck.detail = 'Date matches today';
    } else if (dateNorm === yesterdayNorm || extractedDate === yesterdayStr) {
      result.dateCheck.passed = true;
      result.dateCheck.detail = 'Date matches yesterday (within window)';
    } else if (dateNorm === tomorrowNorm || extractedDate === tomorrowStr) {
      result.dateCheck.passed = true;
      result.dateCheck.detail = 'Date matches tomorrow (timezone difference)';
    } else {
      result.dateCheck.detail = `Date ${extractedDate} is not today (${todayStr})`;
      result.blockingIssues.push(result.dateCheck.detail);
    }
  } else {
    result.dateCheck.detail = 'No date extracted from screenshot';
  }

  if (votedResult.time && votedResult.time.value) {
    const timeStr = String(votedResult.time.value).trim();
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const extractedMinutes = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      let diff = Math.abs(extractedMinutes - currentMinutes);
      if (diff > 720) diff = 1440 - diff;

      if (diff <= 30) {
        result.timeCheck.passed = true;
        result.timeCheck.detail = `Time within ${diff}min window`;
      } else {
        result.timeCheck.detail = `Time difference ${diff}min exceeds 30min window`;
      }
    } else {
      result.timeCheck.detail = 'Could not parse time format';
    }
  } else {
    result.timeCheck.detail = 'No time extracted from screenshot';
  }

  if (votedResult.status && votedResult.status.value) {
    const statusVal = String(votedResult.status.value).toUpperCase();
    if (['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'PAID', 'CREDITED'].includes(statusVal)) {
      result.statusCheck.passed = true;
      result.statusCheck.detail = `Payment status: ${statusVal}`;
    } else {
      result.statusCheck.detail = `Payment status is not SUCCESS: ${statusVal}`;
      result.blockingIssues.push(result.statusCheck.detail);
    }
  } else {
    result.statusCheck.detail = 'No status extracted from screenshot';
  }

  const checks = [
    { name: 'amount', check: result.amountCheck },
    { name: 'upi', check: result.upiCheck },
    { name: 'utr', check: result.utrCheck },
    { name: 'date', check: result.dateCheck },
    { name: 'time', check: result.timeCheck },
    { name: 'status', check: result.statusCheck },
  ];

  result.allChecks = checks.map(c => ({ name: c.name, passed: c.check.passed }));
  result.overallPassed = result.allChecks.every(c => c.passed);
  result.passed = result.overallPassed;

  log(`Business rules: ${result.overallPassed ? 'PASSED' : 'FAILED'}, ${result.blockingIssues.length} blocking issues`);
  return result;
}

module.exports = { validateBusinessRules };
