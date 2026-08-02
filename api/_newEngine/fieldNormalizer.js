function normalizeUTR(val) {
  if (!val) return '';
  const subs = { 'O': '0', 'I': '1', 'S': '5', 'B': '8', 'Z': '2', 'G': '6' };
  return val.toUpperCase().trim().replace(/[^A-Z0-9]/g, '').split('').map(c => subs[c] || c).join('');
}

function normalizeUPI(val) {
  if (!val) return '';
  return val.toLowerCase().trim().replace(/\s+/g, '');
}

function normalizeAmount(val) {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function todayString() {
  return istDateString();
}

function yesterdayString() {
  return istDateString(new Date(Date.now() - 86400000));
}

function tomorrowString() {
  return istDateString(new Date(Date.now() + 86400000));
}

function parseDateString(str) {
  if (!str) return null;
  str = String(str).trim();

  const patterns = [
    { re: /^(\d{4})-(\d{2})-(\d{2})$/, f: (m) => `${m[1]}-${m[2]}-${m[3]}` },
    { re: /^(\d{2})-(\d{2})-(\d{4})$/, f: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    { re: /^(\d{2})\/(\d{2})\/(\d{4})$/, f: (m) => `${m[3]}-${m[2]}-${m[1]}` },
    { re: /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/i, f: (m) => {
      const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const mo = months[m[2].toLowerCase().slice(0, 3)];
      return mo ? `${m[3]}-${mo}-${String(m[1]).padStart(2,'0')}` : null;
    }},
    { re: /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i, f: (m) => {
      const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const mo = months[m[1].toLowerCase().slice(0, 3)];
      return mo ? `${m[3]}-${mo}-${String(m[2]).padStart(2,'0')}` : null;
    }},
    { re: /^(\d{2})\s+([A-Za-z]{3})\s+(\d{2,4})$/i, f: (m) => {
      const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
      const mo = months[m[2].toLowerCase().slice(0, 3)];
      if (!mo) return null;
      const yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${yr}-${mo}-${String(m[1]).padStart(2,'0')}`;
    }},
  ];

  for (const p of patterns) {
    const m = str.match(p.re);
    if (m) {
      const r = p.f(m);
      if (r) return r;
    }
  }
  return null;
}

function isTodayOrNear(dateStr, toleranceDays) {
  if (!dateStr) return false;
  const parsed = parseDateString(dateStr) || dateStr;
  const d = new Date(parsed);
  if (isNaN(d.getTime())) return false;
  const today = new Date(istDateString() + 'T00:00:00Z');
  const diffDays = Math.round((d - today) / 86400000);
  return Math.abs(diffDays) <= (toleranceDays || 1);
}

// ─────────────────────────────────────────────────────────────
// IST (Asia/Kolkata) TIMEZONE HELPERS
//
// India has no DST, so IST = UTC + 05:30 exactly. All payment
// timestamp comparisons (date must be today, time within ±window)
// are resolved against the Asia/Kolkata wall clock — NOT the UTC
// date that `toISOString()` would produce.
// ─────────────────────────────────────────────────────────────

const IST_OFFSET_MIN = 330; // UTC+05:30

function istClock(now) {
  const d = new Date((now instanceof Date ? now : new Date()).getTime() + IST_OFFSET_MIN * 60000);
  const iso = d.toISOString();
  return {
    isoDate: iso.slice(0, 10),                 // YYYY-MM-DD in IST
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    dayMinutes: d.getUTCHours() * 60 + d.getUTCMinutes(), // minutes since IST midnight
  };
}

function istDateString(now) {
  return istClock(now).isoDate;
}

// True when the extracted date string equals TODAY's date in IST.
function isDateTodayIST(dateStr, now) {
  if (!dateStr) return false;
  const parsed = parseDateString(dateStr);
  if (!parsed) return false;
  return parsed === istDateString(now);
}

// Parse a time-of-day string into minutes since midnight (0-1439).
// Supports 12h ("10:45 AM", "10:45PM", "10.45 AM", "10 45 am") and
// 24h ("22:45", "10:45") forms. Returns null when unparseable.
function parseTimeString(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})(?:[:. ])(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const meridiem = (m[3] || '').toUpperCase();
  if (h > 24 || min > 59) return null;
  if (meridiem && h > 12) return null; // "15:00 PM" is invalid
  if (meridiem === 'PM' && h < 12) h += 12;
  if (meridiem === 'AM' && h === 12) h = 0;
  if (!meridiem && h === 24) h = 0;
  return h * 60 + min;
}

// True when the screenshot payment time is within ±windowMin minutes of the
// server's current time in IST. Uses the circular time-of-day distance so the
// comparison wraps correctly across midnight (23:50 IST vs 00:10 IST is 20 min).
function isTimeWithinWindow(timeStr, windowMin, now) {
  const payMin = parseTimeString(timeStr);
  if (payMin === null) return false;
  const nowMin = istClock(now).dayMinutes;
  const diff = Math.abs(nowMin - payMin);
  const circular = Math.min(diff, 1440 - diff);
  return circular <= (windowMin == null ? 30 : windowMin);
}

function normalizeFields(raw) {
  return {
    amount: normalizeAmount(raw?.amount),
    utr: normalizeUTR(raw?.utr),
    upi_id: normalizeUPI(raw?.upi_id),
    receiver_name: raw?.receiver_name ? raw.receiver_name.trim() : null,
    date: parseDateString(raw?.date),
    time: raw?.time ? raw.time.trim() : null,
    status: raw?.status ? raw.status.toUpperCase() : null,
    bank_or_app: raw?.bank_or_app ? raw.bank_or_app.trim() : null,
  };
}

module.exports = { normalizeUTR, normalizeUPI, normalizeAmount, normalizeDate, todayString, yesterdayString, tomorrowString, parseDateString, isTodayOrNear, normalizeFields, istClock, istDateString, isDateTodayIST, parseTimeString, isTimeWithinWindow };
