(() => {
'use strict';

/* ======================================================================
   Paycheck Planner
   - All money is stored as integer cents.
   - Everything flows through DB.log (income, allocation, spending, fund, adjust).
   - Only money that has landed (income entries / starting balances) counts toward Available.
   ====================================================================== */

// ---------- utils ----------
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toDays = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const fromDays = n => new Date(n * DAY).toISOString().slice(0, 10);
const addDays = (iso, n) => fromDays(toDays(iso) + n);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${MONTHS[m - 1]} ${+d}, ${y}`; };
const money = c => (c < 0 ? '-' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseMoney = s => { const n = parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? Math.round(n * 100) : 0; };
const centsIn = c => (c / 100).toFixed(2);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };

const FREQS = [['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['semimonthly', 'Twice a month'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly'], ['once', 'One time']];
const CATS = ['Subscription', 'Debt payment', 'Bill', 'Transfer', 'Other'];
const ACCT_TYPES = ['Checking', 'Savings', 'Cash', 'Other'];
const FILE = 'finance-data.json';

// ---------- schedules ----------
// s = { freq, anchor (ISO date), day2 }. Returns ISO dates in [from, to).
function occurrences(s, from, to) {
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
}

// ---------- state ----------
let DB = null;            // decrypted data
let ENC = null;           // { key, salt, iter } when password protected
let dirty = false;
let saving = false;
let saveErr = '';
let lastBackup = 0;
let saveTimer = null;
const store = { dir: null, dirName: '', pending: null };
const state = { view: 'home', pcId: null, step: 0 };

const newDB = () => ({
  version: 1, onboarded: false, created: new Date().toISOString(), updated: '',
  accounts: [], incomes: [], items: [], funds: [], log: []
});
function migrate(d) {
  d.version = d.version || 1;
  for (const k of ['accounts', 'incomes', 'items', 'funds', 'log']) d[k] = d[k] || [];
  d.onboarded = d.onboarded !== false;
  return d;
}

// ---------- domain ----------
const byId = (arr, id) => arr.find(x => x.id === id);
const entry = id => byId(DB.log, id);
const payAccts = () => DB.accounts.filter(a => a.kind === 'paycheck');
const destAccts = () => DB.accounts.filter(a => a.kind === 'destination');
const acctName = id => (byId(DB.accounts, id) || {}).name || '—';
const itemAmount = it => it.mode === 'fixed' ? (it.amount || 0) : (it.lastAmount ?? it.amount ?? 0);

function paychecks() {
  return DB.log.map((e, i) => [e, i]).filter(x => x[0].type === 'income')
    .sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map(x => x[0]);
}
function currentPc() { const p = paychecks(); return p.find(x => x.id === state.pcId) || p[0] || null; }
const defaultAcct = pc => (pc && pc.accountId) || (payAccts()[0] || {}).id || '';

function acctFigures(a) {
  const L = DB.log.filter(e => e.accountId === a.id);
  const inc = sum(L.filter(e => e.type === 'income' && !e.opening), e => e.amount);
  const adj = sum(L.filter(e => e.type === 'adjust'), e => e.amount);
  const al = L.filter(e => e.type === 'allocation'), sp = L.filter(e => e.type === 'spending');
  const fn = sum(L.filter(e => e.type === 'fund'), e => e.amount);
  const base = (a.start || 0) + inc + adj;
  return {
    bank: base - sum(al.filter(e => e.cleared), e => e.amount) - sum(sp.filter(e => e.cleared), e => e.amount),
    avail: base - sum(al, e => e.amount) - sum(sp, e => e.amount) - fn,
    held: fn
  };
}
const totalAvailable = () => sum(payAccts(), a => acctFigures(a).avail);

function pcStats(pc) {
  const es = DB.log.filter(e => e.paycheckId === pc.id);
  const alloc = es.filter(e => e.type === 'allocation'), sp = es.filter(e => e.type === 'spending'), fn = es.filter(e => e.type === 'fund');
  const a = sum(alloc, e => e.amount), s = sum(sp, e => e.amount), f = sum(fn, e => e.amount);
  return { landed: pc.amount, alloc: a, unpaid: sum(alloc.filter(e => !e.paid), e => e.amount), spent: s, funds: f, left: pc.amount - a - s - f };
}
const fundBalance = id => sum(DB.log.filter(e => e.type === 'fund' && e.fundId === id), e => e.amount);

function nextPay(afterISO) {
  let best = null;
  for (const i of DB.incomes) {
    if (i.type !== 'fixed' || i.active === false) continue;
    const o = occurrences(i, addDays(afterISO, 1), addDays(afterISO, 400))[0];
    if (o && (!best || o < best)) best = o;
  }
  return best;
}
const winStart = pc => (pc.expected && pc.expected < pc.date) ? pc.expected : pc.date;
const winEnd = pc => nextPay(winStart(pc)) || addDays(winStart(pc), 14);
const allocKeys = () => new Set(DB.log.filter(e => e.type === 'allocation' && e.key).map(e => e.key));

function suggestions(pc) {
  const start = winStart(pc), end = winEnd(pc), have = allocKeys(), out = [];
  for (const it of DB.items) {
    if (it.active === false) continue;
    for (const due of occurrences(it, start, end)) {
      const key = it.id + ':' + due;
      if (!have.has(key)) out.push({ it, due, key, amount: itemAmount(it) });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.it.name.localeCompare(b.it.name));
}

function nextPreview(pc) {
  const n1 = nextPay(winStart(pc));
  if (!n1) return null;
  const n2 = nextPay(n1), end = n2 || addDays(n1, 14), have = allocKeys();
  const incs = DB.incomes.filter(i => i.type === 'fixed' && i.active !== false && occurrences(i, n1, addDays(n1, 1)).length);
  const items = [];
  for (const it of DB.items) {
    if (it.active === false) continue;
    for (const due of occurrences(it, n1, end)) if (!have.has(it.id + ':' + due)) items.push({ it, due, amount: itemAmount(it) });
  }
  items.sort((a, b) => a.due.localeCompare(b.due));
  const income = sum(incs, i => i.amount || 0), total = sum(items, i => i.amount);
  return { date: n1, end, incs, income, items, total, free: income - total, overdue: n1 < today() };
}

function expectedList() {
  const out = [];
  for (const inc of DB.incomes) {
    if (inc.type !== 'fixed' || inc.active === false) continue;
    const landed = DB.log.filter(e => e.type === 'income' && e.incomeId === inc.id).map(e => e.expected || e.date).sort().pop();
    const from = landed ? addDays(landed, 1) : addDays(today(), -7);
    const o = occurrences(inc, from, addDays(from, 400))[0];
    if (o) out.push({ inc, date: o });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- mutations ----------
function commit() {
  dirty = true;
  saveErr = '';
  if (store.dir) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
  render();
}
function syncOpening() {
  const op = DB.log.find(e => e.type === 'income' && e.opening);
  if (op) op.amount = sum(payAccts(), a => a.start || 0);
}
function addAlloc(o) {
  const e = {
    id: uid(), type: 'allocation', paycheckId: o.pcId, date: o.due, amount: o.amount, name: o.name, category: o.category,
    itemId: o.itemId || null, key: o.key || null, accountId: o.accountId, destId: o.destId || null,
    paid: false, cleared: false, extra: !!o.extra, needsConfirm: !!o.needsConfirm
  };
  DB.log.push(e);
  return e;
}
function applySuggestions(pc, list) {
  for (const s of list) {
    addAlloc({
      pcId: pc.id, due: s.due, amount: s.amount, name: s.it.name, category: s.it.category, itemId: s.it.id, key: s.key,
      accountId: s.it.accountId || defaultAcct(pc), destId: s.it.destId, needsConfirm: s.it.mode === 'ask'
    });
  }
}

// ---------- crypto ----------
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const ITER = 600000;
async function deriveKey(pw, salt, iter) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function makeEnc(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveKey(pw, salt, ITER), salt, iter: ITER };
}
async function serialize() {
  DB.updated = new Date().toISOString();
  const json = JSON.stringify(DB);
  if (!ENC) return json;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, ENC.key, new TextEncoder().encode(json));
  return JSON.stringify({ format: 'finapp-enc', v: 1, kdf: 'PBKDF2-SHA256', iter: ENC.iter, salt: b64(ENC.salt), iv: b64(iv), data: b64(new Uint8Array(ct)) });
}
async function decryptWith(obj, pw) {
  const salt = unb64(obj.salt);
  const key = await deriveKey(pw, salt, obj.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, key, unb64(obj.data));
  return { db: JSON.parse(new TextDecoder().decode(pt)), enc: { key, salt, iter: obj.iter } };
}

// ---------- storage ----------
const fsa = typeof window.showDirectoryPicker === 'function';
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('finapp', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

async function readFolderFile(dir, name = FILE) {
  try { return await (await (await dir.getFileHandle(name)).getFile()).text(); }
  catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
}
async function writeFolderFile(dir, name, text) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text); await w.close();
}
async function maybeBackup() {
  if (Date.now() - lastBackup < 10 * 60 * 1000) return;
  const old = await readFolderFile(store.dir);
  if (!old) return;
  const bdir = await store.dir.getDirectoryHandle('backups', { create: true });
  await writeFolderFile(bdir, `finance-data-${stamp()}.json`, old);
  lastBackup = Date.now();
  const names = [];
  for await (const [n, h] of bdir.entries()) if (h.kind === 'file' && n.startsWith('finance-data-')) names.push(n);
  names.sort();
  for (const n of names.slice(0, Math.max(0, names.length - 50))) await bdir.removeEntry(n);
}
function download(name, data, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function saveNow() {
  if (!DB) return;
  const text = await serialize();
  if (store.dir) {
    saving = true; renderStatus();
    try { await maybeBackup(); await writeFolderFile(store.dir, FILE, text); dirty = false; saveErr = ''; }
    catch (e) { saveErr = 'Could not save to folder: ' + e.message; }
    saving = false; renderStatus();
  } else {
    download(`finance-data-${stamp()}.json`, text);
    dirty = false; renderStatus();
  }
}

async function loadText(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return alert('That file is not a valid data file.'); }
  if (obj && obj.format === 'finapp-enc') {
    const r = await modal({
      title: 'Unlock your data', submit: 'Unlock',
      body: '<p class="help">This file is password protected.</p><label class="field"><span>Password</span><input type="password" name="pw" autofocus></label>',
      onSubmit: async fd => {
        try { const r = await decryptWith(obj, fd.get('pw')); modal.result = r; return true; }
        catch { return 'Wrong password (or the file is damaged).'; }
      }
    });
    if (!r) return false;
    DB = migrate(modal.result.db); ENC = modal.result.enc;
  } else if (obj && Array.isArray(obj.log)) { DB = migrate(obj); ENC = null; }
  else { alert('That file is not a valid data file.'); return false; }
  dirty = false; state.view = DB.onboarded ? 'home' : 'onboard'; state.step = 0; state.pcId = null;
  render();
  return true;
}

async function connectFolder(handle) {
  try {
    const dir = handle || await window.showDirectoryPicker({ mode: 'readwrite' });
    const text = await readFolderFile(dir);
    if (DB && text && !confirm(`"${dir.name}" already contains ${FILE}. Load it and discard what you have set up so far?`)) return;
    store.dir = dir; store.dirName = dir.name; store.pending = null;
    try { await kvSet('dir', dir); } catch { /* handle persistence is optional */ }
    if (text) { if (!await loadText(text)) { store.dir = null; return; } }
    else if (!DB) { DB = newDB(); ENC = null; state.view = 'onboard'; state.step = 0; }
    if (DB) { dirty = true; await saveNow(); }
    render();
  } catch (e) { if (e.name !== 'AbortError') alert('Could not open folder: ' + e.message); }
}

// ---------- modal ----------
const dlg = $('#modal');
function closeModal(val) { const r = dlg._resolve; dlg._resolve = null; if (dlg.open) dlg.close(); if (r) r(val); }
dlg.addEventListener('close', () => { if (dlg._resolve) { const r = dlg._resolve; dlg._resolve = null; r(false); } });
function modal({ title, body, submit = 'Save', onSubmit, after }) {
  return new Promise(resolve => {
    dlg.innerHTML = `<form><h2>${esc(title)}</h2>${body}<div class="error" id="merr"></div><div class="actions"><button type="button" data-act="mclose">Cancel</button>${submit ? `<button class="primary" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
    dlg._resolve = resolve;
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const err = await onSubmit(new FormData(form), form);
      if (err === undefined || err === true) closeModal(true); else $('#merr').textContent = err;
    });
    const upd = () => form.querySelectorAll('[data-showif]').forEach(el => {
      const [n, v] = el.dataset.showif.split('=');
      el.hidden = !v.split('|').includes(form.elements[n].value);
    });
    form.addEventListener('change', upd); upd();
    if (after) after(form);
    if (!dlg.open) dlg.showModal();
  });
}
const fld = (label, name, val = '', attrs = '', extra = '') => `<label class="field" ${extra}><span>${label}</span><input name="${name}" value="${esc(val)}" ${attrs}></label>`;
const money$ = (label, name, cents = 0, extra = '') => fld(label, name, cents ? centsIn(cents) : '', 'inputmode="decimal" placeholder="0.00"', extra);
const dateF = (label, name, val, extra = '') => fld(label, name, val, 'type="date" required', extra);
const sel = (label, name, opts, val, extra = '') => `<label class="field" ${extra}><span>${label}</span><select name="${name}">${opts.map(o => { const [v, t] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${v == val ? ' selected' : ''}>${esc(t)}</option>`; }).join('')}</select></label>`;
const chk = (label, name, on, extra = '') => `<label class="check" ${extra}><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
const acctOpts = () => payAccts().map(a => [a.id, a.name]);
const pcOpts = () => paychecks().map(p => [p.id, `${fmtDate(p.date)} — ${p.source}`]);

// ---------- entity forms ----------
function accountForm(id) {
  const a = id ? byId(DB.accounts, id) : { kind: 'paycheck', type: 'Checking', name: '', start: 0 };
  return modal({
    title: id ? 'Edit account' : 'Add account',
    body: `<p class="help">A <b>paycheck account</b> is where your pay lands and bills come out; it is tracked with a balance. A <b>destination account</b> (like a savings or brokerage account) is untracked: money sent there is just a payment.</p>`
      + fld('Name', 'name', a.name, 'required')
      + sel('Kind', 'kind', [['paycheck', 'Paycheck account (tracked)'], ['destination', 'Destination account (untracked)']], a.kind)
      + sel('Type', 'type', ACCT_TYPES, a.type)
      + money$('Starting balance — money in this account right now', 'start', a.start, 'data-showif="kind=paycheck"')
      + chk('Active', 'active', a.active !== false),
    onSubmit: fd => {
      const o = id ? a : { id: uid() };
      Object.assign(o, { name: fd.get('name').trim(), kind: fd.get('kind'), type: fd.get('type'), active: fd.get('active') === 'on', start: fd.get('kind') === 'paycheck' ? parseMoney(fd.get('start')) : 0 });
      if (!o.name) return 'Name is required.';
      if (!id) DB.accounts.push(o);
      syncOpening(); commit();
    }
  });
}
function incomeForm(id) {
  const i = id ? byId(DB.incomes, id) : { type: 'fixed', freq: 'biweekly', anchor: today(), amount: 0, name: '', accountId: defaultAcct() };
  return modal({
    title: id ? 'Edit income source' : 'Add income source',
    body: fld('Name (e.g. Main job)', 'name', i.name, 'required')
      + sel('Type', 'type', [['fixed', 'Fixed — paid on a schedule'], ['variable', 'Variable — I enter it when it lands']], i.type)
      + sel('How often', 'freq', FREQS.filter(f => f[0] !== 'once'), i.freq, 'data-showif="type=fixed"')
      + fld('Next pay date', 'anchor', i.anchor, 'type="date"', 'data-showif="type=fixed"')
      + fld('Second pay day of month (1–31)', 'day2', i.day2 || '', 'inputmode="numeric"', 'data-showif="freq=semimonthly"')
      + money$('Amount per paycheck', 'amount', i.amount, 'data-showif="type=fixed"')
      + sel('Deposits into', 'accountId', acctOpts(), i.accountId)
      + chk('Active', 'active', i.active !== false),
    onSubmit: fd => {
      const o = id ? i : { id: uid() };
      Object.assign(o, { name: fd.get('name').trim(), type: fd.get('type'), freq: fd.get('freq'), anchor: fd.get('anchor') || today(), day2: fd.get('day2') ? +fd.get('day2') : null, amount: parseMoney(fd.get('amount')), accountId: fd.get('accountId'), active: fd.get('active') === 'on' });
      if (!o.name) return 'Name is required.';
      if (o.type === 'fixed' && !o.amount) return 'Enter the paycheck amount.';
      if (!id) DB.incomes.push(o);
      commit();
    }
  });
}
function itemForm(id) {
  const it = id ? byId(DB.items, id) : { category: 'Subscription', mode: 'fixed', freq: 'monthly', anchor: today(), amount: 0, name: '', accountId: defaultAcct() };
  return modal({
    title: id ? 'Edit recurring item' : 'Add recurring item',
    body: fld('Name', 'name', it.name, 'required')
      + sel('Category', 'category', CATS, it.category)
      + sel('Amount', 'mode', [['fixed', 'Fixed — same every time'], ['ask', 'Varies — I confirm each time']], it.mode)
      + money$('Typical amount', 'amount', it.mode === 'ask' ? (it.lastAmount ?? it.amount) : it.amount)
      + sel('How often', 'freq', FREQS, it.freq)
      + fld('Next due date', 'anchor', it.anchor, 'type="date"')
      + fld('Second due day of month (1–31)', 'day2', it.day2 || '', 'inputmode="numeric"', 'data-showif="freq=semimonthly"')
      + sel('Paid from', 'accountId', acctOpts(), it.accountId)
      + sel('Destination account', 'destId', [['', '— none —'], ...destAccts().map(a => [a.id, a.name])], it.destId || '', 'data-showif="category=Transfer"')
      + chk('Active', 'active', it.active !== false),
    onSubmit: fd => {
      const o = id ? it : { id: uid() };
      Object.assign(o, { name: fd.get('name').trim(), category: fd.get('category'), mode: fd.get('mode'), amount: parseMoney(fd.get('amount')), freq: fd.get('freq'), anchor: fd.get('anchor') || today(), day2: fd.get('day2') ? +fd.get('day2') : null, accountId: fd.get('accountId'), destId: fd.get('category') === 'Transfer' ? fd.get('destId') || null : null, active: fd.get('active') === 'on' });
      if (o.mode === 'ask') o.lastAmount = o.amount;
      if (!o.name) return 'Name is required.';
      if (!id) DB.items.push(o);
      commit();
    }
  });
}
function fundForm(id) {
  const f = id ? byId(DB.funds, id) : { name: '', purpose: '' };
  return modal({
    title: id ? 'Edit sinking fund' : 'Add sinking fund',
    body: fld('Name (e.g. New car)', 'name', f.name, 'required') + fld('What is it for?', 'purpose', f.purpose),
    onSubmit: fd => {
      const o = id ? f : { id: uid() };
      Object.assign(o, { name: fd.get('name').trim(), purpose: fd.get('purpose').trim() });
      if (!o.name) return 'Name is required.';
      if (!id) DB.funds.push(o);
      commit();
    }
  });
}

// ---------- paycheck / allocation / spending / fund modals ----------
function landForm(pre = {}) {
  const fixed = DB.incomes.filter(i => i.active !== false);
  const opts = [...fixed.map(i => [i.id, i.name]), ['', 'Other income']];
  const first = pre.incomeId !== undefined ? pre.incomeId : (fixed[0] ? fixed[0].id : '');
  const amt = (byId(DB.incomes, first) || {}).amount || 0;
  return modal({
    title: 'Income landed',
    body: '<p class="help">Only money that has actually arrived counts toward Available.</p>'
      + sel('Source', 'incomeId', opts, first)
      + (pre.expected ? `<p class="help">Expected ${fmtDate(pre.expected)}.</p>` : '')
      + dateF('Date it landed', 'date', pre.date || today())
      + money$('Amount', 'amount', pre.amount ?? amt)
      + sel('Deposited into', 'accountId', acctOpts(), (byId(DB.incomes, first) || {}).accountId || defaultAcct())
      + fld('Note (optional)', 'note', '')
      + chk('Suggest allocations for this paycheck next', 'sugg', true),
    after: form => form.elements.incomeId.addEventListener('change', () => {
      const i = byId(DB.incomes, form.elements.incomeId.value);
      if (i) { form.elements.amount.value = i.amount ? centsIn(i.amount) : ''; form.elements.accountId.value = i.accountId; }
    }),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount'));
      if (amount <= 0) return 'Enter the amount that landed.';
      const inc = byId(DB.incomes, fd.get('incomeId'));
      const e = { id: uid(), type: 'income', date: fd.get('date'), expected: pre.expected || null, amount, source: inc ? inc.name : 'Other income', incomeId: inc ? inc.id : null, accountId: fd.get('accountId'), note: fd.get('note').trim() };
      e.paycheckId = e.id;
      DB.log.push(e); state.pcId = e.id; state.view = 'home';
      commit();
      if (fd.get('sugg') === 'on') setTimeout(() => suggestModal(e.id), 0);
    }
  });
}
function suggestModal(pcId) {
  const pc = entry(pcId), list = suggestions(pc);
  if (!list.length) return modal({ title: 'Suggested allocations', body: `<p>Nothing else is due between ${fmtDate(winStart(pc))} and ${fmtDate(winEnd(pc))}. You can still add items manually.</p>`, submit: null, onSubmit() { } });
  return modal({
    title: `Allocate ${money(pc.amount)} — ${fmtDate(pc.date)}`,
    body: `<p class="help">Items due from ${fmtDate(winStart(pc))} up to the next expected pay date (${fmtDate(winEnd(pc))}). Uncheck anything that belongs to a different paycheck.</p>
      <table class="sugg"><tbody>${list.map((s, n) => `<tr><td class="chk"><input type="checkbox" name="c${n}" checked></td><td>${esc(s.it.name)}${s.it.mode === 'ask' ? '<span class="chip">varies</span>' : ''}<div class="muted small">${esc(s.it.category)}</div></td><td class="small">${fmtDate(s.due)}</td><td><input type="text" inputmode="decimal" name="a${n}" value="${centsIn(s.amount)}" style="width:100px"></td></tr>`).join('')}</tbody></table>`,
    submit: 'Create allocations',
    onSubmit: fd => {
      const chosen = [];
      list.forEach((s, n) => { if (fd.get('c' + n) === 'on') chosen.push({ ...s, amount: parseMoney(fd.get('a' + n)) }); });
      applySuggestions(pc, chosen); commit();
    }
  });
}
function allocForm(id, pcId) {
  const a = id ? entry(id) : null;
  const pc = a ? entry(a.paycheckId) : entry(pcId);
  const itemOpts = [['', '— custom —'], ...DB.items.filter(i => i.active !== false).map(i => [i.id, i.name])];
  const v = a || { name: '', category: 'Bill', amount: 0, date: today(), accountId: defaultAcct(pc), paid: false, cleared: false };
  return modal({
    title: a ? 'Edit allocation' : 'Add allocation',
    body: (a ? '' : sel('Recurring item', 'itemId', itemOpts, '') + chk('This is an extra / overpayment on a debt', 'extra', false))
      + fld('Name', 'name', v.name, 'required') + sel('Category', 'category', CATS, v.category)
      + money$('Amount', 'amount', v.amount) + dateF('Due date', 'date', v.date)
      + sel('Paid from', 'accountId', acctOpts(), v.accountId) + sel('Paycheck', 'pcId', pcOpts(), pc.id)
      + chk('Paid', 'paid', v.paid) + chk('Cleared (shows in bank)', 'cleared', v.cleared),
    after: form => {
      if (a) return;
      form.elements.itemId.addEventListener('change', () => {
        const it = byId(DB.items, form.elements.itemId.value); if (!it) return;
        form.elements.name.value = it.name; form.elements.category.value = it.category;
        form.elements.amount.value = centsIn(itemAmount(it)); form.elements.accountId.value = it.accountId || v.accountId;
        const nx = occurrences(it, today(), addDays(today(), 400))[0]; if (nx) form.elements.date.value = nx;
      });
    },
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount'));
      if (amount <= 0) return 'Enter an amount.';
      const paid = fd.get('paid') === 'on', cleared = fd.get('cleared') === 'on';
      const upd = { name: fd.get('name').trim(), category: fd.get('category'), amount, date: fd.get('date'), accountId: fd.get('accountId'), paycheckId: fd.get('pcId'), paid: paid || cleared, cleared, needsConfirm: false };
      if (a) {
        Object.assign(a, upd);
        const it = byId(DB.items, a.itemId); if (it && it.mode === 'ask' && !a.extra) it.lastAmount = amount;
      } else {
        const it = byId(DB.items, fd.get('itemId'));
        const extra = fd.get('extra') === 'on';
        const e = addAlloc({ pcId: upd.paycheckId, due: upd.date, amount, name: extra && !/^extra/i.test(upd.name) ? 'Extra: ' + upd.name : upd.name, category: extra ? 'Debt payment' : upd.category, itemId: it ? it.id : null, key: null, accountId: upd.accountId, destId: it ? it.destId : null, extra });
        e.paid = upd.paid; e.cleared = upd.cleared;
        if (it && it.mode === 'ask' && !extra) it.lastAmount = amount;
      }
      commit();
    }
  });
}
function spendForm(id) {
  const s = entry(id);
  return modal({
    title: 'Edit spending',
    body: dateF('Date', 'date', s.date) + money$('Amount', 'amount', s.amount) + fld('Category', 'category', s.category, 'list="cats"') + fld('Note', 'note', s.note)
      + sel('Account', 'accountId', acctOpts(), s.accountId) + sel('Paycheck', 'pcId', pcOpts(), s.paycheckId) + chk('Cleared', 'cleared', s.cleared),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      Object.assign(s, { date: fd.get('date'), amount, category: fd.get('category').trim(), note: fd.get('note').trim(), accountId: fd.get('accountId'), paycheckId: fd.get('pcId'), cleared: fd.get('cleared') === 'on' });
      commit();
    }
  });
}
function fundMoveForm(fundId, dir) {
  if (!DB.funds.length) return alert('Add a sinking fund first (Funds page).');
  const pc = currentPc();
  return modal({
    title: 'Move money to / from a sinking fund',
    body: sel('Fund', 'fundId', DB.funds.map(f => [f.id, `${f.name} (${money(fundBalance(f.id))})`]), fundId || DB.funds[0].id)
      + sel('Direction', 'dir', [['in', 'Put into fund (reduces Available)'], ['out', 'Pull back out of fund (adds to Available)']], dir || 'in')
      + money$('Amount', 'amount', 0) + dateF('Date', 'date', today())
      + sel('Account', 'accountId', acctOpts(), defaultAcct(pc)) + sel('Paycheck', 'pcId', pcOpts(), pc.id) + fld('Note', 'note', ''),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      const out = fd.get('dir') === 'out';
      if (out && amount > fundBalance(fd.get('fundId'))) return 'That is more than the fund holds.';
      DB.log.push({ id: uid(), type: 'fund', fundId: fd.get('fundId'), paycheckId: fd.get('pcId'), accountId: fd.get('accountId'), date: fd.get('date'), amount: out ? -amount : amount, note: fd.get('note').trim() });
      commit();
    }
  });
}
function adjustForm(acctId) {
  const a = byId(DB.accounts, acctId), f = acctFigures(a);
  return modal({
    title: `Reconcile — ${a.name}`,
    body: `<p class="help">Bank balance according to this app: <b>${money(f.bank)}</b>. Enter what your bank actually shows and the app records the difference as an adjustment.</p>` + money$('Actual bank balance', 'actual', f.bank) + fld('Note', 'note', 'Reconciliation'),
    onSubmit: fd => {
      const diff = parseMoney(fd.get('actual')) - f.bank;
      if (diff === 0) return 'Already matches.';
      DB.log.push({ id: uid(), type: 'adjust', accountId: a.id, date: today(), amount: diff, note: fd.get('note').trim() });
      commit();
    }
  });
}
function passwordForm(title, existing) {
  return modal({
    title, submit: 'Set password',
    body: '<p class="help">The data file will be encrypted with AES-256. <b>There is no recovery</b>: if you forget this password, the data cannot be opened.</p>'
      + '<label class="field"><span>New password (8+ characters)</span><input type="password" name="pw"></label><label class="field"><span>Repeat password</span><input type="password" name="pw2"></label>',
    onSubmit: async fd => {
      if (fd.get('pw').length < 8) return 'Use at least 8 characters.';
      if (fd.get('pw') !== fd.get('pw2')) return 'Passwords do not match.';
      ENC = await makeEnc(fd.get('pw')); commit();
    }
  });
}

// ---------- views ----------
function statusHtml() {
  if (!DB) return '';
  if (saveErr) return `<span class="pill warn">${esc(saveErr)}</span>`;
  if (saving) return '<span class="pill">Saving…</span>';
  if (store.dir) return `<span class="pill ${dirty ? 'warn' : 'ok'}">${dirty ? 'Unsaved' : 'Saved'} · ${esc(store.dirName)}${ENC ? ' · encrypted' : ''}</span>`;
  return `<span class="pill ${dirty ? 'warn' : ''}">${dirty ? 'Unsaved changes' : 'No changes'}${ENC ? ' · encrypted' : ''}</span> <button data-act="save" class="${dirty ? 'primary' : ''}">Save file</button>`;
}
function renderStatus() { const el = $('#status'); if (el) el.innerHTML = statusHtml(); }

function topbar() {
  const nav = [['home', 'This paycheck'], ['paychecks', 'Paychecks'], ['funds', 'Sinking funds'], ['setup', 'Setup'], ['settings', 'Settings']];
  return `<div class="topbar"><span class="brand">Paycheck Planner</span><div class="nav">${nav.map(([k, t]) => `<button data-act="nav" data-v="${k}" class="${state.view === k ? 'on' : ''}">${t}</button>`).join('')}</div><span id="status">${statusHtml()}</span></div>`;
}

function viewStart() {
  return `<div class="start card"><h2>Paycheck Planner</h2>
    <p class="muted">A paycheck-by-paycheck planner. Your data stays on this computer in a file you control.</p>
    ${store.pending ? `<button class="opt primary" data-act="reconnect">Reconnect to “${esc(store.pending.name)}”<small>Continue where you left off</small></button>` : ''}
    ${fsa ? `<button class="opt" data-act="connect">Choose app folder<small>Chrome / Edge: autosaves ${FILE} (and backups) into the folder you pick</small></button>` : ''}
    <button class="opt" data-act="openfile">Open a data file…<small>${fsa ? 'Or pick' : 'Pick'} ${FILE} (or a backup)${fsa ? '' : ' — this browser cannot autosave, so use Save file to download updates'}</small></button>
    <button class="opt" data-act="newdb">Start new<small>Set up accounts, income and bills</small></button>
    <input type="file" id="filein" accept=".json,application/json" hidden></div>`;
}

// Sections shared by Setup and the onboarding wizard
function secAccounts() {
  const rows = DB.accounts.map(a => `<tr><td>${esc(a.name)}<div class="muted small">${esc(a.type)}${a.active === false ? ' · inactive' : ''}</div></td><td>${a.kind === 'paycheck' ? 'Paycheck account' : 'Destination (untracked)'}</td><td class="num">${a.kind === 'paycheck' ? money(a.start || 0) : ''}</td><td class="num"><button class="link" data-act="edit-acct" data-id="${a.id}">Edit</button><button class="link danger" data-act="del-acct" data-id="${a.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Accounts</h2><button class="primary" data-act="add-acct">+ Add account</button></div>
    <p class="help">Add the account(s) your pay lands in with today’s balance. Add savings or brokerage accounts as destinations if you send money there.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Kind</th><th class="num">Starting balance</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No accounts yet.</td></tr>'}</tbody></table></div></div>`;
}
function secIncomes() {
  const rows = DB.incomes.map(i => `<tr><td>${esc(i.name)}${i.active === false ? ' <span class="chip">inactive</span>' : ''}</td><td>${i.type === 'fixed' ? FREQS.find(f => f[0] === i.freq)[1] + ' · next ' + fmtDate(i.anchor) : 'Variable'}</td><td>${esc(acctName(i.accountId))}</td><td class="num">${i.type === 'fixed' ? money(i.amount) : '—'}</td><td class="num"><button class="link" data-act="edit-inc" data-id="${i.id}">Edit</button><button class="link danger" data-act="del-inc" data-id="${i.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Income sources</h2><button class="primary" data-act="add-inc">+ Add income</button></div>
    <p class="help">Fixed income pre-fills when it lands and drives the “next paycheck” preview. Variable income is entered when it arrives. Nothing counts until you confirm it landed.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Schedule</th><th>Deposits into</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No income sources yet.</td></tr>'}</tbody></table></div></div>`;
}
function secItems() {
  const rows = [...DB.items].sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.name.localeCompare(b.name)).map(i => `<tr><td>${esc(i.name)}${i.active === false ? ' <span class="chip">inactive</span>' : ''}<div class="muted small">${esc(i.category)}${i.destId ? ' → ' + esc(acctName(i.destId)) : ''}</div></td><td>${FREQS.find(f => f[0] === i.freq)[1]} · next ${fmtDate(i.anchor)}</td><td class="num">${money(itemAmount(i))}${i.mode === 'ask' ? '<span class="chip">varies</span>' : ''}</td><td class="num"><button class="link" data-act="edit-item" data-id="${i.id}">Edit</button><button class="link danger" data-act="del-item" data-id="${i.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Recurring items</h2><button class="primary" data-act="add-item">+ Add item</button></div>
    <p class="help">Subscriptions, bills, minimum debt payments, and scheduled transfers to savings. Each is assigned to a paycheck by its due date.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Schedule</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No recurring items yet.</td></tr>'}</tbody></table></div></div>`;
}
function secFunds() {
  const rows = DB.funds.map(f => `<tr><td>${esc(f.name)}<div class="muted small">${esc(f.purpose)}</div></td><td class="num">${money(fundBalance(f.id))}</td><td class="num"><button class="link" data-act="edit-fund" data-id="${f.id}">Edit</button><button class="link danger" data-act="del-fund" data-id="${f.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Sinking funds</h2><button class="primary" data-act="add-fund">+ Add fund</button></div>
    <p class="help">Named buckets you add money to whenever you choose (new car, house, …). You can pull money back at any time.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">No funds yet.</td></tr>'}</tbody></table></div></div>`;
}

function viewOnboard() {
  const steps = ['Welcome', 'Accounts', 'Income', 'Bills & debts', 'Sinking funds', 'Finish'];
  const s = state.step;
  const prog = `<div class="steps">${steps.map((t, i) => `<span class="${i === s ? 'on' : i < s ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
  let body = '';
  if (s === 0) {
    body = `<div class="card"><h2>Welcome</h2>
      <p>This app is a <b>paycheck planner</b>, not a forecast. You tell it when money actually lands, and it shows what each paycheck has to pay out and what is left to work with.</p>
      <p class="help">Setup takes a few minutes: your accounts and balances, your income, your recurring bills and debts, and any sinking funds.</p>
      <h3>Protect your data (optional)</h3>
      <p class="help">A password encrypts the data file. If you skip it, the file is plain text. You can change this any time in Settings. There is no password recovery.</p>
      ${ENC ? '<p class="pos">Password set ✓</p>' : '<label class="field"><span>Password (8+ characters, optional)</span><input type="password" id="ob-pw"></label><label class="field"><span>Repeat password</span><input type="password" id="ob-pw2"></label>'}
      <h3>Where to save</h3>
      ${store.dir ? `<p class="pos">Autosaving to folder “${esc(store.dirName)}” ✓</p>` : fsa ? '<p class="help">Pick the folder these app files live in and your data autosaves there with automatic backups.</p><button data-act="connect">Choose app folder</button>' : '<p class="help">This browser cannot autosave to a folder, so you will use <b>Save file</b> to download your data and <b>Open a data file</b> to load it next time.</p>'}
      <div class="error" id="ob-err"></div></div>`;
  } else if (s === 1) body = secAccounts();
  else if (s === 2) body = secIncomes();
  else if (s === 3) body = secItems();
  else if (s === 4) body = secFunds();
  else {
    const total = sum(payAccts(), a => a.start || 0);
    body = `<div class="card"><h2>All set</h2>
      <div class="kv"><span>Paycheck accounts</span><b>${payAccts().length}</b></div><div class="kv"><span>Starting balance (available to allocate)</span><b>${money(total)}</b></div>
      <div class="kv"><span>Income sources</span><b>${DB.incomes.length}</b></div><div class="kv"><span>Recurring items</span><b>${DB.items.length}</b></div><div class="kv"><span>Sinking funds</span><b>${DB.funds.length}</b></div>
      ${fld('Starting balances are as of', 'asof', today(), 'type="date" id="ob-asof"')}
      <p class="help">Next you will see which recurring items are due before your next paycheck so you can allocate them from your starting balance.</p></div>`;
  }
  const nav = `<div class="actions" style="margin-top:14px">${s > 0 ? '<button data-act="ob-back">Back</button>' : ''}<button class="primary" data-act="ob-next">${s === 5 ? 'Finish setup' : (s === 0 || s === 1) ? 'Next' : 'Next / skip'}</button></div>`;
  return `<div class="topbar"><span class="brand">Paycheck Planner — Setup</span><span id="status">${statusHtml()}</span></div>${prog}${body}${nav}`;
}

function viewHome() {
  const pc = currentPc(); if (!pc) return '<div class="card">Nothing logged yet.</div>';
  const st = pcStats(pc), avail = totalAvailable(), latest = paychecks()[0].id === pc.id;
  const sugg = latest ? suggestions(pc) : [];
  const allocs = DB.log.filter(e => e.type === 'allocation' && e.paycheckId === pc.id);
  const spends = DB.log.filter(e => e.type === 'spending' && e.paycheckId === pc.id).sort((a, b) => b.date.localeCompare(a.date));
  const funds = DB.log.filter(e => e.type === 'fund' && e.paycheckId === pc.id);
  const groups = CATS.map(c => {
    const rows = allocs.filter(a => a.category === c).sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) return '';
    return `<tr class="group"><td colspan="4">${c}</td><td class="num">${money(sum(rows, r => r.amount))}</td><td></td></tr>` + rows.map(a => `<tr class="${a.paid ? 'done' : ''}">
      <td class="chk"><input type="checkbox" data-chg="tog" data-id="${a.id}" data-f="paid"${a.paid ? ' checked' : ''}></td>
      <td class="chk"><input type="checkbox" data-chg="tog" data-id="${a.id}" data-f="cleared"${a.cleared ? ' checked' : ''}></td>
      <td class="name">${esc(a.name)}${a.needsConfirm ? '<span class="chip">confirm amount</span>' : ''}${a.destId ? `<div class="muted small">→ ${esc(acctName(a.destId))}</div>` : ''}</td>
      <td class="small">${fmtDate(a.date)}</td><td class="num">${money(a.amount)}</td>
      <td class="num"><button class="link" data-act="edit-alloc" data-id="${a.id}">Edit</button><button class="link danger" data-act="del-entry" data-id="${a.id}">✕</button></td></tr>`).join('');
  }).join('');
  const cats = [...new Set(DB.log.filter(e => e.type === 'spending').map(e => e.category).filter(Boolean))];
  const pv = latest ? nextPreview(pc) : null;
  const accts = payAccts().map(a => { const f = acctFigures(a); return `<div class="acct"><div class="nm">${esc(a.name)}</div><div class="kv"><span class="muted small">Available</span><b class="${f.avail < 0 ? 'neg' : ''}">${money(f.avail)}</b></div><div class="kv"><span class="muted small">Bank (cleared)</span><span>${money(f.bank)}</span></div>${f.held ? `<div class="kv"><span class="muted small">Held in funds</span><span>${money(f.held)}</span></div>` : ''}</div>`; }).join('');

  return `
  <div class="card hero"><div class="label">Available to spend</div><div class="big ${avail < 0 ? 'neg' : ''}">${money(avail)}</div>
    <div class="sub">Everything that has landed, minus everything allocated or spent. Unpaid allocations are already deducted.</div></div>
  <div class="accts">${accts}</div>
  <div class="card"><div class="head"><div><h2>${fmtDate(pc.date)} — ${esc(pc.source)}</h2><span class="muted small">${pc.opening ? 'Starting balances' : 'Deposited into ' + esc(acctName(pc.accountId))}</span></div>
    <label class="field" style="margin:0;min-width:220px"><span>Paycheck</span><select data-chg="pick-pc">${pcOpts().map(([v, t]) => `<option value="${v}"${v === pc.id ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <div class="stats"><div class="stat"><div class="k">Landed</div><div class="v">${money(st.landed)}</div></div><div class="stat"><div class="k">Allocated</div><div class="v">${money(st.alloc)}</div></div>
    <div class="stat"><div class="k">Still unpaid</div><div class="v">${money(st.unpaid)}</div></div><div class="stat"><div class="k">Spent</div><div class="v">${money(st.spent)}</div></div>
    <div class="stat"><div class="k">To funds</div><div class="v">${money(st.funds)}</div></div><div class="stat"><div class="k">Left from this paycheck</div><div class="v ${st.left < 0 ? 'neg' : 'pos'}">${money(st.left)}</div></div></div></div>
  ${sugg.length ? `<div class="banner"><span>${sugg.length} recurring item${sugg.length > 1 ? 's' : ''} due before your next paycheck ${sugg.length > 1 ? 'are' : 'is'} not allocated yet.</span><button class="primary" data-act="suggest" data-id="${pc.id}">Review &amp; allocate</button></div>` : ''}
  <div class="card"><div class="head"><h2>What this paycheck pays out</h2><button data-act="add-alloc" data-id="${pc.id}">+ Add allocation / extra payment</button></div>
    <div class="tbl-wrap"><table><thead><tr><th class="chk">Paid</th><th class="chk">Cleared</th><th>Item</th><th>Due</th><th class="num">Amount</th><th></th></tr></thead><tbody>${groups || '<tr><td colspan="6" class="muted">No allocations yet.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="head"><h2>Spending log</h2><span class="muted small">Total ${money(st.spent)}</span></div>
    <div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th><th class="chk">Cleared</th><th></th></tr></thead><tbody>${spends.map(s => `<tr><td class="small">${fmtDate(s.date)}</td><td>${esc(s.category)}</td><td>${esc(s.note)}</td><td class="num">${money(s.amount)}</td><td class="chk"><input type="checkbox" data-chg="tog" data-id="${s.id}" data-f="cleared"${s.cleared ? ' checked' : ''}></td><td class="num"><button class="link" data-act="edit-spend" data-id="${s.id}">Edit</button><button class="link danger" data-act="del-entry" data-id="${s.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing spent yet.</td></tr>'}</tbody></table></div>
    <form class="inline-form" data-form="spend" data-pc="${pc.id}"><input type="date" name="date" value="${today()}" required><input name="amount" inputmode="decimal" placeholder="Amount" required><input name="category" list="cats" placeholder="Category"><input name="note" placeholder="Note"><button class="primary" type="submit">Add</button></form>
    <datalist id="cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
  <div class="card"><div class="head"><h2>Sinking fund moves</h2><button data-act="fund-move">+ Move money to / from a fund</button></div>
    ${funds.length ? `<table><tbody>${funds.map(f => `<tr><td class="small">${fmtDate(f.date)}</td><td>${esc((byId(DB.funds, f.fundId) || {}).name || '—')}<div class="muted small">${esc(f.note)}</div></td><td class="num ${f.amount < 0 ? 'pos' : ''}">${f.amount < 0 ? 'out ' : 'in '}${money(Math.abs(f.amount))}</td><td class="num"><button class="link danger" data-act="del-entry" data-id="${f.id}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No fund moves on this paycheck.</p>'}</div>
  ${pv ? `<div class="card preview"><div class="head"><h2>Next paycheck <span class="chip proj">projected — not counted in Available</span></h2></div>
    <p class="help">${pv.overdue ? 'Expected ' + fmtDate(pv.date) + ' and has not been logged yet.' : 'Expected ' + fmtDate(pv.date) + '.'} Covers items due ${fmtDate(pv.date)} – ${fmtDate(addDays(pv.end, -1))}.</p>
    <div class="kv"><span>Projected income (${pv.incs.map(i => esc(i.name)).join(', ') || 'none'})</span><span>${money(pv.income)}</span></div>
    ${pv.items.map(i => `<div class="kv small"><span>${esc(i.it.name)} <span class="muted">${fmtDate(i.due)}</span></span><span>−${money(i.amount)}</span></div>`).join('')}
    <div class="kv total"><span>Projected free money</span><span class="${pv.free < 0 ? 'neg' : 'pos'}">${money(pv.free)}</span></div>
    <div class="kv small muted"><span>If you spend nothing more, today’s Available carries over</span><span>${money(avail)}</span></div></div>` : ''}`;
}

function viewPaychecks() {
  const exp = expectedList();
  const rows = paychecks().map(p => { const s = pcStats(p); return `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.source)}${p.note ? `<div class="muted small">${esc(p.note)}</div>` : ''}</td><td>${p.opening ? '' : esc(acctName(p.accountId))}</td><td class="num">${money(s.landed)}</td><td class="num">${money(s.alloc)}</td><td class="num">${money(s.spent)}</td><td class="num">${money(s.funds)}</td><td class="num ${s.left < 0 ? 'neg' : ''}">${money(s.left)}</td><td class="num"><button class="link" data-act="open-pc" data-id="${p.id}">Open</button>${p.opening ? '' : `<button class="link danger" data-act="del-pc" data-id="${p.id}">✕</button>`}</td></tr>`; }).join('');
  return `<div class="card"><div class="head"><h2>Expected income <span class="chip proj">projected — not counted</span></h2><button class="primary" data-act="land">+ Income landed</button></div>
    <table><tbody>${exp.map(e => `<tr><td>${fmtDate(e.date)}${e.date < today() ? '<span class="chip">overdue</span>' : ''}</td><td>${esc(e.inc.name)}</td><td class="num">${money(e.inc.amount)}</td><td class="num"><button class="link" data-act="land" data-inc="${e.inc.id}" data-exp="${e.date}">It landed</button></td></tr>`).join('') || '<tr><td class="muted">No fixed income sources set up. Variable income: use “+ Income landed”.</td></tr>'}</tbody></table></div>
  <div class="card"><div class="head"><h2>Paycheck history</h2></div><div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Source</th><th>Account</th><th class="num">Landed</th><th class="num">Allocated</th><th class="num">Spent</th><th class="num">Funds</th><th class="num">Left</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function viewFunds() {
  const cards = DB.funds.map(f => {
    const es = DB.log.filter(e => e.type === 'fund' && e.fundId === f.id).sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card"><div class="head"><div><h3>${esc(f.name)}</h3><span class="muted small">${esc(f.purpose)}</span></div><div class="big" style="font-size:24px;font-weight:700">${money(fundBalance(f.id))}</div></div>
      <button data-act="fund-move" data-id="${f.id}" data-dir="in">Put in</button> <button data-act="fund-move" data-id="${f.id}" data-dir="out">Pull back</button> <button class="link" data-act="edit-fund" data-id="${f.id}">Edit</button> <button class="link danger" data-act="del-fund" data-id="${f.id}">Delete</button>
      <details><summary>Ledger (${es.length})</summary><table><tbody>${es.map(e => `<tr><td class="small">${fmtDate(e.date)}</td><td>${esc(e.note)}</td><td class="num ${e.amount < 0 ? 'neg' : 'pos'}">${e.amount < 0 ? '−' : '+'}${money(Math.abs(e.amount))}</td></tr>`).join('') || '<tr><td class="muted">No activity.</td></tr>'}</tbody></table></details></div>`;
  }).join('');
  return `<div class="card"><div class="head"><h2>Sinking funds</h2><div><span class="muted small">Total held ${money(sum(DB.funds, f => fundBalance(f.id)))}</span> <button class="primary" data-act="add-fund">+ Add fund</button></div></div>
    <p class="help">Putting money in reduces Available; pulling it back adds to Available. Funds have no schedule — move money whenever you choose.</p></div>
    <div class="funds">${cards || '<div class="card muted">No funds yet.</div>'}</div>`;
}

function viewSetup() {
  const accts = payAccts().map(a => `<button class="link" data-act="reconcile" data-id="${a.id}">Reconcile ${esc(a.name)}</button>`).join(' ');
  return secAccounts() + (accts ? `<p class="muted small" style="margin-top:6px">${accts}</p>` : '') + secIncomes() + secItems();
}

function viewSettings() {
  return `<div class="card"><h2>Storage</h2>
    <p>${store.dir ? `Autosaving to folder <b>${esc(store.dirName)}</b> (<code>${FILE}</code>). Timestamped backups go in <code>backups/</code> (at most one every 10 minutes, newest 50 kept).` : `Not connected to a folder. <b>Save file</b> downloads a timestamped copy of your data; use that file with “Open a data file” next time.`}</p>
    ${fsa && !store.dir ? '<button data-act="connect">Choose app folder</button> ' : ''}<button data-act="save">${store.dir ? 'Save now' : 'Save file (download)'}</button>
    <button data-act="backup-copy">Download backup copy</button></div>
  <div class="card"><h2>Encryption</h2>
    <p>${ENC ? 'The data file is <b>encrypted</b> (AES-256-GCM, key derived from your password with PBKDF2).' : 'The data file is <b>not encrypted</b>.'} There is no password recovery.</p>
    ${ENC ? '<button data-act="pw-change">Change password</button> <button class="danger" data-act="pw-remove">Remove password</button>' : '<button class="primary" data-act="pw-set">Set a password</button>'}</div>
  <div class="card"><h2>Export</h2><p class="muted small">Exports are not encrypted.</p>
    <button class="primary" data-act="export-xlsx">Export to spreadsheet (.xlsx)</button> <button data-act="export-json">Export data (JSON)</button></div>
  <div class="card"><h2>Session</h2><button data-act="lock">Lock / close data</button> <button data-act="openfile">Replace with a data file…</button><input type="file" id="filein" accept=".json,application/json" hidden></div>`;
}

function render() {
  const app = $('#app');
  if (!DB) { app.innerHTML = viewStart(); return; }
  if (state.view === 'onboard') { app.innerHTML = viewOnboard(); return; }
  const v = { home: viewHome, paychecks: viewPaychecks, funds: viewFunds, setup: viewSetup, settings: viewSettings }[state.view] || viewHome;
  app.innerHTML = topbar() + v();
}

// ---------- export ----------
function crc32(buf) {
  if (!crc32.t) { crc32.t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32.t[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crc32.t[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cd = sum(central, c => c.length), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}" s="2"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="12" width="18" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
}
function buildXlsx() {
  const d = c => Math.round(c) / 100;
  const sheets = [];
  sheets.push(['Summary', [['Paycheck date', 'Source', 'Landed', 'Allocated', 'Unpaid', 'Spent', 'To funds', 'Left'],
    ...paychecks().map(p => { const s = pcStats(p); return [p.date, p.source, d(s.landed), d(s.alloc), d(s.unpaid), d(s.spent), d(s.funds), d(s.left)]; }), [], ['Available to spend', '', d(totalAvailable())]]]);
  sheets.push(['Accounts', [['Account', 'Kind', 'Type', 'Starting balance', 'Bank (cleared)', 'Available'], ...DB.accounts.map(a => { const f = a.kind === 'paycheck' ? acctFigures(a) : null; return [a.name, a.kind, a.type, d(a.start || 0), f ? d(f.bank) : '', f ? d(f.avail) : '']; })]]);
  const label = e => e.type === 'income' ? e.source : e.type === 'fund' ? (byId(DB.funds, e.fundId) || {}).name : e.type === 'adjust' ? 'Adjustment' : e.name || e.category;
  const sign = e => e.type === 'income' || e.type === 'adjust' ? e.amount : -e.amount;
  sheets.push(['Ledger', [['Date', 'Type', 'Paycheck', 'Account', 'Description', 'Category', 'Amount (+in / −out)', 'Paid', 'Cleared', 'Note'],
    ...[...DB.log].sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, e.type, e.paycheckId ? ((entry(e.paycheckId) || {}).date || '') : '', acctName(e.accountId), label(e), e.category || '', d(sign(e)), e.type === 'allocation' ? (e.paid ? 'Y' : 'N') : '', e.cleared ? 'Y' : (e.type === 'allocation' || e.type === 'spending' ? 'N' : ''), e.note || ''])]]);
  sheets.push(['Recurring Items', [['Name', 'Category', 'Amount', 'Varies', 'Frequency', 'Next due', 'Paid from', 'Destination', 'Active'], ...DB.items.map(i => [i.name, i.category, d(itemAmount(i)), i.mode === 'ask' ? 'Y' : 'N', i.freq, i.anchor, acctName(i.accountId), i.destId ? acctName(i.destId) : '', i.active === false ? 'N' : 'Y'])]]);
  sheets.push(['Income Sources', [['Name', 'Type', 'Frequency', 'Next pay', 'Amount', 'Deposits into'], ...DB.incomes.map(i => [i.name, i.type, i.type === 'fixed' ? i.freq : '', i.type === 'fixed' ? i.anchor : '', d(i.amount || 0), acctName(i.accountId)])]]);
  sheets.push(['Sinking Funds', [['Fund', 'Purpose', 'Balance'], ...DB.funds.map(f => [f.name, f.purpose, d(fundBalance(f.id))])]]);
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s[0])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s[1]) }))
  ];
  return zip(files);
}

// ---------- actions ----------
const A = {
  mclose: () => closeModal(false),
  nav: ({ v }) => { state.view = v; render(); },
  save: () => saveNow(),
  connect: () => connectFolder(),
  reconnect: async () => { const h = store.pending; if ((await h.requestPermission({ mode: 'readwrite' })) === 'granted') connectFolder(h); },
  openfile: () => { const f = $('#filein'); f.value = ''; f.click(); },
  newdb: () => { DB = newDB(); ENC = null; dirty = false; state.view = 'onboard'; state.step = 0; render(); },
  lock: () => { if (dirty && !confirm('You have unsaved changes. Lock anyway?')) return; DB = null; ENC = null; dirty = false; render(); },
  'backup-copy': async () => download(`finance-data-${stamp()}.json`, await serialize()),
  'export-json': () => download(`finance-export-${stamp()}.json`, JSON.stringify(DB, null, 1)),
  'export-xlsx': () => download(`finance-export-${stamp()}.xlsx`, buildXlsx()),
  'pw-set': () => passwordForm('Set a password'),
  'pw-change': () => passwordForm('Change password'),
  'pw-remove': () => { if (confirm('Remove the password? The data file will be stored unencrypted.')) { ENC = null; commit(); } },
  'add-acct': () => accountForm(), 'edit-acct': ({ id }) => accountForm(id),
  'del-acct': ({ id }) => {
    if (DB.log.some(e => e.accountId === id) || DB.items.some(i => i.accountId === id || i.destId === id) || DB.incomes.some(i => i.accountId === id)) return alert('This account is used by existing entries, items or income. Mark it inactive instead (Edit).');
    if (confirm('Delete this account?')) { DB.accounts = DB.accounts.filter(a => a.id !== id); syncOpening(); commit(); }
  },
  'add-inc': () => payAccts().length ? incomeForm() : alert('Add a paycheck account first.'), 'edit-inc': ({ id }) => incomeForm(id),
  'del-inc': ({ id }) => { if (confirm('Delete this income source? Past paychecks stay in your history.')) { DB.incomes = DB.incomes.filter(i => i.id !== id); commit(); } },
  'add-item': () => payAccts().length ? itemForm() : alert('Add a paycheck account first.'), 'edit-item': ({ id }) => itemForm(id),
  'del-item': ({ id }) => { if (confirm('Delete this recurring item? Existing allocations stay.')) { DB.items = DB.items.filter(i => i.id !== id); commit(); } },
  'add-fund': () => fundForm(), 'edit-fund': ({ id }) => fundForm(id),
  'del-fund': ({ id }) => {
    if (fundBalance(id) !== 0) return alert('Pull the remaining balance out of this fund first.');
    if (confirm('Delete this fund and its history?')) { DB.funds = DB.funds.filter(f => f.id !== id); DB.log = DB.log.filter(e => e.fundId !== id); commit(); }
  },
  'fund-move': ({ id, dir }) => fundMoveForm(id, dir),
  land: ({ inc, exp }) => { const i = byId(DB.incomes, inc); landForm(i ? { incomeId: i.id, expected: exp, date: exp <= today() ? exp : today(), amount: i.amount } : {}); },
  suggest: ({ id }) => suggestModal(id),
  'add-alloc': ({ id }) => allocForm(null, id), 'edit-alloc': ({ id }) => allocForm(id),
  'edit-spend': ({ id }) => spendForm(id),
  'del-entry': ({ id }) => { if (confirm('Delete this entry?')) { DB.log = DB.log.filter(e => e.id !== id); commit(); } },
  'open-pc': ({ id }) => { state.pcId = id; state.view = 'home'; render(); },
  'del-pc': ({ id }) => {
    if (DB.log.some(e => e.paycheckId === id && e.id !== id)) return alert('This paycheck still has allocations, spending or fund moves. Delete or move those first.');
    if (confirm('Delete this income entry?')) { DB.log = DB.log.filter(e => e.id !== id); if (state.pcId === id) state.pcId = null; commit(); }
  },
  reconcile: ({ id }) => adjustForm(id),
  'ob-back': () => { state.step--; render(); },
  'ob-next': async () => {
    const s = state.step;
    if (s === 0) {
      const pw = $('#ob-pw'), pw2 = $('#ob-pw2');
      if (pw && pw.value) {
        if (pw.value.length < 8) return $('#ob-err').textContent = 'Use at least 8 characters.';
        if (pw.value !== pw2.value) return $('#ob-err').textContent = 'Passwords do not match.';
        ENC = await makeEnc(pw.value);
      }
    }
    if (s === 1 && !payAccts().length) return alert('Add at least one paycheck account (where your pay lands).');
    if (s === 5) {
      const asof = $('#ob-asof').value || today();
      DB.log = DB.log.filter(e => !(e.type === 'income' && e.opening));
      const op = { id: uid(), type: 'income', opening: true, date: asof, amount: 0, source: 'Starting balances', accountId: null, note: '' };
      op.paycheckId = op.id; DB.log.push(op); syncOpening();
      DB.onboarded = true; state.view = 'home'; state.pcId = op.id;
      commit();
      if (suggestions(op).length) setTimeout(() => suggestModal(op.id), 0);
      return;
    }
    state.step++; render();
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault(); A[el.dataset.act](el.dataset, el);
});
const C = {
  tog: ({ id, f }, el) => {
    const e = entry(id);
    if (f === 'paid' && el.checked && e.needsConfirm) { el.checked = false; return allocForm(id); }
    e[f] = el.checked;
    if (f === 'cleared' && el.checked && e.type === 'allocation') e.paid = true;
    if (f === 'paid' && !el.checked) e.cleared = false;
    commit();
  },
  'pick-pc': (_, el) => { state.pcId = el.value; render(); }
};
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && C[el.dataset.chg]) return C[el.dataset.chg](el.dataset, el);
  if (e.target.id === 'filein' && e.target.files[0]) {
    const f = e.target.files[0];
    if (DB && state.view !== 'home' && !confirm('Replace the data currently open with this file?')) return;
    f.text().then(loadText);
  }
});
document.addEventListener('submit', e => {
  const form = e.target.closest('[data-form="spend"]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form), pc = entry(form.dataset.pc), amount = parseMoney(fd.get('amount'));
  if (amount <= 0) return;
  DB.log.push({ id: uid(), type: 'spending', paycheckId: pc.id, accountId: defaultAcct(pc), date: fd.get('date'), amount, category: fd.get('category').trim(), note: fd.get('note').trim(), cleared: false });
  commit();
});
window.addEventListener('beforeunload', e => { if (DB && dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- boot ----------
(async function boot() {
  try { const h = await kvGet('dir'); if (h) store.pending = h; } catch { /* no saved handle */ }
  render();
})();
})();
