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
  return new Date().toISOString().split('T')[0];
}

function yesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function tomorrowString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
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
  const today = new Date();
  const diffDays = Math.abs((d - today) / 86400000);
  return diffDays <= (toleranceDays || 1);
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

module.exports = { normalizeUTR, normalizeUPI, normalizeAmount, normalizeDate, todayString, yesterdayString, tomorrowString, parseDateString, isTodayOrNear, normalizeFields };
