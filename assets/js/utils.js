/* utils.js - formatting, safe HTML, statistics (incl. Kruskal-Wallis and chi-square), SHA-256 and file helpers shared by all modules. */
(function () {
  'use strict';

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  // ---------- formatting ----------
  const fmtPct = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)}%` : 'n/a');
  const fmtPp = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)} pp` : 'n/a');
  const fmtSignedPct = (v, d = 1) => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : 'n/a');
  const fmtNum = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : 'n/a');
  const fmtMin = (v, d = 1) => (isNum(v) ? `${v.toFixed(d)} min` : 'n/a');
  const fmtSigned = (v, d = 1, unit = '') => (isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}${unit}` : 'n/a');
  const fmtScore = (v, d = 2) => (isNum(v) ? `${v.toFixed(d)} / 10` : 'n/a');
  const fmtP = (p) => (!isNum(p) ? 'n/a' : p < 0.001 ? '< 0.001' : p.toFixed(3));
  function fmtByUnit(v, unit) {
    switch (unit) {
      case 'pct': return fmtPct(v);
      case 'pp': return fmtPp(v);
      case 'min': return fmtMin(v);
      case 'score': return isNum(v) ? v.toFixed(2) : 'n/a';
      case 'perday': return isNum(v) ? `${v.toFixed(1)} a day` : 'n/a';
      case 'int': return fmtNum(v, 0);
      default: return fmtNum(v, 1);
    }
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (ym) => (ym ? `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : '');
  const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
  function fmtBytes(b) { return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`; }

  // ---------- safety ----------
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
  // CSV formula-injection guard: text cells starting with = + - @ tab or CR are prefixed with an apostrophe.
  // Numbers are written as numbers and are never prefixed.
  function csvCell(v) {
    if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '';
    if (typeof v === 'number') return String(v);
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function toCsv(rows, columns) {
    const head = columns.map((c) => csvCell(c.label || c.key)).join(',');
    const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','));
    return [head, ...body].join('\r\n');
  }
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------- statistics ----------
  const vals = (arr) => arr.filter(isNum);
  function mean(arr) { const a = vals(arr); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  function median(arr) {
    const a = vals(arr).sort((x, y) => x - y); if (!a.length) return null;
    const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function stdev(arr) {                          // sample standard deviation
    const a = vals(arr); if (a.length < 2) return null; const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  }
  function slope(xs, ys) {                       // OLS slope; needs >= 3 points
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    if (p.length < 3) return null;
    const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
    const den = p.reduce((s, [x]) => s + (x - mx) ** 2, 0);
    return den ? p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / den : null;
  }
  function linreg(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    const b = slope(p.map((q) => q[0]), p.map((q) => q[1])); if (b === null) return null;
    const a = mean(p.map((q) => q[1])) - b * mean(p.map((q) => q[0]));
    return { a, b, n: p.length };
  }
  // Regularised incomplete beta (continued fraction, Numerical Recipes) for Student t p-values.
  function lgamma(x) {
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(a, b, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  const tTwoSidedP = (t, df) => ibeta(df / 2, 0.5, df / (df + t * t));
  function pearson(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    const n = p.length; if (n < 4) return { r: null, p: null, n };
    const mx = mean(p.map((q) => q[0])), my = mean(p.map((q) => q[1]));
    let sxy = 0, sxx = 0, syy = 0;
    p.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    if (!sxx || !syy) return { r: null, p: null, n };
    const r = sxy / Math.sqrt(sxx * syy);
    const t = Math.abs(r) >= 1 ? Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
    return { r, p: Number.isFinite(t) ? tTwoSidedP(t, n - 2) : 0, n };
  }
  function ranks(a) {                            // average ranks for ties
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; }
    return r;
  }
  function spearman(xs, ys) {
    const p = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
    return pearson(ranks(p.map((q) => q[0])), ranks(p.map((q) => q[1])));
  }
  function describeCorr(r) {
    if (!isNum(r)) return 'not measurable';
    const a = Math.abs(r), dir = r > 0 ? 'positive' : 'negative';
    return a < 0.1 ? 'no meaningful' : a < 0.3 ? `weak ${dir}` : a < 0.5 ? `moderate ${dir}` : `strong ${dir}`;
  }
  // linear-interpolation quantile (same as numpy "linear")
  function quantile(arr, q) {
    const a = vals(arr).sort((x, y) => x - y); if (!a.length) return null;
    const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return a[lo] + (a[hi] - a[lo]) * (pos - lo);
  }
  // Regularised incomplete gamma P(a, x) and Q(a, x) (Numerical Recipes) for chi-square p-values.
  function gser(a, x) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-14) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  function gcf(a, x) { const FPMIN = 1e-300; let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN; c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h; }
  function gammq(a, x) { if (x <= 0) return 1; return x < a + 1 ? 1 - gser(a, x) : gcf(a, x); }
  const chi2P = (stat, df) => (isNum(stat) && df > 0 ? gammq(df / 2, stat / 2) : null);
  // Kruskal-Wallis H test with tie correction (same as scipy.stats.kruskal); groups = arrays of numbers.
  function kruskal(groups) {
    const g = groups.map(vals).filter((a) => a.length > 0); const k = g.length;
    const all = g.flat(); const N = all.length;
    if (k < 2 || N <= k) return { H: null, p: null, df: k - 1, n: N, epsilon_sq: null };
    const r = ranks(all); let off = 0, sum = 0;
    g.forEach((a) => { let rs = 0; for (let i = 0; i < a.length; i++) rs += r[off + i]; off += a.length; sum += (rs * rs) / a.length; });
    let H = (12 / (N * (N + 1))) * sum - 3 * (N + 1);
    const counts = new Map(); all.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
    let t = 0; counts.forEach((c) => { t += c * c * c - c; });
    const C = 1 - t / (N * N * N - N); if (C > 0) H /= C;
    return { H, p: chi2P(H, k - 1), df: k - 1, n: N, epsilon_sq: (H - k + 1) / (N - k) };
  }
  // Pearson chi-square test of independence for a contingency table (array of rows), no continuity correction.
  function chiSquare(table) {
    const rows = table.filter((r) => r.reduce((s, v) => s + v, 0) > 0);
    const cols = rows.length ? rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0)) : [];
    const keep = cols.map((c) => c > 0);
    const t = rows.map((r) => r.filter((_, j) => keep[j])); const cs = cols.filter((c) => c > 0);
    const N = cs.reduce((s, v) => s + v, 0);
    if (t.length < 2 || cs.length < 2) return { chi2: null, p: null, df: 0, cramers_v: null, n: N, minExpected: null };
    let chi2 = 0, minE = Infinity;
    t.forEach((r) => { const rs = r.reduce((s, v) => s + v, 0); r.forEach((o, j) => { const e = (rs * cs[j]) / N; minE = Math.min(minE, e); chi2 += ((o - e) ** 2) / e; }); });
    const df = (t.length - 1) * (cs.length - 1);
    return { chi2, p: chi2P(chi2, df), df, cramers_v: Math.sqrt(chi2 / (N * (Math.min(t.length, cs.length) - 1))), n: N, minExpected: minE };
  }
  // two-sided 95% critical value of Student t (bisection on the exact p-value)
  function tCrit(df, alpha = 0.05) {
    if (!(df > 0)) return null; let lo = 0, hi = 100;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tTwoSidedP(mid, df) > alpha) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  function meanCI(arr) {
    const a = vals(arr); const n = a.length; const m = mean(a); const sd = stdev(a);
    if (n < 2 || sd === null) return { mean: m, n, lo: null, hi: null, sd };
    const h = tCrit(n - 1) * sd / Math.sqrt(n); return { mean: m, n, lo: m - h, hi: m + h, sd };
  }
  function describeEffect(eps) { if (!isNum(eps)) return 'n/a'; return eps < 0.01 ? 'negligible' : eps < 0.06 ? 'small' : eps < 0.14 ? 'medium' : 'large'; }

  // ---------- SHA-256 (pure JavaScript, synchronous; works from file:// where crypto.subtle may be unavailable) ----------
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str); const l = bytes.length;
    const nBlocks = ((l + 9 + 63) >> 6); const w = new Uint32Array(nBlocks * 16);
    for (let i = 0; i < l; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8);
    w[nBlocks * 16 - 1] = l * 8; w[nBlocks * 16 - 2] = Math.floor(l / 0x20000000);
    let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const W = new Uint32Array(64); const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let b = 0; b < nBlocks; b++) {
      for (let t = 0; t < 16; t++) W[t] = w[b * 16 + t];
      for (let t = 16; t < 64; t++) { const s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3); const s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10); W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0; }
      let [a, bb, c, d, e, f, g, hh] = h;
      for (let t = 0; t < 64; t++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25); const ch = (e & f) ^ (~e & g); const t1 = (hh + S1 + ch + K256[t] + W[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22); const maj = (a & bb) ^ (a & c) ^ (bb & c); const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      h = [(h[0] + a) >>> 0, (h[1] + bb) >>> 0, (h[2] + c) >>> 0, (h[3] + d) >>> 0, (h[4] + e) >>> 0, (h[5] + f) >>> 0, (h[6] + g) >>> 0, (h[7] + hh) >>> 0];
    }
    return h.map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  window.ErUtils = { isNum, fmtPct, fmtPp, fmtSignedPct, fmtNum, fmtMin, fmtSigned, fmtScore, fmtP, fmtByUnit, fmtBytes, monthLabel, hourLabel, MONTHS, esc, csvCell, toCsv,
    download, stamp, mean, median, stdev, quantile, slope, linreg, pearson, spearman, ranks, describeCorr, describeEffect, tTwoSidedP, chi2P, kruskal, chiSquare, tCrit, meanCI,
    sha256Hex, debounce };
})();
