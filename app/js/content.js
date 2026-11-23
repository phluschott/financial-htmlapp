/* Paycheck Weathervane: teaching content.
   Voice rules: facts and definitions are labeled "Fact"; named methods are labeled "One common framework";
   yardsticks are labeled "Commonly quoted". The text describes. It never tells anyone what to do. */
(function (g) {
'use strict';
const VW = g.VW, U = VW.u, M = U.money;

VW.loanPayment = (P, apr, n) => { const r = apr / 1200; if (n <= 0) return 0; return r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n)); };

VW.WHY = {
  pay: 'This is take-home pay: what actually lands in your account after taxes and deductions. Everything else in the app is measured against it.',
  payFreq: 'How often you are paid decides how many paychecks there are in a month. Every 2 weeks is 26 paychecks a year, not 24.',
  payDate: 'Any one payday works, past or upcoming. The app counts forward from it to find every other payday.',
  estimated: 'If your pay changes (hours, tips, commission), enter a typical amount. The paycheck is marked "estimated" until you tick Landed and enter what you really got.',
  billAmount: 'For a bill that changes each time (electric, groceries), enter a typical amount. You can change any one payment later.',
  billDate: 'The next date this is due. The app repeats it and decides which paycheck it lands on: the last one that arrives before the due date.',
  group: 'Groups let the app show what share of your take-home pay goes to each part of life. Pick the closest one.',
  debtBalance: 'The balance is what you owe right now. Read it off your statement or app. It changes with every payment and every new charge, so it goes out of date.',
  apr: 'APR is the yearly cost of borrowing, shown as a percent. It is usually printed on your statement. Leave it at 0 if you do not know.',
  debtMin: 'The minimum payment is the smallest amount the lender accepts each month. Enter what you plan to pay each time.',
  goalTarget: 'The total you want to reach, for example the $5,000 for a down payment.',
  goalContribution: 'The amount you set aside from each paycheck. It comes out of the paycheck like a bill does, so you can see what is left.',
  cash: 'Optional. The money you have right now, as one number. It helps when you ask a question like "can I cover this?" Do not add account names or numbers.'
};

VW.GLOSSARY = [
  ['Take-home pay', 'What lands in your account after taxes and deductions.'],
  ['Paycheck cycle', 'The stretch from one payday up to the next. Bills due in that stretch are paid from that paycheck.'],
  ['Balance', 'The amount you owe right now on a card or loan, or the amount you have saved in a goal.'],
  ['Interest', 'The fee a lender charges for letting you borrow. It is added to what you owe.'],
  ['APR', 'Annual percentage rate. The yearly cost of borrowing, as a percent. A 24% APR works out to about 2% a month.'],
  ['Minimum payment', 'The smallest payment a lender accepts each month. Paying only this keeps the account in good standing but pays the balance down slowly.'],
  ['Principal', 'The part of a loan you actually borrowed, not counting interest. A payment first covers interest, and the rest reduces principal.'],
  ['Down payment', 'Money you pay up front toward a purchase, so you borrow less.'],
  ['Loan term', 'How long you have to repay a loan, usually in months.'],
  ['Sinking fund', 'Money set aside a little at a time for a known future cost, such as a car down payment, car repairs, or holiday gifts.'],
  ['Emergency fund', 'Money set aside for surprises, such as a job loss or a repair, kept apart from everyday money.'],
  ['Cash flow', 'The money moving in and out over a period. This app is mostly about cash flow.'],
  ['Net worth', 'Everything you own minus everything you owe, at one moment.'],
  ['Fixed bill', 'A bill that is the same amount each time, like rent.'],
  ['Variable bill', 'A bill that changes each time, like electricity or groceries.'],
  ['Subscription', 'A charge that repeats on a schedule until you cancel it.'],
  ['Yardstick', 'A commonly quoted rule of thumb you can measure your own numbers against. Yardsticks vary by source and by place.']
];

const needsMonthly = db => U.sum(db.bills.filter(b => b.active !== false && VW.NEEDS.includes(b.group)), VW.monthlyEq);
const s = n => n === 1 ? '' : 's';

VW.LESSONS = [
  { id: 'cycle', title: 'Why money feels tight when the month adds up', kind: 'Fact',
    body: ['Bills are due on dates. Paychecks arrive on dates. The two almost never line up.',
      'Each paycheck has to cover every bill that comes due before the next paycheck arrives. So one paycheck can be tight and the next one roomy, even when the whole month adds up fine.',
      'This is why the Plan page lists each paycheck separately, with a running "left after" beside every payment.'],
    mine: db => {
      const sn = VW.snap(db); if (sn.heads.length < 2) return '';
      const hi = sn.heads.reduce((a, h) => h.left > a.left ? h : a, sn.heads[0]), lo = sn.heads.reduce((a, h) => h.left < a.left ? h : a, sn.heads[0]);
      return `Among your next ${sn.heads.length} paychecks, the tightest is ${U.fmtShort(lo.date)} with ${M(lo.left)} left after its bills. The roomiest is ${U.fmtShort(hi.date)} with ${M(hi.left)} left.`;
    } },
  { id: 'three', title: 'The month with three paychecks', kind: 'Fact',
    body: ['A year has 52 weeks. Pay every 2 weeks means 26 paychecks, not 24. Pay every week means 52, not 48.',
      'In a month with 3 paychecks, one paycheck arrives that is not needed for that month\'s bills. In a 2-paycheck month, there is none. That is why some months feel easy and others do not.',
      'The monthly average of pay every 2 weeks is the paycheck times 26, divided by 12.'],
    mine: db => {
      const inc = db.incomes.filter(i => i.active !== false && (i.freq === 'biweekly' || i.freq === 'weekly'));
      if (!inc.length) return 'This one applies when you are paid every week or every 2 weeks. Add that kind of pay in My Money to see your own months.';
      const base = U.monthKey(U.today()), rows = [];
      for (let k = 0; k < 12; k++) { const mk = U.monthShift(base, k); const n = VW.buildHeads(db, U.monthStart(mk), U.monthStart(U.monthShift(mk, 1))).length; if (n >= 3 || (inc[0].freq === 'weekly' && n >= 5)) rows.push(U.monthName(mk) + ' (' + n + ')'); }
      const avg = Math.round(U.sum(inc, VW.annual) / 12);
      return `Your pay averages ${M(avg)} a month. In the next 12 months, the months with an extra paycheck are: ${rows.length ? rows.join(', ') : 'none'}.`;
    } },
  { id: 'fixedvar', title: 'Fixed and variable bills', kind: 'Fact',
    body: ['A fixed bill is the same every time, like rent or a car payment. A variable bill changes, like electricity or groceries.',
      'The app needs one number for each. For a variable bill, a commonly used method is to enter a typical month, or the higher of the last few. You can change any single payment later if the real bill is different.'] },
  { id: 'minpay', title: 'Where a minimum payment goes', kind: 'Fact',
    body: ['When you pay a loan or card, the payment first covers the interest that has built up. Only the rest reduces what you owe.',
      'When the balance is large and the rate is high, most of a small payment can go to interest. That is why the balance can fall slowly even when payments are on time.'],
    mine: db => {
      const ds = VW.debts(db).map(b => ({ b, f: VW.debtFacts(b) })).filter(x => x.f.balance > 0 && x.f.apr > 0);
      if (!ds.length) return '';
      return ds.map(x => `${U.esc(x.b.name)}: of your ${M(x.f.monthly)} payment, about ${M(Math.min(x.f.monthly, x.f.interestThisMonth))} is this month\'s interest and ${M(x.f.toBalance)} reduces the balance.`).join('<br>');
    } },
  { id: 'apr', title: 'What APR means', kind: 'Fact',
    body: ['APR is the yearly cost of borrowing. Divide it by 12 for a rough monthly rate: 24% a year is about 2% a month.',
      'Example: owe $1,000 at 24% APR and pay nothing, and about $20 of interest is added in a month.'],
    mine: db => {
      const ds = VW.debts(db).map(b => ({ b, f: VW.debtFacts(b) })).filter(x => x.f.balance > 0 && x.f.apr > 0);
      if (!ds.length) return 'Add a debt with its APR in My Money and this shows what it costs you.';
      return ds.map(x => `${U.esc(x.b.name)} at ${x.f.apr}% APR on ${M(x.f.balance)}: about ${M(x.f.interestThisMonth)} of interest a month, about ${M(Math.round(x.f.balance * x.f.apr / 100))} over a year if nothing were paid.`).join('<br>');
    } },
  { id: 'compound', title: 'Interest on interest', kind: 'Fact',
    body: ['Interest is added to the balance, and the next month\'s interest is charged on the bigger balance. This is called compounding.',
      'Example: $1,000 at 24% APR with no payments becomes about $1,268 after 12 months, not $1,240. The extra $28 is interest charged on earlier interest.'] },
  { id: 'small', title: 'Small costs add up', kind: 'Fact',
    body: ['A small charge repeated on a schedule is a larger number once it is counted for a year. A $12 a month charge is $144 a year.'],
    mine: db => {
      const subs = db.bills.filter(b => b.active !== false && b.kind === 'sub');
      if (!subs.length) return 'Add subscriptions in My Money to see their yearly total.';
      const mo = U.sum(subs, VW.monthlyEq), yr = U.sum(subs, VW.annual);
      return `Your ${subs.length} subscription${s(subs.length)} come to ${M(mo)} a month, which is ${M(yr)} a year.`;
    } },
  { id: 'loan', title: 'What a loan really costs', kind: 'Fact', calc: true,
    body: ['A loan has a price and a cost. The price is what you borrow. The cost is everything you pay back, which includes interest.',
      'Two things change the cost most. A bigger down payment means you borrow less. A longer term lowers each payment but adds months of interest, so the total paid is higher.',
      'Try it with your own numbers below.'] },
  { id: 'order', title: 'Snowball and avalanche', kind: 'One common framework',
    body: ['With more than one debt, people often pick which one gets extra money first. Two named methods:',
      'Snowball: put extra on the smallest balance first. The first payoff arrives sooner, which some people find motivating.',
      'Avalanche: put extra on the highest APR first. This usually costs less interest in total.',
      'Both keep the minimum going on every debt. Which one fits depends on what a person values, and neither is the right answer for everyone.'],
    mine: db => {
      const ds = VW.debts(db).map(b => ({ b, f: VW.debtFacts(b) })).filter(x => x.f.balance > 0);
      if (ds.length < 2) return 'This applies when you have two or more debts.';
      const sm = ds.slice().sort((a, b) => a.f.balance - b.f.balance)[0], hi = ds.slice().sort((a, b) => b.f.apr - a.f.apr)[0];
      return `Among your debts, the smallest balance is ${U.esc(sm.b.name)} (${M(sm.f.balance)}). The highest APR is ${U.esc(hi.b.name)} (${hi.f.apr}%).`;
    } },
  { id: 'emergency', title: 'Emergency funds and sinking funds', kind: 'Fact',
    body: ['An emergency fund is money kept for surprises. A sinking fund is money set aside a little at a time for a cost you know is coming, such as a car down payment, repairs, or holiday gifts.',
      'Commonly quoted: an emergency fund of 3 to 6 months of essential costs. Sources differ, and the right size depends on how steady your income is and who depends on it.'],
    mine: db => {
      const n = needsMonthly(db); if (!n) return '';
      return `Your essential monthly costs (home, auto, food, kids, health, debt payments) add up to about ${M(n)}. Three months of that is ${M(n * 3)} and six months is ${M(n * 6)}.`;
    } },
  { id: 'split', title: 'The 50/30/20 split', kind: 'One common framework',
    body: ['One popular way to divide take-home pay: about 50% for needs, 30% for wants, 20% for savings and extra debt payments.',
      'It is a starting measuring stick, not a rule. People with high rent or children often find their needs are above 50%, and that is common.',
      'Here, needs are Home, Auto, Food, Kids & family, Health and Debt. Wants are Subscriptions & fun and Other. Savings is Savings & goals.'],
    mine: db => {
      const f = VW.focus(db), h = f.next || f.cur; if (!h) return '';
      const ms = VW.monthSummary(db, U.monthKey(h.date)); if (!ms.income) return '';
      const x = VW.split503020(ms.byGroup, ms.income);
      return `In ${U.monthLabel(ms.mk)}, your plan is about ${x.needsP}% needs, ${x.wantsP}% wants, ${x.saveP}% savings, and ${U.pct(Math.max(0, ms.left), ms.income)}% not yet assigned.`;
    } },
  { id: 'yard', title: 'Reading your share of take-home pay', kind: 'Commonly quoted yardsticks',
    body: ['The donut on Home shows each group as a share of your take-home pay. Seeing the share is often easier than seeing the dollars.',
      VW.YARDSTICKS.home.text, VW.YARDSTICKS.auto.text, VW.YARDSTICKS.food.text,
      'These numbers vary by source, by city, and by household. They are for measuring, not for judging.'],
    mine: db => {
      const f = VW.focus(db), h = f.next || f.cur; if (!h) return '';
      const ms = VW.monthSummary(db, U.monthKey(h.date)); if (!ms.income) return '';
      return ['home', 'auto', 'food'].map(k => `${VW.groupName(k)}: ${U.pct(ms.byGroup[k] || 0, ms.income)}%`).join(', ') + ` of take-home in ${U.monthLabel(ms.mk)}.`;
    } },
  { id: 'flow', title: 'Cash flow and net worth', kind: 'Fact',
    body: ['Cash flow is the money moving through a period: what came in and what went out. Net worth is a snapshot: what you own minus what you owe.',
      'This app is mostly cash flow. It shows what each paycheck has to cover. Debt balances and goals add a few net worth pieces.'] },
  { id: 'fresh', title: 'Why up-to-date numbers matter', kind: 'Fact',
    body: ['A balance is a snapshot from one day. New charges, interest and payments change it. The app\'s estimate between updates assumes you pay what you entered and add no new charges.',
      'Every answer, in the app or from Claude, is only as good as the numbers entered. That is why each balance shows the date it was entered.'] }
];
})(typeof window !== 'undefined' ? window : globalThis);
