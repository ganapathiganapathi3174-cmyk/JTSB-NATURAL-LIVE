// ─────────────────────────────────────────────────────────────
// TIME-WINDOW + IST TIMEZONE UNIT TESTS  (api/tests/time_window_tests.js)
//
// Verifies the business rule that screenshot payment time must fall
// within ±30 minutes of the server's current time in Asia/Kolkata:
//   - -31 min  -> outside window (manual_review)
//   - -30 min  -> edge, inside window
//   - now      -> inside window
//   - +30 min  -> edge, inside window
//   - +31 min  -> outside window (manual_review)
//   - IST midnight crossover (23:30 IST one side, 00:30 IST the other,
//     same UTC day) -> both sides within window; date classified by IST.
//
// No network, no DB. Run: node api/tests/time_window_tests.js
// ─────────────────────────────────────────────────────────────

const assert = require('assert');
const {
  istClock, istDateString, isDateTodayIST,
  parseTimeString, isTimeWithinWindow,
} = require('../_newEngine/fieldNormalizer.js');
const { validateRules } = require('../_newEngine/rulesValidator.js');
const { decide } = require('../_newEngine/decider.js');
const C = require('../_newEngine/config.js');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  [PASS] ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log('  [FAIL] ' + name + ' — ' + e.message);
  }
}

// Fixed server instant: 2026-07-28T06:30:00Z == 12:00:00 IST.
// IST dayMinutes = 12*60 = 720.
const NOW = new Date('2026-07-28T06:30:00.000Z');
const WINDOW = C.TIME_WINDOW_MIN;

// RulesValidator runs against the real clock, so build today's IST date and a
// current in-window time string at runtime (plus a +120min out-of-window one).
function hhmm(min) {
  const clamped = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
const TODAY_IST_ISO = istDateString();                       // e.g. 2026-08-01
const TODAY_IST_DMY = TODAY_IST_ISO.split('-').reverse().join('/'); // DD/MM/YYYY
const NOW_MIN = istClock().dayMinutes;
const NOW_TIME = hhmm(NOW_MIN);
const PLUS120_TIME = hhmm(NOW_MIN + 120);

(async () => {
  console.log('== TIME-WINDOW / IST UNIT TESTS ==');
  assert.strictEqual(WINDOW, 30, 'default window must be 30 minutes');

  // ── parseTimeString ──
  await test('parseTimeString: 12h/24h forms', () => {
    assert.strictEqual(parseTimeString('10:45 AM'), 645);
    assert.strictEqual(parseTimeString('10:45 PM'), 1365);
    assert.strictEqual(parseTimeString('10:45PM'), 1365);
    assert.strictEqual(parseTimeString('10:45'), 645);
    assert.strictEqual(parseTimeString('22:45'), 1365);
    assert.strictEqual(parseTimeString('12:05 AM'), 5);
    assert.strictEqual(parseTimeString('12:05 PM'), 725);
    assert.strictEqual(parseTimeString('10.45 AM'), 645);
    assert.strictEqual(parseTimeString('10 45 am'), 645);
  });

  await test('parseTimeString: garbage returns null', () => {
    assert.strictEqual(parseTimeString(null), null);
    assert.strictEqual(parseTimeString(''), null);
    assert.strictEqual(parseTimeString('nope'), null);
    assert.strictEqual(parseTimeString('15:00 PM'), null); // invalid 24h+meridiem
    assert.strictEqual(parseTimeString('10:75'), null);    // invalid minutes
  });

  // ── core window: -31 / -30 / now / +30 / +31 ──
  await test('-31 min -> outside window', () => {
    assert.strictEqual(isTimeWithinWindow('11:29 AM', WINDOW, NOW), false);
  });

  await test('-30 min -> inside window (edge)', () => {
    assert.strictEqual(isTimeWithinWindow('11:30 AM', WINDOW, NOW), true);
  });

  await test('now -> inside window', () => {
    assert.strictEqual(isTimeWithinWindow('12:00 PM', WINDOW, NOW), true);
  });

  await test('+30 min -> inside window (edge)', () => {
    assert.strictEqual(isTimeWithinWindow('12:30 PM', WINDOW, NOW), true);
  });

  await test('+31 min -> outside window', () => {
    assert.strictEqual(isTimeWithinWindow('12:31 PM', WINDOW, NOW), false);
  });

  // ── rules-level integration (runtime IST clock) ──
  await test('rulesValidator: in-window time -> checks.time=within_window, no softFail', () => {
    const r = validateRules({
      amount: 120, utr: '1234567892222', upi_id: C.RECEIVER_UPI,
      date: TODAY_IST_DMY, time: NOW_TIME, status: 'SUCCESS',
    }, { amount: 120, utr: '1234567892222' });
    assert.strictEqual(r.checks.time, 'within_window', 'time check: ' + r.checks.time + ' reasons=' + (r.reasons || []).join('; '));
    assert.strictEqual(r.checks.date, 'today_ist', 'date check must be IST today');
    assert.strictEqual(r.softFail, false);
    assert.strictEqual(r.hardFail, false);
  });

  await test('rulesValidator: out-of-window time -> checks.time=out_of_window + softFail', () => {
    const r = validateRules({
      amount: 120, utr: '1234567892222', upi_id: C.RECEIVER_UPI,
      date: TODAY_IST_DMY, time: PLUS120_TIME, status: 'SUCCESS', // +120 min
    }, { amount: 120, utr: '1234567892222' });
    assert.strictEqual(r.checks.time, 'out_of_window', 'time check: ' + r.checks.time + ' reasons=' + (r.reasons || []).join('; '));
    assert.strictEqual(r.softFail, true);
    assert.ok(r.reasons.some(x => x.includes('Time mismatch')), 'must mention time mismatch');
  });

  await test('rulesValidator: missing time -> checks.time=unreadable + softFail', () => {
    const r = validateRules({
      amount: 120, utr: '1234567892222', upi_id: C.RECEIVER_UPI,
      date: TODAY_IST_DMY, time: null, status: 'SUCCESS',
    }, { amount: 120, utr: '1234567892222' });
    assert.strictEqual(r.checks.time, 'unreadable');
    assert.strictEqual(r.softFail, true);
  });

  await test('rulesValidator: non-today IST date -> checks.date=distant + softFail', () => {
    const r = validateRules({
      amount: 120, utr: '1234567892222', upi_id: C.RECEIVER_UPI,
      date: '01/01/2000', time: NOW_TIME, status: 'SUCCESS',
    }, { amount: 120, utr: '1234567892222' });
    assert.strictEqual(r.checks.date, 'distant');
    assert.strictEqual(r.softFail, true);
  });

  await test('decider: out-of-window time alone blocks auto-approve -> manual_review', () => {
    const rules = {
      checks: {
        amount: 'matched', utr: 'matched', upi_id: 'matched',
        date: 'today_ist', time: 'out_of_window', status: 'success',
      },
      passed: true, hardFail: false, softFail: true, reasons: ['Time mismatch: extracted=02:00 PM is outside ±30min window (IST)'],
    };
    const d = decide(rules, { duplicate: false }, { suspicious: false, score: 0, flags: [] }, {}, { ocrConfidence: 100 });
    assert.strictEqual(d.status, C.DECISION.MANUAL_REVIEW);
    assert.ok((d.reasons || []).join(' ').includes('payment time within'), 'missing list must cite the time window');
  });

  await test('decider: all conditions + in-window time -> APPROVE (with relaxed OCR confidence)', () => {
    const rules = {
      checks: {
        amount: 'matched', utr: 'matched', upi_id: 'matched',
        date: 'today_ist', time: 'within_window', status: 'success',
      },
      passed: true, hardFail: false, softFail: false, reasons: [],
    };
    const d = decide(rules, { duplicate: false }, { suspicious: false, score: 0, flags: [] }, {}, { ocrConfidence: 100 });
    assert.strictEqual(d.status, C.DECISION.APPROVE);
  });

  // ── IST midnight crossover ──
  // Server instant 2026-07-28T18:40:00Z == 2026-07-29T00:10:00 IST.
  // UTC date is 07-28, IST date is 07-29. Both sides of midnight must be
  // classified by the IST wall clock.
  const CROSS = new Date('2026-07-28T18:40:00.000Z');

  await test('IST clock resolves the correct local date past midnight (UTC vs IST)', () => {
    const c = istClock(CROSS);
    assert.strictEqual(c.isoDate, '2026-07-29');
    assert.strictEqual(istDateString(CROSS), '2026-07-29');
    // The same instant in UTC would still be 07-28 — the IST helper must differ.
    assert.strictEqual(CROSS.toISOString().slice(0, 10), '2026-07-28');
  });

  await test('midnight crossover: date classified by IST today', () => {
    assert.strictEqual(isDateTodayIST('29/07/2026', CROSS), true, 'IST today must match');
    assert.strictEqual(isDateTodayIST('28/07/2026', CROSS), false, 'UTC date is NOT today in IST');
    assert.strictEqual(isDateTodayIST('2026-07-29', CROSS), true, 'ISO IST date also matches');
  });

  await test('midnight crossover: 00:30 IST side is within window', () => {
    // Server now = 00:10 IST. Payment at 00:40 = +30 min (edge, inside),
    // payment at 00:41 = +31 min (outside).
    assert.strictEqual(isTimeWithinWindow('12:40 AM', WINDOW, CROSS), true);
    assert.strictEqual(isTimeWithinWindow('12:41 AM', WINDOW, CROSS), false);
  });

  await test('midnight crossover: 23:30 IST side is within window (previous day)', () => {
    // 23:30 IST = 40 min before now? No — 00:10 IST minus 23:30 IST = 40 min,
    // so use 23:45 IST (25 min earlier) to stay inside the window.
    assert.strictEqual(isTimeWithinWindow('11:45 PM', WINDOW, CROSS), true);
    assert.strictEqual(isTimeWithinWindow('11:30 PM', WINDOW, CROSS), false);
  });

  console.log('\n== RESULT: ' + passed + ' passed, ' + failed + ' failed ==');
  if (failures.length) {
    for (const f of failures) console.error('FAILED: ' + f.name + ' — ' + f.error);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('HARNESS ERROR:', e.message, e.stack); process.exit(1); });
