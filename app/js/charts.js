/* Paycheck Weathervane: small hand-drawn SVG charts (no libraries). */
(function (g) {
'use strict';
const VW = g.VW, U = VW.u, esc = U.esc;

function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

// segs: [{ id, label, value }] (value in cents). income: take-home for the period.
// Slices are shares of take-home. If spending is more than income, there is no "Left" slice.
VW.shares = function (byGroup, income) {
  const segs = VW.GROUPS.filter(gr => (byGroup[gr.id] || 0) > 0).map(gr => ({ id: gr.id, label: gr.name, value: byGroup[gr.id] }));
  const out = U.sum(segs, s => s.value), left = income - out;
  return { segs, out, left, income, over: left < 0 };
};

VW.donut = function (sh, opts = {}) {
  const size = opts.size || 200, cx = size / 2, cy = size / 2, r1 = size * 0.46, r0 = size * 0.30;
  const total = Math.max(sh.income, sh.out) || 1;
  const parts = sh.segs.slice();
  if (sh.left > 0) parts.push({ id: 'left', label: 'Left over', value: sh.left });
  let a = -Math.PI / 2, paths = '';
  const hl = opts.highlight;
  for (const s of parts) {
    const span = s.value / total * Math.PI * 2;
    if (span <= 0) continue;
    const cls = `s-${s.id}${hl && hl === s.id ? ' hl' : ''}`;
    const d = span >= Math.PI * 2 - 1e-6
      ? arc(cx, cy, r0, r1, a, a + Math.PI) + arc(cx, cy, r0, r1, a + Math.PI, a + Math.PI * 2 - 1e-4)
      : arc(cx, cy, r0, r1, a, a + span - (parts.length > 1 ? 0.012 : 0));
    paths += `<path class="${cls}" d="${d}" data-seg="${s.id}"><title>${esc(s.label)}: ${U.money(s.value)} (${U.pct(s.value, sh.income)}%)</title></path>`;
    a += span;
  }
  const centerTop = sh.over ? 'Short' : 'Left';
  const centerVal = sh.over ? U.moneyR(-sh.left) : U.moneyR(Math.max(0, sh.left));
  const fs = size / 200;
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" role="img" aria-label="Where take-home pay goes">${paths || `<circle cx="${cx}" cy="${cy}" r="${(r0 + r1) / 2}" class="empty-ring"/>`}
    <text x="${cx}" y="${cy - 4 * fs}" text-anchor="middle" class="dc-k" style="font-size:${12 * fs}px">${centerTop}</text>
    <text x="${cx}" y="${cy + 18 * fs}" text-anchor="middle" class="dc-v${sh.over ? ' bad' : ''}" style="font-size:${22 * fs}px">${centerVal}</text></svg>`;
};

VW.shareTable = function (sh, opts = {}) {
  const rows = sh.segs.map(s => `<tr data-seg="${s.id}" class="${opts.highlight === s.id ? 'hl' : ''}"><td><i class="dot s-${s.id}"></i>${esc(s.label)}</td><td class="n">${U.moneyR(s.value)}</td><td class="n">${U.pct(s.value, sh.income)}%</td></tr>`).join('');
  const left = sh.over
    ? `<tr><td><i class="dot s-left"></i>Short by</td><td class="n bad">${U.moneyR(-sh.left)}</td><td class="n"></td></tr>`
    : `<tr><td><i class="dot s-left"></i>Left over</td><td class="n">${U.moneyR(sh.left)}</td><td class="n">${U.pct(sh.left, sh.income)}%</td></tr>`;
  return `<table class="share"><tbody>${rows}${left}</tbody></table>`;
};

// Money in vs money out for each paycheck.
VW.bars = function (heads) {
  if (!heads.length) return '';
  const W = 640, H = 230, L = 46, R = 8, T = 14, B = 34;
  const max = Math.max(...heads.map(h => Math.max(h.income, h.out)), 1);
  const nice = (() => { const raw = max / 100; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / mag; const s = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10; return s * mag * 100; })();
  const top = Math.ceil(max / (nice / 2)) * (nice / 2);
  const ph = H - T - B, pw = W - L - R, gw = pw / heads.length, bw = Math.min(18, gw / 2.6);
  const y = v => T + ph - v / top * ph;
  let grid = '';
  for (let i = 0; i <= 4; i++) { const v = top / 4 * i; grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${U.moneyR(v)}</text>`; }
  let bars = '';
  heads.forEach((h, i) => {
    const x = L + gw * i + gw / 2;
    bars += `<rect x="${x - bw - 1}" y="${y(h.income)}" width="${bw}" height="${Math.max(0, T + ph - y(h.income))}" class="b-in"><title>${U.fmtShort(h.date)}: in ${U.money(h.income)}</title></rect>`;
    bars += `<rect x="${x + 1}" y="${y(h.out)}" width="${bw}" height="${Math.max(0, T + ph - y(h.out))}" class="${h.left < 0 ? 'b-over' : 'b-out'}"><title>${U.fmtShort(h.date)}: out ${U.money(h.out)}, left ${U.money(h.left)}</title></rect>`;
    bars += `<text x="${x}" y="${H - 14}" text-anchor="middle">${U.fmtMD(h.date)}</text>`;
  });
  return `<div class="chartwrap"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Money in and money out for each paycheck">${grid}${bars}</svg></div>
    <div class="legend"><span><i class="sw b-in"></i>Money in</span><span><i class="sw b-out"></i>Money out (bills and set-asides)</span><span><i class="sw b-over"></i>More out than in</span></div>`;
};

VW.progress = (ratio, cls = '') => `<div class="prog ${cls}" role="progressbar" aria-valuenow="${Math.round(ratio * 100)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%"></i></div>`;
})(typeof window !== 'undefined' ? window : globalThis);
