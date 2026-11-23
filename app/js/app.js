/* Paycheck Weathervane: the app (views, forms, events). Everything stays in this browser. */
(function () {
'use strict';
const VW = window.VW, U = VW.u, esc = U.esc, M = U.money, MR = U.moneyR;
const $ = s => document.querySelector(s);
const KEY = 'paycheckWeathervane.v1';

// ---------- state & storage ----------
let DB = null, storageOK = true;
const state = { view: 'home', month: null, step: 0, planMode: 'due', ask: { qid: 'afford', params: {}, extra: '', reviewed: false, started: false }, ripple: null, hlSeg: null };

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); if (d && Array.isArray(d.incomes)) return VW.migrate(d); } }
  catch (e) { storageOK = false; }
  return VW.newDB();
}
function save() {
  DB.updated = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { storageOK = false; }
}
function commit() { save(); render(); }
function mutate(label, fn) {
  const beforeJSON = JSON.stringify(DB), sb = VW.snap(DB);
  fn();
  state.ripple = rippleOf(label, sb, VW.snap(DB), beforeJSON);
  commit();
}
function hasData() { return DB.incomes.length || DB.bills.length || DB.goals.length; }

function delta(a, b) {
  const d = b - a; if (!d) return '';
  return `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲ +' : '▼ '}${M(d)}</span>`;
}
function rippleOf(label, a, b, beforeJSON) {
  const rows = [];
  if (a.focusLeft != null && b.focusLeft != null && a.focusLeft !== b.focusLeft) rows.push(`Left after the paycheck of ${U.fmtShort(b.focusDate)}: ${M(a.focusLeft)} → <b>${M(b.focusLeft)}</b> ${delta(a.focusLeft, b.focusLeft)}`);
  if (a.minLeft != null && b.minLeft != null && a.minLeft !== b.minLeft) rows.push(`Tightest of the next ${b.heads.length} paychecks: ${M(a.minLeft)} → <b>${M(b.minLeft)}</b> ${delta(a.minLeft, b.minLeft)}`);
  if (a.annualLeft !== b.annualLeft) rows.push(`Left over across a year: ${MR(a.annualLeft)} → <b>${MR(b.annualLeft)}</b> ${delta(a.annualLeft, b.annualLeft)}`);
  if (!rows.length) return null;
  return { label, rows, before: beforeJSON };
}

// ---------- tiny UI helpers ----------
const dlg = $('#modal');
let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }
const coach = html => `<div class="coach${DB.newToThis ? '' : ' off'}">${html}</div>`;
const why = key => DB.newToThis && VW.WHY[key] ? `<details class="why"><summary>What is this?</summary><p>${esc(VW.WHY[key])}</p></details>` : '';
const chip = (txt, cls = '') => `<span class="chip ${cls}">${esc(txt)}</span>`;
const groupChip = id => `<span class="chip"><i class="dot s-${id}" style="margin-right:5px"></i>${esc(VW.groupName(id))}</span>`;
const dueIn = iso => { const n = U.daysUntil(iso); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n > 0 ? `in ${n} days` : `${-n} day${n === -1 ? '' : 's'} ago`; };

// ---------- forms ----------
function fieldHtml(f, v) {
  const val = v[f.k], id = 'f_' + f.k, hide = f.showIf && !f.showIf(v) ? ' style="display:none"' : '';
  let input;
  if (f.type === 'money') input = `<div class="money-in"><span>$</span><input id="${id}" type="text" inputmode="decimal" value="${val ? U.centsIn(val) : ''}" placeholder="0.00"></div>`;
  else if (f.type === 'date') input = `<input id="${id}" type="date" value="${esc(val || '')}">`;
  else if (f.type === 'number') input = `<input id="${id}" type="number" min="1" max="31" value="${esc(val ?? '')}">`;
  else if (f.type === 'select') input = `<select id="${id}">${f.options.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(val) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  else if (f.type === 'checkbox') return `<div class="f cb" data-field="${f.k}"${hide}><label><input id="${id}" type="checkbox"${val ? ' checked' : ''}>${esc(f.label)}</label>${f.hint ? `<div class="small muted">${esc(f.hint)}</div>` : ''}</div>`;
  else input = `<input id="${id}" type="text" value="${esc(val || '')}" autocomplete="off"${f.ph ? ` placeholder="${esc(f.ph)}"` : ''}>`;
  return `<div class="f" data-field="${f.k}"${hide}><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<div class="small muted">${esc(f.hint)}</div>` : ''}${f.why ? why(f.why) : ''}</div>`;
}
function readForm(fields) {
  const o = {};
  for (const f of fields) {
    const el = $('#f_' + f.k); if (!el) continue;
    o[f.k] = f.type === 'money' ? U.parseMoney(el.value) : f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value ? +el.value : '') : el.value;
  }
  return o;
}
function openForm(cfg) {
  dlg._cfg = cfg;
  const vals = Object.assign({}, cfg.values);
  dlg.innerHTML = `<h3>${esc(cfg.title)}</h3>${cfg.intro ? `<p class="muted small">${cfg.intro}</p>` : ''}
    <div id="formbody">${cfg.fields.map(f => fieldHtml(f, vals)).join('')}</div>
    <div class="err" id="formerr" role="alert"></div>
    <div class="row sp" style="margin-top:16px"><div>${cfg.danger ? `<button class="link d" data-act="form-danger">${esc(cfg.danger.label)}</button>` : ''}</div>
    <div class="row"><button class="btn sec" data-act="form-cancel">Cancel</button><button class="btn" data-act="form-ok">${esc(cfg.submit || 'Save')}</button></div></div>`;
  dlg.showModal();
  const first = dlg.querySelector('input:not([type=checkbox]),select'); if (first && !cfg.noFocus) first.focus();
}
function formChanged() {
  const cfg = dlg._cfg; if (!cfg) return;
  const v = readForm(cfg.fields);
  for (const f of cfg.fields) if (f.showIf) { const el = dlg.querySelector(`[data-field="${f.k}"]`); if (el) el.style.display = f.showIf(v) ? '' : 'none'; }
}
function submitForm() {
  const cfg = dlg._cfg, v = readForm(cfg.fields);
  for (const f of cfg.fields) {
    if (f.showIf && !f.showIf(v)) continue;
    if (f.req && (v[f.k] === '' || v[f.k] == null || (f.type === 'money' && !v[f.k] && !f.zeroOk))) { $('#formerr').textContent = `Please fill in "${f.label}".`; return; }
  }
  const err = cfg.onSubmit(v);
  if (err) { $('#formerr').textContent = err; return; }
  dlg.close();
}

const incFreqs = VW.FREQS.filter(f => ['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(f[0])).map(f => [f[0], f[1]]);
const billFreqs = VW.FREQS.map(f => [f[0], f[1]]);
const groupOpts = VW.GROUPS.map(g => [g.id, g.name]);

function incomeForm(id) {
  const x = id ? DB.incomes.find(i => i.id === id) : null;
  openForm({
    title: x ? 'Edit pay' : 'Add pay', submit: x ? 'Save' : 'Add',
    values: x ? Object.assign({}, x) : { freq: 'biweekly', anchor: U.today(), active: true },
    fields: [
      { k: 'name', label: 'Name (stays on this device)', type: 'text', req: true, ph: 'My paycheck' },
      { k: 'aka', label: 'Name to use in reports (optional)', type: 'text', ph: 'Income A', hint: 'Your own label. If blank, the report uses a generic one like "Income A".' },
      { k: 'amount', label: 'Take-home amount each time', type: 'money', req: true, why: 'pay' },
      { k: 'freq', label: 'How often are you paid?', type: 'select', options: incFreqs, why: 'payFreq' },
      { k: 'anchor', label: 'A payday (any one, past or next)', type: 'date', req: true, why: 'payDate' },
      { k: 'day2', label: 'The other payday each month (day number)', type: 'number', showIf: v => v.freq === 'semimonthly', hint: 'Example: paid on the 1st and the 15th. Pick the 1st above and enter 15 here.' },
      { k: 'estimated', label: 'This amount changes from paycheck to paycheck', type: 'checkbox', hint: 'Marks the paycheck as an estimate until you confirm it landed.' },
      ...(x ? [{ k: 'active', label: 'Include this pay', type: 'checkbox' }] : [])
    ],
    danger: x ? { label: 'Delete', run: () => { if (confirm('Delete this pay?')) { mutate('Removed pay', () => DB.incomes = DB.incomes.filter(i => i.id !== id)); dlg.close(); } } } : null,
    onSubmit: v => {
      mutate(x ? 'Changed pay' : 'Added pay', () => {
        const rec = { id: x ? x.id : U.uid(), name: v.name.trim(), aka: (v.aka || '').trim(), amount: v.amount, freq: v.freq, anchor: v.anchor, day2: v.freq === 'semimonthly' ? v.day2 : '', estimated: !!v.estimated, active: x ? v.active : true };
        if (x) Object.assign(x, rec); else DB.incomes.push(rec);
      });
    }
  });
}

const KIND_INFO = {
  bill: { title: 'bill', defGroup: 'home', nameLabel: 'What is it? (stays on this device)', ph: 'Rent' },
  sub: { title: 'subscription', defGroup: 'fun', nameLabel: 'What is it? (stays on this device)', ph: 'Streaming' },
  debt: { title: 'debt', defGroup: 'debt', nameLabel: 'What is it? (stays on this device)', ph: 'Credit card' }
};
function billForm(kind, id, preset = {}) {
  const x = id ? DB.bills.find(b => b.id === id) : null; kind = x ? x.kind : kind;
  const ki = KIND_INFO[kind];
  const vals = x ? Object.assign({}, x, x.debt || {}) : Object.assign({ group: ki.defGroup, freq: 'monthly', anchor: U.today(), active: true, balanceDate: U.today(), apr: 0 }, preset);
  const debtF = kind === 'debt' ? [
    { k: 'balance', label: 'Balance you owe right now', type: 'money', req: true, zeroOk: true, why: 'debtBalance' },
    { k: 'balanceDate', label: 'Date of that balance', type: 'date', req: true },
    { k: 'apr', label: 'APR (yearly interest rate, %)', type: 'number', why: 'apr', hint: 'Leave 0 if you do not know.' }
  ] : [];
  openForm({
    title: (x ? 'Edit ' : 'Add a ') + ki.title, submit: x ? 'Save' : 'Add', values: vals,
    fields: [
      { k: 'name', label: ki.nameLabel, type: 'text', req: true, ph: ki.ph },
      { k: 'aka', label: 'Name to use in reports (optional)', type: 'text', ph: 'Card X', hint: 'Your own label. If blank, the report uses a generic one like "Debt 1".' },
      { k: 'amount', label: kind === 'debt' ? 'Payment each time' : 'Amount each time', type: 'money', req: true, why: kind === 'debt' ? 'debtMin' : 'billAmount' },
      { k: 'freq', label: 'How often?', type: 'select', options: billFreqs },
      { k: 'anchor', label: 'Next due date', type: 'date', req: true, why: 'billDate' },
      { k: 'day2', label: 'The other day each month (day number)', type: 'number', showIf: v => v.freq === 'semimonthly' },
      { k: 'group', label: 'Group', type: 'select', options: groupOpts, why: 'group' },
      ...debtF,
      ...(x ? [{ k: 'active', label: 'Include this in my plan', type: 'checkbox' }] : [])
    ],
    danger: x ? { label: 'Delete', run: () => { if (confirm('Delete this ' + ki.title + '?')) { mutate('Removed ' + ki.title, () => DB.bills = DB.bills.filter(b => b.id !== id)); dlg.close(); } } } : null,
    onSubmit: v => {
      if (kind === 'debt' && v.apr !== '' && (v.apr < 0 || v.apr > 100)) return 'APR should be a percent between 0 and 100.';
      mutate((x ? 'Changed ' : 'Added ') + ki.title, () => {
        const rec = { id: x ? x.id : U.uid(), name: v.name.trim(), aka: (v.aka || '').trim(), group: v.group, kind, amount: v.amount, freq: v.freq, anchor: v.anchor, day2: v.freq === 'semimonthly' ? v.day2 : '', active: x ? v.active : true };
        if (kind === 'debt') rec.debt = { balance: v.balance, balanceDate: v.balanceDate, apr: +v.apr || 0, startBalance: x && x.debt ? Math.max(x.debt.startBalance || 0, v.balance) : v.balance };
        if (x) Object.assign(x, rec); else DB.bills.push(rec);
      });
    }
  });
}
function aliasForm() {
  openForm({
    title: 'Always replace a word in reports', intro: 'Anything you list here is swapped for the name you choose, in the question you type. Use it for a bank, a card nickname, a person, or a place.', submit: 'Add', values: {},
    fields: [{ k: 'term', label: 'Word or name to replace', type: 'text', req: true, ph: 'Chase Sapphire' }, { k: 'alias', label: 'What the report should say instead', type: 'text', ph: 'Card X', hint: 'Leave blank to remove it.' }],
    onSubmit: v => { if (v.term.trim().length < 2) return 'Use at least 2 characters.'; DB.aliases.push({ term: v.term.trim(), alias: v.alias.trim() }); commit(); }
  });
}
function balanceForm(id) {
  const b = DB.bills.find(x => x.id === id); if (!b || !b.debt) return;
  openForm({
    title: 'Update balance', intro: 'Enter what the card or loan shows today.', submit: 'Save', values: { balance: VW.estBalance(b), balanceDate: U.today() },
    fields: [{ k: 'balance', label: 'Balance right now', type: 'money', req: true, zeroOk: true, why: 'debtBalance' }, { k: 'balanceDate', label: 'Date', type: 'date', req: true }],
    onSubmit: v => mutate('Updated balance', () => { b.debt.balance = v.balance; b.debt.balanceDate = v.balanceDate; if (v.balance > (b.debt.startBalance || 0)) b.debt.startBalance = v.balance; })
  });
}
function goalForm(id) {
  const x = id ? DB.goals.find(g => g.id === id) : null;
  openForm({
    title: x ? 'Edit goal' : 'Add a goal', submit: x ? 'Save' : 'Add',
    values: x ? Object.assign({}, x) : { active: true, saved: 0, contribution: 0 },
    fields: [
      { k: 'name', label: 'Goal name (stays on this device)', type: 'text', req: true, ph: 'Car down payment' },
      { k: 'aka', label: 'Name to use in reports (optional)', type: 'text', ph: 'Goal A', hint: 'Your own label. If blank, the report uses a generic one like "Goal A".' },
      { k: 'target', label: 'Amount you want to reach', type: 'money', req: true, why: 'goalTarget' },
      { k: 'saved', label: 'Already saved', type: 'money', zeroOk: true },
      { k: 'contribution', label: 'Set aside from each paycheck', type: 'money', zeroOk: true, why: 'goalContribution' },
      ...(x ? [{ k: 'active', label: 'Include this goal', type: 'checkbox' }] : [])
    ],
    danger: x ? { label: 'Delete', run: () => { if (confirm('Delete this goal?')) { mutate('Removed goal', () => DB.goals = DB.goals.filter(g => g.id !== id)); dlg.close(); } } } : null,
    onSubmit: v => mutate(x ? 'Changed goal' : 'Added goal', () => {
      const rec = { id: x ? x.id : U.uid(), name: v.name.trim(), aka: (v.aka || '').trim(), target: v.target, saved: v.saved || 0, savedDate: U.today(), contribution: v.contribution || 0, active: x ? v.active : true };
      if (x) Object.assign(x, rec); else DB.goals.push(rec);
    })
  });
}
function cashForm() {
  openForm({
    title: 'Cash on hand', intro: 'One number: the money you have right now. No account names or numbers.', submit: 'Save', values: { amount: DB.cash ? DB.cash.amount : 0 },
    fields: [{ k: 'amount', label: 'Cash on hand today', type: 'money', zeroOk: true, why: 'cash' }],
    danger: DB.cash ? { label: 'Remove', run: () => { DB.cash = null; commit(); dlg.close(); } } : null,
    onSubmit: v => { DB.cash = { amount: v.amount, date: U.today() }; commit(); }
  });
}
function lineForm(headDate, lineId) {
  const f = VW.focus(DB);
  const heads = VW.buildHeads(DB, U.addDays(headDate, -75), U.addDays(headDate, 75));
  const head = heads.find(h => h.date === headDate); if (!head) return;
  const l = head.lines.find(x => x.id === lineId); if (!l) return;
  const home = l.home, opts = heads.filter(h => h.date <= l.due || h.date === home).slice(-5).map(h => [h.date, `Paycheck of ${U.fmtShort(h.date)}${h.date === home ? ' (usual)' : ''}`]);
  openForm({
    title: l.name, intro: `Due ${U.fmtShort(l.due)}. Changes here apply to this one payment only.`, submit: 'Save',
    values: { amount: l.amount, moveTo: l.moveTo || home, skip: l.skip },
    fields: [
      { k: 'amount', label: `Amount this time (usual ${M(l.usual)})`, type: 'money', zeroOk: true },
      { k: 'moveTo', label: 'Pay it from', type: 'select', options: opts, hint: 'Pay a bill early by choosing an earlier paycheck.' },
      { k: 'skip', label: 'Skip this one (not due this time)', type: 'checkbox' }
    ],
    danger: { label: 'Reset to usual', run: () => { delete DB.lineOv[lineId]; commit(); dlg.close(); } },
    onSubmit: v => {
      const ov = {};
      if (v.amount !== l.usual) ov.amount = v.amount;
      if (v.moveTo && v.moveTo !== home) ov.moveTo = v.moveTo;
      if (v.skip) ov.skip = true;
      if (Object.keys(ov).length) DB.lineOv[lineId] = ov; else delete DB.lineOv[lineId];
      commit();
    }
  });
}
function payForm(date) {
  const h = VW.buildHeads(DB, date, U.addDays(date, 1))[0]; if (!h) return;
  openForm({
    title: `Paycheck of ${U.fmtShort(date)}`, intro: `Expected ${M(h.base)}. If the real amount was different, enter it here.`, submit: 'Save',
    values: { amount: h.income, landed: h.landed },
    fields: [{ k: 'amount', label: 'Amount you actually received or expect', type: 'money', req: true }, { k: 'landed', label: 'It landed in my account', type: 'checkbox' }],
    danger: h.overridden ? { label: 'Use the usual amount', run: () => { delete DB.payOv[date]; commit(); dlg.close(); } } : null,
    onSubmit: v => { if (v.amount === h.base) delete DB.payOv[date]; else DB.payOv[date] = v.amount; if (v.landed) DB.landed[date] = true; else delete DB.landed[date]; commit(); }
  });
}

// ---------- shared view pieces ----------
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function bannersHtml() {
  let h = '';
  if (state.ripple) h += `<div class="banner" role="status"><div><b>${esc(state.ripple.label)}.</b> Here is what it changed:<br>${state.ripple.rows.map(r => '• ' + r).join('<br>')}</div><div class="row" style="flex-wrap:nowrap"><button class="link" data-act="ripple-undo">Undo</button><button class="link" data-act="ripple-x">Dismiss</button></div></div>`;
  if (!storageOK) h += `<div class="banner warn">This browser is not letting the app save (private window or blocked site data). Use Data, then Export, to keep your work.</div>`;
  const stale = VW.debts(DB).filter(b => b.debt.balanceDate && -U.daysUntil(b.debt.balanceDate) > 35);
  if (stale.length) h += `<div class="banner warn"><div><b>${stale.length} balance${stale.length === 1 ? ' is' : 's are'} over 35 days old.</b> Estimates drift when balances are not refreshed.</div><a class="link" href="#money">Update</a></div>`;
  if ((state.view === 'home' || state.view === 'data') && hasData() && (!DB.lastBackup || (Date.now() - new Date(DB.lastBackup)) / 864e5 > 14)) h += `<div class="banner"><div><b>Back up your data.</b> It lives only in this browser.${DB.lastBackup ? '' : ' You have not exported a copy yet.'}</div><button class="link" data-act="export">Export now</button></div>`;
  return h;
}
const nextDue = b => VW.occurrences(b, U.today(), U.addDays(U.today(), 400))[0];
function incomeItem(i) {
  return `<div class="item${i.active === false ? ' off' : ''}"><div><div class="nm">${esc(i.name)} ${i.estimated ? chip('estimated') : ''}${i.active === false ? chip('paused') : ''}</div><div class="small muted">${M(i.amount)} ${VW.freqLabel(i.freq).toLowerCase()}, next payday ${nextDue(i) ? U.fmtShort(nextDue(i)) : 'not found'}</div></div><button class="link" data-act="edit-income" data-id="${i.id}">Edit</button></div>`;
}
function billItem(b) {
  const d = b.debt ? VW.debtFacts(b) : null;
  const nd = nextDue(b);
  return `<div class="item${b.active === false ? ' off' : ''}"><div><div class="nm">${esc(b.name)} ${groupChip(b.group)}${b.active === false ? chip('paused') : ''}</div>
    <div class="small muted">${M(b.amount)} ${VW.freqLabel(b.freq).toLowerCase()}${nd ? ', next ' + U.fmtShort(nd) : ''}</div>
    ${d ? `<div class="small muted">Owe about ${M(d.balance)} (entered ${M(b.debt.balance)} on ${U.fmtDate(b.debt.balanceDate)}), ${d.apr}% APR ${d.stale > 35 ? chip('balance is ' + d.stale + ' days old', 'warn') : ''}</div>` : ''}</div>
    <div class="row">${d ? `<button class="link" data-act="update-balance" data-id="${b.id}">Update balance</button>` : ''}<button class="link" data-act="edit-bill" data-id="${b.id}">Edit</button></div></div>`;
}
function goalItem(x) {
  const gf = VW.goalFacts(DB, x);
  return `<div class="item${x.active === false ? ' off' : ''}" style="display:block"><div class="row sp"><div class="nm">${esc(x.name)} ${groupChip('save')}</div><button class="link" data-act="edit-goal" data-id="${x.id}">Edit</button></div>
    ${VW.progress(gf.pct)}<div class="small muted">${M(x.saved)} of ${M(x.target)} (${Math.round(gf.pct * 100)}%). ${x.contribution ? `Setting aside ${M(x.contribution)} each paycheck${gf.eta && gf.checks > 0 ? `, which reaches it around ${U.fmtDate(gf.eta)}` : ''}.` : 'Nothing set aside from paychecks yet.'}</div></div>`;
}
const cashItem = () => DB.cash ? `<div class="item"><div><div class="nm">${M(DB.cash.amount)}</div><div class="small muted">Entered ${U.fmtDate(DB.cash.date)}</div></div><button class="link" data-act="cash">Update</button></div>` : '';

const SECTIONS = {
  pay: { title: 'Your pay', intro: 'Start with your take-home pay: what lands in your account after taxes. If you and a partner are both paid, add each one. Every payday on the calendar comes from this.', items: () => DB.incomes.map(incomeItem), add: 'Add pay', act: 'add-income', empty: 'No pay added yet.' },
  bills: { title: 'Bills', intro: 'Add what you pay on a schedule: rent, utilities, insurance, a car payment, groceries (a weekly budget works well). You only enter the due date. The app works out which paycheck covers it.', items: () => DB.bills.filter(b => b.kind === 'bill').map(billItem), add: 'Add a bill', act: 'add-bill', kind: 'bill', empty: 'No bills added yet.' },
  subs: { title: 'Subscriptions', intro: 'Streaming, apps, memberships. Small ones count too, because the app will show what they add up to in a year.', items: () => DB.bills.filter(b => b.kind === 'sub').map(billItem), add: 'Add a subscription', act: 'add-bill', kind: 'sub', empty: 'No subscriptions added yet.' },
  debts: { title: 'Debts', intro: 'Credit cards and loans. Enter what you owe today, the interest rate (APR) if you know it, and the payment you plan to make. A car loan or mortgage can go here too. Pick Auto or Home as its group so it counts there.', items: () => DB.bills.filter(b => b.kind === 'debt').map(billItem), add: 'Add a debt', act: 'add-bill', kind: 'debt', empty: 'No debts added. Skip this if you have none.' },
  goals: { title: 'Goals', intro: 'Money you are setting aside for something: an emergency fund, a down payment, holiday gifts. Enter the target and how much you set aside from each paycheck. It comes out of the paycheck like a bill does.', items: () => DB.goals.map(goalItem), add: 'Add a goal', act: 'add-goal', empty: 'No goals added. Skip this if you have none.' },
  cash: { title: 'Cash on hand (optional)', intro: 'One number: the money you have right now. It is optional. It helps when you ask a question like "can I cover this?" Do not add account names or numbers.', items: () => [cashItem()].filter(Boolean), add: 'Set cash on hand', act: 'cash', empty: 'Not set.' }
};
function sectionHtml(id, withIntro) {
  const s = SECTIONS[id], items = s.items();
  return `<h2 style="margin-top:20px">${s.title}</h2>${withIntro ? `<p class="muted">${s.intro}</p>` : coach(s.intro)}
    <div class="list">${items.join('') || `<div class="muted small">${s.empty}</div>`}</div>
    <div style="margin-top:10px"><button class="btn sec sm" data-act="${s.act}"${s.kind ? ` data-kind="${s.kind}"` : ''}>+ ${s.add}</button></div>`;
}

// ---------- welcome & setup ----------
function viewWelcome() {
  return `<div class="welcome">
    <div class="big">See where each paycheck goes.</div>
    <p class="muted" style="font-size:18px">Paycheck Weathervane lays your pay and bills out paycheck by paycheck, so you can see what is due, when, and what is left. When you have a question, it builds a report you can paste into Claude.</p>
    <div class="rules"><p><b>1. It is a visual aid.</b> It shows where your money is going and when. That is all it does.</p><p><b>2. It is not financial advice.</b> Nothing here tells you what to do with your money.</p><p><b>3. It is private.</b> Your numbers stay in this browser. Nothing is sent anywhere unless you choose to copy a report.</p></div>
    <div class="row"><button class="btn" data-act="start-setup">Start setup (about 10 minutes)</button><button class="btn sec" data-act="example">Look around with example data</button></div>
    <p class="small muted" style="margin-top:14px">You can also <button class="link" data-act="open-file">open a saved file</button>.</p></div>`;
}
const STEP_ORDER = ['pay', 'bills', 'subs', 'debts', 'goals', 'cash'];
function viewSetup() {
  const i = Math.max(0, Math.min(STEP_ORDER.length - 1, state.step)), id = STEP_ORDER[i], last = i === STEP_ORDER.length - 1;
  const need = id === 'pay' && !DB.incomes.length;
  return `<div class="welcome" style="margin-top:8px"><div class="small muted">Step ${i + 1} of ${STEP_ORDER.length}</div>
    <div class="steps">${STEP_ORDER.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    ${sectionHtml(id, true).replace('<h2 style="margin-top:20px">', '<h1>').replace('</h2>', '</h1>')}
    ${i === 0 ? `<p class="small muted" style="margin-top:12px">Tip: the dashboard works as soon as pay and a few bills are in. You can add the rest later in My Money.</p>` : ''}
    <div class="row sp" style="margin-top:24px"><button class="btn sec" data-act="setup-back"${i === 0 ? ' disabled' : ''}>Back</button>
    <button class="btn" data-act="${last ? 'setup-finish' : 'setup-next'}"${need ? ' disabled' : ''}>${last ? 'Finish and see my dashboard' : 'Next'}</button></div>
    ${need ? '<p class="small muted" style="text-align:right">Add your pay to continue.</p>' : ''}</div>`;
}

// ---------- home ----------
function paycheckFacts(ms, f) {
  const out = [];
  const sn = VW.snap(DB);
  if (sn.heads.length > 1) {
    const hi = sn.heads.reduce((a, h) => h.left > a.left ? h : a, sn.heads[0]), lo = sn.heads.reduce((a, h) => h.left < a.left ? h : a, sn.heads[0]);
    out.push(`Your tightest paycheck in the next ${sn.heads.length} is ${U.fmtShort(lo.date)}, with ${M(lo.left)} left after its payments. The roomiest is ${U.fmtShort(hi.date)}, with ${M(hi.left)} left.`);
  }
  if (ms.early.length) out.push(`${ms.early.length} payment${ms.early.length === 1 ? '' : 's'} due in ${U.monthName(ms.mk)} (${M(U.sum(ms.early, e => e.line.amount))}) come out of the paycheck before this month starts.`);
  const per = db => db.incomes.filter(i => i.active !== false && (i.freq === 'weekly' || i.freq === 'biweekly'));
  if (per(DB).length && ms.heads.length >= 3) out.push(`${U.monthLabel(ms.mk)} has ${ms.heads.length} paychecks. A month with an extra paycheck is part of how the year adds up (26 paychecks every 2 weeks, not 24).`);
  const subs = DB.bills.filter(b => b.active !== false && b.kind === 'sub');
  if (subs.length) out.push(`Your subscriptions come to ${M(U.sum(subs, VW.monthlyEq))} a month, or ${M(U.sum(subs, VW.annual))} a year.`);
  for (const b of VW.debts(DB)) { const d = VW.debtFacts(b); if (d.balance > 0 && d.apr > 0) out.push(`${esc(b.name)}: about ${M(d.interestThisMonth)} of your ${M(d.monthly)} payment is interest this month. ${isFinite(d.payoff.months) ? `At that payment it takes about ${d.payoff.months} months to pay off.` : 'That payment does not cover the interest.'}`); }
  return out;
}
function viewHome() {
  if (!DB.onboarded && !hasData()) return viewWelcome();
  const f = VW.focus(DB), cur = f.cur, next = f.next, h0 = next || cur;
  if (!h0) return `<h1>Home</h1>${bannersHtml()}<div class="card"><h3>Add your pay to begin</h3><p class="muted">The dashboard is built around your paychecks.</p><a class="btn" href="#money" style="text-decoration:none;display:inline-block">Go to My Money</a></div>`;
  const mk = U.monthKey(h0.date), ms = VW.monthSummary(DB, mk), sh = VW.shares(ms.byGroup, ms.income);
  const start = cur || next;
  const upcoming = [];
  for (const h of f.all) if (h.date >= start.date) for (const l of h.lines) if (!l.skip && !l.paid && l.due >= U.today()) upcoming.push(l);
  upcoming.sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  const heads12 = VW.buildHeads(DB, start.date, U.addDays(start.date, 400)).slice(0, 12);
  const sec = state.hlSeg, y = sec && VW.YARDSTICKS[sec];
  const x = VW.split503020(ms.byGroup, ms.income);
  const goals = DB.goals.filter(g => g.active !== false), debts = VW.debts(DB);
  const facts = paycheckFacts(ms, f);
  const segLines = sec ? ms.heads.flatMap(h => h.lines.filter(l => l.group === sec && !l.skip)) : [];
  const yard = ['home', 'auto', 'food'].filter(k => ms.byGroup[k] && ms.income).map(k => `${VW.groupName(k)} is ${U.pct(ms.byGroup[k], ms.income)}% of take-home`);
  return `<h1>Home</h1>${bannersHtml()}
  <div class="card"><div class="hero"><div>
      <div class="muted small">${next ? 'NEXT PAYCHECK' : 'CURRENT PAYCHECK'}</div>
      <div class="big">${U.fmtShort(h0.date)} ${next ? `<span class="muted" style="font-size:16px;font-weight:600">${dueIn(h0.date)}</span>` : ''}</div>
      <div class="muted">${M(h0.income)}${h0.estimated ? ' (estimated)' : ''}${next ? ` · covers ${plural(h0.lines.filter(l => !l.skip).length, 'payment')}, leaves ${M(h0.left)}` : ''}</div></div>
    ${cur ? `<div><div class="muted small">UNTIL THEN</div><div class="big">${M(cur.unpaid)}</div><div class="muted">still to pay from the ${U.fmtMD(cur.date)} paycheck (${plural(cur.lines.filter(l => !l.skip && !l.paid).length, 'payment')})</div></div>
    <div><div class="muted small">LEFT FROM THAT PAYCHECK</div><div class="big ${cur.left < 0 ? 'bad' : ''}">${M(cur.left)}</div><div class="muted">after everything it covers</div></div>` : ''}
  </div>${coach('Each paycheck covers every payment due until the next one arrives. "Left" is what remains after all of them.')}</div>

  <h2>${U.monthLabel(mk)} at a glance</h2>
  <div class="grid tiles">
    <div class="card tile"><div class="k">Money in</div><div class="v">${MR(ms.income)}</div><div class="s">${ms.heads.length} paycheck${ms.heads.length === 1 ? '' : 's'} dated this month</div></div>
    <div class="card tile"><div class="k">They must cover</div><div class="v">${MR(ms.out)}</div><div class="s">bills and set-asides in their windows</div></div>
    <div class="card tile"><div class="k">Left over</div><div class="v ${ms.left < 0 ? 'bad' : ''}">${MR(ms.left)}</div><div class="s">${ms.left < 0 ? 'more going out than coming in' : U.pct(ms.left, ms.income) + '% of money in'}</div></div>
    <div class="card tile"><div class="k">Due in ${U.monthName(mk)}</div><div class="v">${MR(ms.due)}</div><div class="s">${ms.dueCount} bills by calendar date</div></div>
  </div>
  ${coach(`Why two totals? A paycheck pays for bills that come due <i>after</i> it, even into next month. So "They must cover" and "Due in ${U.monthName(mk)}" can differ. <a class="link" href="#plan">See the split on the Plan page</a>.`)}

  <div class="grid two">
    <div class="card"><h3>Where it goes</h3><p class="muted small">Share of take-home pay, ${U.monthLabel(mk)}. Tap a slice or row for what is in it.</p>
      <div class="donutbox"><div>${VW.donut(sh, { highlight: sec })}</div><div>${VW.shareTable(sh, { highlight: sec })}</div></div>
      ${sec ? `<div class="coach" style="display:block"><b>${esc(VW.groupName(sec))}</b>: ${segLines.length ? segLines.map(l => `${esc(l.name)} ${M(l.amount)}`).join(', ') : 'nothing this month'}.${y ? `<br>${esc(y.text)}` : ''}</div>` : ''}
      ${yard.length ? `<p class="small muted">${yard.join('. ')}. Yardsticks are on the Learn page. They measure; they do not judge.</p>` : ''}
      <p class="small muted">One popular split, 50/30/20, for comparison: needs ${x.needsP}% (target 50), wants ${x.wantsP}% (30), savings ${x.saveP}% (20).</p></div>
    <div class="card"><h3>Coming up</h3><p class="muted small">Tick Paid when you have paid it.</p>
      ${upcoming.length ? `<table><tbody>${upcoming.slice(0, 8).map(l => `<tr><td style="width:28px"><input type="checkbox" data-chg="paid" data-id="${l.id}" aria-label="Paid"></td><td><div class="nm">${esc(l.name)}</div><div class="small muted">${U.fmtShort(l.due)} · ${dueIn(l.due)}</div></td><td class="n">${M(l.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Nothing unpaid coming up.</p>'}</div>
  </div>

  <h2>Money in and out, paycheck by paycheck</h2><div class="card">${VW.bars(heads12)}${coach('Blue is the paycheck. Orange is everything it has to pay before the next one. Where orange nears blue, that paycheck is tight.')}</div>

  ${goals.length || debts.length ? `<div class="grid two" style="margin-top:12px">
    ${goals.length ? `<div class="card"><h3>Goals</h3>${goals.map(g => { const gf = VW.goalFacts(DB, g); return `<div style="margin-top:10px"><div class="row sp"><span class="nm">${esc(g.name)}</span><span class="small muted">${MR(g.saved)} of ${MR(g.target)}</span></div>${VW.progress(gf.pct)}<div class="small muted">${g.contribution ? `${M(g.contribution)} per paycheck${gf.eta && gf.checks > 0 ? ' · reaches it around ' + U.fmtDate(gf.eta) : ''}` : 'nothing set aside yet'}</div></div>`; }).join('')}</div>` : ''}
    ${debts.length ? `<div class="card"><h3>Debts</h3>${debts.map(b => { const d = VW.debtFacts(b); return `<div style="margin-top:10px"><div class="row sp"><span class="nm">${esc(b.name)}</span><span class="small muted">about ${M(d.balance)} owed</span></div>${VW.progress(d.progress, 'debt')}<div class="small muted">${d.apr}% APR · ${d.payoffDate ? 'paid off around ' + U.monthLabel(d.payoffDate) + ' at this payment' : d.balance <= 0 ? 'paid off' : 'payment does not cover the interest'}${d.stale > 35 ? ' · ' + chip('balance is ' + d.stale + ' days old', 'warn') : ''}</div></div>`; }).join('')}</div>` : ''}</div>` : ''}

  ${facts.length ? `<h2>What the numbers say</h2><div class="card"><ul class="facts">${facts.map(t => `<li>${t}</li>`).join('')}</ul><p class="small muted">Plain facts from your own numbers. They describe; they do not advise.</p></div>` : ''}

  <div class="card" style="margin-top:16px"><div class="row sp"><div><h3>Have a question about your money?</h3><p class="muted small" style="margin:2px 0">Pick a question, review the report, and paste it into Claude.</p></div><a class="btn" href="#ask" style="text-decoration:none">Ask Claude</a></div></div>`;
}

// ---------- plan ----------
function rowHtml(l, h) {
  const cls = (l.paid ? 'paid ' : '') + (l.skip ? 'skip' : '');
  return `<tr class="${cls}"><td style="width:28px"><input type="checkbox" data-chg="paid" data-id="${l.id}"${l.paid ? ' checked' : ''}${l.skip ? ' disabled' : ''} aria-label="Paid"></td>
    <td class="n" style="text-align:left;width:92px">${U.fmtShort(l.due).slice(4)}<div class="small muted">${U.dow(l.due)}</div></td>
    <td><span class="nm">${esc(l.name)}</span> ${l.kind === 'save' ? '' : groupChip(l.group)} ${l.movedIn ? chip('paid early', 'acc') : ''}${l.amount !== l.usual && !l.skip ? chip('changed this time') : ''}${l.skip ? chip('skipped') : ''}</td>
    <td class="n">${M(l.amount)}</td><td class="n after ${l.after < 0 ? 'neg' : ''}">${l.skip ? '' : M(l.after)}</td>
    <td class="n"><button class="link" data-act="line" data-head="${h.date}" data-id="${l.id}">Edit</button></td></tr>`;
}
function viewPlan() {
  const f = VW.focus(DB), h0 = f.next || f.cur;
  if (!h0) return `<h1>Plan</h1><div class="card"><p>Add your pay in <a href="#money">My Money</a> to see your paychecks.</p></div>`;
  const mk = state.month || U.monthKey(h0.date), ms = VW.monthSummary(DB, mk), n = ms.heads.length;
  const weekly = DB.incomes.some(i => i.active !== false && (i.freq === 'weekly' || i.freq === 'biweekly'));
  const dates = ms.heads.map(h => U.fmtMD(h.date)).join(', ');
  const even = n ? Math.round(ms.out / n) : 0;
  const intro = n ? `${U.monthLabel(mk)} has <b>${n} paycheck${n === 1 ? '' : 's'}</b> (${dates}).${weekly && n >= 3 ? ' That is a month with an extra paycheck.' : ''}` : `No paychecks are dated in ${U.monthLabel(mk)}.`;
  const earlyHtml = ms.early.length ? `<div class="card" style="margin-top:12px"><h3>Due early in ${U.monthName(mk)}, paid from the paycheck before it</h3><p class="muted small">These come due before ${U.monthName(mk)}'s first paycheck, so the previous month's paycheck covers them.</p>
    <table><tbody>${ms.early.map(e => `<tr><td>${U.fmtShort(e.line.due)}</td><td>${esc(e.line.name)}</td><td class="n">${M(e.line.amount)}</td><td class="n small muted">from the ${U.fmtMD(e.head.date)} paycheck</td></tr>`).join('')}</tbody></table></div>` : '';
  const modePanel = state.planMode === 'even' && n ? `<div class="card" style="margin-top:12px"><h3>Two ways to look at the same money</h3>
    <p class="muted small">"By due date" is what actually leaves each paycheck. "Even split" shows what each paycheck would set aside if ${U.monthName(mk)}'s payments were shared equally (${M(ms.out)} ÷ ${n} = ${M(even)}). The app only shows both. Which one fits is up to you.</p>
    <div class="tablewrap"><table><thead><tr><th>Paycheck</th><th class="n">Money in</th><th class="n">By due date</th><th class="n">Even split</th><th class="n">Difference</th></tr></thead><tbody>${ms.heads.map(h => `<tr><td>${U.fmtShort(h.date)}</td><td class="n">${M(h.income)}</td><td class="n">${M(h.out)}</td><td class="n">${M(even)}</td><td class="n">${delta(h.out, even) || '-'}</td></tr>`).join('')}</tbody></table></div></div>` : '';
  const cards = ms.heads.map(h => `<div class="card paycard"><div class="hd"><div><h3>Paycheck ${U.fmtShort(h.date)}${h.date === (f.next && f.next.date) ? ' ' + chip('next', 'acc') : ''}${h.date <= U.today() ? ' ' + chip('current or past') : ''}</h3>
      <div class="small muted">${M(h.income)} ${h.estimated ? chip('estimated', 'warn') : ''}${h.overridden ? chip('amount changed') : ''} · covers payments due ${U.fmtMD(h.date)} to ${U.fmtMD(U.addDays(h.end, -1))}</div></div>
      <label class="row small"><input type="checkbox" data-chg="landed" data-date="${h.date}"${h.landed ? ' checked' : ''}> Landed <button class="link" data-act="pay" data-date="${h.date}">Edit amount</button></label></div>
    <div class="tablewrap"><table><thead><tr><th></th><th>Due</th><th>Payment</th><th class="n">Amount</th><th class="n">Left after</th><th></th></tr></thead><tbody>
    ${h.lines.map(l => rowHtml(l, h)).join('') || '<tr><td colspan="6" class="muted">Nothing due in this window.</td></tr>'}</tbody></table></div>
    <div class="row sp" style="margin-top:8px"><span class="muted small">${M(h.income)} in − ${M(h.out)} out</span><b class="${h.left < 0 ? 'bad' : ''}">${M(h.left)} left</b></div></div>`).join('');
  return `<div class="row sp"><h1>Plan</h1><div class="row"><button class="btn sec sm" data-act="month-prev">‹ Prev</button><b>${U.monthLabel(mk)}</b><button class="btn sec sm" data-act="month-next">Next ›</button><button class="link" data-act="month-today">Today</button></div></div>${bannersHtml()}
  <p>${intro}</p>
  <div class="grid tiles"><div class="card tile"><div class="k">Money in</div><div class="v">${MR(ms.income)}</div><div class="s">${n} paycheck${n === 1 ? '' : 's'}</div></div>
    <div class="card tile"><div class="k">They must cover</div><div class="v">${MR(ms.out)}</div><div class="s">in their windows</div></div>
    <div class="card tile"><div class="k">Left over</div><div class="v ${ms.left < 0 ? 'bad' : ''}">${MR(ms.left)}</div></div>
    <div class="card tile"><div class="k">Due in ${U.monthName(mk)}</div><div class="v">${MR(ms.due)}</div><div class="s">by calendar date</div></div></div>
  ${coach('Step 1: the month. Step 2: below, the split by paycheck, in date order, with what is left after each payment. Step 3: switch between "by due date" and "even split".')}
  ${earlyHtml}
  <div class="row" style="margin-top:12px"><div class="seg"><button class="${state.planMode === 'due' ? 'on' : ''}" data-act="plan-mode" data-mode="due">By due date</button><button class="${state.planMode === 'even' ? 'on' : ''}" data-act="plan-mode" data-mode="even">Even split</button></div>
    <button class="btn sec sm" data-act="add-once">+ One-time payment</button></div>
  ${modePanel}${cards}`;
}

// ---------- my money ----------
function viewMoney() {
  return `<h1>My Money</h1>${bannersHtml()}<p class="muted">Everything you enter lives here. Change any number and the app shows what it changed.</p>
  ${['pay', 'bills', 'subs', 'debts', 'goals', 'cash'].map(id => sectionHtml(id, false)).join('')}`;
}

// ---------- ask claude ----------
function askFieldHtml(f, v) {
  const val = v[f.k], id = 'a_' + f.k;
  let input;
  if (f.type === 'money') input = `<div class="money-in"><span>$</span><input id="${id}" data-ask="${f.k}" type="text" inputmode="decimal" value="${val ? U.centsIn(val) : ''}" placeholder="0.00"></div>`;
  else if (f.type === 'date') input = `<input id="${id}" data-ask="${f.k}" type="date" value="${esc(val || '')}">`;
  else if (f.type === 'group') input = `<select id="${id}" data-ask="${f.k}">${groupOpts.map(o => `<option value="${o[0]}"${o[0] === val ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  else if (f.type === 'debt') { const ds = VW.debts(DB); input = ds.length ? `<select id="${id}" data-ask="${f.k}">${ds.map(b => `<option value="${b.id}"${b.id === val ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : '<div class="small muted">Add a debt in My Money first.</div>'; }
  else input = `<textarea id="${id}" data-ask="${f.k}" style="min-height:90px;font-family:inherit;font-size:16px" placeholder="Type your question here">${esc(val || '')}</textarea>`;
  return `<div class="f"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
}
function askMonthKey(ev, p) {
  const f = VW.focus(DB); const h0 = f.next || f.cur;
  return ev.qid === 'afford' && p.start ? U.monthKey(p.start) : U.monthKey(h0.date);
}
function askResultHtml() {
  const a = state.ask, p = a.params, ev = VW.evalQuestion(DB, a.qid, p);
  if (ev.error && a.qid !== 'free') return `<div class="muted">${esc(ev.error)}</div>`;
  let h = '';
  if (ev.facts.length) h += `<ul class="facts">${ev.facts.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  if (ev.hypoDB && ev.rows) {
    const mk = askMonthKey(ev, p), b = VW.monthSummary(DB, mk), c = VW.monthSummary(ev.hypoDB, mk);
    h += `<h3 style="margin-top:12px">${U.monthLabel(mk)}: before and after</h3><div class="ba"><div><h3>Now</h3>${VW.donut(VW.shares(b.byGroup, b.income), { size: 180 })}</div><div><h3>With this change</h3>${VW.donut(VW.shares(c.byGroup, c.income), { size: 180 })}</div></div>
    <div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Paycheck</th><th class="n">Left now</th><th class="n">Left after</th><th class="n">Change</th></tr></thead><tbody>${ev.rows.map(r => `<tr><td>${U.fmtShort(r.date)}</td><td class="n">${M(r.before)}</td><td class="n ${r.after < 0 ? 'bad' : ''}">${M(r.after)}</td><td class="n">${delta(r.before, r.after) || '-'}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Numbers from your own entries. Direction and size only; no verdict.</p>`;
  }
  return h || '<div class="muted">Claude will get your full picture along with the question.</div>';
}
function askReportHtml() {
  const a = state.ask;
  const q = VW.QUESTIONS.find(x => x.id === a.qid);
  const ev = VW.evalQuestion(DB, a.qid, a.params);
  if (a.qid === 'free' && !a.params.text) return `<div class="muted">Type your question above to build the report.</div>`;
  if (ev.error && a.qid !== 'free') return `<div class="muted">Fill in the question above to build the report.</div>`;
  const extra = a.extra.split(',').map(s => s.trim()).filter(Boolean);
  const r = VW.buildReport(DB, a.qid, a.params, { extraRemove: extra });
  const { map } = VW.labels(DB);
  return `<p class="small"><b>Best effort at removing identifying information. Always review the report before you paste it.</b></p>
    <p class="small muted">Names are replaced with generic labels and long numbers, emails and links are removed${r.scrubbed ? ` (${r.scrubbed} removed from your question)` : ''}. The app cannot know every private detail, so read every line. If you see anything you do not want shared, edit it or delete it below.</p>
    <textarea id="reportText" spellcheck="false" style="min-height:300px">${esc(r.text)}</textarea>
    <div class="f cb"><label><input type="checkbox" id="reviewed" data-chg="reviewed"${a.reviewed ? ' checked' : ''}> I read the report and it is ready to share</label></div>
    <div class="row"><button class="btn" data-act="ask-copy"${a.reviewed ? '' : ' disabled'}>Copy report</button><a class="btn sec" href="https://claude.ai/new" target="_blank" rel="noopener noreferrer" style="text-decoration:none">Open Claude in a new tab</a></div>
    <p class="small muted" style="margin-top:8px">Then paste (Ctrl+V or Cmd+V) into Claude and send. The report already asks Claude to begin with "Assuming your numbers are correct, it seems to indicate..." and to describe what the numbers show without telling you what to do.</p>
    <details class="why" open><summary>Your key (stays on this screen, not in the report)</summary><div class="tablewrap"><table><tbody>${map.filter(m => m[1]).map(m => `<tr><td>${esc(m[0])}</td><td>${esc(m[1])}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function viewAsk() {
  const a = state.ask, q = VW.QUESTIONS.find(x => x.id === a.qid);
  if (!a.started) { a.params = VW.defaultParams(q); a.started = true; }
  if (!VW.focus(DB).next && !VW.focus(DB).cur) return `<h1>Ask Claude</h1><div class="card"><p>Add your pay and bills in <a href="#money">My Money</a> first, so there is something to ask about.</p></div>`;
  return `<h1>Ask Claude</h1>${bannersHtml()}
  <p class="muted">Pick a question. The app shows the numbers right away, then builds a report you can paste into Claude. Claude's answer will start with "Assuming your numbers are correct, it seems to indicate..." because it can only describe what is in the numbers you entered.</p>
  <h2 style="margin-top:16px">1. Choose a question</h2>
  <div class="picker">${VW.QUESTIONS.map(x => `<label class="pick${x.id === a.qid ? ' on' : ''}" data-act="askq" data-id="${x.id}"><input type="radio" name="q"${x.id === a.qid ? ' checked' : ''}><b>${esc(x.title)}</b><span>${esc(x.blurb)}</span></label>`).join('')}</div>
  ${q.fields.length ? `<h2>2. Fill in the details</h2><div class="card">${q.fields.map(f => askFieldHtml(f, a.params)).join('')}</div>` : ''}
  <h2>${q.fields.length ? '3' : '2'}. What your numbers show</h2><div class="card" id="askOut">${askResultHtml()}</div>
  <h2>${q.fields.length ? '4' : '3'}. Report for Claude</h2>
  <div class="card"><div class="f"><label for="a_extra">Anything else to remove from your question? (names, places, separated by commas)</label><input id="a_extra" data-ask="_extra" type="text" value="${esc(a.extra)}" placeholder="for example: Dana, Springfield"></div>
  <div id="askReport">${askReportHtml()}</div></div>`;
}
function refreshAsk() {
  state.ask.reviewed = false;
  const o = $('#askOut'), r = $('#askReport'); if (o) o.innerHTML = askResultHtml(); if (r) r.innerHTML = askReportHtml();
}

// ---------- learn ----------
function loanCalcHtml() {
  return `<div class="calc"><div><label class="small muted">Price</label><input type="text" inputmode="decimal" data-lc="price" value="25000"></div><div><label class="small muted">Down payment</label><input type="text" inputmode="decimal" data-lc="down" value="5000"></div>
    <div><label class="small muted">APR %</label><input type="text" inputmode="decimal" data-lc="apr" value="7"></div><div><label class="small muted">Months</label><input type="text" inputmode="numeric" data-lc="months" value="60"></div></div><div id="lcOut" class="mine" style="margin-top:8px"></div>`;
}
function lcUpdate() {
  const v = k => parseFloat((document.querySelector(`[data-lc="${k}"]`) || {}).value) || 0, out = $('#lcOut'); if (!out) return;
  const P = Math.max(0, v('price') - v('down')), n = Math.round(v('months')), pay = VW.loanPayment(P, v('apr'), n), total = pay * n;
  out.innerHTML = n > 0 ? `Borrowing <b>${M(Math.round(P * 100))}</b>: payment about <b>${M(Math.round(pay * 100))}</b> a month, total paid about <b>${M(Math.round(total * 100))}</b>, of which about <b>${M(Math.round((total - P) * 100))}</b> is interest.` : 'Enter a number of months.';
}
function viewLearn() {
  return `<h1>How money works</h1>${bannersHtml()}<p class="muted">Short lessons. Each says whether it is a fact, a named method, or a commonly quoted yardstick. They describe how things work. They do not tell you what to do. Where possible, the lesson shows your own numbers.</p>
  ${VW.LESSONS.map((l, i) => { const mine = hasData() && l.mine ? l.mine(DB) : ''; return `<details class="lesson"${i === 0 ? ' open' : ''}><summary><span>${esc(l.title)}</span><span class="chip ${l.kind === 'Fact' ? 'good' : 'acc'}">${esc(l.kind)}</span></summary><div class="in">${l.body.map(t => `<p>${esc(t)}</p>`).join('')}${l.calc ? loanCalcHtml() : ''}${mine ? `<div class="mine"><b>Your numbers</b>${mine}</div>` : ''}</div></details>`; }).join('')}
  <h2>Words</h2><div class="card"><dl class="gl">${VW.GLOSSARY.map(g => `<dt>${esc(g[0])}</dt><dd>${esc(g[1])}</dd>`).join('')}</dl></div>`;
}

// ---------- data ----------
function viewData() {
  return `<h1>Data and settings</h1>${bannersHtml()}
  <div class="card"><h3>Back up and restore</h3><p class="muted small">Your numbers are stored only in this browser, on this device. Clearing browser data erases them, and another device will not see them. Export a file to keep a copy, and open it later to restore.</p>
    <div class="row"><button class="btn" data-act="export">Export a backup file</button><button class="btn sec" data-act="open-file">Open a backup file</button><input type="file" id="filein" accept=".json,application/json" hidden></div>
    <p class="small muted">Last backup: ${DB.lastBackup ? U.fmtDate(DB.lastBackup.slice(0, 10)) : 'never'}.${storageOK ? '' : ' This browser is blocking saving.'}</p>
    <p class="small muted">The file holds your financial details in plain text. Keep it private.</p></div>
  <div class="card" style="margin-top:12px"><h3>Names in reports</h3><p class="muted small">This is an extra step of removing identifying details, and it is your choice. By default the report calls things "Debt 1" or "Home bill 2". You can pick your own names: set a "name to use in reports" when you edit any pay, bill, debt or goal. You can also list words to always replace, such as a bank name or a nickname, and say what they should become.</p>
    <div class="list">${(DB.aliases || []).map((a, i) => `<div class="item"><div><b>${esc(a.term)}</b> <span class="muted">becomes</span> <b>${esc(a.alias || '[removed]')}</b></div><button class="link d" data-act="del-alias" data-i="${i}">Remove</button></div>`).join('') || '<div class="muted small">Nothing listed yet.</div>'}</div>
    <div style="margin-top:10px"><button class="btn sec sm" data-act="add-alias">+ Always replace a word</button></div><p class="small muted">Best effort only. Always read the report before you paste it.</p></div>
  <div class="card" style="margin-top:12px"><h3>Settings</h3><div class="f cb"><label><input type="checkbox" data-chg="coach"${DB.newToThis ? ' checked' : ''}> New to this: show the plain-English hints</label></div></div>
  <div class="card" style="margin-top:12px"><h3>Start over</h3><p class="muted small">Erases everything in this browser.</p><div class="row"><button class="btn danger sm" data-act="reset">Erase all my data</button><button class="btn sec sm" data-act="example">Replace with example data</button></div></div>
  <div class="card" style="margin-top:12px"><h3>About</h3><p class="small"><b>This app is a visual aid, not financial advice.</b> It shows where your money is going and when. It does not recommend, evaluate, or approve any financial decision. If you need advice, talk to a qualified professional.</p>
  <p class="small muted">It runs entirely in your browser. It makes no network requests. The report to Claude is only created, and only copied, when you choose to. ${esc(VW.APP_NAME)} version ${VW.VERSION}.</p>
  <p class="small muted">Provided as is, without warranty of any kind. The numbers are only as accurate as what you enter.</p></div>`;
}

// ---------- render & events ----------
const NAV = [['home', 'Home'], ['plan', 'Plan'], ['money', 'My Money'], ['ask', 'Ask Claude'], ['learn', 'Learn'], ['data', 'Data']];
const VIEWS = { home: viewHome, plan: viewPlan, money: viewMoney, ask: viewAsk, learn: viewLearn, data: viewData, setup: viewSetup };
function render() {
  const welcome = state.view === 'home' && !DB.onboarded && !hasData();
  const setup = state.view === 'setup';
  const body = (VIEWS[state.view] || viewHome)();
  $('#app').innerHTML = `<header><div class="wrap"><p class="brand">${esc(VW.APP_NAME)}</p>${welcome || setup ? '' : `<nav aria-label="Main">${NAV.map(n => `<a href="#${n[0]}" class="${state.view === n[0] ? 'on' : ''}">${n[1]}</a>`).join('')}</nav>`}</div></header>
    <div class="notice">A visual aid, not financial advice. Your numbers stay in this browser.</div>
    <main><div class="wrap">${body}</div></main>
    <footer>${esc(VW.APP_NAME)} ${VW.VERSION} · Provided as is. Only as accurate as what you enter.</footer>`;
  document.title = VW.APP_NAME;
  if (state.view === 'learn') lcUpdate();
}
function route() {
  const v = (location.hash || '#home').slice(1);
  state.view = VIEWS[v] ? v : 'home';
  state.ripple = state.view === 'home' || state.view === 'plan' || state.view === 'money' ? state.ripple : null;
  render(); window.scrollTo(0, 0);
}
function go(v) { if (location.hash === '#' + v) route(); else location.hash = v; }

function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function importText(text) {
  let d; try { d = JSON.parse(text); } catch (e) { return toast('That file is not a valid backup.'); }
  if (!d || !Array.isArray(d.incomes) || !Array.isArray(d.bills)) return toast('That file does not look like a Paycheck Weathervane backup.');
  if (hasData() && !confirm('This replaces everything currently in the app. Continue?')) return;
  DB = VW.migrate(d); DB.onboarded = true; state.ripple = null; commit(); toast('Backup opened.'); go('home');
}
async function copyReport() {
  const ta = $('#reportText'); if (!ta) return;
  try { await navigator.clipboard.writeText(ta.value); toast('Copied. Paste it into Claude.'); }
  catch (e) { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('Copied. Paste it into Claude.'); } catch (e2) { toast('Select the report text and copy it yourself.'); } }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const a = t.dataset.act, id = t.dataset.id;
  switch (a) {
    case 'form-ok': return submitForm();
    case 'form-cancel': return dlg.close();
    case 'form-danger': return dlg._cfg && dlg._cfg.danger && dlg._cfg.danger.run();
    case 'start-setup': state.step = 0; return go('setup');
    case 'example': if (hasData() && !confirm('This replaces what is in the app with example data. Continue?')) return; DB = VW.exampleDB(); state.ripple = null; commit(); return go('home');
    case 'open-file': { let f = $('#filein'); if (!f) { f = document.createElement('input'); f.type = 'file'; f.id = 'filein'; f.accept = '.json,application/json'; f.hidden = true; document.body.appendChild(f); } f.onchange = () => { const file = f.files[0]; if (file) file.text().then(importText); f.value = ''; }; return f.click(); }
    case 'add-income': return incomeForm();
    case 'edit-income': return incomeForm(id);
    case 'add-bill': return billForm(t.dataset.kind);
    case 'edit-bill': return billForm(null, id);
    case 'update-balance': return balanceForm(id);
    case 'add-goal': return goalForm();
    case 'edit-goal': return goalForm(id);
    case 'cash': return cashForm();
    case 'add-once': return billForm('bill', null, { freq: 'once', anchor: U.today() });
    case 'add-alias': return aliasForm();
    case 'del-alias': DB.aliases.splice(+t.dataset.i, 1); return commit();
    case 'setup-next': state.step++; return render();
    case 'setup-back': state.step = Math.max(0, state.step - 1); return render();
    case 'setup-finish': DB.onboarded = true; commit(); return go('home');
    case 'month-prev': case 'month-next': { const f = VW.focus(DB), h0 = f.next || f.cur; const cur = state.month || U.monthKey(h0.date); state.month = U.monthShift(cur, a === 'month-prev' ? -1 : 1); return render(); }
    case 'month-today': state.month = null; return render();
    case 'plan-mode': state.planMode = t.dataset.mode; return render();
    case 'line': return lineForm(t.dataset.head, id);
    case 'pay': return payForm(t.dataset.date);
    case 'seg': state.hlSeg = state.hlSeg === t.dataset.seg ? null : t.dataset.seg; return render();
    case 'ripple-x': state.ripple = null; return render();
    case 'ripple-undo': if (state.ripple) { DB = VW.migrate(JSON.parse(state.ripple.before)); state.ripple = null; commit(); toast('Change undone.'); } return;
    case 'askq': { e.preventDefault(); const q = VW.QUESTIONS.find(x => x.id === id); state.ask = { qid: id, params: VW.defaultParams(q), extra: state.ask.extra, reviewed: false, started: true }; return render(); }
    case 'ask-copy': return copyReport();
    case 'export': DB.lastBackup = new Date().toISOString(); save(); download(`paycheck-weathervane-${U.today().replace(/-/g, '')}.json`, JSON.stringify(DB, null, 2)); toast('Backup file downloaded.'); return render();
    case 'reset': if (confirm('Erase all your data from this browser? This cannot be undone.') && confirm('Really erase everything?')) { DB = VW.newDB(); state.ripple = null; state.month = null; commit(); go('home'); } return;
  }
});
document.addEventListener('click', e => {   // donut slices and share rows
  const s = e.target.closest('[data-seg]'); if (!s || !s.closest('#app') || state.view !== 'home') return;
  const id = s.dataset.seg; if (id === 'left') return;
  state.hlSeg = state.hlSeg === id ? null : id; render();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (dlg.contains(t)) return formChanged();
  const c = t.dataset && t.dataset.chg; if (!c) return;
  if (c === 'paid') { if (t.checked) DB.paid[t.dataset.id] = true; else delete DB.paid[t.dataset.id]; return commit(); }
  if (c === 'landed') { if (t.checked) DB.landed[t.dataset.date] = true; else delete DB.landed[t.dataset.date]; return commit(); }
  if (c === 'coach') { DB.newToThis = t.checked; return commit(); }
  if (c === 'reviewed') { state.ask.reviewed = t.checked; const b = document.querySelector('[data-act="ask-copy"]'); if (b) b.disabled = !t.checked; return; }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset && t.dataset.lc) return lcUpdate();
  if (t.dataset && t.dataset.ask) {
    const k = t.dataset.ask, q = VW.QUESTIONS.find(x => x.id === state.ask.qid), f = q.fields.find(x => x.k === k);
    if (k === '_extra') state.ask.extra = t.value;
    else state.ask.params[k] = f && f.type === 'money' ? U.parseMoney(t.value) : t.value;
    refreshAsk();
  }
});

DB = load();
window.addEventListener('hashchange', route);
route();
window.VWApp = { get DB() { return DB; }, state, render };   // handy for testing
})();
