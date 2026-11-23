/* Paycheck Weathervane: data model and engine (no DOM). */
(function (g) {
'use strict';
const VW = g.VW, U = VW.u;
const { addDays, toDays, today, monthStart, monthShift, sum } = U;

// ---------- data ----------
VW.newDB = () => ({
  version: 1, onboarded: false, newToThis: true, created: new Date().toISOString(), updated: '', lastBackup: '',
  incomes: [],  // { id, name, freq, anchor, day2, amount, estimated, active }
  bills: [],    // { id, name, group, kind: bill|sub|debt, amount, freq, anchor, day2, active, debt?: { balance, balanceDate, startBalance, apr } }
  goals: [],    // { id, name, target, saved, savedDate, contribution (per paycheck), active }
  cash: null,   // { amount, date }
  aliases: [],  // { term, alias }: words always replaced in reports (the person's own choice)
  paid: {},     // line id -> true
  landed: {},   // pay date -> true
  payOv: {},    // pay date -> actual total amount
  lineOv: {}    // line id -> { amount, skip, moveTo }
});
VW.migrate = d => {
  const n = VW.newDB();
  for (const k of Object.keys(n)) if (d[k] === undefined) d[k] = n[k];
  return d;
};
VW.clone = db => JSON.parse(JSON.stringify(db));

// ---------- paychecks ----------
const activeIncomes = db => db.incomes.filter(i => i.active !== false && i.anchor);
VW.nextHeadDate = (db, iso) => {
  let best = null;
  for (const i of activeIncomes(db)) {
    const o = VW.occurrences(i, addDays(iso, 1), addDays(iso, 400))[0];
    if (o && (!best || o < best)) best = o;
  }
  return best;
};

// Paychecks dated in [from, to). Each covers [date, next paycheck).
// Every bill that comes due in that window is listed on it.
VW.buildHeads = function (db, from, to) {
  const e0 = addDays(from, -75), e1 = addDays(to, 75);
  const byDate = new Map();
  for (const inc of activeIncomes(db)) {
    for (const date of VW.occurrences(inc, e0, e1)) {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({ incId: inc.id, name: inc.name, amount: inc.amount, estimated: !!inc.estimated });
    }
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return [];
  const heads = dates.map((date, i) => {
    const parts = byDate.get(date);
    const ov = db.payOv[date];
    const base = sum(parts, p => p.amount);
    return {
      date, parts, base, income: ov != null ? ov : base, overridden: ov != null,
      landed: !!db.landed[date], estimated: parts.some(p => p.estimated) && !db.landed[date],
      end: dates[i + 1] || VW.nextHeadDate(db, date) || addDays(date, 14), lines: []
    };
  });
  const goals = db.goals.filter(x => x.active !== false && x.contribution > 0);
  for (const h of heads) {
    for (const b of db.bills) {
      if (b.active === false) continue;
      for (const due of VW.occurrences(b, h.date, h.end)) {
        if (b.notBefore && due < b.notBefore) continue;
        const id = b.id + ':' + due, ov = db.lineOv[id] || {};
        h.lines.push({ id, billId: b.id, name: b.name, group: b.group, kind: b.kind, due, amount: ov.amount != null ? ov.amount : b.amount,
          usual: b.amount, paid: !!db.paid[id], skip: !!ov.skip, moveTo: ov.moveTo || '', home: h.date, movedIn: false });
      }
    }
    for (const gl of goals) {
      const id = 'g:' + gl.id + ':' + h.date, ov = db.lineOv[id] || {};
      h.lines.push({ id, goalId: gl.id, name: 'Set aside: ' + gl.name, group: 'save', kind: 'save', due: h.date,
        amount: ov.amount != null ? ov.amount : gl.contribution, usual: gl.contribution, paid: !!db.paid[id], skip: !!ov.skip, moveTo: '', home: h.date, movedIn: false });
    }
  }
  // moves: a line can be paid from a different paycheck
  const byHome = new Map(heads.map(h => [h.date, h]));
  for (const h of heads) {
    for (const l of [...h.lines]) {
      if (l.moveTo && l.moveTo !== h.date && byHome.has(l.moveTo)) {
        h.lines.splice(h.lines.indexOf(l), 1);
        l.movedIn = true; l.moveFrom = h.date;
        byHome.get(l.moveTo).lines.push(l);
      }
    }
  }
  const out = [];
  for (const h of heads) {
    if (h.date < from || h.date >= to) continue;
    h.lines.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : a.name.localeCompare(b.name));
    let left = h.income;
    for (const l of h.lines) { if (!l.skip) left -= l.amount; l.after = left; }
    h.out = sum(h.lines.filter(l => !l.skip), l => l.amount);
    h.left = h.income - h.out;
    h.unpaid = sum(h.lines.filter(l => !l.skip && !l.paid), l => l.amount);
    h.skipped = h.lines.filter(l => l.skip);
    out.push(h);
  }
  return out;
};

// The paycheck that covers today (latest on or before today) and the next one.
VW.focus = function (db) {
  const t = today();
  const all = VW.buildHeads(db, addDays(t, -45), addDays(t, 120));
  const cur = [...all].reverse().find(h => h.date <= t) || null;
  const next = all.find(h => h.date > t) || null;
  return { cur, next, all };
};

// ---------- months ----------
VW.monthSummary = function (db, mk) {
  const from = monthStart(mk), to = monthStart(monthShift(mk, 1));
  const heads = VW.buildHeads(db, from, to);
  const byGroup = {};
  for (const h of heads) for (const l of h.lines) if (!l.skip) byGroup[l.group] = (byGroup[l.group] || 0) + l.amount;
  const income = sum(heads, h => h.income), out = sum(heads, h => h.out);
  // calendar view: bills whose due date is in this month, whichever paycheck pays them
  let due = 0, dueCount = 0; const early = [];
  const lead = VW.buildHeads(db, addDays(from, -45), to);
  for (const h of lead) for (const l of h.lines) {
    if (l.skip || l.kind === 'save') continue;
    if (l.due >= from && l.due < to) {
      due += l.amount; dueCount++;
      if (h.date < from) early.push({ line: l, head: h });
    }
  }
  return { mk, from, to, heads, income, out, left: income - out, byGroup, due, dueCount, early };
};

// ---------- debts ----------
VW.debts = db => db.bills.filter(b => b.kind === 'debt' && b.active !== false && b.debt);
VW.estBalance = function (b, asOf) {
  const d = b.debt; let B = d.balance;
  if (!d.balanceDate) return B;
  const r = (d.apr || 0) / 1200;
  for (const _ of VW.occurrences(b, addDays(d.balanceDate, 1), addDays(asOf || today(), 1))) {
    B = B * (1 + r) - b.amount; if (B <= 0) return 0;
  }
  return Math.max(0, Math.round(B));
};
// months to pay off at a steady payment each month; Infinity if the payment never covers interest
VW.payoff = function (balance, apr, monthly) {
  const r = (apr || 0) / 1200; let B = balance, n = 0, interest = 0;
  if (B <= 0) return { months: 0, interest: 0 };
  if (monthly <= 0 || monthly <= B * r + 0.5) return { months: Infinity, interest: Infinity };
  while (B > 0 && n < 1200) { const i = B * r; interest += i; B = B + i - monthly; n++; }
  return { months: n, interest: Math.round(interest + Math.min(0, B)) };
};
VW.debtFacts = function (b) {
  const B = VW.estBalance(b), apr = b.debt.apr || 0, mpay = VW.monthlyEq(b);
  const intNow = Math.round(B * apr / 1200);
  const po = VW.payoff(B, apr, mpay);
  return { balance: B, apr, monthly: mpay, interestThisMonth: intNow, toBalance: Math.max(0, mpay - intNow), payoff: po,
    payoffDate: isFinite(po.months) && po.months > 0 ? monthShift(U.monthKey(today()), po.months) : null,
    progress: b.debt.startBalance > 0 ? Math.max(0, Math.min(1, 1 - B / b.debt.startBalance)) : 0,
    stale: b.debt.balanceDate ? -U.daysUntil(b.debt.balanceDate) : null };
};

// ---------- goals ----------
VW.goalFacts = function (db, gl) {
  const need = Math.max(0, gl.target - gl.saved);
  const f = VW.focus(db);
  const heads = VW.buildHeads(db, today(), addDays(today(), 365 * 6));
  const c = gl.contribution || 0;
  let eta = null, checks = null;
  if (need === 0) { eta = today(); checks = 0; }
  else if (c > 0 && heads.length) { checks = Math.ceil(need / c); eta = heads[checks - 1] ? heads[checks - 1].date : null; }
  return { need, eta, checks, pct: gl.target > 0 ? Math.max(0, Math.min(1, gl.saved / gl.target)) : 0, f };
};
VW.perCheckToReach = function (db, need, byDate) {
  const heads = VW.buildHeads(db, today(), addDays(byDate, 1));
  const n = heads.length;
  return { checks: n, perCheck: n > 0 ? Math.ceil(need / n) : null };
};

// ---------- snapshots (for the ripple strip and what-ifs) ----------
VW.snap = function (db) {
  const f = VW.focus(db);
  const start = f.cur || f.next;
  const heads = f.next ? f.all.filter(h => h.date >= f.next.date).slice(0, 6) : [];   // upcoming paychecks only
  const incY = sum(db.incomes.filter(i => i.active !== false), VW.annual);
  const outY = sum(db.bills.filter(b => b.active !== false), VW.annual) + sum(db.goals.filter(x => x.active !== false), x => Math.round((x.contribution || 0) * annualChecks(db)));
  return {
    focusLeft: start ? start.left : null, focusDate: start ? start.date : null,
    minLeft: heads.length ? Math.min(...heads.map(h => h.left)) : null,
    minDate: heads.length ? heads.reduce((a, h) => h.left < a.left ? h : a, heads[0]).date : null,
    heads, cur: f.cur, annualIn: incY, annualOut: outY, annualLeft: incY - outY
  };
};
function annualChecks(db) {
  const inc = db.incomes.filter(i => i.active !== false);
  if (!inc.length) return 0;
  // paychecks per year (distinct pay dates over a 365-day span)
  const set = new Set();
  for (const i of inc) for (const d of VW.occurrences(i, today(), addDays(today(), 365))) set.add(d);
  return set.size;
}
VW.annualChecks = annualChecks;

// ---------- what-ifs ----------
VW.applyHypo = function (db, h) {
  const c = VW.clone(db);
  if (h.type === 'payment') {
    c.bills.push({ id: 'hypo', name: h.name || 'New payment', group: h.group || 'auto', kind: 'bill', amount: h.amount, freq: h.freq || 'monthly', anchor: h.start, notBefore: h.start, active: true });
  } else if (h.type === 'goal') {
    c.goals.push({ id: 'hypo', name: h.name || 'New goal', target: h.target, saved: h.saved || 0, contribution: h.perCheck, active: true });
  } else if (h.type === 'income') {
    c.incomes.push({ id: 'hypo', name: 'Extra income', freq: h.freq || 'monthly', anchor: h.start, amount: h.amount, active: true });
  }
  return c;
};

// ---------- yardsticks (commonly quoted rules of thumb, not advice) ----------
VW.YARDSTICKS = {
  auto: { label: 'Auto', text: 'A commonly quoted yardstick is a car payment of about 10% to 15% of take-home pay, and all car costs together (payment, insurance, gas, upkeep) about 15% to 20%.', lo: 15, hi: 20 },
  home: { label: 'Home', text: 'A commonly quoted yardstick is housing at about 25% to 35% of take-home pay.', lo: 25, hi: 35 },
  food: { label: 'Food', text: 'Commonly quoted yardsticks put food at about 10% to 15% of take-home pay.', lo: 10, hi: 15 }
};
VW.split503020 = function (byGroup, income) {
  const needs = sum(VW.NEEDS, k => byGroup[k] || 0), wants = sum(VW.WANTS, k => byGroup[k] || 0), save = byGroup.save || 0;
  return { needs, wants, save, needsP: U.pct(needs, income), wantsP: U.pct(wants, income), saveP: U.pct(save, income) };
};

// ---------- example data ----------
VW.exampleDB = function () {
  const db = VW.newDB(), t = today();
  // next Friday, two weeks apart, paid every other Friday
  const d = new Date(toDays(t) * U.DAY); let add = (5 - d.getUTCDay() + 7) % 7; if (add === 0) add = 14;
  const payday = addDays(t, add - 14 * 0);
  const prev = addDays(payday, -14);
  const m = (iso, day) => { const [y, mo] = iso.split('-').map(Number); const k = U.monthKey(iso); return `${k}-${U.pad(day)}`; };
  const mk = U.monthKey(t), nk = monthShift(mk, 1);
  const dayOnOrAfter = day => { const a = `${mk}-${U.pad(day)}`; return a >= t ? a : `${nk}-${U.pad(day)}`; };
  db.incomes.push({ id: 'i1', name: 'My paycheck', freq: 'biweekly', anchor: prev, amount: 184000, estimated: false, active: true });
  const B = (id, name, group, kind, amount, day, freq = 'monthly', extra = {}) => db.bills.push(Object.assign({ id, name, group, kind, amount, freq, anchor: dayOnOrAfter(day), active: true }, extra));
  B('b1', 'Rent', 'home', 'bill', 110000, 1);
  B('b2', 'Electric', 'home', 'bill', 13000, 26);
  B('b3', 'Internet', 'home', 'bill', 6500, 12);
  B('b4', 'Phone', 'home', 'bill', 9000, 8);
  B('b5', 'Car insurance', 'auto', 'bill', 14000, 15);
  B('b6', 'Groceries (budget)', 'food', 'bill', 20000, 3, 'weekly', { anchor: addDays(prev, 1) });
  B('b7', 'Streaming', 'fun', 'sub', 1599, 9);
  B('b8', 'Music', 'fun', 'sub', 1099, 20);
  B('b9', 'Gym', 'fun', 'sub', 3000, 5);
  B('b10', 'Credit card', 'debt', 'debt', 8500, 22, 'monthly', { debt: { balance: 240000, balanceDate: t, startBalance: 240000, apr: 24 } });
  db.goals.push({ id: 'g1', name: 'Car down payment', target: 500000, saved: 80000, savedDate: t, contribution: 5000, active: true });
  db.cash = { amount: 42000, date: t };
  db.onboarded = true;
  return db;
};
})(typeof window !== 'undefined' ? window : globalThis);
