/* Paycheck Weathervane: what-if questions and the report that gets pasted into Claude (no DOM). */
(function (g) {
'use strict';
const VW = g.VW, U = VW.u, M = U.money, MR = U.moneyR;
const { addDays, today } = U;

// ---------- questions ----------
const nextSoon = () => addDays(today(), 7);
VW.QUESTIONS = [
  { id: 'afford', title: 'Can I afford a new monthly payment?', blurb: 'For example a car payment, rent increase, or new loan.',
    fields: [
      { k: 'amount', label: 'Payment per month', type: 'money', req: true },
      { k: 'start', label: 'First payment date', type: 'date', def: nextSoon },
      { k: 'group', label: 'What kind of payment is it?', type: 'group', def: 'auto' }
    ] },
  { id: 'goal', title: 'How much do I need to set aside to reach a goal?', blurb: 'For example $5,000 for a down payment by a date.',
    fields: [
      { k: 'target', label: 'Amount you want to reach', type: 'money', req: true },
      { k: 'saved', label: 'Already saved toward it', type: 'money', def: () => 0 },
      { k: 'byDate', label: 'Reach it by', type: 'date', def: () => addDays(today(), 365), req: true }
    ] },
  { id: 'extra', title: 'What if I pay extra on a debt?', blurb: 'See how an extra amount each month changes the payoff.',
    fields: [
      { k: 'debtId', label: 'Which debt', type: 'debt', req: true },
      { k: 'amount', label: 'Extra per month', type: 'money', req: true }
    ] },
  { id: 'where', title: 'Where is my money going?', blurb: 'A plain look at each group and its share of take-home pay.', fields: [] },
  { id: 'debts', title: 'What do my debts look like?', blurb: 'Balances, interest, and how long each takes at the current payments.', fields: [] },
  { id: 'free', title: 'Ask my own question', blurb: 'Type any question. Claude gets your numbers along with it.', fields: [{ k: 'text', label: 'Your question', type: 'text', req: true }] }
];
VW.defaultParams = q => { const p = {}; for (const f of q.fields) if (f.def) p[f.k] = typeof f.def === 'function' ? f.def() : f.def; return p; };

function rowsFor(before, after) {
  const a = before.heads, b = after.heads;
  return a.map((h, i) => ({ date: h.date, before: h.left, after: b[i] ? b[i].left : h.left, income: h.income }));
}
function monthShares(db) {
  const f = VW.focus(db), h = f.next || f.cur;
  if (!h) return null;
  const ms = VW.monthSummary(db, U.monthKey(h.date));
  return { ms, sh: VW.shares(ms.byGroup, ms.income) };
}

// Evaluate a question against the data. Returns facts the app can show right away and the Claude wording.
VW.evalQuestion = function (db, qid, p) {
  const out = { qid, facts: [], rows: null, hypoDB: null, question: '', before: null, after: null, error: '' };
  const q = VW.QUESTIONS.find(x => x.id === qid);
  for (const f of q.fields) if (f.req && (p[f.k] == null || p[f.k] === '' || p[f.k] === 0)) { out.error = 'Fill in "' + f.label + '" to see the numbers.'; }
  const sb = VW.snap(db); out.before = sb;
  const avgMonth = Math.round(U.sum(db.incomes.filter(i => i.active !== false), VW.annual) / 12);
  if (qid === 'afford' && !out.error) {
    const hypo = { type: 'payment', amount: p.amount, freq: 'monthly', start: p.start, group: p.group || 'auto', name: 'Possible new payment' };
    const d2 = VW.applyHypo(db, hypo), sa = VW.snap(d2); out.hypoDB = d2; out.after = sa; out.rows = rowsFor(sb, sa);
    const share = U.pct(p.amount, avgMonth);
    out.facts.push(`The new payment of ${M(p.amount)} a month is ${share}% of your average monthly take-home pay (${M(avgMonth)}).`);
    const worst = out.rows.reduce((a, r) => r.after < a.after ? r : a, out.rows[0]);
    if (worst) out.facts.push(worst.after < 0 ? `With it, the paycheck on ${U.fmtShort(worst.date)} would be short by ${M(-worst.after)}.` : `With it, the tightest of your next ${out.rows.length} paychecks has ${M(worst.after)} left (${U.fmtShort(worst.date)}).`);
    out.facts.push(`Over a year it adds ${M(p.amount * 12)} going out. Your yearly left-over would go from ${M(sb.annualLeft)} to ${M(sa.annualLeft)}.`);
    const y = VW.YARDSTICKS[p.group];
    if (y) out.facts.push(y.text);
    out.question = `Can I afford a new ${VW.groupName(p.group || 'auto')} payment of ${M(p.amount)} per month starting ${U.fmtDate(p.start)}? Please describe what my numbers show about it.`;
  } else if (qid === 'goal' && !out.error) {
    const need = Math.max(0, p.target - (p.saved || 0));
    const r = VW.perCheckToReach(db, need, p.byDate);
    if (!r.checks) { out.error = 'There is no paycheck before that date. Pick a later date or add your pay in My Money.'; }
    else {
      const d2 = VW.applyHypo(db, { type: 'goal', target: p.target, saved: p.saved || 0, perCheck: r.perCheck, name: 'Possible goal' }), sa = VW.snap(d2);
      out.hypoDB = d2; out.after = sa; out.rows = rowsFor(sb, sa);
      const perMonth = Math.round(r.perCheck * VW.annualChecks(db) / 12);
      out.facts.push(`To go from ${M(p.saved || 0)} to ${M(p.target)} by ${U.fmtDate(p.byDate)}, you need ${M(need)} more.`);
      out.facts.push(`There are ${r.checks} paycheck${r.checks === 1 ? '' : 's'} before then, so that is ${M(r.perCheck)} from each one (about ${M(perMonth)} a month).`);
      const worst = out.rows.reduce((a, x) => x.after < a.after ? x : a, out.rows[0]);
      if (worst) out.facts.push(worst.after < 0 ? `Set aside from each paycheck, ${U.fmtShort(worst.date)} would be short by ${M(-worst.after)}.` : `Set aside from each paycheck, the tightest of your next ${out.rows.length} paychecks has ${M(worst.after)} left (${U.fmtShort(worst.date)}).`);
      out.question = `I want to reach ${M(p.target)} by ${U.fmtDate(p.byDate)}. I have ${M(p.saved || 0)} saved so far. What would it take from each paycheck, and does it fit with my other payments?`;
    }
  } else if (qid === 'extra' && !out.error) {
    const b = db.bills.find(x => x.id === p.debtId);
    if (!b || !b.debt) { out.error = 'Pick one of your debts. Add a debt in My Money first if the list is empty.'; }
    else {
      const f = VW.debtFacts(b), a0 = VW.payoff(f.balance, f.apr, f.monthly), a1 = VW.payoff(f.balance, f.apr, f.monthly + p.amount);
      const d2 = VW.applyHypo(db, { type: 'payment', amount: p.amount, freq: 'monthly', start: addDays(today(), 7), group: 'debt', name: 'Extra payment' }), sa = VW.snap(d2);
      out.hypoDB = d2; out.after = sa; out.rows = rowsFor(sb, sa);
      const fm = n => isFinite(n) ? `${n} month${n === 1 ? '' : 's'}` : 'never at this payment (it does not cover the interest)';
      out.facts.push(`At ${M(f.monthly)} a month, the estimated balance of ${M(f.balance)} takes ${fm(a0.months)} and about ${isFinite(a0.interest) ? M(a0.interest) : 'unlimited'} in interest.`);
      out.facts.push(`At ${M(f.monthly + p.amount)} a month, it takes ${fm(a1.months)} and about ${isFinite(a1.interest) ? M(a1.interest) : 'unlimited'} in interest.`);
      if (isFinite(a0.interest) && isFinite(a1.interest)) out.facts.push(`The difference is ${a0.months - a1.months} fewer month${a0.months - a1.months === 1 ? '' : 's'} and ${M(a0.interest - a1.interest)} less interest.`);
      out.question = `What would paying an extra ${M(p.amount)} per month on one of my debts change? Please describe what my numbers show.`;
      out.debtLabel = b.id;
    }
  } else if (qid === 'where') {
    const m = monthShares(db);
    if (m) { out.facts.push(`In ${U.monthLabel(m.ms.mk)}, ${MR(m.ms.income)} comes in and ${MR(m.sh.out)} is planned out (${U.pct(m.sh.out, m.ms.income)}%).`); }
    out.question = 'Where is my money going? Please describe each group and its share of take-home pay, using the numbers provided.';
  } else if (qid === 'debts') {
    const ds = VW.debts(db);
    if (!ds.length) out.error = 'No debts entered yet. Add them in My Money.';
    out.question = 'What do my debts look like? Please describe the balances, the interest, and how long each would take at the current payments.';
  } else if (qid === 'free' && !out.error) {
    out.question = p.text;
  }
  return out;
};

// ---------- labels and the best-effort scrub ----------
VW.labels = function (db) {
  const map = [], L = {}; const counts = {};
  const word = b => b.kind === 'sub' ? 'Subscription' : b.kind === 'debt' ? 'Debt' : VW.groupName(b.group) + ' bill';
  const pick = (x, generic) => (x.aka && x.aka.trim()) ? x.aka.trim() : generic;   // the person's own "AKA" wins
  db.incomes.forEach((i, n) => { const l = pick(i, 'Income ' + String.fromCharCode(65 + n)); L[i.id] = l; map.push([l, i.name]); });
  db.bills.forEach(b => { const w = word(b); counts[w] = (counts[w] || 0) + 1; const l = pick(b, w + ' ' + counts[w]); L[b.id] = l; map.push([l, b.name]); });
  db.goals.forEach((x, n) => { const l = pick(x, 'Goal ' + String.fromCharCode(65 + n)); L[x.id] = l; map.push([l, x.name]); });
  return { L, map };
};

VW.scrub = function (text, db, extra) {
  const { map } = VW.labels(db); let n = 0;
  const bump = s => { n++; return s; };
  const names = map.filter(m => m[1] && m[1].trim().length >= 3).sort((a, b) => b[1].length - a[1].length);
  for (const [label, name] of names) {
    const esc = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp((/^\w/.test(name.trim()) ? '\\b' : '') + esc + (/\w$/.test(name.trim()) ? '\\b' : ''), 'gi');
    text = text.replace(re, () => bump(label));
  }
  for (const a of (db.aliases || [])) {   // the person's own always-replace list
    const t = (a.term || '').trim(); if (t.length < 2) continue;
    text = text.replace(new RegExp((/^\w/.test(t) ? '\\b' : '') + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\w$/.test(t) ? '\\b' : ''), 'gi'), () => bump((a.alias || '').trim() || '[removed]'));
  }
  for (const w of (extra || [])) {
    const t = w.trim(); if (t.length < 2) continue;
    text = text.replace(new RegExp((/^\w/.test(t) ? '\\b' : '') + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\w$/.test(t) ? '\\b' : ''), 'gi'), () => bump('[removed]'));
  }
  text = text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => bump('[email removed]'));
  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, () => bump('[link removed]'));
  text = text.replace(/(?<!\$)\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, () => bump('[number removed]'));
  text = text.replace(/(?<![\$\d])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, () => bump('[number removed]'));
  text = text.replace(/(?<![\$\d,.])\b\d(?:[ -]?\d){8,}\b(?![,.]\d)/g, () => bump('[number removed]'));
  return { text, count: n };
};

// ---------- the report ----------
const INSTRUCTIONS = `INSTRUCTIONS FOR CLAUDE (please read first)
Someone using a personal money-tracking tool pasted the data below. They entered it themselves. Identifying details were removed on a best-effort basis, so names are generic labels such as "Home bill 1" or "Debt 2".

How to reply:
1. Begin your reply with exactly these words: "Assuming your numbers are correct, it seems to indicate..."
2. Describe what the numbers show and what is possible. Think of yourself as a weathervane: you show which way things point. You are not giving financial advice and you are not telling this person what to do. Where there are options, lay out the tradeoffs without ranking them.
3. Use only the numbers provided. Show the arithmetic you use. The paycheck figures were already calculated by the tool, so use them as given. If you find an apparent error, say so plainly instead of silently changing it.
4. Explain every money term in plain words, as if to someone who was never taught how money works. Name the simple rule behind each point (for example "interest is charged on what you still owe").
5. Point out anything missing or possibly out of date. The "as of" dates are listed below.
6. Do not recommend specific products, banks, lenders, or investments.
7. Keep the reply short and in plain language. Use short headings only if they help.`;

VW.buildReport = function (db, qid, p, opts = {}) {
  const ev = VW.evalQuestion(db, qid, p);
  const { L } = VW.labels(db);
  const L0 = x => L[x] || 'Item';
  const lines = []; let scrubbed = 0;
  const push = (...a) => lines.push(...a);
  const t = today();
  const avgMonth = Math.round(U.sum(db.incomes.filter(i => i.active !== false), VW.annual) / 12);

  push(INSTRUCTIONS, '', '==================================================', 'MY NUMBERS', '==================================================');
  push(`Report date: ${U.fmtDate(t)}`);
  const stale = [];
  for (const b of VW.debts(db)) if (b.debt.balanceDate) stale.push(`${L0(b.id)} balance entered ${U.fmtDate(b.debt.balanceDate)} (${-U.daysUntil(b.debt.balanceDate)} days ago)`);
  if (db.cash) stale.push(`Cash on hand entered ${U.fmtDate(db.cash.date)} (${-U.daysUntil(db.cash.date)} days ago)`);
  push(stale.length ? 'Data freshness: ' + stale.join('; ') + '.' : 'Data freshness: no balances entered.');
  if (db.cash) push(`Cash on hand when entered: ${M(db.cash.amount)}.`);

  push('', 'INCOME (take-home pay)');
  const incs = db.incomes.filter(i => i.active !== false);
  if (!incs.length) push('- None entered.');
  for (const i of incs) push(`- ${L0(i.id)}: ${M(i.amount)} ${VW.freqLabel(i.freq).toLowerCase()}${i.freq === 'semimonthly' && i.day2 ? ' (around the ' + U.fmtMD(i.anchor).split(' ')[1] + ' and the ' + i.day2 + ')' : ''}${i.estimated ? ', amount is an estimate' : ''}.`);
  if (incs.length) push(`- Average per month: ${M(avgMonth)}.`);

  const f = VW.focus(db);
  const heads = f.next ? f.all.filter(h => h.date >= f.next.date).slice(0, 6) : [];
  push('', 'PAYCHECKS, CALCULATED BY THE TOOL (each paycheck covers every payment due before the next paycheck)');
  if (f.cur) push(`Current period: the paycheck of ${U.fmtShort(f.cur.date)} was ${M(f.cur.income)}; ${M(f.cur.unpaid)} of its payments are not yet marked paid.`);
  if (!heads.length) push('- No upcoming paychecks to show.');
  else {
    push('Upcoming paychecks: Date | Money in | Payments due until the following paycheck | Left after');
    for (const h of heads) push(`${U.fmtShort(h.date)} | ${M(h.income)}${h.estimated ? ' (est.)' : ''} | ${M(h.out)} | ${M(h.left)}`);
    const first = heads[0];
    push('', `Payments inside the next paycheck (${U.fmtShort(first.date)}):`);
    for (const l of first.lines) if (!l.skip) push(`- ${U.fmtShort(l.due)}: ${L0(l.billId || l.goalId)}${l.kind === 'save' ? ' (set-aside)' : ''}, ${M(l.amount)}`);
  }

  push('', 'RECURRING PAYMENTS');
  const bills = db.bills.filter(b => b.active !== false);
  if (!bills.length) push('- None entered.');
  for (const b of bills) push(`- ${L0(b.id)} [${VW.groupName(b.group)}]: ${M(b.amount)} ${VW.freqLabel(b.freq).toLowerCase()}${VW.perYear(b.freq) && b.freq !== 'monthly' ? ' (about ' + M(VW.monthlyEq(b)) + ' a month)' : ''}${b.kind === 'sub' ? ' (subscription)' : ''}`);

  const ds = VW.debts(db);
  push('', 'DEBTS');
  if (!ds.length) push('- None entered.');
  for (const b of ds) {
    const d = VW.debtFacts(b);
    push(`- ${L0(b.id)}: balance ${M(b.debt.balance)} as of ${U.fmtDate(b.debt.balanceDate)}${b.debt.balance !== d.balance ? ' (estimated now: ' + M(d.balance) + ', assuming payments are made and no new charges)' : ''}, APR ${d.apr}%, payment ${M(b.amount)} ${VW.freqLabel(b.freq).toLowerCase()}. Interest this month is about ${M(d.interestThisMonth)}; ${isFinite(d.payoff.months) ? 'at the current payment it would take about ' + d.payoff.months + ' months and ' + M(d.payoff.interest) + ' in interest' : 'the current payment does not cover the interest'}.`);
  }

  push('', 'GOALS');
  const goals = db.goals.filter(x => x.active !== false);
  if (!goals.length) push('- None entered.');
  for (const x of goals) { const gf = VW.goalFacts(db, x); push(`- ${L0(x.id)}: target ${M(x.target)}, saved ${M(x.saved)} as of ${U.fmtDate(x.savedDate || t)}, setting aside ${M(x.contribution || 0)} per paycheck${gf.eta && gf.checks > 0 ? ', which reaches the target around ' + U.fmtDate(gf.eta) : ''}.`); }

  const m = monthShares(db);
  if (m && m.ms.income) {
    push('', `SHARE OF TAKE-HOME, ${U.monthLabel(m.ms.mk).toUpperCase()} (paychecks dated that month: ${M(m.ms.income)})`);
    for (const s of m.sh.segs) push(`- ${s.label}: ${M(s.value)} (${U.pct(s.value, m.ms.income)}%)`);
    push(m.sh.over ? `- Short by: ${M(-m.sh.left)}` : `- Left over: ${M(m.sh.left)} (${U.pct(m.sh.left, m.ms.income)}%)`);
    const x = VW.split503020(m.ms.byGroup, m.ms.income);
    push(`- Needs ${x.needsP}%, wants ${x.wantsP}%, savings ${x.saveP}% (needs = Home, Auto, Food, Kids & family, Health, Debt; wants = Subscriptions & fun, Other).`);
  }

  push('', '==================================================', 'MY QUESTION', '==================================================');
  const qs = VW.scrub(ev.question || '(no question selected)', db, opts.extraRemove);
  scrubbed += qs.count;
  push(qs.text);
  if (ev.facts.length || ev.rows) {
    push('', 'The tool also calculated this for the question:');
    for (const x of ev.facts) push('- ' + x);
    if (ev.rows) { push('', 'Left after each paycheck, before and after the change:'); for (const r of ev.rows) push(`- ${U.fmtShort(r.date)}: ${M(r.before)} now, ${M(r.after)} after`); }
  }
  let text = lines.join('\n');
  if (ev.debtLabel) text = text.replace('on one of my debts', 'on ' + L0(ev.debtLabel));
  return { text, scrubbed, ev };
};
})(typeof window !== 'undefined' ? window : globalThis);
