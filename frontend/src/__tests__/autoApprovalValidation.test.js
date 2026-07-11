import { describe, it, expect } from 'vitest';

const EXPECTED_AMOUNT = 120;
const EXPECTED_UPI_ID = 'jayarajj126-3@okicici';

function normalizeUpi(upi) {
  return upi.toLowerCase().replace(/\s+/g, '');
}

function parseOcrDate(dateStr) {
  if (!dateStr) return '';
  const dmy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  const clean = dateStr.replace(/-/g, '/');
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  const monthFix = { mar: 'may', jur: 'jun', jul: 'jun', aug: 'apr' };
  let fixed = clean;
  for (const [bad, good] of Object.entries(monthFix)) {
    fixed = fixed.replace(new RegExp('\\b' + bad + '\\b', 'gi'), good.charAt(0).toUpperCase() + good.slice(1));
  }
  const parsed2 = new Date(fixed);
  if (!isNaN(parsed2.getTime())) {
    return `${parsed2.getFullYear()}-${String(parsed2.getMonth() + 1).padStart(2, '0')}-${String(parsed2.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function validatePayment({ ocrData, userInputs, todayStr, isDuplicateUtr }) {
  const failures = [];
  const checks = [];

  function fail(check, reason) {
    checks.push({ check, passed: false, reason });
    failures.push(reason);
  }
  function pass(check) {
    checks.push({ check, passed: true });
  }

  // 1. Unique UTR
  if (isDuplicateUtr) {
    fail('Unique UTR', 'Duplicate UTR Detected');
  } else {
    pass('Unique UTR');
  }

  // 2. Receiver UPI — strict exact match
  const upiCandidates = [ocrData?.receiver_upi, ocrData?.upi_id, ocrData?.sender_upi].filter(Boolean);
  const matchedUpi = upiCandidates.find(upi => normalizeUpi(upi) === normalizeUpi(EXPECTED_UPI_ID));
  if (matchedUpi) {
    pass('Receiver UPI');
  } else if (upiCandidates.length > 0) {
    fail('Receiver UPI', `Expected admin UPI "${EXPECTED_UPI_ID}" not found. OCR found: ${upiCandidates.join(', ')}`);
  } else {
    fail('Receiver UPI', 'Admin UPI not detected by OCR');
  }

  // 3. Amount — strict: must exactly equal 120, no substring matching
  let resolvedAmount = ocrData?.amount;
  if (resolvedAmount && ocrData?.raw) {
    const parsedResolved = parseFloat(resolvedAmount.replace(/[,]/g, ''));
    if (!isNaN(parsedResolved) && Math.abs(parsedResolved - EXPECTED_AMOUNT) >= 1) {
      const exactMatch = ocrData.raw.match(new RegExp(`(?:₹|Rs\\.?|INR)\\s*${EXPECTED_AMOUNT}(?:\\.00)?(?!\\d)`, 'i'));
      if (exactMatch) {
        resolvedAmount = String(EXPECTED_AMOUNT);
      }
    }
  }
  if (!resolvedAmount && ocrData?.raw) {
    const exactPattern = new RegExp(`(?:₹|Rs\\.?|INR)\\s*${EXPECTED_AMOUNT}(?:\\.00)?(?!\\d)`, 'i');
    if (exactPattern.test(ocrData.raw)) {
      resolvedAmount = String(EXPECTED_AMOUNT);
    }
  }
  if (resolvedAmount) {
    const parsedAmount = parseFloat(resolvedAmount.replace(/[,]/g, ''));
    if (!isNaN(parsedAmount) && parsedAmount === EXPECTED_AMOUNT) {
      pass('Payment Amount (₹120)');
    } else {
      fail('Payment Amount (₹120)', `OCR read ₹${resolvedAmount}, expected ₹${EXPECTED_AMOUNT}`);
    }
  } else {
    fail('Payment Amount (₹120)', 'Amount not detected in OCR text');
  }

  // 4. Transaction Date
  if (ocrData?.date) {
    const ocrStr = parseOcrDate(ocrData.date);
    if (!ocrStr) {
      fail('Transaction Date', 'Date unreadable from OCR');
    } else if (ocrStr === todayStr) {
      pass('Transaction Date (Today)');
    } else {
      fail('Transaction Date', `Transaction date ${ocrStr} does not match today ${todayStr}`);
    }
  } else {
    fail('Transaction Date', 'Not detected by OCR');
  }

  // 5. UTR Validation — screenshot UTR must match user-entered UTR
  const ocrUtr = ocrData?.utr || ocrData?.transaction_id;
  const userEnteredUtr = userInputs?.utr;
  if (ocrUtr && userEnteredUtr) {
    const normOcrUtr = ocrUtr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const normUserUtr = userEnteredUtr.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (normOcrUtr === normUserUtr) {
      pass('UTR Validation');
    } else {
      fail('UTR Validation', `Screenshot UTR "${ocrUtr}" does not match entered UTR "${userEnteredUtr}"`);
    }
  } else if (!ocrUtr) {
    fail('UTR Validation', 'UTR not detected in screenshot OCR');
  } else {
    fail('UTR Validation', 'No user-entered UTR for comparison');
  }

  // Decision: only core checks
  const coreCheckNames = ['Receiver UPI', 'Payment Amount', 'Payment Status', 'Unique UTR', 'Transaction Date', 'UTR Validation'];
  const coreDetails = checks.filter(c => coreCheckNames.some(n => c.check.includes(n)));
  const allPassed = coreDetails.length > 0 && coreDetails.every(c => c.passed === true);
  const hasAnyFail = coreDetails.some(c => c.passed === false);

  function _auditCheck(namePart) {
    const found = checks.find(c => c.check.includes(namePart));
    return { passed: found ? found.passed === true : false, reason: found && found.reason ? found.reason : 'Check not found' };
  }
  const ocrUtrVal = ocrData?.utr || ocrData?.transaction_id;
  const validationAudit = {
    upi: {
      label: 'Admin UPI Validation',
      ..._auditCheck('Receiver UPI'),
      expected: EXPECTED_UPI_ID,
      actual: upiCandidates.length > 0 ? upiCandidates.join(', ') : 'Not detected',
    },
    utr: {
      label: 'UTR Validation',
      ..._auditCheck('UTR Validation'),
      userEntered: userInputs?.utr || 'N/A',
      ocrDetected: ocrUtrVal || 'N/A',
    },
    duplicateUtr: {
      label: 'Duplicate UTR Validation',
      ..._auditCheck('Unique UTR'),
      expected: 'No duplicate',
      actual: isDuplicateUtr ? 'Duplicate UTR detected' : 'No duplicate found',
    },
    amount: {
      label: 'Amount Validation',
      ..._auditCheck('Payment Amount'),
      expected: `₹${EXPECTED_AMOUNT}`,
      actual: resolvedAmount ? `₹${resolvedAmount}` : 'Not detected',
    },
    date: {
      label: 'Date Validation',
      ..._auditCheck('Transaction Date'),
      expected: todayStr,
      actual: ocrData?.date || 'Not detected',
    },
  };

  return {
    approved: allPassed,
    rejected: hasAnyFail || !allPassed,
    failures,
    checks,
    validationAudit,
  };
}

const TODAY = '2026-06-14';
const NOW_DATE = '14/06/2026';

describe('Payment Auto-Approval Validation', () => {
  describe('MANDATORY: Approve Cases', () => {
    const approveCases = [
      {
        name: 'Valid payment #1',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          transaction_id: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120.00\nUTR: 123456789012`,
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012', amount: '120', date: NOW_DATE },
        isDuplicateUtr: false,
      },
      {
        name: 'Valid payment #2',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '987654321098',
          transaction_id: '987654321098',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120\nUTR: 987654321098`,
          payment_status: 'Success',
        },
        userInputs: { utr: '987654321098', amount: '120', date: NOW_DATE },
        isDuplicateUtr: false,
      },
    ];

    approveCases.forEach(({ name, ocrData, userInputs, isDuplicateUtr }) => {
      it(`APPROVE: ${name}`, () => {
        const result = validatePayment({ ocrData, userInputs, todayStr: TODAY, isDuplicateUtr });
        expect(result.approved).toBe(true);
        expect(result.rejected).toBe(false);
        expect(result.failures).toEqual([]);
      });
    });
  });

  describe('MANDATORY: Reject Cases', () => {
    const rejectCases = [
      {
        name: 'Wrong UPI',
        ocrData: {
          receiver_upi: 'other@upi',
          upi_id: 'other@upi',
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: other@upi\nAmount: ₹120\nUTR: 123456789012`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: false,
        expectedFailures: ['UPI'],
      },
      {
        name: 'UTR mismatch',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '999999999999',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120\nUTR: 999999999999`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: false,
        expectedFailures: ['UTR'],
      },
      {
        name: 'Wrong amount (100 instead of 120)',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '100',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹100\nUTR: 123456789012`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: false,
        expectedFailures: ['Amount'],
      },
      {
        name: 'Wrong amount (1200 instead of 120)',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '1200',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹1,200.00\nUTR: 123456789012`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: false,
        expectedFailures: ['Amount'],
      },
      {
        name: 'Old date (yesterday)',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: '13/06/2026',
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120\nUTR: 123456789012\nDate: 13/06/2026`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: false,
        expectedFailures: ['Date'],
      },
      {
        name: 'Duplicate UTR',
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120\nUTR: 123456789012`,
        },
        userInputs: { utr: '123456789012' },
        isDuplicateUtr: true,
        expectedFailures: ['UTR'],
      },
    ];

    rejectCases.forEach(({ name, ocrData, userInputs, isDuplicateUtr, expectedFailures }) => {
      it(`REJECT: ${name}`, () => {
        const result = validatePayment({ ocrData, userInputs, todayStr: TODAY, isDuplicateUtr });
        expect(result.rejected).toBe(true);
        expect(result.approved).toBe(false);
        expectedFailures.forEach(f => {
          const hasFailedCheck = result.checks.some(c => c.check.includes(f) && c.passed === false);
          expect(hasFailedCheck, `Expected check containing "${f}" to have failed`).toBe(true);
        });
      });
    });
  });

  describe('CRITICAL: Amount Regex Substring Bug', () => {
    const rawAmount = raw => `UPI: ${EXPECTED_UPI_ID}\nAmount: ${raw}\nUTR: 123456789012`;

    it('BUG EXISTS: ₹1200 (no comma) incorrectly matches regex ₹120', () => {
      const rawText = rawAmount('₹1200');
      const regex = new RegExp(`(?:₹|Rs\\.?|INR)\\s*120(?:\\.00)?`, 'i');
      const match = rawText.match(regex);
      expect(match).not.toBeNull();
    });

    it('BUG EXISTS: Rs. 1200 (no comma) incorrectly matches regex Rs. 120', () => {
      const rawText = rawAmount('Rs. 1200');
      const regex = new RegExp(`(?:₹|Rs\\.?|INR)\\s*120(?:\\.00)?`, 'i');
      const match = rawText.match(regex);
      expect(match).not.toBeNull();
    });

    it('BUG EXISTS: INR 1200 (no comma) incorrectly matches regex INR 120', () => {
      const rawText = rawAmount('INR 1200');
      const regex = new RegExp(`(?:₹|Rs\\.?|INR)\\s*120(?:\\.00)?`, 'i');
      const match = rawText.match(regex);
      expect(match).not.toBeNull();
    });

    it('FALSE APPROVAL: ₹1200 with no comma causes false approval in current logic', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '1200',
          date: NOW_DATE,
          raw: rawAmount('₹1200'),
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
      expect(result.approved).toBe(false);
    });

    it('FALSE APPROVAL: Rs. 1120 with no comma causes false approval', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '1120',
          date: NOW_DATE,
          raw: rawAmount('Rs. 1120'),
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
      expect(result.approved).toBe(false);
    });

    it('SAFE: ₹1,200 with comma separator is correctly rejected', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '1200',
          date: NOW_DATE,
          raw: rawAmount('₹1,200.00'),
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('SAFE: ₹120.00 with .00 suffix is correctly approved', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: rawAmount('₹120.00'),
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('SAFE: ₹120 without decimal is correctly approved', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: rawAmount('₹120'),
          payment_status: 'Completed',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });
  });

  describe('EDGE: UPI Variations', () => {
    it('APPROVE: UPI with spaces around it', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: `  ${EXPECTED_UPI_ID}  `,
          upi_id: `  ${EXPECTED_UPI_ID}  `,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('APPROVE: UPI in uppercase', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID.toUpperCase(),
          upi_id: EXPECTED_UPI_ID.toUpperCase(),
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID.toUpperCase()}`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('REJECT: completely different UPI', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: 'someone-else@paytm',
          upi_id: 'someone-else@paytm',
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: 'UPI: someone-else@paytm',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: no UPI detected by OCR', () => {
      const result = validatePayment({
        ocrData: {
          amount: '120',
          utr: '123456789012',
          date: NOW_DATE,
          raw: 'Amount: ₹120\nUTR: 123456789012',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });
  });

  describe('EDGE: Amount Variations', () => {
    it('APPROVE: amount "120.00" (with decimal)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120.00',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120.00`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('APPROVE: amount "120" without decimal', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          upi_id: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('REJECT: amount "120.50" (wrong decimal)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120.50',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120.50`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: amount "121" (wrong amount)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '121',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹121.00`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('APPROVE: amount "0120" (leading zero — parses to 120 numerically)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '0120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹0120`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });
  });

  describe('EDGE: UTR Validation', () => {
    it('APPROVE: UTR match with alphanumeric characters', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: 'TXN123ABC',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nUTR: TXN123ABC`,
        },
        userInputs: { utr: 'TXN123ABC' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('APPROVE: UTR match ignoring special characters', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: 'TXN-123-ABC',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nUTR: TXN-123-ABC`,
        },
        userInputs: { utr: 'TXN123ABC' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('REJECT: UTR mismatch (OCR misread)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: 'L23456',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nUTR: L23456`,
        },
        userInputs: { utr: '123456' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: missing OCR UTR', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: missing user-entered UTR', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: NOW_DATE,
          raw: `UPI: ${EXPECTED_UPI_ID}\nUTR: 123456789012`,
        },
        userInputs: {},
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });
  });

  describe('EDGE: Date Variations', () => {
    it('APPROVE: date in DD/MM/YYYY format', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: '14/06/2026',
          raw: `UPI: ${EXPECTED_UPI_ID}\nDate: 14/06/2026`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.approved).toBe(true);
    });

    it('REJECT: date in DD-MM-YYYY format (hyphen — new Date fails to parse it)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: '14-06-2026',
          raw: `UPI: ${EXPECTED_UPI_ID}\nDate: 14-06-2026`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: future date', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: '15/06/2026',
          raw: `UPI: ${EXPECTED_UPI_ID}\nDate: 15/06/2026`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: invalid date (month 13)', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          date: '14/13/2026',
          raw: `UPI: ${EXPECTED_UPI_ID}\nDate: 14/13/2026`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: missing date in OCR', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: EXPECTED_UPI_ID,
          utr: '123456789012',
          amount: '120',
          raw: `UPI: ${EXPECTED_UPI_ID}\nAmount: ₹120`,
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });
  });

  describe('EDGE: Multiple Failures', () => {
    it('REJECT: all validations fail', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: 'wrong@upi',
          utr: '000000000000',
          amount: '999',
          date: '01/01/2020',
          raw: 'UPI: wrong@upi\nAmount: ₹999\nDate: 01/01/2020',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: true,
      });
      expect(result.rejected).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.failures.length).toBeGreaterThanOrEqual(4);
    });

    it('REJECT: wrong UPI + wrong amount together', () => {
      const result = validatePayment({
        ocrData: {
          receiver_upi: 'fake@upi',
          utr: '123456789012',
          amount: '50',
          date: NOW_DATE,
          raw: 'UPI: fake@upi\nAmount: ₹50',
        },
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
      const upiFailed = result.checks.some(c => c.check.includes('UPI') && c.passed === false);
      const amountFailed = result.checks.some(c => c.check.includes('Amount') && c.passed === false);
      expect(upiFailed).toBe(true);
      expect(amountFailed).toBe(true);
    });
  });

  describe('EDGE: Empty / Missing Data', () => {
    it('REJECT: completely empty OCR data', () => {
      const result = validatePayment({
        ocrData: {},
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: null OCR data', () => {
      const result = validatePayment({
        ocrData: null,
        userInputs: { utr: '123456789012' },
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });

    it('REJECT: no user inputs and no ocr data', () => {
      const result = validatePayment({
        ocrData: {},
        userInputs: {},
        todayStr: TODAY,
        isDuplicateUtr: false,
      });
      expect(result.rejected).toBe(true);
    });
  });
});

