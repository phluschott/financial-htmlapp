(() => {
'use strict';

/* ======================================================================
   Paycheck Planner
   - All money is stored as integer cents.
   - Paychecks come from the income schedules; each paycheck covers the span until the next one.
   - Recurring items are assigned to the paycheck that precedes their due date (overridable).
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
const FILE = 'finance-data.json';
const VERSION = '1.0.0';

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
const state = { view: 'plan', month: null, step: 0 };

const newDB = () => ({
  version: 2, onboarded: false, created: new Date().toISOString(), updated: '',
  incomes: [],   // { id, name, type: fixed|variable, freq, anchor, day2, amount, active }
  items: [],     // { id, name, category, mode: fixed|ask, amount, lastAmount, freq, anchor, day2, dest, active }
  funds: [],     // { id, name, purpose }
  occ: {},       // per-occurrence overrides keyed "itemId:dueDate": { amount, paid, cleared, skip, moveTo, confirmed }
  pays: [],      // paycheck overrides { key: "incomeId:date", amount, landed } and one-off income { key: null, name, date, amount }
  extras: [],    // one-off lines { id, headDate, date, name, category, amount, paid, cleared }
  fundMoves: []  // { id, fundId, headDate, date, amount (+ in / − out), note }
});
function migrate(d) {
  const n = newDB();
  for (const k of Object.keys(n)) if (d[k] === undefined) d[k] = n[k];
  d.version = 2; d.onboarded = d.onboarded !== false;
  return d;
}

// ---------- domain ----------
const byId = (arr, id) => arr.find(x => x.id === id);
const itemAmount = it => it.mode === 'fixed' ? (it.amount || 0) : (it.lastAmount ?? it.amount ?? 0);
const dow = iso => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(toDays(iso) * DAY).getUTCDay()];
const fmtShort = iso => `${dow(iso)} ${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8)}`;
const monthKey = iso => iso.slice(0, 7);
const monthStart = k => k + '-01';
const monthShift = (k, n) => { const [y, m] = k.split('-').map(Number); const i = y * 12 + m - 1 + n; return `${Math.floor(i / 12)}-${pad(i % 12 + 1)}`; };
const monthLabel = k => { const [y, m] = k.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] + ' ' + y; };

const activeFixed = () => DB.incomes.filter(i => i.type === 'fixed' && i.active !== false);
function nextHeadAfter(iso) {
  let best = null;
  for (const i of activeFixed()) {
    const o = occurrences(i, addDays(iso, 1), addDays(iso, 400))[0];
    if (o && (!best || o < best)) best = o;
  }
  return best || addDays(iso, 14);
}
// Paychecks ("heads") dated in [from, to). Each head covers [date, end) — until the next paycheck.
function computeHeads(from, to) {
  const byDate = new Map();
  for (const inc of activeFixed()) {
    for (const date of occurrences(inc, from, to)) {
      const key = inc.id + ':' + date, o = DB.pays.find(p => p.key === key);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push({ key, incomeId: inc.id, name: inc.name, date, amount: o ? o.amount : inc.amount, landed: !!(o && o.landed), sched: true });
    }
  }
  if (!byDate.size) for (const p of DB.pays) if (!p.key && p.date >= from && p.date < to && !byDate.has(p.date)) byDate.set(p.date, []);
  const dates = [...byDate.keys()].sort();
  return dates.map((d, i) => ({ date: d, end: dates[i + 1] || nextHeadAfter(d), pays: byDate.get(d), lines: [], moves: [], extraPays: [] }));
}
const nextPayDate = () => (computeHeads(today(), addDays(today(), 420))[0] || {}).date || null;

// Build the plan for a month: every paycheck dated in the month, plus the in-progress one if it started earlier.
function buildPlan(mk) {
  const from = monthStart(mk), to = monthStart(monthShift(mk, 1));
  const H = computeHeads(addDays(from, -60), addDays(to, 60));
  if (!H.length) return { heads: [], all: H };
  const at = d => H.find(h => d >= h.date && d < h.end);
  const lo = H[0].date, hi = H[H.length - 1].end;
  for (const it of DB.items) {
    if (it.active === false) continue;
    for (const due of occurrences(it, lo, hi)) {
      const key = it.id + ':' + due, o = DB.occ[key] || {};
      const h = o.moveTo ? H.find(x => x.date === o.moveTo) : at(due);
      if (!h) continue;
      h.lines.push({
        kind: 'item', key, it, due, name: it.name, category: it.category, dest: it.dest,
        amount: o.amount !== undefined ? o.amount : itemAmount(it), paid: !!o.paid, cleared: !!o.cleared, skip: !!o.skip,
        needsConfirm: it.mode === 'ask' && !o.confirmed
      });
    }
  }
  for (const x of DB.extras) { const h = H.find(h => h.date === x.headDate); if (h) h.lines.push({ kind: 'extra', key: x.id, x, due: x.date, name: x.name, category: x.category, dest: x.dest, amount: x.amount, paid: x.paid, cleared: x.cleared, skip: false }); }
  for (const m of DB.fundMoves) { const h = H.find(h => h.date === m.headDate); if (h) h.moves.push(m); }
  for (const p of DB.pays) if (!p.key) { const h = at(p.date); if (h) h.extraPays.push(p); }

  for (const h of H) {
    const rows = [];
    h.pays.forEach(p => rows.push({ t: 0, date: h.date, kind: 'pay', pay: p, name: p.name, amount: p.amount }));
    h.extraPays.forEach(p => rows.push({ t: 0, date: p.date, kind: 'xpay', pay: p, name: p.name, amount: p.amount }));
    h.moves.forEach(m => { const f = byId(DB.funds, m.fundId) || { name: '?' }; rows.push({ t: m.amount < 0 ? 0 : 1, date: m.date, kind: 'fund', m, name: (m.amount < 0 ? 'From fund: ' : 'To fund: ') + f.name, category: 'Sinking fund', amount: Math.abs(m.amount) }); });
    h.lines.forEach(l => rows.push({ ...l, t: 1, date: l.due }));
    // Outgoing rows dated before their paycheck are paid from it, so they sort no earlier than the paycheck date.
    rows.forEach(r => { r.sd = r.t === 1 && r.date < h.date ? h.date : r.date; });
    rows.sort((a, b) => a.sd.localeCompare(b.sd) || a.t - b.t || a.name.localeCompare(b.name));
    let run = 0, income = 0, out = 0, minRun = Infinity, minDate = null;
    for (const r of rows) {
      if (r.t === 0) { run += r.amount; income += r.amount; }
      else if (!r.skip) { run -= r.amount; out += r.amount; }
      r.run = run;
      if (r.t === 1 && !r.skip && run < minRun) { minRun = run; minDate = r.date; }
    }
    h.rows = rows; h.income = income; h.out = out; h.left = run; h.minRun = minRun; h.minDate = minDate;
    h.landed = h.pays.length ? h.pays.every(p => p.landed) : true;
  }
  const heads = H.filter(h => h.date >= from && h.date < to);
  let inProgress = null;
  const np = nextPayDate();
  if (np && monthKey(np) === mk) {
    inProgress = H.find(h => h.date < from && h.date <= today() && today() < h.end) || null;
    if (inProgress) heads.unshift(inProgress);
  }
  return { heads, all: H, inProgress, next: np };
}

// ---------- history protection ----------
// When an amount changes, freeze past occurrences at their old value so earlier months do not change.
function freezeItem(it) {
  for (const due of occurrences(it, addDays(today(), -400), today())) {
    const o = DB.occ[it.id + ':' + due] = DB.occ[it.id + ':' + due] || {};
    if (o.amount === undefined) o.amount = itemAmount(it);
  }
}
function freezeIncome(inc) {
  for (const date of occurrences(inc, addDays(today(), -400), today())) {
    const key = inc.id + ':' + date;
    if (!DB.pays.some(p => p.key === key)) DB.pays.push({ key, incomeId: inc.id, name: inc.name, date, amount: inc.amount, landed: true });
  }
}

// ---------- mutations ----------
function commit() {
  dirty = true; saveErr = '';
  if (store.dir) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
  render();
}
const fundBalance = id => sum(DB.fundMoves.filter(m => m.fundId === id), m => m.amount);
const setOcc = (key, patch) => { DB.occ[key] = Object.assign(DB.occ[key] || {}, patch); };
const planMonth = () => state.month || (nextPayDate() ? monthKey(nextPayDate()) : monthKey(today()));

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
  } else if (obj && Array.isArray(obj.incomes) && Array.isArray(obj.items)) { DB = migrate(obj); ENC = null; }
  else { alert('That file is not a valid data file.'); return false; }
  dirty = false; state.view = DB.onboarded ? 'plan' : 'onboard'; state.step = 0; state.month = null; state.scroll = true;
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
// ---------- helpers for forms ----------
let lastPlan = null;
const headOptions = () => {
  const H = (lastPlan && lastPlan.all.length) ? lastPlan.all : computeHeads(addDays(today(), -45), addDays(today(), 120));
  return H.map(h => [h.date, fmtShort(h.date) + ' paycheck']);
};
const nearHeadOptions = () => computeHeads(addDays(today(), -14), addDays(today(), 120)).map(h => [h.date, fmtShort(h.date) + ' paycheck']);
function upsertPay(p, patch) {
  let o = DB.pays.find(x => x.key === p.key);
  if (!o) { o = { key: p.key, incomeId: p.incomeId, name: p.name, date: p.date, amount: p.amount, landed: false }; DB.pays.push(o); }
  Object.assign(o, patch);
}

// ---------- entity forms ----------
function incomeForm(id) {
  const i = id ? byId(DB.incomes, id) : { type: 'fixed', freq: 'biweekly', anchor: today(), amount: 0, name: '' };
  return modal({
    title: id ? 'Edit income source' : 'Add income source',
    body: fld('Name (e.g. Main job)', 'name', i.name, 'required')
      + sel('Type', 'type', [['fixed', 'Fixed — paid on a schedule'], ['variable', 'Variable — I enter it when it lands']], i.type)
      + sel('How often', 'freq', FREQS.filter(f => f[0] !== 'once'), i.freq, 'data-showif="type=fixed"')
      + fld('A pay date (next one, or any past one)', 'anchor', i.anchor, 'type="date"', 'data-showif="type=fixed"')
      + fld('Second pay day of month (1–31)', 'day2', i.day2 || '', 'inputmode="numeric"', 'data-showif="freq=semimonthly"')
      + money$('Amount per paycheck', 'amount', i.amount, 'data-showif="type=fixed"')
      + chk('Active', 'active', i.active !== false),
    onSubmit: fd => {
      const o = id ? i : { id: uid() };
      const amount = parseMoney(fd.get('amount'));
      if (!fd.get('name').trim()) return 'Name is required.';
      if (fd.get('type') === 'fixed' && !amount) return 'Enter the paycheck amount.';
      if (id && o.type === 'fixed' && o.amount !== amount) freezeIncome(o);
      Object.assign(o, { name: fd.get('name').trim(), type: fd.get('type'), freq: fd.get('freq'), anchor: fd.get('anchor') || today(), day2: fd.get('day2') ? +fd.get('day2') : null, amount, active: fd.get('active') === 'on' });
      if (!id) DB.incomes.push(o);
      commit();
    }
  });
}
function itemForm(id) {
  const it = id ? byId(DB.items, id) : { category: 'Subscription', mode: 'fixed', freq: 'monthly', anchor: today(), amount: 0, name: '' };
  return modal({
    title: id ? 'Edit recurring item' : 'Add recurring item',
    body: fld('Name', 'name', it.name, 'required')
      + sel('Category', 'category', CATS, it.category)
      + sel('Amount', 'mode', [['fixed', 'Fixed — same every time'], ['ask', 'Varies — I confirm each time']], it.mode)
      + money$('Typical amount', 'amount', it.mode === 'ask' ? (it.lastAmount ?? it.amount) : it.amount)
      + sel('How often', 'freq', FREQS, it.freq)
      + fld('Next due date', 'anchor', it.anchor, 'type="date"')
      + fld('Second due day of month (1–31)', 'day2', it.day2 || '', 'inputmode="numeric"', 'data-showif="freq=semimonthly"')
      + fld('Goes to (e.g. Ally Savings)', 'dest', it.dest || '', '', 'data-showif="category=Transfer"')
      + chk('Active', 'active', it.active !== false),
    onSubmit: fd => {
      if (!fd.get('name').trim()) return 'Name is required.';
      const o = id ? it : { id: uid() }, amount = parseMoney(fd.get('amount'));
      if (id && (o.mode !== fd.get('mode') || itemAmount(o) !== amount)) freezeItem(o);
      Object.assign(o, { name: fd.get('name').trim(), category: fd.get('category'), mode: fd.get('mode'), amount, freq: fd.get('freq'), anchor: fd.get('anchor') || today(), day2: fd.get('day2') ? +fd.get('day2') : null, dest: fd.get('category') === 'Transfer' ? fd.get('dest').trim() : '', active: fd.get('active') === 'on' });
      if (o.mode === 'ask') o.lastAmount = amount;
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
      if (!fd.get('name').trim()) return 'Name is required.';
      const o = id ? f : { id: uid() };
      Object.assign(o, { name: fd.get('name').trim(), purpose: fd.get('purpose').trim() });
      if (!id) DB.funds.push(o);
      commit();
    }
  });
}

// ---------- plan modals ----------
function payForm(headDate, key) {
  const h = lastPlan.all.find(x => x.date === headDate);
  const p = h.pays.find(x => x.key === key);
  return modal({
    title: `${p.name} — ${fmtShort(p.date)}`,
    body: '<p class="help">Change the amount if this paycheck came in different, and tick Landed once the money has arrived.</p>'
      + money$('Amount', 'amount', p.amount) + chk('Landed (money has arrived)', 'landed', p.landed)
      + '<button type="button" class="link" data-act="reset-pay" data-key="' + esc(key) + '">Reset to the scheduled amount</button>',
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      upsertPay(p, { amount, landed: fd.get('landed') === 'on' }); commit();
    }
  });
}
function extraIncomeForm(headDate, id) {
  const p = id ? DB.pays.find(x => x.id === id) : { name: 'Extra income', date: headDate >= today() ? headDate : today(), amount: 0 };
  return modal({
    title: id ? 'Edit extra income' : 'Add extra / variable income',
    body: '<p class="help">Income that landed outside your fixed paychecks (side work, refund, gift). It adds to the paycheck period its date falls in.</p>'
      + fld('Description', 'name', p.name, 'required') + dateF('Date it landed', 'date', p.date) + money$('Amount', 'amount', p.amount)
      + (id ? `<button type="button" class="link danger" data-act="del-xpay" data-id="${id}">Delete this income</button>` : ''),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      const o = id ? p : { id: uid(), key: null, incomeId: null, landed: true };
      Object.assign(o, { name: fd.get('name').trim() || 'Extra income', date: fd.get('date'), amount });
      if (!id) DB.pays.push(o);
      commit();
    }
  });
}
function lineForm(headDate, key) {
  const h = lastPlan.all.find(x => x.date === headDate), l = h.lines.find(x => x.key === key);
  if (l.kind === 'item') {
    const natural = (lastPlan.all.find(x => l.due >= x.date && l.due < x.end) || h).date;
    return modal({
      title: `${l.name} — due ${fmtShort(l.due)}`,
      body: money$(l.needsConfirm ? 'Amount this time (confirm)' : 'Amount', 'amount', l.amount)
        + chk('Paid', 'paid', l.paid) + chk('Cleared (shows in the bank)', 'cleared', l.cleared)
        + sel('Pay this from', 'moveTo', headOptions(), h.date)
        + chk('Skip this time (not due / handled elsewhere)', 'skip', l.skip),
      onSubmit: fd => {
        const amount = parseMoney(fd.get('amount')); if (amount < 0) return 'Enter an amount.';
        const cleared = fd.get('cleared') === 'on', paid = fd.get('paid') === 'on' || cleared, mv = fd.get('moveTo');
        setOcc(l.key, { amount, paid, cleared, confirmed: true, skip: fd.get('skip') === 'on', moveTo: mv === natural ? undefined : mv });
        if (l.it.mode === 'ask') l.it.lastAmount = amount;
        commit();
      }
    });
  }
  const x = l.x;
  return modal({
    title: 'Edit ' + x.name,
    body: fld('Name', 'name', x.name, 'required') + sel('Category', 'category', CATS, x.category) + (x.category === 'Transfer' ? fld('Goes to', 'dest', x.dest || '') : '')
      + money$('Amount', 'amount', x.amount) + dateF('Date', 'date', x.date) + sel('Pay this from', 'headDate', headOptions(), x.headDate)
      + chk('Paid', 'paid', x.paid) + chk('Cleared', 'cleared', x.cleared)
      + `<button type="button" class="link danger" data-act="del-extra" data-id="${x.id}">Delete this line</button>`,
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      const cleared = fd.get('cleared') === 'on';
      Object.assign(x, { name: fd.get('name').trim(), category: fd.get('category'), dest: fd.get('dest') ? fd.get('dest').trim() : x.dest, amount, date: fd.get('date'), headDate: fd.get('headDate'), paid: fd.get('paid') === 'on' || cleared, cleared });
      commit();
    }
  });
}
function addLineForm(headDate, presetAmount = 0) {
  const debts = DB.items.filter(i => i.category === 'Debt payment' && i.active !== false);
  return modal({
    title: 'Add to this paycheck',
    body: sel('What is it?', 'kind', [['debt', 'Extra payment on a debt'], ['transfer', 'Send money to savings / another account'], ['bill', 'One-time bill or expense'], ['fundin', 'Put into a sinking fund'], ['fundout', 'Pull back from a sinking fund']], presetAmount ? 'transfer' : 'debt')
      + sel('Which debt', 'itemId', [['', '— other —'], ...debts.map(d => [d.id, d.name])], '', 'data-showif="kind=debt"')
      + fld('Name', 'name', '', '', 'data-showif="kind=debt|transfer|bill"')
      + fld('Goes to (e.g. Ally Savings)', 'dest', '', '', 'data-showif="kind=transfer"')
      + sel('Fund', 'fundId', DB.funds.map(f => [f.id, `${f.name} (${money(fundBalance(f.id))})`]), '', 'data-showif="kind=fundin|fundout"')
      + money$('Amount', 'amount', presetAmount) + dateF('Date', 'date', headDate >= today() ? headDate : today()) + fld('Note (optional)', 'note', '', '', 'data-showif="kind=fundin|fundout"')
      + sel('Pay this from', 'headDate', headOptions(), headDate),
    after: form => form.elements.itemId.addEventListener('change', () => {
      const it = byId(DB.items, form.elements.itemId.value); if (it) form.elements.name.value = 'Extra: ' + it.name;
    }),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')), kind = fd.get('kind'); if (amount <= 0) return 'Enter an amount.';
      if (kind === 'fundin' || kind === 'fundout') {
        const fid = fd.get('fundId'); if (!fid) return 'Add a sinking fund first (Sinking funds page).';
        if (kind === 'fundout' && amount > fundBalance(fid)) return 'That is more than the fund holds.';
        DB.fundMoves.push({ id: uid(), fundId: fid, headDate: fd.get('headDate'), date: fd.get('date'), amount: kind === 'fundout' ? -amount : amount, note: fd.get('note').trim() });
      } else {
        let name = fd.get('name').trim(); if (!name) return 'Give it a name.';
        if (kind === 'debt' && fd.get('itemId') && !/^extra/i.test(name)) name = 'Extra: ' + name;
        DB.extras.push({ id: uid(), headDate: fd.get('headDate'), date: fd.get('date'), name, category: kind === 'debt' ? 'Debt payment' : kind === 'transfer' ? 'Transfer' : 'Bill', dest: kind === 'transfer' ? fd.get('dest').trim() : '', amount, paid: false, cleared: false });
      }
      commit();
    }
  });
}
function fundMoveForm(fundId, dir) {
  if (!DB.funds.length) return alert('Add a sinking fund first.');
  const opts = nearHeadOptions(), nx = nextPayDate();
  return modal({
    title: 'Move money to / from a sinking fund',
    body: sel('Fund', 'fundId', DB.funds.map(f => [f.id, `${f.name} (${money(fundBalance(f.id))})`]), fundId || DB.funds[0].id)
      + sel('Direction', 'dir', [['in', 'Put into fund (comes out of the paycheck)'], ['out', 'Pull back out of fund (adds to the paycheck)']], dir || 'in')
      + money$('Amount', 'amount', 0) + dateF('Date', 'date', nx && nx > today() ? nx : today()) + sel('Applies to', 'headDate', opts, nx || (opts[0] || [])[0]) + fld('Note', 'note', ''),
    onSubmit: fd => {
      const amount = parseMoney(fd.get('amount')); if (amount <= 0) return 'Enter an amount.';
      const out = fd.get('dir') === 'out';
      if (out && amount > fundBalance(fd.get('fundId'))) return 'That is more than the fund holds.';
      if (!fd.get('headDate')) return 'Add an income source first so there is a paycheck to apply this to.';
      DB.fundMoves.push({ id: uid(), fundId: fd.get('fundId'), headDate: fd.get('headDate'), date: fd.get('date'), amount: out ? -amount : amount, note: fd.get('note').trim() });
      commit();
    }
  });
}
function passwordForm(title) {
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
  const nav = [['plan', 'Plan'], ['funds', 'Sinking funds'], ['setup', 'Setup'], ['settings', 'Settings']];
  return `<div class="topbar"><span class="brand">Paycheck Planner</span><div class="nav">${nav.map(([k, t]) => `<button data-act="nav" data-v="${k}" class="${state.view === k ? 'on' : ''}">${t}</button>`).join('')}</div><span id="status">${statusHtml()}</span></div>`;
}
function viewStart() {
  return `<div class="start card"><h2>Paycheck Planner</h2>
    <p class="muted">See what each paycheck has to pay, when, and what is left to play with. Your data stays on this computer in a file you control.</p>
    ${store.pending ? `<button class="opt primary" data-act="reconnect">Reconnect to “${esc(store.pending.name)}”<small>Continue where you left off</small></button>` : ''}
    ${fsa ? `<button class="opt" data-act="connect">Choose app folder<small>Chrome / Edge: autosaves ${FILE} (and backups) into the folder you pick</small></button>` : ''}
    <button class="opt" data-act="openfile">Open a data file…<small>${fsa ? 'Or pick' : 'Pick'} ${FILE} (or a backup)${fsa ? '' : ' — this browser cannot autosave, so use Save file to download updates'}</small></button>
    <button class="opt" data-act="newdb">Start new<small>Set up your income and bills</small></button>
    <input type="file" id="filein" accept=".json,application/json" hidden></div>`;
}

function secIncomes() {
  const rows = DB.incomes.map(i => `<tr><td>${esc(i.name)}${i.active === false ? ' <span class="chip">inactive</span>' : ''}</td><td>${i.type === 'fixed' ? FREQS.find(f => f[0] === i.freq)[1] : 'Variable — entered when it lands'}</td><td class="num">${i.type === 'fixed' ? money(i.amount) : '—'}</td><td class="num"><button class="link" data-act="edit-inc" data-id="${i.id}">Edit</button><button class="link danger" data-act="del-inc" data-id="${i.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Income</h2><button class="primary" data-act="add-inc">+ Add income</button></div>
    <p class="help">Fixed income creates your paychecks automatically (for example every other Friday). Variable income is added on the Plan page when it lands.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Schedule</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No income yet.</td></tr>'}</tbody></table></div></div>`;
}
function secItems() {
  const rows = [...DB.items].sort((a, b) => CATS.indexOf(a.category) - CATS.indexOf(b.category) || a.name.localeCompare(b.name)).map(i => `<tr><td>${esc(i.name)}${i.active === false ? ' <span class="chip">inactive</span>' : ''}<div class="muted small">${esc(i.category)}${i.dest ? ' → ' + esc(i.dest) : ''}</div></td><td>${FREQS.find(f => f[0] === i.freq)[1]} · next ${fmtDate(i.anchor)}</td><td class="num">${money(itemAmount(i))}${i.mode === 'ask' ? '<span class="chip">varies</span>' : ''}</td><td class="num"><button class="link" data-act="edit-item" data-id="${i.id}">Edit</button><button class="link danger" data-act="del-item" data-id="${i.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Bills, subscriptions &amp; debts</h2><button class="primary" data-act="add-item">+ Add item</button></div>
    <p class="help">Everything that pulls money on a schedule: subscriptions, bills, credit card minimums, mortgage, and regular transfers to savings. Each lands on the paycheck that comes before its due date.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Schedule</th><th class="num">Amount</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">Nothing added yet.</td></tr>'}</tbody></table></div></div>`;
}
function secFunds() {
  const rows = DB.funds.map(f => `<tr><td>${esc(f.name)}<div class="muted small">${esc(f.purpose)}</div></td><td class="num">${money(fundBalance(f.id))}</td><td class="num"><button class="link" data-act="edit-fund" data-id="${f.id}">Edit</button><button class="link danger" data-act="del-fund" data-id="${f.id}">Delete</button></td></tr>`).join('');
  return `<div class="card"><div class="head"><h2>Sinking funds</h2><button class="primary" data-act="add-fund">+ Add fund</button></div>
    <p class="help">Named buckets you add money to whenever you choose (new car, house, …) and can pull back from. They have no schedule.</p>
    <div class="tbl-wrap"><table><thead><tr><th>Name</th><th class="num">Balance</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">No funds yet.</td></tr>'}</tbody></table></div></div>`;
}

function viewOnboard() {
  const steps = ['Welcome', 'Income', 'Bills & debts', 'Sinking funds', 'Finish'];
  const s = state.step;
  const prog = `<div class="steps">${steps.map((t, i) => `<span class="${i === s ? 'on' : i < s ? 'done' : ''}">${i + 1}. ${t}</span>`).join('')}</div>`;
  let body = '';
  if (s === 0) {
    body = `<div class="card"><h2>Welcome</h2>
      <p class="banner" style="display:block"><b>Please note:</b> this is only a visual aid for seeing where your money is going and when. It is <b>not financial advice</b>.</p>
      <p>This app answers one question: <b>“I have a paycheck coming — what do I need to pay out of it, and what is left?”</b> Each paycheck gets its own card listing the payments due until the next paycheck, in date order.</p>
      <p class="help">Setup takes a few minutes: your income, the things that pull money on a schedule, and any sinking funds. No account balances are tracked.</p>
      <h3>Protect your data (optional)</h3>
      <p class="help">A password encrypts the data file. If you skip it, the file is plain text. You can change this any time in Settings. There is no password recovery.</p>
      ${ENC ? '<p class="pos">Password set ✓</p>' : '<label class="field"><span>Password (8+ characters, optional)</span><input type="password" id="ob-pw"></label><label class="field"><span>Repeat password</span><input type="password" id="ob-pw2"></label>'}
      <h3>Where to save</h3>
      ${store.dir ? `<p class="pos">Autosaving to folder “${esc(store.dirName)}” ✓</p>` : fsa ? '<p class="help">Pick the folder these app files live in and your data autosaves there with automatic backups.</p><button data-act="connect">Choose app folder</button>' : '<p class="help">This browser cannot autosave to a folder, so use <b>Save file</b> to download your data and <b>Open a data file</b> to load it next time.</p>'}
      <div class="error" id="ob-err"></div></div>`;
  } else if (s === 1) body = secIncomes();
  else if (s === 2) body = secItems();
  else if (s === 3) body = secFunds();
  else body = `<div class="card"><h2>All set</h2>
      <div class="kv"><span>Income sources</span><b>${DB.incomes.length}</b></div><div class="kv"><span>Recurring items</span><b>${DB.items.length}</b></div><div class="kv"><span>Sinking funds</span><b>${DB.funds.length}</b></div>
      <p class="help">You will land on the Plan page, with your next paycheck highlighted.</p></div>`;
  const nav = `<div class="actions" style="margin-top:14px">${s > 0 ? '<button data-act="ob-back">Back</button>' : ''}<button class="primary" data-act="ob-next">${s === 4 ? 'Finish setup' : s === 0 ? 'Next' : 'Next / skip'}</button></div>`;
  return `<div class="topbar"><span class="brand">Paycheck Planner — Setup</span><span id="status">${statusHtml()}</span></div>${prog}${body}${nav}`;
}

function rowHtml(h, r) {
  const d = fmtShort(r.date);
  if (r.kind === 'pay' || r.kind === 'xpay') {
    const landed = r.kind === 'xpay' || r.pay.landed;
    return `<tr class="inc"><td class="small">${d}</td><td>${esc(r.name)} <span class="chip ${landed ? 'ok' : 'proj'}">${landed ? 'landed' : r.date > today() ? 'expected' : 'confirm landed'}</span></td>
      <td class="num pos">+${money(r.amount)}</td><td class="num">${money(r.run)}</td>
      <td class="chk">${r.kind === 'pay' ? `<input type="checkbox" title="Landed" data-chg="landed" data-head="${h.date}" data-key="${esc(r.pay.key)}"${r.pay.landed ? ' checked' : ''}>` : ''}</td><td class="chk"></td>
      <td class="num"><button class="link" data-act="${r.kind === 'pay' ? 'edit-pay' : 'edit-xpay'}" data-head="${h.date}" data-key="${esc(r.pay.key || '')}" data-id="${r.pay.id || ''}">Edit</button></td></tr>`;
  }
  if (r.kind === 'fund') {
    return `<tr class="${r.t === 0 ? 'inc' : ''}"><td class="small">${d}</td><td>${esc(r.name)}${r.m.note ? `<div class="muted small">${esc(r.m.note)}</div>` : ''}</td><td class="num ${r.t === 0 ? 'pos' : ''}">${r.t === 0 ? '+' : '−'}${money(r.amount)}</td><td class="num">${money(r.run)}</td><td class="chk"></td><td class="chk"></td><td class="num"><button class="link danger" data-act="del-move" data-id="${r.m.id}">✕</button></td></tr>`;
  }
  return `<tr class="${r.paid ? 'done' : ''}${r.skip ? ' skipped' : ''}"><td class="small">${d}</td>
    <td class="name">${esc(r.name)}${r.needsConfirm && !r.skip ? '<span class="chip">confirm amount</span>' : ''}${r.skip ? '<span class="chip proj">skipped</span>' : ''}<div class="muted small">${esc(r.category)}${r.dest ? ' → ' + esc(r.dest) : ''}</div></td>
    <td class="num">${r.skip ? '—' : '−' + money(r.amount)}</td><td class="num ${r.run < 0 ? 'neg' : ''}">${r.skip ? '' : money(r.run)}</td>
    <td class="chk"><input type="checkbox" data-chg="tog" data-kind="${r.kind}" data-head="${h.date}" data-key="${esc(r.key)}" data-f="paid"${r.paid ? ' checked' : ''}></td>
    <td class="chk"><input type="checkbox" data-chg="tog" data-kind="${r.kind}" data-head="${h.date}" data-key="${esc(r.key)}" data-f="cleared"${r.cleared ? ' checked' : ''}></td>
    <td class="num"><button class="link" data-act="edit-line" data-head="${h.date}" data-key="${esc(r.key)}">Edit</button></td></tr>`;
}

function checkCard(h, plan) {
  const isNext = h.date === plan.next, t = today();
  const cur = h.date <= t && t < h.end;
  const badge = isNext ? '<span class="badge next">Next paycheck</span>' : (plan.inProgress === h ? '<span class="badge">Still in progress</span>' : cur ? '<span class="badge">Current period</span>' : '');
  const n = h.rows.filter(r => r.t === 1 && !r.skip).length;
  return `<div class="card check${isNext ? ' next' : ''}" id="chk-${h.date}">
    <div class="head"><div><h2>${fmtShort(h.date)} paycheck ${badge}</h2><span class="muted small">Pays for ${fmtDate(h.date)} – ${fmtDate(addDays(h.end, -1))} · ${n} payment${n === 1 ? '' : 's'}</span></div>
      <div class="leftbox"><div class="muted small">Left to play with</div><div class="big2 ${h.left < 0 ? 'neg' : 'pos'}">${money(h.left)}</div></div></div>
    ${h.minRun < 0 ? `<div class="banner err small">Runs short by ${money(-h.minRun)} on ${fmtShort(h.minDate)} unless something moves.</div>` : ''}
    <div class="tbl-wrap"><table class="tl"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">Left after</th><th class="chk">Paid</th><th class="chk">Clrd</th><th></th></tr></thead><tbody>${h.rows.map(r => rowHtml(h, r)).join('')}</tbody></table></div>
    <div class="actions" style="justify-content:flex-start">
      <button data-act="add-line" data-head="${h.date}">+ Add payment / allocation</button>
      ${h.left > 0 ? `<button class="primary" data-act="add-line" data-head="${h.date}" data-amt="${h.left}">Allocate what’s left (${money(h.left)})</button>` : ''}
      <button class="link" data-act="add-xpay" data-head="${h.date}">+ Extra income</button></div></div>`;
}

function viewPlan() {
  const mk = planMonth(), plan = buildPlan(mk); lastPlan = plan;
  const nav = `<div class="monthnav"><button data-act="month" data-d="-1">‹</button><h2>${monthLabel(mk)}</h2><button data-act="month" data-d="1">›</button><button class="link" data-act="month-today">Jump to next paycheck</button></div>`;
  if (!plan.all.length) return nav + `<div class="card"><p>No paychecks to show. Add a <b>fixed income source</b> in Setup and your paychecks appear here automatically.</p><button class="primary" data-act="nav" data-v="setup">Go to Setup</button></div>`;
  const inMonth = plan.heads.filter(h => h !== plan.inProgress);
  const income = sum(inMonth, h => h.income), out = sum(inMonth, h => h.out);
  const landed = sum(inMonth, h => sum(h.rows.filter(r => r.t === 0 && (r.kind !== 'pay' || r.pay.landed)), r => r.amount));
  const cats = {};
  inMonth.forEach(h => h.rows.filter(r => r.t === 1 && !r.skip).forEach(r => { cats[r.category] = (cats[r.category] || 0) + r.amount; }));
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<span class="catchip">${esc(c)} <b>${money(v)}</b>${income ? ` <span class="muted">${Math.round(v / income * 100)}%</span>` : ''}</span>`).join('');
  const summary = `<div class="card"><div class="stats" style="margin-top:0">
      <div class="stat"><div class="k">Income this month</div><div class="v">${money(income)}</div><div class="muted small">${landed >= income ? 'all landed' : `${money(landed)} landed · ${money(income - landed)} expected`}</div></div>
      <div class="stat"><div class="k">Going out</div><div class="v">${money(out)}</div></div>
      <div class="stat"><div class="k">Left to play with</div><div class="v ${income - out < 0 ? 'neg' : 'pos'}">${money(income - out)}</div></div></div>
      ${catRows ? `<div class="cats">${catRows}</div>` : ''}</div>`;
  return nav + summary + (plan.heads.length ? plan.heads.map(h => checkCard(h, plan)).join('') : '<div class="card muted">No paychecks fall in this month.</div>');
}

function viewFunds() {
  const cards = DB.funds.map(f => {
    const es = DB.fundMoves.filter(m => m.fundId === f.id).sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card"><div class="head"><div><h3>${esc(f.name)}</h3><span class="muted small">${esc(f.purpose)}</span></div><div class="big2">${money(fundBalance(f.id))}</div></div>
      <button data-act="fund-move" data-id="${f.id}" data-dir="in">Put in</button> <button data-act="fund-move" data-id="${f.id}" data-dir="out">Pull back</button> <button class="link" data-act="edit-fund" data-id="${f.id}">Edit</button> <button class="link danger" data-act="del-fund" data-id="${f.id}">Delete</button>
      <details><summary>History (${es.length})</summary><table><tbody>${es.map(e => `<tr><td class="small">${fmtDate(e.date)}</td><td>${esc(e.note)}</td><td class="num ${e.amount < 0 ? 'neg' : 'pos'}">${e.amount < 0 ? '−' : '+'}${money(Math.abs(e.amount))}</td></tr>`).join('') || '<tr><td class="muted">No activity.</td></tr>'}</tbody></table></details></div>`;
  }).join('');
  return `<div class="card"><div class="head"><h2>Sinking funds</h2><div><span class="muted small">Total held ${money(sum(DB.funds, f => fundBalance(f.id)))}</span> <button class="primary" data-act="add-fund">+ Add fund</button></div></div>
    <p class="help">Putting money in comes out of a paycheck; pulling it back adds to one. There is no schedule — move money whenever you choose. You can also do it from a paycheck card on the Plan page.</p></div>
    <div class="funds">${cards || '<div class="card muted">No funds yet.</div>'}</div>`;
}
function viewSetup() { return secIncomes() + secItems(); }
function viewSettings() {
  return `<div class="card"><h2>Storage</h2>
    <p>${store.dir ? `Autosaving to folder <b>${esc(store.dirName)}</b> (<code>${FILE}</code>). Timestamped backups go in <code>backups/</code> (at most one every 10 minutes, newest 50 kept).` : `Not connected to a folder. <b>Save file</b> downloads a timestamped copy of your data; use that file with “Open a data file” next time.`}</p>
    ${fsa && !store.dir ? '<button data-act="connect">Choose app folder</button> ' : ''}<button data-act="save">${store.dir ? 'Save now' : 'Save file (download)'}</button>
    <button data-act="backup-copy">Download backup copy</button></div>
  <div class="card"><h2>Encryption</h2>
    <p>${ENC ? 'The data file is <b>encrypted</b> (AES-256-GCM, key derived from your password with PBKDF2).' : 'The data file is <b>not encrypted</b>.'} There is no password recovery.</p>
    ${ENC ? '<button data-act="pw-change">Change password</button> <button class="danger" data-act="pw-remove">Remove password</button>' : '<button class="primary" data-act="pw-set">Set a password</button>'}</div>
  <div class="card"><h2>Export</h2><p class="muted small">Exports are not encrypted. The spreadsheet contains the month shown on the Plan page, plus your income, items and funds.</p>
    <button class="primary" data-act="export-xlsx">Export to spreadsheet (.xlsx)</button> <button data-act="export-json">Export data (JSON)</button></div>
  <div class="card"><h2>About</h2><p class="muted small">Paycheck Planner v${VERSION}. Everything runs in this page; nothing is sent anywhere.</p><p class="small"><b>A visual aid only, not financial advice.</b> It shows where your money is going and when; it does not recommend or evaluate any financial decision. It is only as accurate as what you enter.</p></div>
  <div class="card"><h2>Session</h2><button data-act="lock">Lock / close data</button> <button data-act="openfile">Replace with a data file…</button><input type="file" id="filein" accept=".json,application/json" hidden></div>`;
}

function render() {
  const app = $('#app');
  if (!DB) { app.innerHTML = viewStart(); return; }
  if (state.view === 'onboard') { app.innerHTML = viewOnboard(); return; }
  const v = { plan: viewPlan, funds: viewFunds, setup: viewSetup, settings: viewSettings }[state.view] || viewPlan;
  app.innerHTML = topbar() + v();
  if (state.view === 'plan' && state.scroll) {
    state.scroll = false;
    const el = lastPlan && lastPlan.next && document.getElementById('chk-' + lastPlan.next);
    if (el) el.scrollIntoView({ block: 'start' });
  }
}

function buildXlsx() {
  const d = c => Math.round(c) / 100, mk = planMonth(), plan = buildPlan(mk), sheets = [];
  const inMonth = plan.heads.filter(h => h !== plan.inProgress);
  const planRows = [['Paycheck', 'Date', 'What', 'Category', 'Goes to', 'Amount (+in / −out)', 'Left after', 'Paid', 'Cleared']];
  for (const h of plan.heads) for (const r of h.rows) {
    planRows.push([h.date, r.date, r.name, r.category || (r.t === 0 ? 'Income' : ''), r.dest || '', r.skip ? 0 : d(r.t === 0 ? r.amount : -r.amount), r.skip ? '' : d(r.run),
      r.t === 1 ? (r.paid ? 'Y' : 'N') : (r.kind === 'pay' ? (r.pay.landed ? 'Landed' : 'Expected') : ''), r.t === 1 && r.kind !== 'fund' ? (r.cleared ? 'Y' : 'N') : '']);
  }
  planRows.push([], ['Left to play with by paycheck']);
  for (const h of plan.heads) planRows.push([h.date, '', 'Income ' + d(h.income) + ' · Out ' + d(h.out), '', '', d(h.left)]);
  planRows.push(['Month total left', '', '', '', '', d(sum(inMonth, h => h.left))]);
  sheets.push([monthLabel(mk).slice(0, 31), planRows]);
  sheets.push(['Recurring Items', [['Name', 'Category', 'Amount', 'Varies', 'Frequency', 'Next due', 'Goes to', 'Active'], ...DB.items.map(i => [i.name, i.category, d(itemAmount(i)), i.mode === 'ask' ? 'Y' : 'N', i.freq, i.anchor, i.dest || '', i.active === false ? 'N' : 'Y'])]]);
  sheets.push(['Income', [['Name', 'Type', 'Frequency', 'Pay date', 'Amount'], ...DB.incomes.map(i => [i.name, i.type, i.type === 'fixed' ? i.freq : '', i.type === 'fixed' ? i.anchor : '', d(i.amount || 0)])]]);
  sheets.push(['Sinking Funds', [['Fund', 'Purpose', 'Balance'], ...DB.funds.map(f => [f.name, f.purpose, d(fundBalance(f.id))])]]);
  sheets.push(['Fund History', [['Date', 'Fund', 'Amount (+in / −out)', 'Note'], ...[...DB.fundMoves].sort((a, b) => a.date.localeCompare(b.date)).map(m => [m.date, (byId(DB.funds, m.fundId) || {}).name || '', d(m.amount), m.note || ''])]]);
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s[0])}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
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
  'export-xlsx': () => download(`paycheck-plan-${stamp()}.xlsx`, buildXlsx()),
  'pw-set': () => passwordForm('Set a password'),
  'pw-change': () => passwordForm('Change password'),
  'pw-remove': () => { if (confirm('Remove the password? The data file will be stored unencrypted.')) { ENC = null; commit(); } },
  month: ({ d }) => { state.month = monthShift(planMonth(), +d); render(); },
  'month-today': () => { state.month = null; state.scroll = true; render(); },
  'add-inc': () => incomeForm(), 'edit-inc': ({ id }) => incomeForm(id),
  'del-inc': ({ id }) => { if (confirm('Delete this income source? Its paychecks disappear from every month, including past ones. (Mark it inactive instead to keep history.)')) { DB.incomes = DB.incomes.filter(i => i.id !== id); commit(); } },
  'add-item': () => itemForm(), 'edit-item': ({ id }) => itemForm(id),
  'del-item': ({ id }) => { if (confirm('Delete this item? It disappears from every month, including past ones. (Mark it inactive instead to keep history.)')) { DB.items = DB.items.filter(i => i.id !== id); commit(); } },
  'add-fund': () => fundForm(), 'edit-fund': ({ id }) => fundForm(id),
  'del-fund': ({ id }) => {
    if (fundBalance(id) !== 0) return alert('Pull the remaining balance out of this fund first.');
    if (confirm('Delete this fund and its history?')) { DB.funds = DB.funds.filter(f => f.id !== id); DB.fundMoves = DB.fundMoves.filter(m => m.fundId !== id); commit(); }
  },
  'fund-move': ({ id, dir }) => fundMoveForm(id, dir),
  'edit-pay': ({ head, key }) => payForm(head, key),
  'reset-pay': ({ key }) => { DB.pays = DB.pays.filter(p => p.key !== key); closeModal(true); commit(); },
  'add-xpay': ({ head }) => extraIncomeForm(head), 'edit-xpay': ({ head, id }) => extraIncomeForm(head, id),
  'del-xpay': ({ id }) => { DB.pays = DB.pays.filter(p => p.id !== id); closeModal(true); commit(); },
  'add-line': ({ head, amt }) => addLineForm(head, amt ? +amt : 0),
  'edit-line': ({ head, key }) => lineForm(head, key),
  'del-extra': ({ id }) => { DB.extras = DB.extras.filter(x => x.id !== id); closeModal(true); commit(); },
  'del-move': ({ id }) => { if (confirm('Remove this fund move?')) { DB.fundMoves = DB.fundMoves.filter(m => m.id !== id); commit(); } },
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
    if (s === 4) { DB.onboarded = true; state.view = 'plan'; state.month = null; state.scroll = true; return commit(); }
    state.step++; render();
  }
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault(); A[el.dataset.act](el.dataset, el);
});
const C = {
  tog: ({ kind, key, head, f }, el) => {
    if (kind === 'item') {
      const l = lastPlan.all.find(h => h.date === head).lines.find(x => x.key === key);
      if (f === 'paid' && el.checked && l.needsConfirm) { el.checked = false; return lineForm(head, key); }
      const o = DB.occ[key] || {};
      const patch = { [f]: el.checked };
      if (f === 'cleared' && el.checked) patch.paid = true;
      if (f === 'paid' && !el.checked) patch.cleared = false;
      setOcc(key, { paid: o.paid, cleared: o.cleared, ...patch });
    } else {
      const x = byId(DB.extras, key);
      x[f] = el.checked;
      if (f === 'cleared' && el.checked) x.paid = true;
      if (f === 'paid' && !el.checked) x.cleared = false;
    }
    commit();
  },
  landed: ({ head, key }, el) => {
    const p = lastPlan.all.find(h => h.date === head).pays.find(x => x.key === key);
    upsertPay(p, { landed: el.checked }); commit();
  }
};
document.addEventListener('change', e => {
  const el = e.target.closest('[data-chg]');
  if (el && C[el.dataset.chg]) return C[el.dataset.chg](el.dataset, el);
  if (e.target.id === 'filein' && e.target.files[0]) {
    const f = e.target.files[0];
    if (DB && !confirm('Replace the data currently open with this file?')) return;
    f.text().then(loadText);
  }
});
window.addEventListener('beforeunload', e => { if (DB && dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- boot ----------
(async function boot() {
  try { const h = await kvGet('dir'); if (h) store.pending = h; } catch { /* no saved handle */ }
  render();
})();
})();
