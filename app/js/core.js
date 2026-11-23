/* Paycheck Weathervane: core helpers (no DOM). All money is integer cents. */
(function (g) {
'use strict';
const VW = g.VW = g.VW || {};

VW.APP_NAME = 'Paycheck Weathervane';
VW.VERSION = '0.1.0';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');
const toDays = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const fromDays = n => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (iso, n) => fromDays(toDays(iso) + n);
let todayOverride = null;
const today = () => { if (todayOverride) return todayOverride; const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dow = iso => DOW[new Date(toDays(iso) * DAY).getUTCDay()];
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${MONTHS[m - 1]} ${+d}, ${y}`; };
const fmtShort = iso => `${dow(iso)} ${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;
const fmtMD = iso => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;
const monthKey = iso => iso.slice(0, 7);
const monthStart = k => k + '-01';
const monthShift = (k, n) => { const [y, m] = k.split('-').map(Number); const i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${pad(i % 12 + 1)}`; };
const monthLabel = k => { const [y, m] = k.split('-'); return MONTH_NAMES[m - 1] + ' ' + y; };
const monthName = k => MONTH_NAMES[+k.slice(5, 7) - 1];
const daysUntil = iso => toDays(iso) - toDays(today());
const money = c => {
  c = Math.round(c);
  const whole = Math.abs(c) % 100 === 0;
  return (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
};
const moneyR = c => (c < 0 ? '-' : '') + '$' + Math.round(Math.abs(c) / 100).toLocaleString('en-US');
const parseMoney = s => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
const centsIn = c => (c / 100).toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : 0;

VW.u = { DAY, MONTHS, MONTH_NAMES, pad, toDays, fromDays, addDays, today, dow, fmtDate, fmtShort, fmtMD, monthKey, monthStart, monthShift, monthLabel, monthName, daysUntil, money, moneyR, parseMoney, centsIn, uid, sum, esc, pct };
VW.setToday = iso => { todayOverride = iso; };

// ---------- frequencies ----------
VW.FREQS = [
  ['weekly', 'Every week', 52],
  ['biweekly', 'Every 2 weeks', 26],
  ['semimonthly', 'Twice a month', 24],
  ['monthly', 'Once a month', 12],
  ['quarterly', 'Every 3 months', 4],
  ['yearly', 'Once a year', 1],
  ['once', 'One time only', 0]
];
VW.perYear = f => (VW.FREQS.find(x => x[0] === f) || [0, 0, 0])[2];
VW.freqLabel = f => (VW.FREQS.find(x => x[0] === f) || [0, f])[1];
VW.annual = x => Math.round(x.amount * VW.perYear(x.freq));
VW.monthlyEq = x => Math.round(x.amount * VW.perYear(x.freq) / 12);

// ---------- schedules ----------
// s = { freq, anchor (ISO date), day2 }. Returns ISO dates in [from, to).
VW.occurrences = function (s, from, to) {
  if (!s || !s.anchor || !s.freq) return [];
  const f = toDays(from), t = toDays(to), a = toDays(s.anchor), out = [];
  if (s.freq === 'once') { if (a >= f && a < t) out.push(a); }
  else if (s.freq === 'weekly' || s.freq === 'biweekly') {
    const step = s.freq === 'weekly' ? 7 : 14;
    for (let n = a + Math.ceil((f - a) / step) * step; n < t; n += step) out.push(n);
  } else {
    const [ay, am, ad] = s.anchor.split('-').map(Number);
    const step = { monthly: 1, quarterly: 3, yearly: 12, semimonthly: 1 }[s.freq];
    const aIdx = ay * 12 + am - 1;
    const [fy, fm] = from.split('-').map(Number), [ty, tm] = to.split('-').map(Number);
    for (let idx = fy * 12 + fm - 1; idx <= ty * 12 + tm - 1; idx++) {
      if (((idx - aIdx) % step + step) % step !== 0) continue;
      const y = Math.floor(idx / 12), m = idx % 12;
      const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const days = [ad];
      if (s.freq === 'semimonthly' && s.day2) days.push(+s.day2);
      for (const d of days) {
        const n = Math.round(Date.UTC(y, m, Math.min(d, dim)) / DAY);
        if (n >= f && n < t) out.push(n);
      }
    }
  }
  return [...new Set(out)].sort((x, y) => x - y).map(fromDays);
};

// ---------- groups ----------
VW.GROUPS = [
  { id: 'home', name: 'Home', hint: 'Rent or mortgage, utilities, internet, home insurance, repairs' },
  { id: 'auto', name: 'Auto', hint: 'Car payment, car insurance, gas, upkeep' },
  { id: 'food', name: 'Food', hint: 'Groceries and eating out' },
  { id: 'kids', name: 'Kids & family', hint: 'Childcare, school costs, child support' },
  { id: 'health', name: 'Health', hint: 'Medical, prescriptions, health insurance' },
  { id: 'debt', name: 'Debt', hint: 'Credit cards and other loans' },
  { id: 'fun', name: 'Subscriptions & fun', hint: 'Streaming, apps, memberships, entertainment' },
  { id: 'save', name: 'Savings & goals', hint: 'Emergency fund, down payment, sinking funds' },
  { id: 'other', name: 'Other', hint: 'Everything else' }
];
VW.groupName = id => (VW.GROUPS.find(x => x.id === id) || VW.GROUPS[8]).name;
VW.NEEDS = ['home', 'auto', 'food', 'kids', 'health', 'debt'];
VW.WANTS = ['fun', 'other'];
})(typeof window !== 'undefined' ? window : globalThis);
